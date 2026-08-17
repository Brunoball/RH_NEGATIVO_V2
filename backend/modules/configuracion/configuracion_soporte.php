<?php
declare(strict_types=1);

function configuracion_listas_definiciones(): array
{
    return [
        'categoria' => [
            'lista' => 'categoria', 'tabla' => 'categoria', 'id_campo' => 'id_categoria',
            'etiqueta' => 'categoría', 'entidad' => 'CATEGORIA', 'auto_id' => true,
            'campos' => [
                'nombre' => ['tipo' => 'texto', 'max' => 100, 'label' => 'nombre'],
                'monto_mensual' => ['tipo' => 'decimal', 'label' => 'monto mensual'],
                'monto_anual' => ['tipo' => 'decimal', 'label' => 'monto anual'],
            ],
        ],
        'cobrador' => [
            'lista' => 'cobrador', 'tabla' => 'cobrador', 'id_campo' => 'id_cobrador',
            'etiqueta' => 'cobrador', 'entidad' => 'COBRADOR', 'auto_id' => false,
            'campos' => ['nombre' => ['tipo' => 'texto', 'max' => 50, 'label' => 'nombre']],
        ],
        'estado' => [
            'lista' => 'estado', 'tabla' => 'estado', 'id_campo' => 'id_estado',
            'etiqueta' => 'estado', 'entidad' => 'ESTADO', 'auto_id' => false,
            'campos' => ['nombre' => ['tipo' => 'texto', 'max' => 20, 'label' => 'nombre']],
        ],
        'grupo_sanguineo' => [
            'lista' => 'grupo_sanguineo', 'tabla' => 'grupo_sanguineo', 'id_campo' => 'id_grupo_sanguineo',
            'etiqueta' => 'grupo sanguíneo', 'entidad' => 'GRUPO_SANGUINEO', 'auto_id' => false,
            'campos' => ['nombre' => ['tipo' => 'texto', 'max' => 10, 'label' => 'nombre']],
        ],
        'medios_pago' => [
            'lista' => 'medios_pago', 'tabla' => 'medios_pago', 'id_campo' => 'id_medio_pago',
            'etiqueta' => 'medio de pago', 'entidad' => 'MEDIO_PAGO', 'auto_id' => true,
            'campos' => ['nombre' => ['tipo' => 'texto', 'max' => 50, 'label' => 'nombre']],
        ],
        'periodo' => [
            'lista' => 'periodo', 'tabla' => 'periodo', 'id_campo' => 'id_periodo',
            'etiqueta' => 'período', 'entidad' => 'PERIODO', 'auto_id' => false,
            'campos' => [
                'nombre' => ['tipo' => 'texto', 'max' => 50, 'label' => 'nombre'],
                'meses' => ['tipo' => 'texto', 'max' => 50, 'label' => 'meses'],
            ],
        ],
    ];
}

function configuracion_lista_definicion(mixed $value): array
{
    $key = strtolower(trim((string)$value));
    $definitions = configuracion_listas_definiciones();
    if (!isset($definitions[$key])) {
        api_error('La lista solicitada no es válida.', 'LISTA_CONFIGURACION_INVALIDA');
    }
    return $definitions[$key];
}

function configuracion_columnas(array $definition): array
{
    return array_keys($definition['campos']);
}

function configuracion_item(PDO $db, array $definition, int $id, bool $lock = false): ?array
{
    $table = $definition['tabla'];
    $idField = $definition['id_campo'];
    $fields = implode(', ', configuracion_columnas($definition));
    $suffix = $lock ? ' FOR UPDATE' : '';
    $statement = $db->prepare(
        "SELECT {$idField}, {$fields}, activo, creado_en FROM {$table} WHERE {$idField} = ?{$suffix}"
    );
    $statement->execute([$id]);
    $row = $statement->fetch();
    if (!$row) return null;
    $row[$idField] = (int)$row[$idField];
    $row['activo'] = (bool)$row['activo'];
    $row['cantidad_usos'] = configuracion_cantidad_usos($db, $definition, $id);
    return $row;
}

function configuracion_relaciones(array $definition): array
{
    return match ((string)$definition['lista']) {
        'categoria' => [
            ['tabla' => 'socios', 'columna' => 'id_categoria'],
        ],
        'cobrador' => [
            ['tabla' => 'socios', 'columna' => 'id_cobrador'],
        ],
        'estado' => [
            ['tabla' => 'socios', 'columna' => 'id_estado'],
            ['tabla' => 'socios_historial_estados', 'columna' => 'id_estado_anterior'],
            ['tabla' => 'socios_historial_estados', 'columna' => 'id_estado_nuevo'],
        ],
        'grupo_sanguineo' => [
            ['tabla' => 'socios', 'columna' => 'id_grupo_sanguineo'],
        ],
        'medios_pago' => [
            ['tabla' => 'pagos', 'columna' => 'id_medio_pago'],
            ['tabla' => 'pagos_inscripcion', 'columna' => 'id_medio_pago'],
            ['tabla' => 'contable_ingresos', 'columna' => 'id_medio_pago'],
            ['tabla' => 'contable_egresos', 'columna' => 'id_medio_pago'],
        ],
        'periodo' => [
            ['tabla' => 'pagos', 'columna' => 'id_periodo'],
        ],
        default => [],
    };
}

function configuracion_tabla_columna_existe(PDO $db, string $table, string $column): bool
{
    $statement = $db->prepare(
        'SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $statement->execute([$table, $column]);
    return (int)$statement->fetchColumn() === 1;
}

function configuracion_cantidad_usos(PDO $db, array $definition, int $id): int
{
    $total = 0;
    foreach (configuracion_relaciones($definition) as $relation) {
        $table = (string)$relation['tabla'];
        $column = (string)$relation['columna'];
        if (!configuracion_tabla_columna_existe($db, $table, $column)) continue;
        $statement = $db->prepare("SELECT COUNT(*) FROM `{$table}` WHERE `{$column}` = ?");
        $statement->execute([$id]);
        $total += (int)$statement->fetchColumn();
    }

    // Categoría, cobrador y grupo se guardan también dentro de la auditoría de
    // Socios. Aunque hoy ya no haya socios apuntando al catálogo, eliminarlo
    // haría perder la etiqueta al reconstruir informes históricos.
    $historicalField = match ((string)$definition['lista']) {
        'categoria' => 'id_categoria',
        'cobrador' => 'id_cobrador',
        'grupo_sanguineo' => 'id_grupo_sanguineo',
        default => null,
    };
    if ($historicalField !== null
        && configuracion_tabla_columna_existe($db, 'auditoria', 'datos_anteriores')
        && configuracion_tabla_columna_existe($db, 'auditoria', 'datos_nuevos')) {
        $jsonPath = '$.' . $historicalField;
        $statement = $db->prepare(
            "SELECT COUNT(*)
             FROM auditoria
             WHERE tabla = 'socios'
               AND (
                    CAST(JSON_UNQUOTE(JSON_EXTRACT(datos_anteriores, ?)) AS UNSIGNED) = ?
                 OR CAST(JSON_UNQUOTE(JSON_EXTRACT(datos_nuevos, ?)) AS UNSIGNED) = ?
               )"
        );
        $statement->execute([$jsonPath, $id, $jsonPath, $id]);
        $total += (int)$statement->fetchColumn();
    }

    // Los pagos no guardan id_categoria como columna propia, pero las altas
    // creadas por Cuotas sí conservan ese dato en auditoría. Esto evita borrar
    // una categoría que ya no usa ningún socio actual pero que sí clasificó
    // movimientos financieros históricos.
    if ((string)$definition['lista'] === 'categoria'
        && configuracion_tabla_columna_existe($db, 'auditoria', 'datos_anteriores')
        && configuracion_tabla_columna_existe($db, 'auditoria', 'datos_nuevos')) {
        $statement = $db->prepare(
            "SELECT COUNT(*)
             FROM auditoria
             WHERE tabla = 'pagos'
               AND (
                    CAST(JSON_UNQUOTE(JSON_EXTRACT(datos_anteriores, '$.id_categoria')) AS UNSIGNED) = ?
                 OR CAST(JSON_UNQUOTE(JSON_EXTRACT(datos_nuevos, '$.id_categoria')) AS UNSIGNED) = ?
               )"
        );
        $statement->execute([$id, $id]);
        $total += (int)$statement->fetchColumn();
    }

    return $total;
}

function configuracion_auditar(PDO $db, array $auth, array $definition, int $id, string $action, mixed $before, mixed $after): void
{
    if (!in_array($action, ['INSERT', 'UPDATE', 'DELETE'], true)) {
        throw new LogicException('Acción de auditoría de configuración no permitida.');
    }
    $encode = static function (mixed $value): ?string {
        if ($value === null) return null;
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
        return is_string($json) ? $json : '{"error":"No se pudo serializar la auditoría."}';
    };
    $statement = $db->prepare(
        "INSERT INTO auditoria (tabla, id_registro, accion, datos_anteriores, datos_nuevos, id_usuario, origen)
         VALUES (?, ?, ?, ?, ?, ?, 'SISTEMA')"
    );
    $statement->execute([
        $definition['tabla'], $id, $action, $encode($before), $encode($after), $auth['id_usuario'],
    ]);
}
