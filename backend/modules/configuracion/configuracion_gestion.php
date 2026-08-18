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
        $data = self::normalizarCamposConfiguracion($definition, $body);
        self::validarCatalogoEstructural($definition, $id, $data);

        try {
            return transaction($db, static function () use ($db, $auth, $definition, $id, $data): array {
                $table = $definition['tabla'];
                $idField = $definition['id_campo'];
                self::validarNombreDuplicado($db, $definition, $data['nombre'], $id);
                $before = null;

                if ($id === null) {
                    $savedId = null;
                    $columns = array_keys($data);
                    $params = array_values($data);
                    if (!(bool)$definition['auto_id']) {
                        $savedId = configuracion_siguiente_id_manual($db, $definition);
                        array_unshift($columns, $idField);
                        array_unshift($params, $savedId);
                    }
                    $columns[] = 'activo';
                    $params[] = 1;
                    $columns[] = 'creado_en';
                    $placeholders = array_fill(0, count($params), '?');
                    $placeholders[] = 'CURDATE()';
                    $insert = $db->prepare(
                        'INSERT INTO ' . $table . ' (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')'
                    );
                    $insert->execute($params);
                    if ($savedId === null) $savedId = (int)$db->lastInsertId();

                    if ($definition['lista'] === 'categoria') {
                        self::registrarPrecioCategoriaConfiguracion($db, $savedId, 'mensual', '0.00', $data['monto_mensual']);
                        self::registrarPrecioCategoriaConfiguracion($db, $savedId, 'anual', '0.00', $data['monto_anual']);
                    }
                } else {
                    $before = configuracion_item($db, $definition, $id, true);
                    if (!$before) api_error('La opción que intentás editar no existe.', 'OPCION_NO_ENCONTRADA', 404);
                    self::validarEdicionCatalogoConHistorial($db, $definition, $id, $before, $data);
                    $sets = [];
                    foreach (array_keys($data) as $column) $sets[] = "{$column} = ?";
                    $params = array_values($data);
                    $params[] = $id;
                    $db->prepare('UPDATE ' . $table . ' SET ' . implode(', ', $sets) . " WHERE {$idField} = ?")->execute($params);
                    $savedId = $id;

                    if ($definition['lista'] === 'categoria') {
                        $oldMonthly = number_format((float)$before['monto_mensual'], 2, '.', '');
                        $oldAnnual = number_format((float)$before['monto_anual'], 2, '.', '');
                        if ($oldMonthly !== $data['monto_mensual']) {
                            self::registrarPrecioCategoriaConfiguracion($db, $id, 'mensual', $oldMonthly, $data['monto_mensual']);
                        }
                        if ($oldAnnual !== $data['monto_anual']) {
                            self::registrarPrecioCategoriaConfiguracion($db, $id, 'anual', $oldAnnual, $data['monto_anual']);
                        }
                    }
                }

                $after = configuracion_item($db, $definition, $savedId);
                configuracion_auditar($db, $auth, $definition, $savedId, $id === null ? 'INSERT' : 'UPDATE', $before, $after);
                return ['creado' => $id === null, 'lista' => $definition['lista'], 'item' => $after];
            });
        } catch (Throwable $error) {
            if (duplicate_key($error)) api_error('Ya existe una opción con ese nombre.', 'NOMBRE_DUPLICADO', 409);
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
            if (!$before) api_error('La opción solicitada no existe.', 'OPCION_NO_ENCONTRADA', 404);
            self::validarCambioEstadoCatalogoEstructural($definition, $id);
            if ((bool)$before['activo'] === $activo) {
                api_error($activo ? 'La opción ya está activa.' : 'La opción ya está dada de baja.', 'ESTADO_SIN_CAMBIOS', 409);
            }
            $db->prepare("UPDATE {$table} SET activo = ? WHERE {$idField} = ?")->execute([$activo ? 1 : 0, $id]);
            $after = configuracion_item($db, $definition, $id);
            configuracion_auditar($db, $auth, $definition, $id, 'UPDATE', $before, $after);
            return ['lista' => $definition['lista'], 'id' => $id, 'activo' => $activo, 'eliminado_definitivo' => false, 'item' => $after];
        });
    }

    private static function cambiarEstadoItemDatos(array $auth, array $body, bool $reactivate): array
    {
        return self::establecerEstadoItemDatos($auth, $body, $reactivate);
    }

    private static function eliminarDefinitivoItemDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $definition = configuracion_lista_definicion($body['lista'] ?? null);
        $id = positive_id($body['id'] ?? null, $definition['etiqueta']);

        return transaction($db, static function () use ($db, $auth, $definition, $id): array {
            $table = $definition['tabla'];
            $idField = $definition['id_campo'];
            $before = configuracion_item($db, $definition, $id, true);
            if (!$before) api_error('La opción solicitada no existe.', 'OPCION_NO_ENCONTRADA', 404);
            self::validarCambioEstadoCatalogoEstructural($definition, $id);
            $usageCount = configuracion_cantidad_usos($db, $definition, $id);
            if ($usageCount > 0) {
                api_error(
                    "No se puede eliminar definitivamente porque esta {$definition['etiqueta']} tiene {$usageCount} registros asociados. Podés darla de baja para impedir nuevos usos sin perder información histórica.",
                    'OPCION_EN_USO',
                    409,
                    ['cantidad_usos' => $usageCount]
                );
            }
            if ($definition['lista'] === 'categoria') {
                $db->prepare('DELETE FROM precios_historicos WHERE id_categoria = ?')->execute([$id]);
            }
            $db->prepare("DELETE FROM {$table} WHERE {$idField} = ?")->execute([$id]);
            configuracion_auditar($db, $auth, $definition, $id, 'DELETE', $before, null);
            return ['lista' => $definition['lista'], 'id' => $id, 'activo' => false, 'eliminado_definitivo' => true, 'cantidad_usos' => 0, 'item' => null];
        });
    }

    private static function normalizarCamposConfiguracion(array $definition, array $body): array
    {
        $data = [];
        foreach ($definition['campos'] as $field => $config) {
            if ($config['tipo'] === 'decimal') {
                $data[$field] = decimal_amount($body[$field] ?? null, $config['label']);
            } else {
                $data[$field] = required_text($body, $field, $config['label'], (int)$config['max']);
            }
        }
        return $data;
    }

    private static function validarNombreDuplicado(PDO $db, array $definition, string $name, ?int $excludeId): void
    {
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
        if ($statement->fetchColumn()) api_error('Ya existe una opción con ese nombre.', 'NOMBRE_DUPLICADO', 409);
    }

    private static function validarCatalogoEstructural(array $definition, ?int $id, array $data): void
    {
        $list = (string)$definition['lista'];
        if ($list === 'periodo' && $id === null) {
            api_error(
                'Los períodos 1 a 7 son estructurales del sistema y no se pueden agregar períodos adicionales.',
                'PERIODO_ESTRUCTURAL',
                409
            );
        }
        if ($list === 'estado' && $id !== null && in_array($id, [1, 2], true)) {
            $required = $id === 1 ? 'PASIVO' : 'ACTIVO';
            if (strtoupper(trim((string)($data['nombre'] ?? ''))) !== $required) {
                api_error(
                    "El estado {$required} es estructural y no puede cambiar de nombre.",
                    'ESTADO_ESTRUCTURAL',
                    409
                );
            }
        }
    }

    private static function validarEdicionCatalogoConHistorial(
        PDO $db,
        array $definition,
        int $id,
        array $before,
        array $data
    ): void {
        $list = (string)$definition['lista'];

        if ($list === 'periodo' && $id >= 1 && $id <= 7) {
            foreach ($data as $field => $value) {
                if ((string)($before[$field] ?? '') !== (string)$value) {
                    api_error(
                        'Los períodos 1 a 7 son estructurales del sistema y no se pueden renombrar ni modificar.',
                        'PERIODO_ESTRUCTURAL',
                        409
                    );
                }
            }
        }

        // Los movimientos guardan el id del medio, pero los comprobantes e
        // informes históricos muestran su nombre desde el catálogo. Evitamos
        // que un renombrado posterior cambie silenciosamente esa etiqueta.
        if ($list === 'medios_pago'
            && (string)($before['nombre'] ?? '') !== (string)($data['nombre'] ?? '')) {
            $usageCount = configuracion_cantidad_usos($db, $definition, $id);
            if ($usageCount > 0) {
                api_error(
                    'El medio de pago ya está utilizado y no puede renombrarse porque cambiaría comprobantes e informes históricos. Dalo de baja y creá uno nuevo.',
                    'OPCION_EN_USO',
                    409,
                    ['cantidad_usos' => $usageCount]
                );
            }
        }
    }

    private static function validarCambioEstadoCatalogoEstructural(array $definition, int $id): void
    {
        $list = (string)$definition['lista'];
        if ($list === 'periodo' && $id >= 1 && $id <= 7) {
            api_error(
                'Los períodos 1 a 7 son estructurales y no se pueden dar de baja ni eliminar.',
                'PERIODO_ESTRUCTURAL',
                409
            );
        }
        if ($list === 'estado' && in_array($id, [1, 2], true)) {
            api_error(
                'Los estados ACTIVO y PASIVO son estructurales y no se pueden dar de baja ni eliminar.',
                'ESTADO_ESTRUCTURAL',
                409
            );
        }
    }

    private static function registrarPrecioCategoriaConfiguracion(PDO $db, int $categoryId, string $type, string $previousAmount, string $newAmount): void
    {
        $existing = $db->prepare(
            'SELECT id_historial, precio_viejo
             FROM precios_historicos
             WHERE id_categoria = ? AND tipo = ? AND fecha_cambio = CURDATE()
             ORDER BY id_historial ASC
             LIMIT 1 FOR UPDATE'
        );
        $existing->execute([$categoryId, $type]);
        $row = $existing->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $db->prepare(
                'UPDATE precios_historicos SET precio_nuevo = ? WHERE id_historial = ?'
            )->execute([$newAmount, (int)$row['id_historial']]);
            return;
        }
        $db->prepare(
            'INSERT INTO precios_historicos (id_categoria, tipo, precio_viejo, precio_nuevo, fecha_cambio) VALUES (?, ?, ?, ?, CURDATE())'
        )->execute([$categoryId, $type, $previousAmount, $newAmount]);
    }
}
