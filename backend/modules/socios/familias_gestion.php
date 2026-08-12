<?php
declare(strict_types=1);

trait FamiliasGestion
{
    abstract private static function familyDetail(PDO $db, int $id, bool $includeHistory = false): ?array;

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = isset($body['id_familia']) && $body['id_familia'] !== ''
            ? positive_id($body['id_familia'], 'familia')
            : null;
        $name = required_text($body, 'nombre', 'nombre', 150);
        $description = optional_text($body['descripcion'] ?? null, 500);
        $members = self::normalizeMembers($body);
        if ($members === []) api_error('Seleccioná al menos un integrante para la familia.', 'VALIDATION_ERROR');
        if (count(array_filter($members, static fn(array $member): bool => $member['es_titular'])) > 1) {
            api_error('Una familia puede tener como máximo un titular activo.', 'TITULAR_DUPLICADO', 409);
        }

        $unlinkDate = valid_date($body['fecha_desvinculacion'] ?? date('Y-m-d'), 'desvinculación');
        $unlinkReason = optional_text($body['motivo_desvinculacion'] ?? null, 500);

        try {
            $saved = transaction($db, static function () use (
                $db,
                $auth,
                $id,
                $name,
                $description,
                $members,
                $unlinkDate,
                $unlinkReason
            ): array {
                $duplicate = $db->prepare(
                    'SELECT id_familia FROM familias WHERE nombre = ? AND id_familia <> ? LIMIT 1'
                );
                $duplicate->execute([$name, $id ?? 0]);
                if ($duplicate->fetch()) api_error('Ya existe otra familia con ese nombre.', 'FAMILIA_DUPLICADA', 409);

                $before = null;
                if ($id === null) {
                    $db->prepare('INSERT INTO familias (nombre, descripcion, activo) VALUES (?, ?, 1)')
                        ->execute([$name, $description]);
                    $familyId = (int)$db->lastInsertId();
                } else {
                    $lock = $db->prepare('SELECT * FROM familias WHERE id_familia = ? FOR UPDATE');
                    $lock->execute([$id]);
                    $locked = $lock->fetch();
                    if (!$locked) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);
                    if (!(bool)$locked['activo']) {
                        api_error(
                            'Reactivá la familia antes de modificar su composición.',
                            'FAMILIA_INACTIVA',
                            409
                        );
                    }
                    $before = self::familyDetail($db, $id, true) ?? $locked;
                    $familyId = $id;
                    $db->prepare('UPDATE familias SET nombre = ?, descripcion = ? WHERE id_familia = ?')
                        ->execute([$name, $description, $familyId]);
                }

                $memberIds = array_keys($members);
                $placeholders = implode(',', array_fill(0, count($memberIds), '?'));

                // Libera vínculos heredados que hayan quedado abiertos dentro de una familia inactiva.
                $releaseInactive = $db->prepare(
                    "UPDATE familias_socios fs
                     INNER JOIN familias f ON f.id_familia = fs.id_familia
                     SET fs.fecha_desvinculacion = CURDATE(),
                         fs.motivo_desvinculacion = COALESCE(fs.motivo_desvinculacion, 'FAMILIA INACTIVA')
                     WHERE fs.id_socio IN ({$placeholders})
                       AND fs.fecha_desvinculacion IS NULL
                       AND fs.id_familia <> ?
                       AND f.activo = 0"
                );
                $releaseInactive->execute(array_merge($memberIds, [$familyId]));

                $people = $db->prepare(
                    "SELECT s.id_socio, s.estado, p.apellido, p.nombre
                     FROM socios s
                     INNER JOIN socios_personas p ON p.id_socio = s.id_socio
                     WHERE s.id_socio IN ({$placeholders})
                       AND s.tipo_socio = 'PERSONA'
                     FOR UPDATE"
                );
                $people->execute($memberIds);
                $personRows = $people->fetchAll();
                if (count($personRows) !== count($memberIds)) {
                    api_error('Uno de los integrantes no existe o no es una persona.', 'SOCIO_INVALIDO');
                }

                $currentStatement = $db->prepare(
                    'SELECT * FROM familias_socios WHERE id_familia = ? AND fecha_desvinculacion IS NULL FOR UPDATE'
                );
                $currentStatement->execute([$familyId]);
                $currentLinks = [];
                foreach ($currentStatement->fetchAll() as $link) {
                    $currentLinks[(int)$link['id_socio']] = $link;
                }

                foreach ($personRows as $person) {
                    $personId = (int)$person['id_socio'];
                    if ((string)$person['estado'] !== 'ACTIVO' && !isset($currentLinks[$personId])) {
                        api_error(
                            "{$person['apellido']}, {$person['nombre']} está dado de baja y no puede incorporarse.",
                            'SOCIO_INACTIVO',
                            409
                        );
                    }
                }

                $conflicts = $db->prepare(
                    "SELECT p.apellido, p.nombre, f.nombre AS familia
                     FROM familias_socios fs
                     INNER JOIN familias f ON f.id_familia = fs.id_familia
                     INNER JOIN socios_personas p ON p.id_socio = fs.id_socio
                     WHERE fs.id_socio IN ({$placeholders})
                       AND fs.id_familia <> ?
                       AND fs.fecha_desvinculacion IS NULL
                     LIMIT 1"
                );
                $conflicts->execute(array_merge($memberIds, [$familyId]));
                if ($conflict = $conflicts->fetch()) {
                    api_error(
                        "{$conflict['apellido']}, {$conflict['nombre']} ya pertenece a {$conflict['familia']}.",
                        'SOCIO_YA_TIENE_FAMILIA',
                        409
                    );
                }

                $removedIds = array_values(array_diff(array_keys($currentLinks), $memberIds));
                if ($removedIds !== [] && !$unlinkReason) {
                    api_error(
                        'Indicá el motivo de desvinculación para quitar integrantes actuales.',
                        'MOTIVO_DESVINCULACION_REQUERIDO'
                    );
                }

                if ($removedIds !== []) {
                    $removePlaceholders = implode(',', array_fill(0, count($removedIds), '?'));
                    foreach ($removedIds as $removedId) {
                        $incorporation = (string)$currentLinks[$removedId]['fecha_incorporacion'];
                        if ($unlinkDate < $incorporation) {
                            api_error('La fecha de desvinculación no puede ser anterior a la incorporación.', 'FECHA_INVALIDA');
                        }
                    }
                    $close = $db->prepare(
                        "UPDATE familias_socios
                         SET fecha_desvinculacion = ?, motivo_desvinculacion = ?
                         WHERE id_familia = ?
                           AND id_socio IN ({$removePlaceholders})
                           AND fecha_desvinculacion IS NULL"
                    );
                    $close->execute(array_merge([$unlinkDate, $unlinkReason, $familyId], $removedIds));
                }

                // Primero desmarca titulares para permitir cambiarlo sin chocar con la UNIQUE generada.
                $db->prepare(
                    'UPDATE familias_socios SET es_titular = 0 WHERE id_familia = ? AND fecha_desvinculacion IS NULL'
                )->execute([$familyId]);

                $update = $db->prepare(
                    'UPDATE familias_socios
                     SET parentesco = ?, es_titular = ?, observaciones = ?
                     WHERE id_familia_socio = ?'
                );
                $insert = $db->prepare(
                    'INSERT INTO familias_socios
                     (id_familia, id_socio, parentesco, es_titular, observaciones, fecha_incorporacion)
                     VALUES (?, ?, ?, ?, ?, ?)'
                );

                foreach ($members as $memberId => $member) {
                    if (isset($currentLinks[$memberId])) {
                        $update->execute([
                            $member['parentesco'],
                            $member['es_titular'] ? 1 : 0,
                            $member['observaciones'],
                            (int)$currentLinks[$memberId]['id_familia_socio'],
                        ]);
                    } else {
                        $insert->execute([
                            $familyId,
                            $memberId,
                            $member['parentesco'],
                            $member['es_titular'] ? 1 : 0,
                            $member['observaciones'],
                            $member['fecha_incorporacion'],
                        ]);
                    }
                }

                $after = self::familyDetail($db, $familyId, true);
                audit_change(
                    $db,
                    $auth,
                    'FAMILIAS',
                    $id === null ? 'CREAR' : 'EDITAR',
                    'familias',
                    $familyId,
                    $id === null ? "Se creó la familia {$name}." : "Se modificó la familia {$name}.",
                    $before,
                    $after
                );
                return $after ?? [];
            });
        } catch (Throwable $error) {
            if (duplicate_key($error)) {
                $message = $error->getMessage();
                if (str_contains($message, 'uq_familias_nombre')) {
                    api_error('Ya existe otra familia con ese nombre.', 'FAMILIA_DUPLICADA', 409);
                }
                if (str_contains($message, 'uq_familias_socios_titular_activo')) {
                    api_error('La familia ya tiene un titular activo.', 'TITULAR_DUPLICADO', 409);
                }
                if (str_contains($message, 'uq_familias_socios_socio_activo')) {
                    api_error('Uno de los socios ya pertenece a otra familia activa.', 'SOCIO_YA_TIENE_FAMILIA', 409);
                }
                api_error('No se pudo guardar la familia por un dato duplicado.', 'REGISTRO_DUPLICADO', 409);
            }
            throw $error;
        }

        return ['item' => $saved, 'creada' => $id === null];
    }

    private static function cambiarEstadoDatos(
        array $auth,
        int $id,
        bool $active,
        ?string $date = null,
        ?string $reason = null
    ): array {
        $db = $auth['db'];
        $saved = transaction($db, static function () use ($db, $auth, $id, $active, $date, $reason): array {
            $statement = $db->prepare('SELECT * FROM familias WHERE id_familia = ? FOR UPDATE');
            $statement->execute([$id]);
            $locked = $statement->fetch();
            if (!$locked) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);
            if ((bool)$locked['activo'] === $active) {
                api_error(
                    $active ? 'La familia ya se encuentra activa.' : 'La familia ya se encuentra dada de baja.',
                    'ESTADO_SIN_CAMBIOS',
                    409
                );
            }

            $before = self::familyDetail($db, $id, true) ?? $locked;
            if (!$active) {
                $effectiveDate = $date ?: date('Y-m-d');
                $effectiveReason = $reason ?: 'BAJA DE FAMILIA';
                $links = $db->prepare(
                    'SELECT fecha_incorporacion FROM familias_socios
                     WHERE id_familia = ? AND fecha_desvinculacion IS NULL FOR UPDATE'
                );
                $links->execute([$id]);
                foreach ($links->fetchAll() as $link) {
                    if ($effectiveDate < (string)$link['fecha_incorporacion']) {
                        api_error('La fecha de baja no puede ser anterior a la incorporación de un integrante.', 'FECHA_INVALIDA');
                    }
                }
                $db->prepare(
                    'UPDATE familias_socios
                     SET fecha_desvinculacion = ?, motivo_desvinculacion = ?
                     WHERE id_familia = ? AND fecha_desvinculacion IS NULL'
                )->execute([$effectiveDate, $effectiveReason, $id]);
            }

            $db->prepare('UPDATE familias SET activo = ? WHERE id_familia = ?')
                ->execute([$active ? 1 : 0, $id]);
            $after = self::familyDetail($db, $id, true);
            audit_change(
                $db,
                $auth,
                'FAMILIAS',
                $active ? 'REACTIVAR' : 'DAR_BAJA',
                'familias',
                $id,
                $active
                    ? 'Se reactivó la familia. Sus integrantes anteriores permanecen en el historial.'
                    : 'Se dio de baja la familia y se cerraron sus vínculos activos.',
                $before,
                $after
            );
            return $after ?? [];
        });
        return ['item' => $saved];
    }

    private static function eliminarDefinitivoDatos(array $auth, int $id): array
    {
        $db = $auth['db'];

        try {
            return transaction($db, static function () use ($db, $auth, $id): array {
                $lock = $db->prepare('SELECT * FROM familias WHERE id_familia = ? FOR UPDATE');
                $lock->execute([$id]);
                $locked = $lock->fetch();
                if (!$locked) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);

                $before = self::familyDetail($db, $id, true) ?? $locked;
                $links = $db->prepare(
                    'SELECT COUNT(*) AS vinculos_totales,
                            COUNT(DISTINCT CASE WHEN fecha_desvinculacion IS NULL THEN id_socio END) AS socios_sin_familia
                     FROM familias_socios
                     WHERE id_familia = ?'
                );
                $links->execute([$id]);
                $impactRow = $links->fetch() ?: [];
                $impact = [
                    'socios_sin_familia' => (int)($impactRow['socios_sin_familia'] ?? 0),
                    'vinculos_eliminados' => (int)($impactRow['vinculos_totales'] ?? 0),
                ];
                $name = trim((string)($locked['nombre'] ?? '')) ?: "ID {$id}";

                // Se eliminan únicamente los vínculos familiares. Los socios y
                // todos sus pagos, estados y datos personales permanecen intactos.
                $db->prepare('DELETE FROM familias_socios WHERE id_familia = ?')->execute([$id]);
                $db->prepare('DELETE FROM familias WHERE id_familia = ?')->execute([$id]);

                audit_change(
                    $db,
                    $auth,
                    'FAMILIAS',
                    'ELIMINAR_DEFINITIVO',
                    'familias',
                    $id,
                    "Se eliminó definitivamente la familia {$name}. Sus socios quedaron sin familia y conservaron toda su información.",
                    [
                        'familia' => $before,
                        'impacto_eliminacion' => $impact,
                    ],
                    null
                );

                return [
                    'id_familia' => $id,
                    'impacto_eliminacion' => $impact,
                ];
            });
        } catch (PDOException $error) {
            if ((string)$error->getCode() === '23000') {
                api_error(
                    'No se pudo eliminar la familia porque existe otra relación protegida en la base.',
                    'FAMILIA_CON_RELACIONES_PROTEGIDAS',
                    409
                );
            }
            throw $error;
        }
    }

    private static function normalizeMembers(array $body): array
    {
        $raw = $body['integrantes'] ?? null;
        if (!is_array($raw)) {
            $raw = array_map(
                static fn(mixed $id): array => ['id_socio' => $id],
                is_array($body['integrante_ids'] ?? null) ? $body['integrante_ids'] : []
            );
        }

        $members = [];
        foreach ($raw as $item) {
            if (!is_array($item)) $item = ['id_socio' => $item];
            $id = filter_var($item['id_socio'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($id === false) continue;
            $date = valid_date($item['fecha_incorporacion'] ?? date('Y-m-d'), 'incorporación');
            $members[(int)$id] = [
                'id_socio' => (int)$id,
                'parentesco' => optional_text($item['parentesco'] ?? null, 50),
                'es_titular' => self::familyBoolean($item['es_titular'] ?? false),
                'observaciones' => optional_text($item['observaciones'] ?? null, 500),
                'fecha_incorporacion' => $date,
            ];
        }
        return $members;
    }

    private static function familyBoolean(mixed $value): bool
    {
        if (is_bool($value)) return $value;
        return in_array(strtolower(trim((string)$value)), ['1', 'true', 'si', 'sí', 'on'], true);
    }
}
