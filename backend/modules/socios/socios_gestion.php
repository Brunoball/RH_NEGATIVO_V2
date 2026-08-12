<?php
declare(strict_types=1);

trait SociosGestion
{
    abstract private static function detalle(PDO $db, int $id): ?array;

    abstract private static function impactoEliminacion(PDO $db, int $id): array;

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = isset($body['id_socio']) && $body['id_socio'] !== ''
            ? positive_id($body['id_socio'], 'socio')
            : null;

        $type = strtoupper(trim((string)($body['tipo_socio'] ?? '')));
        if (!in_array($type, ['PERSONA', 'EMPRESA'], true)) {
            api_error('Seleccioná un tipo de socio válido.', 'VALIDATION_ERROR');
        }

        $current = $id === null ? null : self::detalle($db, $id);
        if ($id !== null && !$current) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
        if ($current && $current['tipo_socio'] !== $type) {
            api_error('El tipo de socio no puede modificarse después del alta.', 'TIPO_SOCIO_INMUTABLE', 409);
        }

        $date = valid_date($body['fecha_alta'] ?? ($current['fecha_alta'] ?? date('Y-m-d')), 'alta');
        $observations = optional_text($body['observaciones'] ?? null, 5000);
        $categoryId = self::optionalForeignId(
            $db,
            $body['id_categoria'] ?? null,
            'categorias',
            'id_categoria',
            'categoría',
            $current['id_categoria'] ?? null
        );
        $paymentMethodId = self::optionalForeignId(
            $db,
            $body['id_medio_pago'] ?? null,
            'medios_pago',
            'id_medio_pago',
            'medio de pago',
            $current['id_medio_pago'] ?? null
        );
        $reminder = self::booleanValue($body['enviar_recordatorio'] ?? false) ? 1 : 0;

        $specific = $type === 'PERSONA'
            ? self::validatePerson($body, $reminder === 1)
            : self::validateCompany($db, $body, $current, $reminder === 1);

        try {
            $saved = transaction($db, static function () use (
                $db,
                $auth,
                $body,
                $id,
                $type,
                $date,
                $observations,
                $categoryId,
                $paymentMethodId,
                $reminder,
                $specific
            ): array {
                if ($id === null) {
                    self::setHistoryVariables($db, $auth['id_usuario'], $date, null, 'Alta inicial del socio.');
                    $insert = $db->prepare(
                        'INSERT INTO socios
                         (tipo_socio, observaciones, fecha_alta, estado, id_categoria, id_medio_pago, enviar_recordatorio)
                         VALUES (?, ?, ?, \'ACTIVO\', ?, ?, ?)'
                    );
                    $insert->execute([$type, $observations, $date, $categoryId, $paymentMethodId, $reminder]);
                    $partnerId = (int)$db->lastInsertId();

                    if ($type === 'PERSONA') {
                        $db->prepare(
                            'INSERT INTO socios_personas
                             (id_socio, apellido, nombre, dni, domicilio, numero_domicilio, localidad, telefono, email, domicilio_alternativo)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                        )->execute([
                            $partnerId,
                            $specific['apellido'],
                            $specific['nombre'],
                            $specific['dni'],
                            $specific['domicilio'],
                            $specific['numero_domicilio'],
                            $specific['localidad'],
                            $specific['telefono'],
                            $specific['email'],
                            $specific['domicilio_alternativo'],
                        ]);
                    } else {
                        $db->prepare(
                            'INSERT INTO socios_empresas
                             (id_socio, razon_social, cuit, domicilio, telefono, email, domicilio_alternativo, id_condicion_iva)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                        )->execute([
                            $partnerId,
                            $specific['razon_social'],
                            $specific['cuit'],
                            $specific['domicilio'],
                            $specific['telefono'],
                            $specific['email'],
                            $specific['domicilio_alternativo'],
                            $specific['id_condicion_iva'],
                        ]);
                    }

                    self::ensureStateHistory(
                        $db,
                        $partnerId,
                        'ALTA',
                        null,
                        'ACTIVO',
                        $date,
                        null,
                        'Alta inicial del socio.',
                        $auth['id_usuario']
                    );
                    self::clearHistoryVariables($db);

                    $after = self::detalle($db, $partnerId);
                    audit_change(
                        $db,
                        $auth,
                        $type === 'PERSONA' ? 'SOCIOS' : 'EMPRESAS',
                        'CREAR',
                        'socios',
                        $partnerId,
                        $type === 'PERSONA'
                            ? "Se creó el socio {$specific['apellido']}, {$specific['nombre']}."
                            : "Se creó la empresa {$specific['razon_social']}.",
                        null,
                        $after
                    );
                    return $after ?? [];
                }

                $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
                $lock->execute([$id]);
                $locked = $lock->fetch();
                if (!$locked) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
                if ((string)$locked['tipo_socio'] !== $type) {
                    api_error('El tipo de socio no puede modificarse después del alta.', 'TIPO_SOCIO_INMUTABLE', 409);
                }
                $before = self::detalle($db, $id) ?? $locked;

                $db->prepare(
                    'UPDATE socios
                     SET observaciones = ?, fecha_alta = ?, id_categoria = ?, id_medio_pago = ?, enviar_recordatorio = ?
                     WHERE id_socio = ?'
                )->execute([$observations, $date, $categoryId, $paymentMethodId, $reminder, $id]);

                if ($type === 'PERSONA') {
                    $detailUpdate = $db->prepare(
                        'UPDATE socios_personas
                         SET apellido = ?, nombre = ?, dni = ?, domicilio = ?, numero_domicilio = ?, localidad = ?,
                             telefono = ?, email = ?, domicilio_alternativo = ?
                         WHERE id_socio = ?'
                    );
                    $detailUpdate->execute([
                        $specific['apellido'],
                        $specific['nombre'],
                        $specific['dni'],
                        $specific['domicilio'],
                        $specific['numero_domicilio'],
                        $specific['localidad'],
                        $specific['telefono'],
                        $specific['email'],
                        $specific['domicilio_alternativo'],
                        $id,
                    ]);
                } else {
                    $detailUpdate = $db->prepare(
                        'UPDATE socios_empresas
                         SET razon_social = ?, cuit = ?, domicilio = ?, telefono = ?, email = ?,
                             domicilio_alternativo = ?, id_condicion_iva = ?
                         WHERE id_socio = ?'
                    );
                    $detailUpdate->execute([
                        $specific['razon_social'],
                        $specific['cuit'],
                        $specific['domicilio'],
                        $specific['telefono'],
                        $specific['email'],
                        $specific['domicilio_alternativo'],
                        $specific['id_condicion_iva'],
                        $id,
                    ]);
                }

                if ($detailUpdate->rowCount() === 0) {
                    $exists = $db->prepare(
                        $type === 'PERSONA'
                            ? 'SELECT 1 FROM socios_personas WHERE id_socio = ?'
                            : 'SELECT 1 FROM socios_empresas WHERE id_socio = ?'
                    );
                    $exists->execute([$id]);
                    if (!$exists->fetchColumn()) {
                        api_error(
                            'El registro central no posee su detalle especializado. Revisá la integridad de la migración.',
                            'SOCIO_SIN_DETALLE',
                            409
                        );
                    }
                }

                $after = self::detalle($db, $id);
                audit_change(
                    $db,
                    $auth,
                    $type === 'PERSONA' ? 'SOCIOS' : 'EMPRESAS',
                    'EDITAR',
                    'socios',
                    $id,
                    $type === 'PERSONA'
                        ? "Se modificó el socio {$specific['apellido']}, {$specific['nombre']}."
                        : "Se modificó la empresa {$specific['razon_social']}.",
                    $before,
                    $after
                );
                return $after ?? [];
            });
        } catch (Throwable $error) {
            self::clearHistoryVariablesSilently($db);
            if (duplicate_key($error)) self::throwDuplicateSocioError($error, $type);
            throw $error;
        }

        return ['item' => $saved, 'creado' => $id === null];
    }

    private static function darBajaDatos(array $auth, int $id, string $date, string $reason): array
    {
        return self::changeStatus($auth, $id, 'INACTIVO', $date, $reason, 'BAJA');
    }

    private static function reactivarDatos(array $auth, int $id, ?string $date = null, ?string $reason = null): array
    {
        return self::changeStatus(
            $auth,
            $id,
            'ACTIVO',
            $date ?: date('Y-m-d'),
            $reason,
            'REACTIVACION'
        );
    }

    private static function eliminarDefinitivoDatos(array $auth, int $id): array
    {
        $db = $auth['db'];

        try {
            return transaction($db, static function () use ($db, $auth, $id): array {
                $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
                $lock->execute([$id]);
                $locked = $lock->fetch();
                if (!$locked) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

                $before = self::detalle($db, $id) ?? $locked;
                $impact = self::impactoEliminacion($db, $id);
                $module = ($before['tipo_socio'] ?? 'PERSONA') === 'EMPRESA' ? 'EMPRESAS' : 'SOCIOS';
                $name = trim((string)($before['denominacion'] ?? '')) ?: "ID {$id}";

                // Las FK del modelo son RESTRICT para evitar borrados accidentales.
                // La eliminación definitiva solo existe detrás de una doble confirmación
                // y limpia primero todas las relaciones conocidas, dentro de la misma transacción.
                $db->prepare('DELETE FROM familias_socios WHERE id_socio = ?')->execute([$id]);
                $db->prepare('DELETE FROM pagos WHERE id_socio = ?')->execute([$id]);
                $db->prepare('DELETE FROM socios_historial_estados WHERE id_socio = ?')->execute([$id]);
                $db->prepare('DELETE FROM socios WHERE id_socio = ?')->execute([$id]);

                audit_change(
                    $db,
                    $auth,
                    $module,
                    'ELIMINAR_DEFINITIVO',
                    'socios',
                    $id,
                    "Se eliminó definitivamente {$name}, junto con sus pagos, vínculos familiares e historial de estados.",
                    [
                        'socio' => $before,
                        'impacto_eliminacion' => $impact,
                    ],
                    null
                );

                return [
                    'id_socio' => $id,
                    'impacto_eliminacion' => $impact,
                ];
            });
        } catch (PDOException $error) {
            if ((string)$error->getCode() === '23000') {
                api_error(
                    'No se pudo eliminar el socio porque existe otra relación protegida en la base. Revisá los datos vinculados.',
                    'SOCIO_CON_RELACIONES_PROTEGIDAS',
                    409
                );
            }
            throw $error;
        }
    }

    private static function changeStatus(
        array $auth,
        int $id,
        string $newStatus,
        string $effectiveDate,
        ?string $reason,
        string $event
    ): array {
        $db = $auth['db'];
        try {
            $saved = transaction($db, static function () use (
                $db,
                $auth,
                $id,
                $newStatus,
                $effectiveDate,
                $reason,
                $event
            ): array {
                $statement = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
                $statement->execute([$id]);
                $locked = $statement->fetch();
                if (!$locked) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
                $previous = (string)$locked['estado'];
                if ($previous === $newStatus) {
                    api_error(
                        $newStatus === 'ACTIVO' ? 'El socio ya se encuentra activo.' : 'El socio ya se encuentra dado de baja.',
                        'ESTADO_SIN_CAMBIOS',
                        409
                    );
                }

                $before = self::detalle($db, $id) ?? $locked;
                $historyBefore = (int)$db->query(
                    'SELECT COALESCE(MAX(id_historial_estado), 0) FROM socios_historial_estados'
                )->fetchColumn();

                self::setHistoryVariables($db, $auth['id_usuario'], $effectiveDate, $reason, null);
                if ($newStatus === 'INACTIVO') {
                    $db->prepare(
                        'UPDATE socios
                         SET estado = \'INACTIVO\', fecha_baja = ?, motivo_baja = ?
                         WHERE id_socio = ?'
                    )->execute([$effectiveDate, $reason, $id]);
                } else {
                    $db->prepare(
                        'UPDATE socios
                         SET estado = \'ACTIVO\', fecha_baja = NULL, motivo_baja = NULL
                         WHERE id_socio = ?'
                    )->execute([$id]);
                }

                self::ensureStateHistory(
                    $db,
                    $id,
                    $event,
                    $previous,
                    $newStatus,
                    $effectiveDate,
                    $reason,
                    null,
                    $auth['id_usuario'],
                    $historyBefore
                );
                self::clearHistoryVariables($db);

                $after = self::detalle($db, $id);
                $module = ($after['tipo_socio'] ?? $before['tipo_socio'] ?? 'PERSONA') === 'EMPRESA' ? 'EMPRESAS' : 'SOCIOS';
                audit_change(
                    $db,
                    $auth,
                    $module,
                    $newStatus === 'ACTIVO' ? 'REACTIVAR' : 'DAR_BAJA',
                    'socios',
                    $id,
                    $newStatus === 'ACTIVO' ? 'Se reactivó el socio.' : 'Se dio de baja el socio.',
                    $before,
                    $after
                );
                return $after ?? [];
            });
        } catch (Throwable $error) {
            self::clearHistoryVariablesSilently($db);
            throw $error;
        }

        return ['item' => $saved];
    }

    private static function validatePerson(array $body, bool $reminderEnabled): array
    {
        $dni = preg_replace('/\D+/', '', (string)($body['dni'] ?? '')) ?? '';
        if ($dni !== '' && !preg_match('/^[0-9]{7,8}$/', $dni)) {
            api_error('El DNI debe tener 7 u 8 dígitos.', 'VALIDATION_ERROR', 422, ['campo' => 'dni']);
        }

        return [
            'apellido' => required_text($body, 'apellido', 'apellido', 100),
            'nombre' => required_text($body, 'nombre', 'nombre', 100),
            'dni' => $dni === '' ? null : $dni,
            'domicilio' => optional_text($body['domicilio'] ?? null, 150),
            'numero_domicilio' => optional_text($body['numero_domicilio'] ?? null, 20),
            'localidad' => optional_text($body['localidad'] ?? null, 100),
            'telefono' => self::normalizePhone($body['telefono'] ?? null, $reminderEnabled),
            'email' => self::optionalEmail($body['email'] ?? null),
            'domicilio_alternativo' => optional_text($body['domicilio_alternativo'] ?? null, 255),
        ];
    }

    private static function validateCompany(PDO $db, array $body, ?array $current, bool $reminderEnabled): array
    {
        $cuit = preg_replace('/\D+/', '', (string)($body['cuit'] ?? '')) ?? '';
        if ($cuit !== '' && !preg_match('/^[0-9]{11}$/', $cuit)) {
            api_error('El CUIT debe tener 11 dígitos.', 'VALIDATION_ERROR', 422, ['campo' => 'cuit']);
        }

        $taxConditionId = self::optionalForeignId(
            $db,
            $body['id_condicion_iva'] ?? null,
            'condiciones_iva',
            'id_condicion_iva',
            'condición de IVA',
            $current['id_condicion_iva'] ?? null
        );

        return [
            'razon_social' => required_text($body, 'razon_social', 'razón social', 255),
            'cuit' => $cuit === '' ? null : $cuit,
            'domicilio' => optional_text($body['domicilio'] ?? null, 255),
            'telefono' => self::normalizePhone($body['telefono'] ?? null, $reminderEnabled),
            'email' => self::optionalEmail($body['email'] ?? null),
            'domicilio_alternativo' => optional_text($body['domicilio_alternativo'] ?? null, 255),
            'id_condicion_iva' => $taxConditionId,
        ];
    }

    private static function normalizePhone(mixed $value, bool $requiredForReminder): ?string
    {
        $raw = trim((string)$value);
        if ($raw === '') {
            if ($requiredForReminder) {
                api_error(
                    'Para activar los recordatorios, ingresá primero un teléfono.',
                    'VALIDATION_ERROR',
                    422,
                    ['campo' => 'telefono']
                );
            }
            return null;
        }

        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        if (str_starts_with($digits, '00')) {
            $digits = substr($digits, 2);
        }

        if (str_starts_with($digits, '549')) {
            $digits = substr($digits, 3);
        } elseif (str_starts_with($digits, '54')) {
            $digits = substr($digits, 2);
        }

        // Quita el 0 de larga distancia nacional.
        $digits = preg_replace('/^0+/', '', $digits) ?? '';

        // Compatibilidad con el formato celular argentino antiguo:
        // característica + 15 + número local.
        if (strlen($digits) > 10 && preg_match('/^(\d{2,4})15(\d{6,8})$/', $digits, $matches)) {
            $without15 = $matches[1] . $matches[2];
            if (strlen($without15) === 10) {
                $digits = $without15;
            }
        }

        if (!preg_match('/^\d{10}$/', $digits)) {
            api_error(
                'El teléfono debe tener 10 dígitos (característica + número). Podés ingresarlo con guiones, espacios, 0, 15 o +54; el sistema lo normaliza al guardar.',
                'VALIDATION_ERROR',
                422,
                ['campo' => 'telefono']
            );
        }

        return $digits;
    }

    private static function optionalEmail(mixed $value): ?string
    {
        $email = trim((string)$value);
        if ($email === '') return null;
        if (strlen($email) > 190 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            api_error('El correo electrónico no es válido.', 'VALIDATION_ERROR', 422, ['campo' => 'email']);
        }
        return strtolower($email);
    }

    private static function optionalForeignId(
        PDO $db,
        mixed $value,
        string $table,
        string $column,
        string $label,
        ?int $currentId = null
    ): ?int {
        if ($value === null || $value === '' || (string)$value === '0') return null;
        $id = positive_id($value, $label);
        $statement = $db->prepare("SELECT activo FROM {$table} WHERE {$column} = ? LIMIT 1");
        $statement->execute([$id]);
        $row = $statement->fetch();
        if (!$row) api_error("La {$label} seleccionada no existe.", 'VALIDATION_ERROR');
        if (!(bool)$row['activo'] && $id !== $currentId) {
            api_error("La {$label} seleccionada está inactiva.", 'VALIDATION_ERROR');
        }
        return $id;
    }

    private static function booleanValue(mixed $value): bool
    {
        if (is_bool($value)) return $value;
        return in_array(strtolower(trim((string)$value)), ['1', 'true', 'si', 'sí', 'on'], true);
    }

    private static function setHistoryVariables(
        PDO $db,
        int $userId,
        ?string $date,
        ?string $reason,
        ?string $observations
    ): void {
        $statement = $db->prepare(
            'SET @lalcec_id_usuario = ?, @lalcec_fecha_estado = ?, @lalcec_motivo_estado = ?, @lalcec_observaciones_estado = ?'
        );
        $statement->execute([$userId, $date, $reason, $observations]);
    }

    private static function clearHistoryVariables(PDO $db): void
    {
        $db->exec(
            'SET @lalcec_id_usuario = NULL, @lalcec_fecha_estado = NULL, @lalcec_motivo_estado = NULL, @lalcec_observaciones_estado = NULL'
        );
    }

    private static function clearHistoryVariablesSilently(PDO $db): void
    {
        try {
            self::clearHistoryVariables($db);
        } catch (Throwable) {
            // No oculta el error principal.
        }
    }

    private static function ensureStateHistory(
        PDO $db,
        int $partnerId,
        string $event,
        ?string $previousStatus,
        string $newStatus,
        ?string $date,
        ?string $reason,
        ?string $observations,
        int $userId,
        int $minimumHistoryId = 0
    ): void {
        $check = $db->prepare(
            'SELECT id_historial_estado
             FROM socios_historial_estados
             WHERE id_socio = ? AND tipo_evento = ? AND id_historial_estado > ?
             ORDER BY id_historial_estado DESC
             LIMIT 1'
        );
        $check->execute([$partnerId, $event, $minimumHistoryId]);
        if ($check->fetch()) return;

        $db->prepare(
            'INSERT INTO socios_historial_estados
             (id_socio, tipo_evento, estado_anterior, estado_nuevo, fecha_efectiva, motivo, observaciones, id_usuario)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $partnerId,
            $event,
            $previousStatus,
            $newStatus,
            $date,
            $reason,
            $observations,
            $userId,
        ]);
    }

    private static function throwDuplicateSocioError(Throwable $error, string $type): never
    {
        $message = $error->getMessage();
        if (str_contains($message, 'uq_socios_personas_dni')) {
            api_error('Ya existe otro socio con ese DNI.', 'DNI_DUPLICADO', 409);
        }
        api_error(
            $type === 'PERSONA'
                ? 'No se pudo guardar el socio porque existe un dato único repetido.'
                : 'No se pudo guardar la empresa porque existe un dato único repetido.',
            'REGISTRO_DUPLICADO',
            409
        );
    }
}
