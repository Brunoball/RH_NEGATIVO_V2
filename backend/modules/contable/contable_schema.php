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

    // Camino normal: el esquema ya existe. Un SELECT con LIMIT 0 obliga a
    // MySQL/MariaDB a validar tablas y columnas sin leer filas ni ejecutar DDL.
    // Antes cada request hacía 3 CREATE TABLE IF NOT EXISTS + 3 consultas a
    // information_schema aunque no hubiera nada que migrar.
    $probe = static function (PDO $connection): void {
        $connection->query(
            'SELECT
                o.id_opcion, o.tipo, o.nombre, o.activo, o.creado_en, o.actualizado_en,
                i.id_ingreso, i.fecha, i.id_medio_pago, i.proveedor, i.categoria,
                i.concepto, i.importe, i.detalle, i.creado_en, i.actualizado_en,
                e.id_egreso, e.fecha, e.id_medio_pago, e.proveedor, e.categoria,
                e.concepto, e.numero_comprobante, e.importe, e.detalle,
                e.archivo_path, e.creado_en, e.actualizado_en,
                se.id_socio AS socio_eliminado_id, se.nombre AS socio_eliminado_nombre,
                se.dni AS socio_eliminado_dni, se.fecha_eliminacion,
                se.id_usuario AS socio_eliminado_usuario, se.datos_socio, se.impacto
             FROM contable_opciones o
             LEFT JOIN contable_ingresos i ON 1 = 0
             LEFT JOIN contable_egresos e ON 1 = 0
             LEFT JOIN socios_eliminados se ON 1 = 0
             LIMIT 0'
        );
    };

    try {
        $probe($db);
        $done[$connectionId] = true;
        return;
    } catch (PDOException) {
        // Instalación incompleta o versión anterior: se ejecuta el camino de
        // autocreación/validación original que está debajo.
    }

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

    $db->exec(
        "CREATE TABLE IF NOT EXISTS socios_eliminados (
            id_socio INT NOT NULL,
            nombre VARCHAR(100) NOT NULL,
            dni VARCHAR(15) NULL,
            fecha_eliminacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            id_usuario INT NULL,
            datos_socio LONGTEXT NOT NULL,
            impacto LONGTEXT NOT NULL,
            PRIMARY KEY (id_socio),
            KEY idx_socios_eliminados_fecha (fecha_eliminacion),
            KEY idx_socios_eliminados_dni (dni)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    try {
        $probe($db);
        $done[$connectionId] = true;
        return;
    } catch (PDOException) {
        // Si CREATE TABLE IF NOT EXISTS no pudo reparar una tabla antigua con
        // columnas faltantes, conservamos el diagnóstico detallado de abajo.
    }

    $required = [
        'contable_opciones' => ['id_opcion','tipo','nombre','activo','creado_en','actualizado_en'],
        'contable_ingresos' => ['id_ingreso','fecha','id_medio_pago','proveedor','categoria','concepto','importe','detalle','creado_en','actualizado_en'],
        'contable_egresos' => ['id_egreso','fecha','id_medio_pago','proveedor','categoria','concepto','numero_comprobante','importe','detalle','archivo_path','creado_en','actualizado_en'],
        'socios_eliminados' => ['id_socio','nombre','dni','fecha_eliminacion','id_usuario','datos_socio','impacto'],
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
