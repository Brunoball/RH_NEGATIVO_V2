<?php
declare(strict_types=1);

trait FamiliasGestion
{
    abstract private static function familyDetail(PDO $db, int $id, bool $includeHistory = false): ?array;

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = isset($body['id_familia']) && $body['id_familia'] !== '' && $body['id_familia'] !== null
            ? positive_id($body['id_familia'], 'familia')
            : null;

        $name = required_text($body, 'nombre', 'nombre de la familia', 120);
        $observations = optional_text($body['observaciones'] ?? $body['descripcion'] ?? null, 2000);
        $members = self::normalizeMembers($body);
        if ($members === []) {
            api_error('Seleccioná al menos un integrante para la familia.', 'VALIDATION_ERROR', 422);
        }

        $unlinkDate = valid_date($body['fecha_desvinculacion'] ?? date('Y-m-d'), 'desvinculación');
        if ($unlinkDate > date('Y-m-d')) {
            api_error('La fecha de desvinculación no puede ser futura.', 'VALIDATION_ERROR', 422);
        }

        try {
            $saved = transaction($db, static function () use (
                $db,
                $auth,
                $id,
                $name,
                $observations,
                $members,
                $unlinkDate
            ): array {
                $duplicate = $db->prepare(
                    'SELECT id_familia FROM familias WHERE nombre_familia = ? AND id_familia <> ? LIMIT 1'
                );
                $duplicate->execute([$name, $id ?? 0]);
                if ($duplicate->fetch()) {
                    api_error('Ya existe otra familia con ese nombre.', 'FAMILIA_DUPLICADA', 409);
                }

                $before = null;
                if ($id === null) {
                    $db->prepare(
                        'INSERT INTO familias
                         (nombre_familia, observaciones, activo, creado_en, actualizado_en)
                         VALUES (?, ?, 1, CURDATE(), CURDATE())'
                    )->execute([$name, $observations]);
                    $familyId = (int)$db->lastInsertId();
                } else {
                    $lock = $db->prepare('SELECT * FROM familias WHERE id_familia = ? FOR UPDATE');
                    $lock->execute([$id]);
                    $locked = $lock->fetch();
                    if (!$locked) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);
                    if (!(bool)$locked['activo']) {
                        api_error(
                            'Reactivá la familia antes de modificar sus integrantes.',
                            'FAMILIA_INACTIVA',
                            409
                        );
                    }

                    $before = self::familyDetail($db, $id, true) ?? $locked;
                    $familyId = $id;
                    $db->prepare(
                        'UPDATE familias
                         SET nombre_familia = ?, observaciones = ?, actualizado_en = CURDATE()
                         WHERE id_familia = ?'
                    )->execute([$name, $observations, $familyId]);
                }

                $memberIds = array_keys($members);
                $placeholders = implode(',', array_fill(0, count($memberIds), '?'));

                // Bloquea los socios elegidos para que dos altas simultáneas no
                // puedan asignar al mismo socio a dos familias diferentes.
                $people = $db->prepare(
                    "SELECT id_socio, nombre, dni, vigente
                     FROM socios
                     WHERE id_socio IN ({$placeholders})
                     FOR UPDATE"
                );
                $people->execute($memberIds);
                $personRows = $people->fetchAll();
                if (count($personRows) !== count($memberIds)) {
                    api_error('Uno de los integrantes seleccionados no existe.', 'SOCIO_INVALIDO', 422);
                }

                $peopleById = [];
                foreach ($personRows as $person) {
                    $peopleById[(int)$person['id_socio']] = $person;
                }

                $currentStatement = $db->prepare(
                    'SELECT *
                     FROM familias_socios
                     WHERE id_familia = ?
                       AND activo = 1
                       AND hasta IS NULL
                     FOR UPDATE'
                );
                $currentStatement->execute([$familyId]);
                $currentLinks = [];
                foreach ($currentStatement->fetchAll() as $link) {
                    $currentLinks[(int)$link['id_socio']] = $link;
                }

                foreach ($memberIds as $memberId) {
                    $person = $peopleById[$memberId];
                    if (!(bool)$person['vigente'] && !isset($currentLinks[$memberId])) {
                        api_error(
                            "{$person['nombre']} está dado de baja y no puede incorporarse a una familia.",
                            'SOCIO_INACTIVO',
                            409
                        );
                    }
                }

                // Un vínculo abierto dentro de una familia dada de baja es un
                // dato inconsistente heredado. Lo cerramos para no bloquear al
                // socio al incorporarlo a una familia activa.
                $releaseInactive = $db->prepare(
                    "UPDATE familias_socios fs
                     INNER JOIN familias f ON f.id_familia = fs.id_familia
                     SET fs.activo = 0,
                         fs.hasta = COALESCE(fs.hasta, CURDATE()),
                         fs.actualizado_en = CURRENT_TIMESTAMP
                     WHERE fs.id_socio IN ({$placeholders})
                       AND fs.id_familia <> ?
                       AND fs.activo = 1
                       AND fs.hasta IS NULL
                       AND f.activo = 0"
                );
                $releaseInactive->execute(array_merge($memberIds, [$familyId]));

                $conflicts = $db->prepare(
                    "SELECT s.nombre AS socio, f.nombre_familia AS familia
                     FROM familias_socios fs
                     INNER JOIN familias f
                        ON f.id_familia = fs.id_familia
                       AND f.activo = 1
                     INNER JOIN socios s ON s.id_socio = fs.id_socio
                     WHERE fs.id_socio IN ({$placeholders})
                       AND fs.id_familia <> ?
                       AND fs.activo = 1
                       AND fs.hasta IS NULL
                     LIMIT 1
                     FOR UPDATE"
                );
                $conflicts->execute(array_merge($memberIds, [$familyId]));
                if ($conflict = $conflicts->fetch()) {
                    api_error(
                        "{$conflict['socio']} ya pertenece a la familia {$conflict['familia']}.",
                        'SOCIO_YA_TIENE_FAMILIA',
                        409
                    );
                }

                $removedIds = array_values(array_diff(array_keys($currentLinks), $memberIds));
                if ($removedIds !== []) {
                    foreach ($removedIds as $removedId) {
                        $from = $currentLinks[$removedId]['desde'];
                        if ($from !== null && $unlinkDate < (string)$from) {
                            api_error(
                                'La fecha de desvinculación no puede ser anterior a la incorporación.',
                                'FECHA_INVALIDA',
                                422
                            );
                        }
                    }

                    $removePlaceholders = implode(',', array_fill(0, count($removedIds), '?'));
                    $close = $db->prepare(
                        "UPDATE familias_socios
                         SET activo = 0,
                             hasta = ?,
                             actualizado_en = CURRENT_TIMESTAMP
                         WHERE id_familia = ?
                           AND id_socio IN ({$removePlaceholders})
                           AND activo = 1
                           AND hasta IS NULL"
                    );
                    $close->execute(array_merge([$unlinkDate, $familyId], $removedIds));
                }

                $update = $db->prepare(
                    'UPDATE familias_socios
                     SET desde = ?, actualizado_en = CURRENT_TIMESTAMP
                     WHERE id_familia_socio = ?'
                );
                $insert = $db->prepare(
                    'INSERT INTO familias_socios
                     (id_familia, id_socio, desde, hasta, activo)
                     VALUES (?, ?, ?, NULL, 1)'
                );

                foreach ($members as $memberId => $member) {
                    if (isset($currentLinks[$memberId])) {
                        $update->execute([
                            $member['desde'],
                            (int)$currentLinks[$memberId]['id_familia_socio'],
                        ]);
                    } else {
                        $insert->execute([
                            $familyId,
                            $memberId,
                            $member['desde'],
                        ]);
                    }
                }

                $after = self::familyDetail($db, $familyId, true);
                if (!$after) throw new RuntimeException('No se pudo recuperar la familia guardada.');

                self::auditarFamilia(
                    $db,
                    $auth,
                    'familias',
                    $familyId,
                    $id === null ? 'INSERT' : 'UPDATE',
                    $before,
                    $after
                );

                return $after;
            });
        } catch (PDOException $error) {
            self::resolverErrorPersistenciaFamilia($error);
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
        $effectiveDate = $date ?: date('Y-m-d');
        if ($effectiveDate > date('Y-m-d')) {
            api_error('La fecha indicada no puede ser futura.', 'VALIDATION_ERROR', 422);
        }

        $saved = transaction($db, static function () use (
            $db,
            $auth,
            $id,
            $active,
            $effectiveDate,
            $reason
        ): array {
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
                $links = $db->prepare(
                    'SELECT id_familia_socio, desde
                     FROM familias_socios
                     WHERE id_familia = ?
                       AND activo = 1
                       AND hasta IS NULL
                     FOR UPDATE'
                );
                $links->execute([$id]);
                foreach ($links->fetchAll() as $link) {
                    if ($link['desde'] !== null && $effectiveDate < (string)$link['desde']) {
                        api_error(
                            'La fecha de baja no puede ser anterior a la incorporación de un integrante.',
                            'FECHA_INVALIDA',
                            422
                        );
                    }
                }

                $db->prepare(
                    'UPDATE familias_socios
                     SET activo = 0,
                         hasta = ?,
                         actualizado_en = CURRENT_TIMESTAMP
                     WHERE id_familia = ?
                       AND activo = 1
                       AND hasta IS NULL'
                )->execute([$effectiveDate, $id]);
            }

            $db->prepare(
                'UPDATE familias SET activo = ?, actualizado_en = CURDATE() WHERE id_familia = ?'
            )->execute([$active ? 1 : 0, $id]);

            $after = self::familyDetail($db, $id, true);
            if (!$after) throw new RuntimeException('No se pudo recuperar la familia después del cambio de estado.');

            $auditAfter = $after;
            if (!$active && $reason) {
                $auditAfter['motivo_baja'] = $reason;
                $auditAfter['fecha_baja'] = $effectiveDate;
            }

            self::auditarFamilia($db, $auth, 'familias', $id, 'UPDATE', $before, $auditAfter);
            return $after;
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
                            COUNT(DISTINCT CASE WHEN activo = 1 AND hasta IS NULL THEN id_socio END) AS socios_sin_familia
                     FROM familias_socios
                     WHERE id_familia = ?'
                );
                $links->execute([$id]);
                $impactRow = $links->fetch() ?: [];
                $impact = [
                    'socios_sin_familia' => (int)($impactRow['socios_sin_familia'] ?? 0),
                    'vinculos_eliminados' => (int)($impactRow['vinculos_totales'] ?? 0),
                ];

                // La eliminación definitiva de una familia jamás elimina socios,
                // pagos ni datos personales: únicamente borra los vínculos del
                // grupo y luego la cabecera de la familia.
                $db->prepare('DELETE FROM familias_socios WHERE id_familia = ?')->execute([$id]);
                $db->prepare('DELETE FROM familias WHERE id_familia = ?')->execute([$id]);

                self::auditarFamilia(
                    $db,
                    $auth,
                    'familias',
                    $id,
                    'DELETE',
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
            self::resolverErrorPersistenciaFamilia($error);
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
            $id = filter_var(
                $item['id_socio'] ?? null,
                FILTER_VALIDATE_INT,
                ['options' => ['min_range' => 1]]
            );
            if ($id === false) continue;

            $date = valid_date(
                $item['desde'] ?? $item['fecha_incorporacion'] ?? date('Y-m-d'),
                'incorporación'
            );
            if ($date > date('Y-m-d')) {
                api_error('La fecha de incorporación no puede ser futura.', 'VALIDATION_ERROR', 422);
            }

            $members[(int)$id] = [
                'id_socio' => (int)$id,
                'desde' => $date,
            ];
        }

        return $members;
    }

    /** Escribe auditoría según el esquema real de RH Negativo V2. */
    private static function auditarFamilia(
        PDO $db,
        array $auth,
        string $table,
        int $recordId,
        string $action,
        mixed $before,
        mixed $after
    ): void {
        if (!in_array($action, ['INSERT', 'UPDATE', 'DELETE', 'MIGRACION', 'FUSION'], true)) {
            throw new LogicException('Acción de auditoría no permitida.');
        }

        $encode = static function (mixed $value): ?string {
            if ($value === null) return null;
            $json = json_encode(
                $value,
                JSON_UNESCAPED_UNICODE
                    | JSON_UNESCAPED_SLASHES
                    | JSON_INVALID_UTF8_SUBSTITUTE
                    | JSON_PARTIAL_OUTPUT_ON_ERROR
                    | JSON_PRESERVE_ZERO_FRACTION
            );
            return is_string($json) ? $json : '{"error":"No se pudo serializar la auditoría."}';
        };

        $statement = $db->prepare(
            "INSERT INTO auditoria
             (tabla, id_registro, accion, datos_anteriores, datos_nuevos, id_usuario, origen)
             VALUES (?, ?, ?, ?, ?, ?, 'SISTEMA')"
        );
        $statement->execute([
            clean_text($table, 64, false),
            $recordId,
            $action,
            $encode($before),
            $encode($after),
            $auth['id_usuario'],
        ]);
    }

    private static function resolverErrorPersistenciaFamilia(PDOException $error): never
    {
        $driverCode = (int)($error->errorInfo[1] ?? 0);
        if ($driverCode === 1062) {
            api_error('Ya existe otra familia con ese nombre.', 'FAMILIA_DUPLICADA', 409);
        }
        if ($driverCode === 1451 || $driverCode === 1452) {
            api_error(
                'No se pudo completar la operación por una relación de datos inválida.',
                'RELACION_INVALIDA',
                409
            );
        }
        throw $error;
    }
}
