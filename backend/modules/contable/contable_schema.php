<?php
declare(strict_types=1);

/**
 * Verifica que la versión simplificada del módulo Contabilidad esté aplicada.
 * La columna de estado de las opciones contables es una migración aditiva y
 * segura: si todavía no existe, se agrega una sola vez para soportar bajas.
 */

function ensure_contable_opciones_estado(PDO $db): void
{
    static $done = [];
    $connectionId = spl_object_id($db);
    if (isset($done[$connectionId])) return;

    $columnExists = static function () use ($db): bool {
        $statement = $db->prepare(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'contable_opciones'
               AND COLUMN_NAME = 'activo'"
        );
        $statement->execute();
        return (int)$statement->fetchColumn() === 1;
    };

    if (!$columnExists()) {
        try {
            $db->exec(
                'ALTER TABLE contable_opciones
                 ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER nombre'
            );
        } catch (Throwable $error) {
            if (!$columnExists()) {
                throw new RuntimeException(
                    'No se pudo agregar el estado activo/inactivo a contable_opciones. Detalle: ' . $error->getMessage(),
                    0,
                    $error
                );
            }
        }
    }

    $indexStatement = $db->prepare(
        "SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'contable_opciones'
           AND INDEX_NAME = 'idx_contable_opciones_activo'"
    );
    $indexStatement->execute();
    if ((int)$indexStatement->fetchColumn() === 0) {
        try {
            $db->exec('ALTER TABLE contable_opciones ADD INDEX idx_contable_opciones_activo (activo)');
        } catch (Throwable $error) {
            // El índice mejora la consulta pero no es requisito funcional.
        }
    }

    $done[$connectionId] = true;
}



/**
 * Los datos históricos pueden quedar sin una opción de configuración cuando
 * un administrador la elimina definitivamente. Por eso estos campos deben
 * aceptar NULL, aunque sigan siendo obligatorios al crear movimientos nuevos.
 */
function ensure_contable_campos_desvinculables(PDO $db): void
{
    static $done = [];
    $connectionId = spl_object_id($db);
    if (isset($done[$connectionId])) return;

    $fields = [
        // id_medio_pago también debe aceptar NULL para que, si un administrador
        // elimina definitivamente un medio de pago, el movimiento permanezca.
        'contable_ingresos' => ['id_medio_pago', 'proveedor', 'categoria', 'concepto'],
        'contable_egresos' => ['id_medio_pago', 'proveedor', 'categoria', 'concepto'],
    ];

    foreach ($fields as $table => $columns) {
        foreach ($columns as $column) {
            $statement = $db->prepare(
                "SELECT COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ?
                   AND COLUMN_NAME = ?
                 LIMIT 1"
            );
            $statement->execute([$table, $column]);
            $info = $statement->fetch();
            if (!$info || strtoupper((string)$info['IS_NULLABLE']) === 'YES') continue;

            $columnType = trim((string)$info['COLUMN_TYPE']);
            $charset = trim((string)($info['CHARACTER_SET_NAME'] ?? ''));
            $collation = trim((string)($info['COLLATION_NAME'] ?? ''));
            $sql = "ALTER TABLE `{$table}` MODIFY COLUMN `{$column}` {$columnType}";
            if ($charset !== '') $sql .= " CHARACTER SET {$charset}";
            if ($collation !== '') $sql .= " COLLATE {$collation}";
            $sql .= ' NULL';
            $db->exec($sql);
        }
    }

    $done[$connectionId] = true;
}

function ensure_contable_schema(PDO $db): void
{
    static $validatedConnections = [];

    ensure_contable_opciones_estado($db);
    ensure_contable_campos_desvinculables($db);
    $connectionId = spl_object_id($db);
    if (isset($validatedConnections[$connectionId])) return;

    $requiredColumns = [
        'contable_opciones' => ['id_opcion', 'tipo', 'nombre', 'activo', 'creado_en', 'actualizado_en'],
        'contable_ingresos' => [
            'id_ingreso', 'fecha', 'id_medio_pago', 'proveedor',
            'categoria', 'concepto', 'importe', 'detalle', 'creado_en', 'actualizado_en',
        ],
        'contable_egresos' => [
            'id_egreso', 'fecha', 'id_medio_pago', 'proveedor',
            'categoria', 'concepto', 'numero_comprobante', 'importe',
            'detalle', 'archivo_path', 'creado_en', 'actualizado_en',
        ],
    ];

    $forbiddenColumns = [
        'contable_opciones' => [
            'id_usuario_master_creacion', 'id_usuario_master_modificacion',
        ],
        'contable_ingresos' => [
            'id_proveedor', 'id_categoria', 'id_concepto',
            'medio_pago_snapshot', 'proveedor_snapshot', 'categoria_snapshot', 'concepto_snapshot',
            'estado', 'fecha_anulacion', 'id_usuario_master_creacion', 'id_usuario_master_modificacion',
        ],
        'contable_egresos' => [
            'id_proveedor', 'id_categoria', 'id_concepto',
            'medio_pago_snapshot', 'proveedor_snapshot', 'categoria_snapshot', 'concepto_snapshot',
            'estado', 'fecha_anulacion', 'archivo_nombre_original', 'archivo_nombre_guardado',
            'archivo_mime', 'archivo_tamanio',
            'id_usuario_master_creacion', 'id_usuario_master_modificacion',
        ],
    ];

    try {
        foreach ($requiredColumns as $table => $columns) {
            $tableStatement = $db->prepare(
                'SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
            );
            $tableStatement->execute([$table]);
            if ((int)$tableStatement->fetchColumn() !== 1) {
                throw new RuntimeException("Falta la tabla {$table}.");
            }

            $columnStatement = $db->prepare(
                'SELECT COLUMN_NAME FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
            );
            $columnStatement->execute([$table]);
            $existing = array_fill_keys($columnStatement->fetchAll(PDO::FETCH_COLUMN), true);

            $missing = array_values(array_filter(
                $columns,
                static fn(string $column): bool => !isset($existing[$column])
            ));
            if ($missing !== []) {
                throw new RuntimeException(
                    "La tabla {$table} no tiene las columnas requeridas: " . implode(', ', $missing) . '.'
                );
            }

            $obsolete = array_values(array_filter(
                $forbiddenColumns[$table] ?? [],
                static fn(string $column): bool => isset($existing[$column])
            ));
            if ($obsolete !== []) {
                throw new RuntimeException(
                    "La tabla {$table} todavía conserva columnas antiguas: " . implode(', ', $obsolete) . '.'
                );
            }
        }
    } catch (Throwable $error) {
        throw new RuntimeException(
            'El módulo Contabilidad necesita la migración clean incluida en el ZIP. Detalle: '
            . $error->getMessage(),
            0,
            $error
        );
    }

    $validatedConnections[$connectionId] = true;
}
