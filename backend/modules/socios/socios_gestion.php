<?php
declare(strict_types=1);

trait SociosGestion
{
    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = null;
        if (($body['id_socio'] ?? '') !== '' && ($body['id_socio'] ?? null) !== null) {
            $id = positive_id($body['id_socio'], 'socio');
        }

        $data = self::validarSocio($db, $body, $id);

        try {
            $result = transaction($db, function () use ($db, $auth, $data, $id): array {
                if ($id === null) {
                    $statement = $db->prepare(
                        'INSERT INTO socios
                         (nombre, id_cobrador, id_grupo_sanguineo, id_categoria, domicilio, numero,
                          telefono_movil, telefono_fijo, observaciones, fecha_nacimiento, id_estado,
                          domicilio_cobro, dni, fecha_ingreso, vigente)
                         VALUES
                         (:nombre, :id_cobrador, :id_grupo_sanguineo, :id_categoria, :domicilio, :numero,
                          :telefono_movil, :telefono_fijo, :observaciones, :fecha_nacimiento, :id_estado,
                          :domicilio_cobro, :dni, :fecha_ingreso, 1)'
                    );
                    $statement->execute($data);
                    $newId = (int)$db->lastInsertId();
                    $after = self::detalle($db, $newId);
                    if (!$after) {
                        throw new RuntimeException('No se pudo recuperar el socio recién creado.');
                    }

                    self::insertarHistorialEstado(
                        $db,
                        $newId,
                        'ALTA',
                        null,
                        $after['id_estado'],
                        null,
                        true,
                        ($after['fecha_ingreso'] ?: date('Y-m-d')) . ' 00:00:00',
                        'ALTA DE SOCIO',
                        null,
                        $auth['id_usuario']
                    );
                    self::auditarSocio($db, $auth, 'socios', $newId, 'INSERT', null, $after);

                    return ['item' => $after, 'creado' => true];
                }

                $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
                $lock->execute([$id]);
                $rawBefore = $lock->fetch();
                if (!$rawBefore) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

                $before = self::detalle($db, $id);
                $statement = $db->prepare(
                    'UPDATE socios SET
                        nombre = :nombre,
                        id_cobrador = :id_cobrador,
                        id_grupo_sanguineo = :id_grupo_sanguineo,
                        id_categoria = :id_categoria,
                        domicilio = :domicilio,
                        numero = :numero,
                        telefono_movil = :telefono_movil,
                        telefono_fijo = :telefono_fijo,
                        observaciones = :observaciones,
                        fecha_nacimiento = :fecha_nacimiento,
                        id_estado = :id_estado,
                        domicilio_cobro = :domicilio_cobro,
                        dni = :dni,
                        fecha_ingreso = :fecha_ingreso
                     WHERE id_socio = :id_socio'
                );
                $statement->execute($data + ['id_socio' => $id]);

                $after = self::detalle($db, $id);
                if (!$after) throw new RuntimeException('No se pudo recuperar el socio actualizado.');

                $previousState = $rawBefore['id_estado'] === null ? null : (int)$rawBefore['id_estado'];
                $newState = $after['id_estado'];
                if ($previousState !== $newState) {
                    self::insertarHistorialEstado(
                        $db,
                        $id,
                        'CAMBIO_ESTADO',
                        $previousState,
                        $newState,
                        (bool)$rawBefore['vigente'],
                        (bool)$rawBefore['vigente'],
                        date('Y-m-d H:i:s'),
                        'CAMBIO DE ESTADO',
                        null,
                        $auth['id_usuario']
                    );
                }

                self::auditarSocio($db, $auth, 'socios', $id, 'UPDATE', $before, $after);
                return ['item' => $after, 'creado' => false];
            });
        } catch (PDOException $error) {
            self::resolverErrorPersistenciaSocio($error);
        }

        return $result;
    }

    private static function darBajaDatos(array $auth, int $id, string $date, string $reason): array
    {
        $db = $auth['db'];
        $saved = transaction($db, function () use ($db, $auth, $id, $date, $reason): array {
            $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $raw = $lock->fetch();
            if (!$raw) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            if (!(bool)$raw['vigente']) api_error('El socio ya está dado de baja.', 'SOCIO_YA_BAJA', 409);

            if ($raw['fecha_ingreso'] && $date < (string)$raw['fecha_ingreso']) {
                api_error('La fecha de baja no puede ser anterior a la fecha de ingreso.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_baja']);
            }

            $before = self::detalle($db, $id);
            $db->prepare('UPDATE socios SET vigente = 0 WHERE id_socio = ?')->execute([$id]);
            $after = self::detalle($db, $id);
            if (!$after) throw new RuntimeException('No se pudo recuperar el socio después de la baja.');

            self::insertarHistorialEstado(
                $db,
                $id,
                'BAJA',
                $raw['id_estado'] === null ? null : (int)$raw['id_estado'],
                $raw['id_estado'] === null ? null : (int)$raw['id_estado'],
                true,
                false,
                $date . ' 00:00:00',
                $reason,
                null,
                $auth['id_usuario']
            );
            self::auditarSocio($db, $auth, 'socios', $id, 'UPDATE', $before, $after);
            return $after;
        });

        return ['item' => $saved];
    }

    private static function reactivarDatos(array $auth, int $id, string $date, ?string $reason): array
    {
        $db = $auth['db'];
        $saved = transaction($db, function () use ($db, $auth, $id, $date, $reason): array {
            $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $raw = $lock->fetch();
            if (!$raw) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            if ((bool)$raw['vigente']) api_error('El socio ya está vigente.', 'SOCIO_YA_VIGENTE', 409);

            $lastLow = $db->prepare(
                "SELECT MAX(DATE(fecha_evento)) FROM socios_historial_estados WHERE id_socio = ? AND tipo_evento = 'BAJA'"
            );
            $lastLow->execute([$id]);
            $lastLowDate = $lastLow->fetchColumn();
            if ($lastLowDate && $date < (string)$lastLowDate) {
                api_error('La fecha de reactivación no puede ser anterior a la última baja.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_reactivacion']);
            }

            $before = self::detalle($db, $id);
            $db->prepare('UPDATE socios SET vigente = 1 WHERE id_socio = ?')->execute([$id]);
            $after = self::detalle($db, $id);
            if (!$after) throw new RuntimeException('No se pudo recuperar el socio después de la reactivación.');

            self::insertarHistorialEstado(
                $db,
                $id,
                'REACTIVACION',
                $raw['id_estado'] === null ? null : (int)$raw['id_estado'],
                $raw['id_estado'] === null ? null : (int)$raw['id_estado'],
                false,
                true,
                $date . ' 00:00:00',
                $reason ?: 'REACTIVACIÓN DE SOCIO',
                null,
                $auth['id_usuario']
            );
            self::auditarSocio($db, $auth, 'socios', $id, 'UPDATE', $before, $after);
            return $after;
        });

        return ['item' => $saved];
    }

    private static function registrarContactoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id_socio'] ?? $body['id'] ?? null, 'socio');
        $date = valid_date($body['fecha_contacto'] ?? date('Y-m-d'), 'contacto');
        if ($date > date('Y-m-d')) {
            api_error('La fecha del contacto no puede ser futura.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_contacto']);
        }

        $status = strtoupper(trim((string)($body['estado_contacto'] ?? '')));
        if (!in_array($status, ['CONTACTADO', 'PENDIENTE', 'NO_CONTACTADO'], true)) {
            api_error('Seleccioná un estado de gestión válido.', 'VALIDATION_ERROR', 422, ['campo' => 'estado_contacto']);
        }
        $detail = optional_text($body['detalle_contacto'] ?? null, 4000);

        return transaction($db, function () use ($db, $auth, $id, $date, $status, $detail): array {
            $lock = $db->prepare('SELECT id_socio, nombre, fecha_nacimiento, vigente FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $socio = $lock->fetch();
            if (!$socio) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

            $statement = $db->prepare(
                'INSERT INTO socios_contactos
                 (id_socio, fecha_contacto, estado_contacto, detalle_contacto, id_usuario)
                 VALUES (?, ?, ?, ?, ?)'
            );
            $statement->execute([$id, $date, $status, $detail, $auth['id_usuario']]);
            $contactId = (int)$db->lastInsertId();

            $contact = [
                'id_contacto' => $contactId,
                'id_socio' => $id,
                'fecha_contacto' => $date,
                'estado_contacto' => $status,
                'detalle_contacto' => $detail,
                'id_usuario' => $auth['id_usuario'],
                'usuario' => $auth['usuario'],
            ];
            self::auditarSocio($db, $auth, 'socios_contactos', $contactId, 'INSERT', null, $contact);

            // Solo una gestión efectivamente CONTACTADA cierra automáticamente
            // el aviso anual. PENDIENTE / NO_CONTACTADO conservan la tarjeta
            // para que el equipo pueda volver a intentar el seguimiento.
            if ($status === 'CONTACTADO') {
                self::cerrarAvisoCumpleaniosInterno($db, $auth, $socio, 'CONTACTO');
            }

            return [
                'contacto' => $contact,
                'item' => self::detalle($db, $id),
            ];
        });
    }

    private static function cerrarCumpleaniosDatos(array $auth, int $id): array
    {
        $db = $auth['db'];
        return transaction($db, function () use ($db, $auth, $id): array {
            $lock = $db->prepare('SELECT id_socio, nombre, fecha_nacimiento, vigente FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $socio = $lock->fetch();
            if (!$socio) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            if (!(bool)$socio['vigente']) api_error('El socio ya no está vigente.', 'SOCIO_NO_VIGENTE', 409);
            if (!$socio['fecha_nacimiento']) api_error('El socio no tiene fecha de nacimiento registrada.', 'SIN_FECHA_NACIMIENTO', 409);

            $age = self::edadActual((string)$socio['fecha_nacimiento']);
            if ($age < 18 || $age > 23) {
                api_error('El socio ya no pertenece al rango de avisos de 18 a 23 años.', 'FUERA_RANGO_CUMPLEANIOS', 409);
            }

            $closure = self::cerrarAvisoCumpleaniosInterno($db, $auth, $socio, 'MANUAL');
            return ['cierre' => $closure, 'id_socio' => $id];
        });
    }

    private static function eliminarDefinitivoDatos(array $auth, int $id): array
    {
        $db = $auth['db'];
        return transaction($db, function () use ($db, $auth, $id): array {
            $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            if (!$lock->fetch()) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

            $before = self::detalle($db, $id);
            $impact = self::impactoEliminacion($db, $id);

            // El orden respeta todas las FK RESTRICT del esquema RH V2.
            $db->prepare('DELETE FROM familias_socios WHERE id_socio = ?')->execute([$id]);
            $db->prepare('DELETE FROM pagos_inscripcion WHERE id_socio = ?')->execute([$id]);
            $db->prepare('DELETE FROM pagos WHERE id_socio = ?')->execute([$id]);
            $db->prepare('DELETE FROM socios_contactos WHERE id_socio = ?')->execute([$id]);
            $db->prepare('DELETE FROM socios_cumpleanios_cierres WHERE id_socio = ?')->execute([$id]);
            $db->prepare('DELETE FROM socios_historial_estados WHERE id_socio = ?')->execute([$id]);
            $db->prepare('DELETE FROM socios_fusiones WHERE id_socio_origen = ? OR id_socio_destino = ?')->execute([$id, $id]);
            $db->prepare('DELETE FROM socios WHERE id_socio = ?')->execute([$id]);

            self::auditarSocio(
                $db,
                $auth,
                'socios',
                $id,
                'DELETE',
                ['socio' => $before, 'impacto' => $impact],
                null
            );

            return ['id_socio' => $id, 'impacto' => $impact];
        });
    }

    private static function validarSocio(PDO $db, array $body, ?int $editingId): array
    {
        $current = null;
        if ($editingId !== null) {
            $currentStatement = $db->prepare(
                'SELECT id_cobrador, id_categoria, id_grupo_sanguineo, id_estado FROM socios WHERE id_socio = ? LIMIT 1'
            );
            $currentStatement->execute([$editingId]);
            $current = $currentStatement->fetch();
            if (!$current) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
        }

        $name = required_text($body, 'nombre', 'nombre', 100);
        $collectorId = positive_id($body['id_cobrador'] ?? null, 'cobrador');
        $categoryId = positive_id($body['id_categoria'] ?? null, 'categoría');
        $bloodId = self::optionalPositiveId($body['id_grupo_sanguineo'] ?? null, 'grupo sanguíneo');
        $stateId = self::optionalPositiveId($body['id_estado'] ?? null, 'estado');

        self::validarCatalogo($db, 'cobrador', 'id_cobrador', $collectorId, 'cobrador', $current && (int)$current['id_cobrador'] === $collectorId);
        self::validarCatalogo($db, 'categoria', 'id_categoria', $categoryId, 'categoría', $current && (int)$current['id_categoria'] === $categoryId);
        if ($bloodId !== null) {
            self::validarCatalogo(
                $db,
                'grupo_sanguineo',
                'id_grupo_sanguineo',
                $bloodId,
                'grupo sanguíneo',
                $current && $current['id_grupo_sanguineo'] !== null && (int)$current['id_grupo_sanguineo'] === $bloodId
            );
        }
        if ($stateId !== null) {
            self::validarCatalogo(
                $db,
                'estado',
                'id_estado',
                $stateId,
                'estado',
                $current && $current['id_estado'] !== null && (int)$current['id_estado'] === $stateId
            );
        }

        $dni = preg_replace('/\D+/', '', (string)($body['dni'] ?? '')) ?? '';
        if ($dni !== '' && !preg_match('/^[0-9]{6,15}$/', $dni)) {
            api_error('El DNI debe contener entre 6 y 15 dígitos.', 'VALIDATION_ERROR', 422, ['campo' => 'dni']);
        }
        if ($dni !== '') {
            $sql = 'SELECT id_socio FROM socios WHERE dni = ?' . ($editingId !== null ? ' AND id_socio <> ?' : '') . ' LIMIT 1';
            $statement = $db->prepare($sql);
            $statement->execute($editingId !== null ? [$dni, $editingId] : [$dni]);
            if ($statement->fetchColumn()) api_error('Ya existe un socio con ese DNI.', 'DNI_DUPLICADO', 409, ['campo' => 'dni']);
        }

        $birth = valid_date($body['fecha_nacimiento'] ?? '', 'nacimiento', false);
        if ($birth !== null && $birth > date('Y-m-d')) {
            api_error('La fecha de nacimiento no puede ser futura.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_nacimiento']);
        }
        $joined = valid_date($body['fecha_ingreso'] ?? '', 'ingreso', false);
        if ($joined !== null && $joined > date('Y-m-d')) {
            api_error('La fecha de ingreso no puede ser futura.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_ingreso']);
        }
        if ($birth !== null && $joined !== null && $joined < $birth) {
            api_error('La fecha de ingreso no puede ser anterior a la fecha de nacimiento.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_ingreso']);
        }

        return [
            'nombre' => $name,
            'id_cobrador' => $collectorId,
            'id_grupo_sanguineo' => $bloodId,
            'id_categoria' => $categoryId,
            'domicilio' => optional_text($body['domicilio'] ?? null, 100),
            'numero' => optional_text($body['numero'] ?? null, 20),
            'telefono_movil' => self::normalizarTelefono($body['telefono_movil'] ?? null),
            'telefono_fijo' => self::normalizarTelefono($body['telefono_fijo'] ?? null),
            'observaciones' => optional_text($body['observaciones'] ?? null, 8000),
            'fecha_nacimiento' => $birth,
            'id_estado' => $stateId,
            'domicilio_cobro' => optional_text($body['domicilio_cobro'] ?? null, 150),
            'dni' => $dni === '' ? null : $dni,
            'fecha_ingreso' => $joined,
        ];
    }

    private static function optionalPositiveId(mixed $value, string $label): ?int
    {
        if ($value === null || trim((string)$value) === '') return null;
        return positive_id($value, $label);
    }

    private static function validarCatalogo(PDO $db, string $table, string $idColumn, int $id, string $label, bool $allowInactive = false): void
    {
        $allowed = [
            'cobrador' => 'id_cobrador',
            'categoria' => 'id_categoria',
            'grupo_sanguineo' => 'id_grupo_sanguineo',
            'estado' => 'id_estado',
        ];
        if (($allowed[$table] ?? null) !== $idColumn) {
            throw new LogicException('Catálogo de socio no permitido.');
        }
        $statement = $db->prepare("SELECT activo FROM {$table} WHERE {$idColumn} = ? LIMIT 1");
        $statement->execute([$id]);
        $active = $statement->fetchColumn();
        if ($active === false) api_error("El {$label} seleccionado no existe.", 'VALIDATION_ERROR', 422);
        if (!(bool)$active && !$allowInactive) api_error("El {$label} seleccionado está inactivo.", 'VALIDATION_ERROR', 422);
    }

    private static function normalizarTelefono(mixed $value): ?string
    {
        $text = trim((string)$value);
        if ($text === '') return null;
        $digits = preg_replace('/\D+/', '', $text) ?? '';
        if ($digits === '' || strlen($digits) < 6 || strlen($digits) > 20) {
            api_error('El teléfono debe contener entre 6 y 20 dígitos.', 'VALIDATION_ERROR', 422);
        }
        return $digits;
    }

    private static function insertarHistorialEstado(
        PDO $db,
        int $id,
        string $event,
        ?int $previousState,
        ?int $newState,
        ?bool $previousActive,
        ?bool $newActive,
        string $eventDate,
        ?string $reason,
        ?string $observation,
        int $userId
    ): void {
        $statement = $db->prepare(
            'INSERT INTO socios_historial_estados
             (id_socio, tipo_evento, id_estado_anterior, id_estado_nuevo,
              vigente_anterior, vigente_nuevo, fecha_evento, motivo, observacion,
              id_usuario, origen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'SISTEMA\')'
        );
        $statement->execute([
            $id,
            $event,
            $previousState,
            $newState,
            $previousActive === null ? null : (int)$previousActive,
            $newActive === null ? null : (int)$newActive,
            $eventDate,
            $reason,
            $observation,
            $userId,
        ]);
    }

    private static function cerrarAvisoCumpleaniosInterno(PDO $db, array $auth, array $socio, string $origin): ?array
    {
        $birth = trim((string)($socio['fecha_nacimiento'] ?? ''));
        if ($birth === '' || !(bool)($socio['vigente'] ?? false)) return null;
        $age = self::edadActual($birth);
        if ($age < 18 || $age > 23) return null;

        $year = (int)date('Y');
        $existing = $db->prepare(
            "SELECT id_cierre, cerrado_en FROM socios_cumpleanios_cierres
             WHERE id_socio = ? AND anio = ? AND rango = '18-23' LIMIT 1"
        );
        $existing->execute([(int)$socio['id_socio'], $year]);
        $row = $existing->fetch();
        if ($row) {
            return [
                'id_cierre' => (int)$row['id_cierre'],
                'id_socio' => (int)$socio['id_socio'],
                'anio' => $year,
                'rango' => '18-23',
                'edad_al_cierre' => $age,
                'ya_cerrado' => true,
            ];
        }

        $statement = $db->prepare(
            "INSERT INTO socios_cumpleanios_cierres
             (id_socio, anio, rango, edad_al_cierre, fecha_nacimiento,
              cerrado_por_usuario_id, cerrado_por_nombre, origen)
             VALUES (?, ?, '18-23', ?, ?, ?, ?, ?)"
        );
        $statement->execute([
            (int)$socio['id_socio'],
            $year,
            $age,
            $birth,
            $auth['id_usuario'],
            clean_text($auth['usuario'] ?? 'USUARIO', 100),
            clean_text($origin, 30),
        ]);
        $closureId = (int)$db->lastInsertId();
        $closure = [
            'id_cierre' => $closureId,
            'id_socio' => (int)$socio['id_socio'],
            'anio' => $year,
            'rango' => '18-23',
            'edad_al_cierre' => $age,
            'fecha_nacimiento' => $birth,
            'origen' => $origin,
            'ya_cerrado' => false,
        ];
        self::auditarSocio($db, $auth, 'socios_cumpleanios_cierres', $closureId, 'INSERT', null, $closure);
        return $closure;
    }

    private static function edadActual(string $birth): int
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $birth);
        if (!$date) return -1;
        return (int)$date->diff(new DateTimeImmutable('today'))->y;
    }

    /**
     * La estructura de `auditoria` en RH Negativo V2 es distinta al helper
     * global heredado. Esta escritura local evita romper las operaciones del
     * módulo y respeta exactamente el esquema actual.
     */
    private static function auditarSocio(
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
            'INSERT INTO auditoria
             (tabla, id_registro, accion, datos_anteriores, datos_nuevos, id_usuario, origen)
             VALUES (?, ?, ?, ?, ?, ?, \'SISTEMA\')'
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

    private static function resolverErrorPersistenciaSocio(PDOException $error): never
    {
        $driverCode = (int)($error->errorInfo[1] ?? 0);
        if ($driverCode === 1062) {
            api_error('Ya existe un socio con ese DNI.', 'DNI_DUPLICADO', 409, ['campo' => 'dni']);
        }
        if ($driverCode === 1451 || $driverCode === 1452) {
            api_error('La operación no pudo completarse por una relación de datos inválida.', 'RELACION_INVALIDA', 409);
        }
        throw $error;
    }
}
