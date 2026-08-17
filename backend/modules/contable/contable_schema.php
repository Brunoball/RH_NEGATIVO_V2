<?php
declare(strict_types=1);

/**
 * Esquema autocontenido del módulo Contabilidad de RH Negativo.
 *
 * Las cuotas y las inscripciones NO se duplican en tablas contables: se leen
 * directamente de `pagos` y `pagos_inscripcion`. Estas tablas guardan sólo
 * movimientos manuales y catálogos propios del módulo.
 */
function ensure_contable_schema(PDO $db): void
{
    static $done = [];
    $connectionId = spl_object_id($db);
    if (isset($done[$connectionId])) return;

    $db->exec(
        "CREATE TABLE IF NOT EXISTS contable_opciones (
            id_opcion INT UNSIGNED NOT NULL AUTO_INCREMENT,
            tipo ENUM('PROVEEDOR','CATEGORIA_INGRESO','CONCEPTO_INGRESO','CATEGORIA_EGRESO','CONCEPTO_EGRESO') NOT NULL,
            nombre VARCHAR(160) NOT NULL,
            activo TINYINT UNSIGNED NOT NULL DEFAULT 1,
            creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id_opcion),
            UNIQUE KEY uq_contable_opcion_tipo_nombre (tipo, nombre),
            KEY idx_contable_opciones_activo (activo),
            CONSTRAINT chk_contable_opciones_activo CHECK (activo IN (0,1))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $db->exec(
        "CREATE TABLE IF NOT EXISTS contable_ingresos (
            id_ingreso BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            fecha DATE NOT NULL,
            id_medio_pago INT UNSIGNED NULL,
            proveedor VARCHAR(160) NULL,
            categoria VARCHAR(160) NULL,
            concepto VARCHAR(160) NULL,
            importe DECIMAL(14,2) NOT NULL,
            detalle VARCHAR(500) NULL,
            creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id_ingreso),
            KEY idx_contable_ingresos_fecha (fecha),
            KEY idx_contable_ingresos_medio (id_medio_pago),
            CONSTRAINT fk_contable_ingresos_medio
                FOREIGN KEY (id_medio_pago) REFERENCES medios_pago(id_medio_pago)
                ON DELETE SET NULL ON UPDATE CASCADE,
            CONSTRAINT chk_contable_ingresos_importe CHECK (importe > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $db->exec(
        "CREATE TABLE IF NOT EXISTS contable_egresos (
            id_egreso BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            fecha DATE NOT NULL,
            id_medio_pago INT UNSIGNED NULL,
            proveedor VARCHAR(160) NULL,
            categoria VARCHAR(160) NULL,
            concepto VARCHAR(160) NULL,
            numero_comprobante VARCHAR(120) NULL,
            importe DECIMAL(14,2) NOT NULL,
            detalle VARCHAR(500) NULL,
            archivo_path VARCHAR(500) NULL,
            creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id_egreso),
            KEY idx_contable_egresos_fecha (fecha),
            KEY idx_contable_egresos_medio (id_medio_pago),
            CONSTRAINT fk_contable_egresos_medio
                FOREIGN KEY (id_medio_pago) REFERENCES medios_pago(id_medio_pago)
                ON DELETE SET NULL ON UPDATE CASCADE,
            CONSTRAINT chk_contable_egresos_importe CHECK (importe > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $required = [
        'contable_opciones' => ['id_opcion','tipo','nombre','activo','creado_en','actualizado_en'],
        'contable_ingresos' => ['id_ingreso','fecha','id_medio_pago','proveedor','categoria','concepto','importe','detalle','creado_en','actualizado_en'],
        'contable_egresos' => ['id_egreso','fecha','id_medio_pago','proveedor','categoria','concepto','numero_comprobante','importe','detalle','archivo_path','creado_en','actualizado_en'],
    ];

    foreach ($required as $table => $columns) {
        $statement = $db->prepare(
            'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
        );
        $statement->execute([$table]);
        $existing = array_fill_keys($statement->fetchAll(PDO::FETCH_COLUMN), true);
        $missing = array_values(array_filter($columns, static fn(string $column): bool => !isset($existing[$column])));
        if ($missing !== []) {
            throw new RuntimeException(
                "La tabla {$table} no tiene las columnas requeridas: " . implode(', ', $missing) . '.'
            );
        }
    }

    $done[$connectionId] = true;
}
