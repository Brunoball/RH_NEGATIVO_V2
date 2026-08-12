<?php
declare(strict_types=1);

trait DescuentosFamiliaresGestion
{
    private static function listarDescuentosDatos(PDO $db, array $filters = []): array
    {
        $status = trim((string)($filters['estado'] ?? 'vigente'));
        if (!in_array($status, ['vigente', 'historial', 'todos'], true)) {
            api_error('El estado solicitado no es válido.', 'FILTRO_INVALIDO');
        }

        $where = match ($status) {
            'vigente' => 'WHERE d.activo = 1',
            'historial' => 'WHERE d.activo = 0',
            default => '',
        };

        $statement = $db->query(
            "SELECT d.id_descuento_familiar,
                    d.cantidad_integrantes_desde,
                    d.cantidad_integrantes_hasta,
                    d.porcentaje_descuento,
                    d.vigencia_desde,
                    d.vigencia_hasta,
                    d.descripcion,
                    d.activo,
                    CASE
                        WHEN d.activo = 0 THEN 'HISTORICO'
                        WHEN d.vigencia_desde > CURDATE() THEN 'PROGRAMADO'
                        WHEN d.vigencia_hasta IS NOT NULL AND d.vigencia_hasta < CURDATE() THEN 'FINALIZADO'
                        ELSE 'VIGENTE'
                    END AS estado_vigencia,
                    d.creado_en AS created_at,
                    d.actualizado_en AS updated_at
             FROM descuentos_familiares d
             {$where}
             ORDER BY d.activo DESC,
                      d.cantidad_integrantes_desde ASC,
                      CASE
                          WHEN d.cantidad_integrantes_hasta IS NULL THEN 51
                          ELSE d.cantidad_integrantes_hasta
                      END ASC,
                      d.vigencia_desde DESC,
                      d.id_descuento_familiar DESC"
        );

        return array_map(
            static fn(array $item): array => self::castDescuento($item),
            $statement->fetchAll()
        );
    }

    private static function guardarDescuentoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = isset($body['id_descuento_familiar']) && $body['id_descuento_familiar'] !== ''
            ? positive_id($body['id_descuento_familiar'], 'descuento familiar')
            : null;

        $from = self::validarCantidadIntegrantes(
            $body['cantidad_integrantes_desde'] ?? null,
            'cantidad mínima de integrantes'
        );
        $to = self::validarCantidadIntegrantesOpcional(
            $body['cantidad_integrantes_hasta'] ?? null,
            'cantidad máxima de integrantes'
        );
        if ($to !== null && $to < $from) {
            api_error(
                'La cantidad máxima no puede ser menor que la cantidad mínima.',
                'RANGO_INTEGRANTES_INVALIDO',
                422,
                ['campo' => 'cantidad_integrantes_hasta']
            );
        }

        $percentage = decimal_amount(
            $body['porcentaje_descuento'] ?? null,
            'porcentaje de descuento',
            0.01,
            100
        );
        $effectiveFrom = valid_date(
            $body['vigencia_desde'] ?? date('Y-m-d'),
            'inicio de vigencia'
        );
        $effectiveTo = valid_date(
            $body['vigencia_hasta'] ?? null,
            'fin de vigencia',
            false
        );
        if ($effectiveTo !== null && $effectiveTo < $effectiveFrom) {
            api_error(
                'El fin de vigencia no puede ser anterior al inicio.',
                'VIGENCIA_DESCUENTO_INVALIDA',
                422,
                ['campo' => 'vigencia_hasta']
            );
        }
        $description = optional_text($body['descripcion'] ?? null, 255);

        try {
            return transaction($db, static function () use (
                $db,
                $auth,
                $id,
                $from,
                $to,
                $percentage,
                $effectiveFrom,
                $effectiveTo,
                $description
            ): array {
                if ($id === null) {
                    self::validarSolapamientoDescuento(
                        $db,
                        $from,
                        $to,
                        $effectiveFrom,
                        $effectiveTo,
                        null
                    );
                    $discountId = self::insertarDescuento(
                        $db,
                        $from,
                        $to,
                        $percentage,
                        $effectiveFrom,
                        $effectiveTo,
                        $description
                    );
                    $after = self::obtenerDescuento($db, $discountId);

                    audit_change(
                        $db,
                        $auth,
                        'CATEGORIAS',
                        'CREAR',
                        'descuentos_familiares',
                        $discountId,
                        'Se creó una regla global de descuento familiar por cantidad de integrantes.',
                        null,
                        $after
                    );

                    return ['item' => $after, 'creado' => true];
                }

                $beforeRaw = self::bloquearDescuento($db, $id);
                $before = self::castDescuento($beforeRaw);
                if (!(bool)$before['activo']) {
                    api_error(
                        'Una regla histórica no puede editarse.',
                        'DESCUENTO_FAMILIAR_HISTORICO',
                        409
                    );
                }
                if ($effectiveFrom < (string)$before['vigencia_desde']) {
                    api_error(
                        'La nueva vigencia no puede comenzar antes que la regla actual.',
                        'VIGENCIA_DESCUENTO_INVALIDA',
                        409
                    );
                }

                if ($effectiveFrom === (string)$before['vigencia_desde']) {
                    self::validarSolapamientoDescuento(
                        $db,
                        $from,
                        $to,
                        $effectiveFrom,
                        $effectiveTo,
                        $id
                    );
                    self::actualizarDescuento(
                        $db,
                        $id,
                        $from,
                        $to,
                        $percentage,
                        $effectiveFrom,
                        $effectiveTo,
                        $description
                    );
                    $discountId = $id;
                } else {
                    $dayBefore = (new DateTimeImmutable($effectiveFrom))
                        ->modify('-1 day')
                        ->format('Y-m-d');
                    $previousEnd = $before['vigencia_hasta'] === null
                        ? $dayBefore
                        : min((string)$before['vigencia_hasta'], $dayBefore);

                    self::desactivarDescuento($db, $id, $previousEnd);
                    self::validarSolapamientoDescuento(
                        $db,
                        $from,
                        $to,
                        $effectiveFrom,
                        $effectiveTo,
                        null
                    );
                    $discountId = self::insertarDescuento(
                        $db,
                        $from,
                        $to,
                        $percentage,
                        $effectiveFrom,
                        $effectiveTo,
                        $description
                    );
                }

                $after = self::obtenerDescuento($db, $discountId);
                audit_change(
                    $db,
                    $auth,
                    'CATEGORIAS',
                    'EDITAR',
                    'descuentos_familiares',
                    $discountId,
                    'Se modificó una regla global de descuento familiar. Si cambió la vigencia, la versión anterior quedó en el historial.',
                    $before,
                    $after
                );

                return ['item' => $after, 'creado' => false];
            });
        } catch (PDOException $error) {
            self::resolverErrorPersistenciaDescuento($error);
        }
    }

    private static function eliminarDescuentoDatos(array $auth, int $id): void
    {
        $db = $auth['db'];

        try {
            transaction($db, static function () use ($db, $auth, $id): void {
                $beforeRaw = self::bloquearDescuento($db, $id);
                $before = self::castDescuento($beforeRaw);
                if (!(bool)$before['activo']) {
                    api_error(
                        'El descuento familiar ya se encuentra en el historial.',
                        'ESTADO_SIN_CAMBIOS',
                        409
                    );
                }

                $today = date('Y-m-d');
                $endDate = $today < (string)$before['vigencia_desde']
                    ? (string)$before['vigencia_desde']
                    : $today;
                if ($before['vigencia_hasta'] !== null && (string)$before['vigencia_hasta'] < $endDate) {
                    $endDate = (string)$before['vigencia_hasta'];
                }

                self::desactivarDescuento($db, $id, $endDate);
                $after = self::obtenerDescuento($db, $id);

                audit_change(
                    $db,
                    $auth,
                    'CATEGORIAS',
                    'ELIMINAR',
                    'descuentos_familiares',
                    $id,
                    'Se desactivó una regla global de descuento familiar y se conservó en el historial.',
                    $before,
                    $after
                );
            });
        } catch (PDOException $error) {
            self::resolverErrorPersistenciaDescuento($error);
        }
    }

    private static function insertarDescuento(
        PDO $db,
        int $from,
        ?int $to,
        string $percentage,
        string $effectiveFrom,
        ?string $effectiveTo,
        ?string $description
    ): int {
        $statement = $db->prepare(
            'INSERT INTO descuentos_familiares
             (cantidad_integrantes_desde, cantidad_integrantes_hasta,
              porcentaje_descuento, vigencia_desde, vigencia_hasta,
              descripcion, activo)
             VALUES
             (:cantidad_desde, :cantidad_hasta, :porcentaje,
              :vigencia_desde, :vigencia_hasta, :descripcion, 1)'
        );
        self::bindNullableInt($statement, ':cantidad_hasta', $to);
        self::bindNullableString($statement, ':vigencia_hasta', $effectiveTo);
        self::bindNullableString($statement, ':descripcion', $description);
        $statement->bindValue(':cantidad_desde', $from, PDO::PARAM_INT);
        $statement->bindValue(':porcentaje', $percentage, PDO::PARAM_STR);
        $statement->bindValue(':vigencia_desde', $effectiveFrom, PDO::PARAM_STR);
        $statement->execute();

        $id = (int)$db->lastInsertId();
        if ($id <= 0) {
            throw new RuntimeException('No se pudo recuperar el identificador del descuento familiar creado.');
        }
        return $id;
    }

    private static function actualizarDescuento(
        PDO $db,
        int $id,
        int $from,
        ?int $to,
        string $percentage,
        string $effectiveFrom,
        ?string $effectiveTo,
        ?string $description
    ): void {
        $statement = $db->prepare(
            'UPDATE descuentos_familiares
             SET cantidad_integrantes_desde = :cantidad_desde,
                 cantidad_integrantes_hasta = :cantidad_hasta,
                 porcentaje_descuento = :porcentaje,
                 vigencia_desde = :vigencia_desde,
                 vigencia_hasta = :vigencia_hasta,
                 descripcion = :descripcion
             WHERE id_descuento_familiar = :id'
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->bindValue(':cantidad_desde', $from, PDO::PARAM_INT);
        self::bindNullableInt($statement, ':cantidad_hasta', $to);
        $statement->bindValue(':porcentaje', $percentage, PDO::PARAM_STR);
        $statement->bindValue(':vigencia_desde', $effectiveFrom, PDO::PARAM_STR);
        self::bindNullableString($statement, ':vigencia_hasta', $effectiveTo);
        self::bindNullableString($statement, ':descripcion', $description);
        $statement->execute();
    }

    private static function desactivarDescuento(PDO $db, int $id, string $endDate): void
    {
        $statement = $db->prepare(
            'UPDATE descuentos_familiares
             SET activo = 0, vigencia_hasta = :vigencia_hasta
             WHERE id_descuento_familiar = :id'
        );
        $statement->bindValue(':vigencia_hasta', $endDate, PDO::PARAM_STR);
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
    }

    private static function validarSolapamientoDescuento(
        PDO $db,
        int $from,
        ?int $to,
        string $effectiveFrom,
        ?string $effectiveTo,
        ?int $excludeId
    ): void {
        $sql =
            'SELECT id_descuento_familiar
             FROM descuentos_familiares
             WHERE activo = 1
               AND id_descuento_familiar <> :id_excluido
               AND (cantidad_integrantes_hasta IS NULL
                    OR cantidad_integrantes_hasta >= :cantidad_desde)
               AND (vigencia_hasta IS NULL
                    OR vigencia_hasta >= :vigencia_desde)';

        if ($to !== null) {
            $sql .= "\n               AND cantidad_integrantes_desde <= :cantidad_hasta";
        }
        if ($effectiveTo !== null) {
            $sql .= "\n               AND vigencia_desde <= :vigencia_hasta";
        }
        $sql .= "\n             LIMIT 1";

        $statement = $db->prepare($sql);
        $statement->bindValue(':id_excluido', $excludeId ?? 0, PDO::PARAM_INT);
        $statement->bindValue(':cantidad_desde', $from, PDO::PARAM_INT);
        $statement->bindValue(':vigencia_desde', $effectiveFrom, PDO::PARAM_STR);
        if ($to !== null) {
            $statement->bindValue(':cantidad_hasta', $to, PDO::PARAM_INT);
        }
        if ($effectiveTo !== null) {
            $statement->bindValue(':vigencia_hasta', $effectiveTo, PDO::PARAM_STR);
        }
        $statement->execute();

        if ($statement->fetch()) {
            api_error(
                'Ya existe una regla global activa que se superpone para ese rango de integrantes y vigencia.',
                'DESCUENTO_FAMILIAR_DUPLICADO',
                409
            );
        }
    }

    private static function bloquearDescuento(PDO $db, int $id): array
    {
        $statement = $db->prepare(
            'SELECT id_descuento_familiar,
                    cantidad_integrantes_desde,
                    cantidad_integrantes_hasta,
                    porcentaje_descuento,
                    vigencia_desde,
                    vigencia_hasta,
                    descripcion,
                    activo,
                    creado_en AS created_at,
                    actualizado_en AS updated_at
             FROM descuentos_familiares
             WHERE id_descuento_familiar = :id
             FOR UPDATE'
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
        $row = $statement->fetch();
        if (!$row) {
            api_error(
                'El descuento familiar no existe.',
                'DESCUENTO_FAMILIAR_NO_ENCONTRADO',
                404
            );
        }
        return $row;
    }

    private static function obtenerDescuento(PDO $db, int $id): array
    {
        $statement = $db->prepare(
            "SELECT id_descuento_familiar,
                    cantidad_integrantes_desde,
                    cantidad_integrantes_hasta,
                    porcentaje_descuento,
                    vigencia_desde,
                    vigencia_hasta,
                    descripcion,
                    activo,
                    CASE
                        WHEN activo = 0 THEN 'HISTORICO'
                        WHEN vigencia_desde > CURDATE() THEN 'PROGRAMADO'
                        WHEN vigencia_hasta IS NOT NULL AND vigencia_hasta < CURDATE() THEN 'FINALIZADO'
                        ELSE 'VIGENTE'
                    END AS estado_vigencia,
                    creado_en AS created_at,
                    actualizado_en AS updated_at
             FROM descuentos_familiares
             WHERE id_descuento_familiar = :id"
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
        $row = $statement->fetch();
        if (!$row) {
            api_error(
                'El descuento familiar no existe.',
                'DESCUENTO_FAMILIAR_NO_ENCONTRADO',
                404
            );
        }
        return self::castDescuento($row);
    }

    private static function resolverErrorPersistenciaDescuento(PDOException $error): never
    {
        $driverCode = (int)($error->errorInfo[1] ?? 0);
        $message = (string)($error->errorInfo[2] ?? $error->getMessage());
        $normalizedMessage = function_exists('mb_strtolower')
            ? mb_strtolower($message, 'UTF-8')
            : strtolower($message);

        if ($driverCode === 1062) {
            api_error(
                'Ya existe una regla de descuento familiar con esos datos.',
                'DESCUENTO_FAMILIAR_DUPLICADO',
                409
            );
        }

        // MySQL utiliza 1644 cuando un trigger ejecuta SIGNAL SQLSTATE 45000.
        // Las reglas funcionales conocidas deben llegar al frontend como un
        // conflicto entendible y no como un error interno genérico.
        if ($driverCode === 1644 || (string)$error->getCode() === '45000') {
            if (
                str_contains($normalizedMessage, 'superpon')
                || str_contains($normalizedMessage, 'duplic')
                || str_contains($normalizedMessage, 'ya existe')
            ) {
                api_error(
                    'Ya existe una regla global activa que se superpone para ese rango de integrantes y vigencia.',
                    'DESCUENTO_FAMILIAR_DUPLICADO',
                    409
                );
            }

            api_error(
                $message !== '' ? $message : 'La base rechazó la regla de descuento familiar.',
                'VALIDATION_ERROR',
                422
            );
        }

        if (in_array($driverCode, [1048, 1264, 1364, 1366, 3819, 4025], true)) {
            api_error(
                'Los datos del descuento familiar no cumplen las validaciones de la base.',
                'VALIDATION_ERROR',
                422
            );
        }

        // Estos errores aparecen cuando la tabla global quedó acompañada por
        // triggers o consultas del modelo anterior por categoría. Se informa
        // la causa concreta para que nunca vuelva a verse solamente un 500.
        if (in_array($driverCode, [1054, 1146, 1356, 1442], true)) {
            error_log(sprintf(
                '[descuentos_familiares] ESQUEMA_DESACTUALIZADO SQLSTATE=%s DRIVER=%d MENSAJE=%s',
                (string)$error->getCode(),
                $driverCode,
                $message
            ));
            api_error(
                'La base conserva un trigger o una estructura vieja de descuentos familiares. Ejecutá la corrección SQL incluida una sola vez.',
                'ESQUEMA_DESCUENTOS_DESACTUALIZADO',
                500
            );
        }

        error_log(sprintf(
            '[descuentos_familiares] SQLSTATE=%s DRIVER=%d MENSAJE=%s',
            (string)$error->getCode(),
            $driverCode,
            $message
        ));
        throw $error;
    }

    private static function bindNullableInt(PDOStatement $statement, string $parameter, ?int $value): void
    {
        if ($value === null) {
            $statement->bindValue($parameter, null, PDO::PARAM_NULL);
            return;
        }
        $statement->bindValue($parameter, $value, PDO::PARAM_INT);
    }

    private static function bindNullableString(PDOStatement $statement, string $parameter, ?string $value): void
    {
        if ($value === null) {
            $statement->bindValue($parameter, null, PDO::PARAM_NULL);
            return;
        }
        $statement->bindValue($parameter, $value, PDO::PARAM_STR);
    }

    private static function validarCantidadIntegrantes(mixed $value, string $label): int
    {
        $quantity = filter_var(
            $value,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 2, 'max_range' => 50]]
        );
        if ($quantity === false) {
            api_error(
                "La {$label} debe estar entre 2 y 50.",
                'VALIDATION_ERROR',
                422
            );
        }
        return (int)$quantity;
    }

    private static function validarCantidadIntegrantesOpcional(mixed $value, string $label): ?int
    {
        if ($value === null || trim((string)$value) === '') {
            return null;
        }
        return self::validarCantidadIntegrantes($value, $label);
    }

    private static function castDescuento(array $item): array
    {
        if ($item === []) {
            return [];
        }
        $item['id_descuento_familiar'] = (int)$item['id_descuento_familiar'];
        $item['cantidad_integrantes_desde'] = (int)$item['cantidad_integrantes_desde'];
        $item['cantidad_integrantes_hasta'] = $item['cantidad_integrantes_hasta'] === null
            ? null
            : (int)$item['cantidad_integrantes_hasta'];
        $item['porcentaje_descuento'] = number_format(
            (float)$item['porcentaje_descuento'],
            2,
            '.',
            ''
        );
        $item['activo'] = (bool)$item['activo'];
        $item['estado_vigencia'] = (string)(
            $item['estado_vigencia']
            ?? ($item['activo'] ? 'VIGENTE' : 'HISTORICO')
        );
        return $item;
    }
}
