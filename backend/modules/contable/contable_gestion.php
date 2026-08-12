<?php
declare(strict_types=1);

trait ContableGestion
{
    protected static function guardarOpcionDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = self::idOpcional($body['id_opcion'] ?? null, 'opción contable');
        $type = self::tipoOpcion($body['tipo'] ?? null);
        $name = required_text($body, 'nombre', 'nombre', 160);

        return transaction($db, static function () use ($db, $auth, $id, $type, $name): array {
            $duplicate = $db->prepare(
                'SELECT id_opcion
                 FROM contable_opciones
                 WHERE tipo = ? AND nombre = ? AND (? IS NULL OR id_opcion <> ?)
                 LIMIT 1'
            );
            $duplicate->execute([$type, $name, $id, $id]);
            if ($duplicate->fetch()) {
                api_error('Ya existe una opción con ese nombre en la lista seleccionada.', 'OPCION_DUPLICADA', 409);
            }

            $before = null;
            if ($id === null) {
                $statement = $db->prepare(
                    'INSERT INTO contable_opciones (tipo, nombre, activo)
                     VALUES (?, ?, 1)'
                );
                $statement->execute([$type, $name]);
                $savedId = (int)$db->lastInsertId();
                $action = 'CREAR_OPCION';
                $description = "Se creó la opción contable {$name}.";
            } else {
                $before = self::opcionConfiguracion($db, $id, true);
                if (!$before) api_error('La opción que intentás editar no existe.', 'OPCION_CONTABLE_NO_ENCONTRADA', 404);
                if ((string)$before['tipo'] !== $type) {
                    api_error('La opción no pertenece a la lista seleccionada.', 'TIPO_OPCION_INVALIDO', 409);
                }

                $statement = $db->prepare(
                    'UPDATE contable_opciones
                     SET nombre = ?
                     WHERE id_opcion = ?'
                );
                $statement->execute([$name, $id]);
                $savedId = $id;
                $action = 'EDITAR_OPCION';
                $description = "Se modificó la opción contable {$name}.";
            }

            $after = self::opcionConfiguracion($db, $savedId);
            audit_change(
                $db,
                $auth,
                'CONTABLE',
                $action,
                'contable_opciones',
                $savedId,
                $description,
                $before,
                $after
            );

            return [
                'creado' => $id === null,
                'item' => $after,
            ];
        });
    }


    protected static function cambiarEstadoOpcionDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id_opcion'] ?? null, 'opción contable');
        $activo = filter_var($body['activo'] ?? null, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($activo === null) {
            api_error('El estado solicitado no es válido.', 'ESTADO_OPCION_INVALIDO');
        }

        return transaction($db, static function () use ($db, $auth, $id, $activo): array {
            $before = self::opcionConfiguracion($db, $id, true);
            if (!$before) {
                api_error('La opción solicitada no existe.', 'OPCION_CONTABLE_NO_ENCONTRADA', 404);
            }

            $db->prepare(
                'UPDATE contable_opciones
                 SET activo = ?
                 WHERE id_opcion = ?'
            )->execute([$activo ? 1 : 0, $id]);

            $after = self::opcionConfiguracion($db, $id);
            audit_change(
                $db,
                $auth,
                'CONTABLE',
                $activo ? 'REACTIVAR_OPCION' : 'DAR_BAJA_OPCION',
                'contable_opciones',
                $id,
                $activo
                    ? "Se reactivó la opción contable {$before['nombre']}."
                    : "Se dio de baja la opción contable {$before['nombre']}.",
                $before,
                $after
            );

            return [
                'id_opcion' => $id,
                'activo' => $activo,
                'item' => $after,
            ];
        });
    }

    protected static function eliminarOpcionDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id_opcion'] ?? null, 'opción contable');

        return transaction($db, static function () use ($db, $auth, $id): array {
            $before = self::opcionConfiguracion($db, $id, true);
            if (!$before) api_error('La opción que intentás eliminar no existe.', 'OPCION_CONTABLE_NO_ENCONTRADA', 404);

            $usageCount = self::cantidadUsosOpcion($db, (string)$before['tipo'], (string)$before['nombre']);
            $unlinkedCount = self::desvincularOpcionContable(
                $db,
                (string)$before['tipo'],
                (string)$before['nombre']
            );

            $db->prepare('DELETE FROM contable_opciones WHERE id_opcion = ?')->execute([$id]);
            audit_change(
                $db,
                $auth,
                'CONTABLE',
                'ELIMINAR_OPCION',
                'contable_opciones',
                $id,
                "Se eliminó definitivamente la opción contable {$before['nombre']} y {$unlinkedCount} movimientos asociados quedaron sin esa información.",
                $before,
                null
            );

            return [
                'id_opcion' => $id,
                'eliminado_definitivo' => true,
                'cantidad_usos' => $usageCount,
                'registros_desvinculados' => $unlinkedCount,
            ];
        });
    }

    protected static function desvincularOpcionContable(PDO $db, string $type, string $name): int
    {
        $targets = match ($type) {
            'PROVEEDOR' => [
                ['contable_ingresos', 'proveedor'],
                ['contable_egresos', 'proveedor'],
            ],
            'CATEGORIA_INGRESO' => [['contable_ingresos', 'categoria']],
            'CONCEPTO_INGRESO' => [['contable_ingresos', 'concepto']],
            'CATEGORIA_EGRESO' => [['contable_egresos', 'categoria']],
            'CONCEPTO_EGRESO' => [['contable_egresos', 'concepto']],
            default => [],
        };

        $updated = 0;
        foreach ($targets as [$table, $column]) {
            $statement = $db->prepare("UPDATE {$table} SET {$column} = NULL WHERE {$column} = ?");
            $statement->execute([$name]);
            $updated += $statement->rowCount();
        }
        return $updated;
    }

    protected static function guardarIngresoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = self::idOpcional($body['id_ingreso'] ?? null, 'ingreso');
        $date = valid_date($body['fecha'] ?? null, 'ingreso');
        $mean = self::medioPago($db, positive_id($body['id_medio_pago'] ?? null, 'medio de pago'));
        $provider = self::opcion($db, positive_id($body['id_proveedor'] ?? null, 'persona o proveedor'), 'PROVEEDOR');
        $category = self::opcion($db, positive_id($body['id_categoria'] ?? null, 'categoría'), 'CATEGORIA_INGRESO');
        $concept = self::opcion($db, positive_id($body['id_concepto'] ?? null, 'concepto'), 'CONCEPTO_INGRESO');
        $amount = decimal_amount($body['importe'] ?? null, 'importe', 0.01);
        $detail = optional_text($body['detalle'] ?? null, 500);

        return transaction($db, static function () use (
            $db,
            $auth,
            $id,
            $date,
            $mean,
            $provider,
            $category,
            $concept,
            $amount,
            $detail
        ): array {
            $before = null;
            if ($id !== null) {
                $statement = $db->prepare(
                    'SELECT * FROM contable_ingresos WHERE id_ingreso = ? LIMIT 1 FOR UPDATE'
                );
                $statement->execute([$id]);
                $before = $statement->fetch();
                if (!$before) api_error('El ingreso que intentás editar no existe.', 'INGRESO_NO_ENCONTRADO', 404);

                $db->prepare(
                    'UPDATE contable_ingresos SET
                        fecha = ?, id_medio_pago = ?, proveedor = ?, categoria = ?, concepto = ?,
                        importe = ?, detalle = ?
                     WHERE id_ingreso = ?'
                )->execute([
                    $date,
                    $mean['id_medio_pago'],
                    $provider['nombre'],
                    $category['nombre'],
                    $concept['nombre'],
                    $amount,
                    $detail,
                    $id,
                ]);
                $savedId = $id;
                $action = 'EDITAR_INGRESO';
            } else {
                $db->prepare(
                    'INSERT INTO contable_ingresos
                     (fecha, id_medio_pago, proveedor, categoria, concepto, importe, detalle)
                     VALUES (?, ?, ?, ?, ?, ?, ?)'
                )->execute([
                    $date,
                    $mean['id_medio_pago'],
                    $provider['nombre'],
                    $category['nombre'],
                    $concept['nombre'],
                    $amount,
                    $detail,
                ]);
                $savedId = (int)$db->lastInsertId();
                $action = 'CREAR_INGRESO';
            }

            $statement = $db->prepare('SELECT * FROM contable_ingresos WHERE id_ingreso = ? LIMIT 1');
            $statement->execute([$savedId]);
            $after = $statement->fetch();
            audit_change(
                $db,
                $auth,
                'CONTABLE',
                $action,
                'contable_ingresos',
                $savedId,
                $id === null ? 'Se registró un ingreso manual.' : 'Se modificó un ingreso manual.',
                $before,
                $after
            );
            return ['id_ingreso' => $savedId];
        });
    }

    protected static function eliminarIngresoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id_ingreso'] ?? null, 'ingreso');

        return transaction($db, static function () use ($db, $auth, $id): array {
            $statement = $db->prepare(
                'SELECT * FROM contable_ingresos WHERE id_ingreso = ? LIMIT 1 FOR UPDATE'
            );
            $statement->execute([$id]);
            $before = $statement->fetch();
            if (!$before) api_error('El ingreso no existe.', 'INGRESO_NO_ENCONTRADO', 404);

            $db->prepare('DELETE FROM contable_ingresos WHERE id_ingreso = ?')->execute([$id]);
            audit_change(
                $db,
                $auth,
                'CONTABLE',
                'ELIMINAR_INGRESO',
                'contable_ingresos',
                $id,
                'Se eliminó un ingreso manual.',
                $before,
                null
            );
            return ['id_ingreso' => $id];
        });
    }

    protected static function guardarEgresoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = self::idOpcional($body['id_egreso'] ?? null, 'egreso');
        $date = valid_date($body['fecha'] ?? null, 'egreso');
        $mean = self::medioPago($db, positive_id($body['id_medio_pago'] ?? null, 'medio de pago'));
        $provider = self::opcion($db, positive_id($body['id_proveedor'] ?? null, 'persona o proveedor'), 'PROVEEDOR');
        $category = self::opcion($db, positive_id($body['id_categoria'] ?? null, 'categoría'), 'CATEGORIA_EGRESO');
        $concept = self::opcion($db, positive_id($body['id_concepto'] ?? null, 'concepto'), 'CONCEPTO_EGRESO');
        $receiptNumber = optional_text($body['numero_comprobante'] ?? null, 120);
        $amount = decimal_amount($body['importe'] ?? null, 'importe', 0.01);
        $detail = optional_text($body['detalle'] ?? null, 500);
        $removeFile = filter_var($body['eliminar_archivo'] ?? false, FILTER_VALIDATE_BOOL);
        $newFile = self::guardarArchivoEgreso($auth);
        $oldFileToDelete = null;

        try {
            $result = transaction($db, static function () use (
                $db,
                $auth,
                $id,
                $date,
                $mean,
                $provider,
                $category,
                $concept,
                $receiptNumber,
                $amount,
                $detail,
                $removeFile,
                $newFile,
                &$oldFileToDelete
            ): array {
                $before = null;
                $filePath = null;

                if ($id !== null) {
                    $statement = $db->prepare(
                        'SELECT * FROM contable_egresos WHERE id_egreso = ? LIMIT 1 FOR UPDATE'
                    );
                    $statement->execute([$id]);
                    $before = $statement->fetch();
                    if (!$before) api_error('El egreso que intentás editar no existe.', 'EGRESO_NO_ENCONTRADO', 404);

                    $filePath = $before['archivo_path'] ?? null;
                    if ($newFile !== null) {
                        $oldFileToDelete = $filePath;
                        $filePath = $newFile['archivo_path'];
                    } elseif ($removeFile) {
                        $oldFileToDelete = $filePath;
                        $filePath = null;
                    }

                    $db->prepare(
                        'UPDATE contable_egresos SET
                            fecha = ?, id_medio_pago = ?, proveedor = ?, categoria = ?, concepto = ?,
                            numero_comprobante = ?, importe = ?, detalle = ?, archivo_path = ?
                         WHERE id_egreso = ?'
                    )->execute([
                        $date,
                        $mean['id_medio_pago'],
                        $provider['nombre'],
                        $category['nombre'],
                        $concept['nombre'],
                        $receiptNumber,
                        $amount,
                        $detail,
                        $filePath,
                        $id,
                    ]);
                    $savedId = $id;
                    $action = 'EDITAR_EGRESO';
                } else {
                    $filePath = $newFile['archivo_path'] ?? null;
                    $db->prepare(
                        'INSERT INTO contable_egresos
                         (fecha, id_medio_pago, proveedor, categoria, concepto, numero_comprobante,
                          importe, detalle, archivo_path)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                    )->execute([
                        $date,
                        $mean['id_medio_pago'],
                        $provider['nombre'],
                        $category['nombre'],
                        $concept['nombre'],
                        $receiptNumber,
                        $amount,
                        $detail,
                        $filePath,
                    ]);
                    $savedId = (int)$db->lastInsertId();
                    $action = 'CREAR_EGRESO';
                }

                $statement = $db->prepare('SELECT * FROM contable_egresos WHERE id_egreso = ? LIMIT 1');
                $statement->execute([$savedId]);
                $after = $statement->fetch();
                audit_change(
                    $db,
                    $auth,
                    'CONTABLE',
                    $action,
                    'contable_egresos',
                    $savedId,
                    $id === null ? 'Se registró un egreso.' : 'Se modificó un egreso.',
                    $before,
                    $after
                );
                return ['id_egreso' => $savedId];
            });
        } catch (Throwable $error) {
            if ($newFile && !empty($newFile['absolute_path']) && is_file($newFile['absolute_path'])) {
                @unlink($newFile['absolute_path']);
            }
            throw $error;
        }

        if ($oldFileToDelete) self::borrarArchivoFisico($auth, $oldFileToDelete);
        return $result;
    }

    protected static function eliminarEgresoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id_egreso'] ?? null, 'egreso');
        $filePath = null;

        $result = transaction($db, static function () use ($db, $auth, $id, &$filePath): array {
            $statement = $db->prepare(
                'SELECT * FROM contable_egresos WHERE id_egreso = ? LIMIT 1 FOR UPDATE'
            );
            $statement->execute([$id]);
            $before = $statement->fetch();
            if (!$before) api_error('El egreso no existe.', 'EGRESO_NO_ENCONTRADO', 404);
            $filePath = $before['archivo_path'] ?? null;

            $db->prepare('DELETE FROM contable_egresos WHERE id_egreso = ?')->execute([$id]);
            audit_change(
                $db,
                $auth,
                'CONTABLE',
                'ELIMINAR_EGRESO',
                'contable_egresos',
                $id,
                'Se eliminó un egreso.',
                $before,
                null
            );
            return ['id_egreso' => $id];
        });

        if ($filePath) self::borrarArchivoFisico($auth, $filePath);
        return $result;
    }
}
