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
        $name = required_text($body, 'nombre', 'nombre', 120);
        $description = optional_text($body['descripcion'] ?? null, 500);
        $amount = decimal_amount($body['monto_actual'] ?? null, 'monto mensual');
        $effectiveDate = valid_date($body['vigente_desde'] ?? date('Y-m-d'), 'vigencia');
        if ($effectiveDate > date('Y-m-d')) {
            api_error('La fecha de vigencia no puede ser futura.', 'VIGENCIA_PRECIO_INVALIDA');
        }

        try {
            $saved = transaction($db, static function () use (
                $db,
                $auth,
                $id,
                $name,
                $description,
                $amount,
                $effectiveDate
            ): array {
                $duplicate = $db->prepare(
                    'SELECT id_categoria FROM categorias
                     WHERE nombre = ? AND id_categoria <> ? LIMIT 1'
                );
                $duplicate->execute([$name, $id ?? 0]);
                if ($duplicate->fetch()) {
                    api_error('Ya existe otra categoría con ese nombre.', 'CATEGORIA_DUPLICADA', 409);
                }

                if ($id === null) {
                    $insert = $db->prepare(
                        'INSERT INTO categorias
                         (nombre, descripcion, monto_cuota, activo)
                         VALUES (?, ?, ?, 1)'
                    );
                    $insert->execute([$name, $description, $amount]);
                    $categoryId = (int)$db->lastInsertId();
                    self::registrarCambioPrecio(
                        $db,
                        $categoryId,
                        '0.00',
                        $amount,
                        $effectiveDate
                    );
                    $after = self::detalle($db, $categoryId);

                    audit_change(
                        $db,
                        $auth,
                        'CATEGORIAS',
                        'CREAR',
                        'categorias',
                        $categoryId,
                        "Se creó la categoría {$name} con una cuota mensual de {$amount}.",
                        null,
                        $after
                    );
                    return $after ?? [];
                }

                $lock = $db->prepare('SELECT * FROM categorias WHERE id_categoria = ? FOR UPDATE');
                $lock->execute([$id]);
                $locked = $lock->fetch();
                if (!$locked) {
                    api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);
                }

                $before = self::detalle($db, $id) ?? $locked;
                $previousAmount = number_format((float)$locked['monto_cuota'], 2, '.', '');
                $priceChanged = $previousAmount !== $amount;

                if ($priceChanged) {
                    self::validarFechaCambioPrecio($db, $id, $effectiveDate);
                }

                $db->prepare(
                    'UPDATE categorias
                     SET nombre = ?, descripcion = ?, monto_cuota = ?
                     WHERE id_categoria = ?'
                )->execute([$name, $description, $amount, $id]);

                if ($priceChanged) {
                    self::registrarCambioPrecio(
                        $db,
                        $id,
                        $previousAmount,
                        $amount,
                        $effectiveDate
                    );
                }

                $after = self::detalle($db, $id);
                $descriptionAudit = $priceChanged
                    ? "Se modificó la categoría {$name} y su cuota pasó de {$previousAmount} a {$amount} desde {$effectiveDate}."
                    : "Se modificaron los datos de la categoría {$name}.";
                audit_change(
                    $db,
                    $auth,
                    'CATEGORIAS',
                    'EDITAR',
                    'categorias',
                    $id,
                    $descriptionAudit,
                    $before,
                    $after
                );
                return $after ?? [];
            });
        } catch (Throwable $error) {
            if (self::isDuplicateKey($error)) {
                api_error('Ya existe una categoría con esos datos.', 'CATEGORIA_DUPLICADA', 409);
            }
            throw $error;
        }

        return ['item' => $saved, 'creada' => $id === null];
    }

    private static function validarFechaCambioPrecio(PDO $db, int $categoryId, string $effectiveDate): void
    {
        $statement = $db->prepare(
            'SELECT DATE(fecha_cambio)
             FROM categorias_historial_precios
             WHERE id_categoria = ?
             ORDER BY fecha_cambio DESC, id_historial_precio DESC
             LIMIT 1 FOR UPDATE'
        );
        $statement->execute([$categoryId]);
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
        string $previousAmount,
        string $newAmount,
        string $effectiveDate
    ): void {
        $timestamp = $effectiveDate === date('Y-m-d')
            ? date('Y-m-d H:i:s')
            : $effectiveDate . ' 00:00:00';

        $db->prepare(
            'INSERT INTO categorias_historial_precios
             (id_categoria, monto_anterior, monto_nuevo, fecha_cambio)
             VALUES (?, ?, ?, ?)'
        )->execute([$categoryId, $previousAmount, $newAmount, $timestamp]);
    }

    private static function cambiarEstadoDatos(array $auth, int $id, bool $active): array
    {
        $db = $auth['db'];
        $saved = transaction($db, static function () use ($db, $auth, $id, $active): array {
            $statement = $db->prepare('SELECT * FROM categorias WHERE id_categoria = ? FOR UPDATE');
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
            $db->prepare('UPDATE categorias SET activo = ? WHERE id_categoria = ?')
                ->execute([$active ? 1 : 0, $id]);
            $after = self::detalle($db, $id);

            audit_change(
                $db,
                $auth,
                'CATEGORIAS',
                $active ? 'REACTIVAR' : 'DAR_BAJA',
                'categorias',
                $id,
                $active ? 'Se reactivó la categoría.' : 'Se dio de baja la categoría.',
                $before,
                $after
            );
            return $after ?? [];
        });

        return ['item' => $saved];
    }

    private static function isDuplicateKey(Throwable $error): bool
    {
        return $error instanceof PDOException
            && (int)($error->errorInfo[1] ?? 0) === 1062;
    }
}
