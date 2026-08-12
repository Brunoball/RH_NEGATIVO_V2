<?php
declare(strict_types=1);

trait CategoriasGestion
{
    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = isset($body['id_categoria']) && $body['id_categoria'] !== ''
            ? positive_id($body['id_categoria'], 'categoría')
            : null;
        $name = required_text($body, 'nombre', 'nombre', 100);
        $monthly = decimal_amount(
            $body['monto_mensual'] ?? $body['monto_actual'] ?? null,
            'monto mensual'
        );
        $annual = decimal_amount($body['monto_anual'] ?? null, 'monto anual');
        $effectiveDate = valid_date($body['vigente_desde'] ?? date('Y-m-d'), 'vigencia');
        if ($effectiveDate > date('Y-m-d')) {
            api_error('La fecha de vigencia no puede ser futura.', 'VIGENCIA_PRECIO_INVALIDA', 422);
        }

        try {
            $saved = transaction($db, static function () use (
                $db,
                $auth,
                $id,
                $name,
                $monthly,
                $annual,
                $effectiveDate
            ): array {
                $duplicate = $db->prepare(
                    'SELECT id_categoria FROM categoria
                     WHERE nombre = ? AND id_categoria <> ? LIMIT 1'
                );
                $duplicate->execute([$name, $id ?? 0]);
                if ($duplicate->fetch()) {
                    api_error('Ya existe otra categoría con ese nombre.', 'CATEGORIA_DUPLICADA', 409);
                }

                if ($id === null) {
                    $insert = $db->prepare(
                        'INSERT INTO categoria
                         (nombre, monto_mensual, monto_anual, activo, creado_en)
                         VALUES (?, ?, ?, 1, ?)'
                    );
                    $insert->execute([$name, $monthly, $annual, date('Y-m-d')]);
                    $categoryId = (int)$db->lastInsertId();

                    self::registrarCambioPrecio($db, $categoryId, 'mensual', '0.00', $monthly, $effectiveDate);
                    self::registrarCambioPrecio($db, $categoryId, 'anual', '0.00', $annual, $effectiveDate);

                    $after = self::detalle($db, $categoryId) ?? [];
                    self::auditarCategoria($db, $auth, $categoryId, 'INSERT', null, $after);
                    return $after;
                }

                $lock = $db->prepare('SELECT * FROM categoria WHERE id_categoria = ? FOR UPDATE');
                $lock->execute([$id]);
                $locked = $lock->fetch();
                if (!$locked) {
                    api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);
                }

                $before = self::detalle($db, $id) ?? $locked;
                $previousMonthly = number_format((float)$locked['monto_mensual'], 2, '.', '');
                $previousAnnual = number_format((float)$locked['monto_anual'], 2, '.', '');
                $monthlyChanged = $previousMonthly !== $monthly;
                $annualChanged = $previousAnnual !== $annual;

                if ($monthlyChanged) {
                    self::validarFechaCambioPrecio($db, $id, 'mensual', $effectiveDate);
                }
                if ($annualChanged) {
                    self::validarFechaCambioPrecio($db, $id, 'anual', $effectiveDate);
                }

                $db->prepare(
                    'UPDATE categoria
                     SET nombre = ?, monto_mensual = ?, monto_anual = ?
                     WHERE id_categoria = ?'
                )->execute([$name, $monthly, $annual, $id]);

                if ($monthlyChanged) {
                    self::registrarCambioPrecio(
                        $db,
                        $id,
                        'mensual',
                        $previousMonthly,
                        $monthly,
                        $effectiveDate
                    );
                }
                if ($annualChanged) {
                    self::registrarCambioPrecio(
                        $db,
                        $id,
                        'anual',
                        $previousAnnual,
                        $annual,
                        $effectiveDate
                    );
                }

                $after = self::detalle($db, $id) ?? [];
                self::auditarCategoria($db, $auth, $id, 'UPDATE', $before, $after);
                return $after;
            });
        } catch (PDOException $error) {
            if ((int)($error->errorInfo[1] ?? 0) === 1062) {
                api_error('Ya existe una categoría con ese nombre.', 'CATEGORIA_DUPLICADA', 409);
            }
            throw $error;
        }

        return ['item' => $saved, 'creada' => $id === null];
    }

    private static function validarFechaCambioPrecio(
        PDO $db,
        int $categoryId,
        string $type,
        string $effectiveDate
    ): void {
        $statement = $db->prepare(
            'SELECT fecha_cambio
             FROM precios_historicos
             WHERE id_categoria = ? AND tipo = ?
             ORDER BY fecha_cambio DESC, id_historial DESC
             LIMIT 1 FOR UPDATE'
        );
        $statement->execute([$categoryId, $type]);
        $lastDate = $statement->fetchColumn();
        if ($lastDate !== false && $effectiveDate < (string)$lastDate) {
            api_error(
                'La nueva vigencia no puede ser anterior al último cambio de precio registrado.',
                'VIGENCIA_PRECIO_INVALIDA',
                409
            );
        }
    }

    private static function registrarCambioPrecio(
        PDO $db,
        int $categoryId,
        string $type,
        string $previousAmount,
        string $newAmount,
        string $effectiveDate
    ): void {
        if (!in_array($type, ['mensual', 'anual'], true)) {
            throw new LogicException('Tipo de precio inválido.');
        }

        $db->prepare(
            'INSERT INTO precios_historicos
             (id_categoria, tipo, precio_viejo, precio_nuevo, fecha_cambio)
             VALUES (?, ?, ?, ?, ?)'
        )->execute([$categoryId, $type, $previousAmount, $newAmount, $effectiveDate]);
    }

    private static function cambiarEstadoDatos(array $auth, int $id, bool $active): array
    {
        $db = $auth['db'];
        $saved = transaction($db, static function () use ($db, $auth, $id, $active): array {
            $statement = $db->prepare('SELECT * FROM categoria WHERE id_categoria = ? FOR UPDATE');
            $statement->execute([$id]);
            $locked = $statement->fetch();
            if (!$locked) {
                api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);
            }
            if ((bool)$locked['activo'] === $active) {
                api_error(
                    $active
                        ? 'La categoría ya se encuentra activa.'
                        : 'La categoría ya se encuentra dada de baja.',
                    'ESTADO_SIN_CAMBIOS',
                    409
                );
            }

            $before = self::detalle($db, $id) ?? $locked;
            $db->prepare('UPDATE categoria SET activo = ? WHERE id_categoria = ?')
                ->execute([$active ? 1 : 0, $id]);
            $after = self::detalle($db, $id) ?? [];
            self::auditarCategoria($db, $auth, $id, 'UPDATE', $before, $after);
            return $after;
        });

        return ['item' => $saved];
    }

    /** Auditoría según el esquema real de RH Negativo V2. */
    private static function auditarCategoria(
        PDO $db,
        array $auth,
        int $recordId,
        string $action,
        mixed $before,
        mixed $after
    ): void {
        if (!in_array($action, ['INSERT', 'UPDATE', 'DELETE'], true)) {
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
             VALUES ('categoria', ?, ?, ?, ?, ?, 'SISTEMA')"
        );
        $statement->execute([
            $recordId,
            $action,
            $encode($before),
            $encode($after),
            $auth['id_usuario'],
        ]);
    }
}
