<?php
declare(strict_types=1);

/**
 * Esquema propio del módulo Categorías de RH Negativo V2.
 *
 * La base histórica ya posee `categoria` y `precios_historicos`. Los descuentos
 * familiares son una configuración nueva y global: se aplican por cantidad de
 * integrantes de una familia y no dependen de una categoría particular.
 */
function ensure_categorias_schema(PDO $db): void
{
    static $done = [];
    $connectionId = spl_object_id($db);
    if (isset($done[$connectionId])) return;

    $required = [
        'categoria' => [
            'id_categoria', 'nombre', 'monto_mensual', 'monto_anual', 'activo', 'creado_en',
        ],
        'precios_historicos' => [
            'id_historial', 'id_categoria', 'tipo', 'precio_viejo', 'precio_nuevo', 'fecha_cambio',
        ],
        'socios' => ['id_socio', 'id_categoria', 'vigente'],
    ];

    foreach ($required as $table => $columns) {
        $tableStatement = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
        );
        $tableStatement->execute([$table]);
        if ((int)$tableStatement->fetchColumn() !== 1) {
            throw new RuntimeException("Falta la tabla {$table} requerida por Categorías.");
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
    }

    // Es una migración aditiva e idempotente. De esta forma el módulo queda
    // listo al subir el backend incluso si el dump original aún no traía esta tabla.
    $db->exec(
        "CREATE TABLE IF NOT EXISTS descuentos_familiares (
            id_descuento_familiar INT UNSIGNED NOT NULL AUTO_INCREMENT,
            cantidad_integrantes_desde TINYINT UNSIGNED NOT NULL,
            cantidad_integrantes_hasta TINYINT UNSIGNED NULL,
            porcentaje_descuento DECIMAL(5,2) NOT NULL,
            vigencia_desde DATE NOT NULL,
            vigencia_hasta DATE NULL,
            descripcion VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
            activo TINYINT UNSIGNED NOT NULL DEFAULT 1,
            creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id_descuento_familiar),
            KEY idx_descuentos_familiares_estado (activo, vigencia_desde, vigencia_hasta),
            KEY idx_descuentos_familiares_rango (cantidad_integrantes_desde, cantidad_integrantes_hasta),
            CONSTRAINT chk_df_cantidad_desde CHECK (cantidad_integrantes_desde BETWEEN 2 AND 50),
            CONSTRAINT chk_df_cantidad_hasta CHECK (
                cantidad_integrantes_hasta IS NULL
                OR (cantidad_integrantes_hasta BETWEEN cantidad_integrantes_desde AND 50)
            ),
            CONSTRAINT chk_df_porcentaje CHECK (porcentaje_descuento > 0 AND porcentaje_descuento <= 100),
            CONSTRAINT chk_df_vigencia CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde),
            CONSTRAINT chk_df_activo CHECK (activo IN (0,1))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $done[$connectionId] = true;
}
