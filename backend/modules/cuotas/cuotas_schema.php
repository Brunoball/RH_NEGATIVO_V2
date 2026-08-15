<?php
declare(strict_types=1);

/**
 * Verifica que Cuotas esté trabajando contra el esquema real de RH Negativo.
 * No crea ni altera tablas: evita errores SQL difíciles de diagnosticar.
 */
function ensure_cuotas_schema(PDO $db): void
{
    static $verified = false;
    if ($verified) return;

    $required = [
        'socios' => [
            'id_socio', 'nombre', 'dni', 'id_categoria', 'id_cobrador',
            'fecha_ingreso', 'vigente', 'domicilio', 'numero',
            'domicilio_cobro', 'telefono_fijo', 'telefono_movil',
        ],
        'categoria' => ['id_categoria', 'nombre', 'monto_mensual', 'monto_anual', 'activo'],
        'precios_historicos' => ['id_historial', 'id_categoria', 'tipo', 'precio_viejo', 'precio_nuevo', 'fecha_cambio'],
        'periodo' => ['id_periodo', 'nombre', 'meses', 'activo'],
        'pagos' => ['id_pago', 'id_socio', 'id_periodo', 'anio_aplicado', 'fecha_pago', 'estado', 'monto', 'id_medio_pago'],
        'medios_pago' => ['id_medio_pago', 'nombre', 'activo'],
        'cobrador' => ['id_cobrador', 'nombre'],
        'familias' => ['id_familia', 'nombre_familia', 'activo'],
        'familias_socios' => ['id_familia_socio', 'id_familia', 'id_socio', 'desde', 'hasta', 'activo'],
        'descuentos_familiares' => [
            'id_descuento_familiar', 'cantidad_integrantes_desde',
            'cantidad_integrantes_hasta', 'porcentaje_descuento',
            'vigencia_desde', 'vigencia_hasta', 'activo',
        ],
    ];

    $statement = $db->prepare(
        'SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN (' . implode(',', array_fill(0, count($required), '?')) . ')'
    );
    $statement->execute(array_keys($required));

    $available = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $available[(string)$row['TABLE_NAME']][(string)$row['COLUMN_NAME']] = true;
    }

    $missing = [];
    foreach ($required as $table => $columns) {
        foreach ($columns as $column) {
            if (!isset($available[$table][$column])) $missing[] = $table . '.' . $column;
        }
    }

    if ($missing !== []) {
        api_error(
            'La base de datos no posee la estructura requerida por el módulo de cuotas.',
            'CUOTAS_SCHEMA_INVALIDO',
            500,
            ['faltantes' => $missing]
        );
    }

    $verified = true;
}
