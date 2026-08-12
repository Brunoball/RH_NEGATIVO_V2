<?php
declare(strict_types=1);

trait ConfiguracionGestion
{
    private static function guardarItemDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $definition = configuracion_lista_definicion($body['lista'] ?? null);
        $idText = trim((string)($body['id'] ?? ''));
        $id = $idText === '' ? null : positive_id($idText, $definition['etiqueta']);
        $name = required_text(
            $body,
            'nombre',
            $definition['etiqueta'],
            (int)$definition['max_nombre']
        );

        try {
            return transaction($db, static function () use ($db, $auth, $definition, $id, $name): array {
                $table = $definition['tabla'];
                $idField = $definition['id_campo'];
                $before = null;

                self::validarNombreDuplicado($db, $definition, $name, $id);

                if ($id === null) {
                    $insert = $db->prepare(
                        "INSERT INTO {$table} (nombre, activo, creado_en, actualizado_en)
                         VALUES (?, 1, NOW(), NOW())"
                    );
                    $insert->execute([$name]);
                    $savedId = (int)$db->lastInsertId();
                    $action = 'CREAR_' . $definition['entidad'];
                    $description = "Se creó {$definition['etiqueta']} {$name}.";
                } else {
                    $before = configuracion_item($db, $definition, $id, true);
                    if (!$before) {
                        api_error('La opción que intentás editar no existe.', 'OPCION_NO_ENCONTRADA', 404);
                    }

                    $db->prepare(
                        "UPDATE {$table}
                         SET nombre = ?, actualizado_en = NOW()
                         WHERE {$idField} = ?"
                    )->execute([$name, $id]);
                    $savedId = $id;
                    $action = 'EDITAR_' . $definition['entidad'];
                    $description = "Se modificó {$definition['etiqueta']} {$name}.";
                }

                $after = configuracion_item($db, $definition, $savedId);
                audit_change(
                    $db,
                    $auth,
                    'CONFIGURACION',
                    $action,
                    $table,
                    $savedId,
                    $description,
                    $before,
                    $after
                );

                return [
                    'creado' => $id === null,
                    'lista' => $definition['lista'],
                    'item' => $after,
                ];
            });
        } catch (Throwable $error) {
            if (duplicate_key($error)) {
                api_error('Ya existe una opción con ese nombre.', 'NOMBRE_DUPLICADO', 409);
            }
            throw $error;
        }
    }


    private static function establecerEstadoItemDatos(array $auth, array $body, bool $activo): array
    {
        $db = $auth['db'];
        $definition = configuracion_lista_definicion($body['lista'] ?? null);
        $id = positive_id($body['id'] ?? null, $definition['etiqueta']);

        return transaction($db, static function () use ($db, $auth, $definition, $id, $activo): array {
            $table = $definition['tabla'];
            $idField = $definition['id_campo'];
            $before = configuracion_item($db, $definition, $id, true);
            if (!$before) {
                api_error('La opción solicitada no existe.', 'OPCION_NO_ENCONTRADA', 404);
            }

            $db->prepare(
                "UPDATE {$table}
                 SET activo = ?, actualizado_en = NOW()
                 WHERE {$idField} = ?"
            )->execute([$activo ? 1 : 0, $id]);

            $after = configuracion_item($db, $definition, $id);
            $action = ($activo ? 'REACTIVAR_' : 'DAR_BAJA_') . $definition['entidad'];
            $description = $activo
                ? "Se reactivó {$definition['etiqueta']} {$before['nombre']}."
                : "Se dio de baja {$definition['etiqueta']} {$before['nombre']}.";

            audit_change(
                $db,
                $auth,
                'CONFIGURACION',
                $action,
                $table,
                $id,
                $description,
                $before,
                $after
            );

            return [
                'lista' => $definition['lista'],
                'id' => $id,
                'activo' => $activo,
                'eliminado_definitivo' => false,
                'item' => $after,
            ];
        });
    }

    private static function eliminarDefinitivoItemDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $definition = configuracion_lista_definicion($body['lista'] ?? null);
        $id = positive_id($body['id'] ?? null, $definition['etiqueta']);

        // ALTER TABLE hace commit implícito en MySQL/MariaDB, por eso la
        // preparación de columnas nullable se realiza antes de la transacción.
        configuracion_preparar_referencias_nullable($db, $definition);

        return transaction($db, static function () use ($db, $auth, $definition, $id): array {
            $table = $definition['tabla'];
            $idField = $definition['id_campo'];
            $before = configuracion_item($db, $definition, $id, true);
            if (!$before) {
                api_error('La opción solicitada no existe.', 'OPCION_NO_ENCONTRADA', 404);
            }

            $usageCount = configuracion_cantidad_usos($db, $definition, $id);
            // Desvinculamos primero los hijos. Las FK pueden conservar RESTRICT:
            // al momento del DELETE ya no existe ninguna referencia al catálogo.
            $unlinkedCount = configuracion_desvincular_referencias($db, $definition, $id);
            $db->prepare("DELETE FROM {$table} WHERE {$idField} = ?")->execute([$id]);

            audit_change(
                $db,
                $auth,
                'CONFIGURACION',
                'ELIMINAR_' . $definition['entidad'],
                $table,
                $id,
                "Se eliminó definitivamente {$definition['etiqueta']} {$before['nombre']} y {$unlinkedCount} registros asociados quedaron sin esa referencia.",
                $before,
                null
            );

            return [
                'lista' => $definition['lista'],
                'id' => $id,
                'activo' => false,
                'eliminado_definitivo' => true,
                'cantidad_usos' => $usageCount,
                'registros_desvinculados' => $unlinkedCount,
                'item' => null,
            ];
        });
    }

    private static function cambiarEstadoItemDatos(array $auth, array $body, bool $reactivate): array
    {
        $db = $auth['db'];
        $definition = configuracion_lista_definicion($body['lista'] ?? null);
        $id = positive_id($body['id'] ?? null, $definition['etiqueta']);

        return transaction($db, static function () use ($db, $auth, $definition, $id, $reactivate): array {
            $table = $definition['tabla'];
            $idField = $definition['id_campo'];
            $before = configuracion_item($db, $definition, $id, true);
            if (!$before) {
                api_error('La opción solicitada no existe.', 'OPCION_NO_ENCONTRADA', 404);
            }

            if ($reactivate) {
                $db->prepare(
                    "UPDATE {$table}
                     SET activo = 1, actualizado_en = NOW()
                     WHERE {$idField} = ?"
                )->execute([$id]);
                $after = configuracion_item($db, $definition, $id);
                $action = 'REACTIVAR_' . $definition['entidad'];
                $description = "Se reactivó {$definition['etiqueta']} {$before['nombre']}.";
                $deleted = false;
            } else {
                $usageCount = configuracion_cantidad_usos($db, $definition, $id);
                if ($usageCount === 0) {
                    $db->prepare("DELETE FROM {$table} WHERE {$idField} = ?")->execute([$id]);
                    $after = null;
                    $action = 'ELIMINAR_' . $definition['entidad'];
                    $description = "Se eliminó definitivamente {$definition['etiqueta']} {$before['nombre']}.";
                    $deleted = true;
                } else {
                    $db->prepare(
                        "UPDATE {$table}
                         SET activo = 0, actualizado_en = NOW()
                         WHERE {$idField} = ?"
                    )->execute([$id]);
                    $after = configuracion_item($db, $definition, $id);
                    $action = 'DAR_BAJA_' . $definition['entidad'];
                    $description = "Se dio de baja {$definition['etiqueta']} {$before['nombre']} para conservar sus relaciones.";
                    $deleted = false;
                }
            }

            audit_change(
                $db,
                $auth,
                'CONFIGURACION',
                $action,
                $table,
                $id,
                $description,
                $before,
                $after
            );

            return [
                'lista' => $definition['lista'],
                'id' => $id,
                'activo' => $reactivate,
                'eliminado_definitivo' => $deleted,
                'item' => $after,
            ];
        });
    }

    private static function validarNombreDuplicado(
        PDO $db,
        array $definition,
        string $name,
        ?int $excludeId
    ): void {
        $table = $definition['tabla'];
        $idField = $definition['id_campo'];
        $sql = "SELECT {$idField} FROM {$table} WHERE nombre = ?";
        $params = [$name];

        if ($excludeId !== null) {
            $sql .= " AND {$idField} <> ?";
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 1';

        $statement = $db->prepare($sql);
        $statement->execute($params);
        if ($statement->fetchColumn()) {
            api_error('Ya existe una opción con ese nombre.', 'NOMBRE_DUPLICADO', 409);
        }
    }
}
