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


function configuracion_siguiente_id_manual(PDO $db, array $definition): int
{
    $table = (string)$definition['tabla'];
    $idField = (string)$definition['id_campo'];

    // El SELECT con FOR UPDATE conserva la serialización que ya tenía el alta
    // manual. El siguiente ID debe ser mayor que cualquier ID actual o histórico:
    // reutilizar un ID eliminado haría que una opción nueva heredara auditorías
    // y referencias pertenecientes a otra opción anterior.
    $currentStatement = $db->query(
        "SELECT `{$idField}` FROM `{$table}` ORDER BY `{$idField}` DESC LIMIT 1 FOR UPDATE"
    );
    $current = $currentStatement->fetchColumn();
    $maxUsedId = $current === false ? 0 : (int)$current;

    if (configuracion_tabla_columna_existe($db, 'auditoria', 'id_registro')
        && configuracion_tabla_columna_existe($db, 'auditoria', 'tabla')) {
        $auditStatement = $db->prepare(
            'SELECT COALESCE(MAX(id_registro), 0) FROM auditoria WHERE tabla = ?'
        );
        $auditStatement->execute([$table]);
        $maxUsedId = max($maxUsedId, (int)$auditStatement->fetchColumn());
    }

    // También contemplamos referencias relacionales que pudieron sobrevivir a
    // datos legacy anteriores a la auditoría de catálogos.
    foreach (configuracion_relaciones($definition) as $relation) {
        $relationTable = (string)$relation['tabla'];
        $relationColumn = (string)$relation['columna'];
        if (!configuracion_tabla_columna_existe($db, $relationTable, $relationColumn)) continue;
        $relationStatement = $db->query(
            "SELECT COALESCE(MAX(`{$relationColumn}`), 0) FROM `{$relationTable}`"
        );
        $maxUsedId = max($maxUsedId, (int)$relationStatement->fetchColumn());
    }

    // Cobrador y grupo sanguíneo también aparecen dentro de snapshots JSON de
    // auditoría de Socios. Tomarlos en cuenta evita colisiones con datos legacy
    // aunque la fila original del catálogo ya haya sido eliminada.
    $historicalField = match ((string)$definition['lista']) {
        'cobrador' => 'id_cobrador',
        'grupo_sanguineo' => 'id_grupo_sanguineo',
        default => null,
    };
    if ($historicalField !== null
        && configuracion_tabla_columna_existe($db, 'auditoria', 'datos_anteriores')
        && configuracion_tabla_columna_existe($db, 'auditoria', 'datos_nuevos')) {
        $jsonPath = '$.' . $historicalField;
        $snapshotStatement = $db->prepare(
            "SELECT GREATEST(
                COALESCE(MAX(CASE WHEN JSON_VALID(datos_anteriores)
                    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(datos_anteriores, ?)) AS UNSIGNED) ELSE 0 END), 0),
                COALESCE(MAX(CASE WHEN JSON_VALID(datos_nuevos)
                    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(datos_nuevos, ?)) AS UNSIGNED) ELSE 0 END), 0)
             )
             FROM auditoria
             WHERE tabla = 'socios'"
        );
        $snapshotStatement->execute([$jsonPath, $jsonPath]);
        $maxUsedId = max($maxUsedId, (int)$snapshotStatement->fetchColumn());
    }

    return $maxUsedId + 1;
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
    $row['cantidad_usos'] = configuracion_cantidad_usos_actuales($db, $definition, $id);
    $row['cantidad_usos_protegidos'] = configuracion_cantidad_usos($db, $definition, $id);
    return $row;
}

function configuracion_relaciones_uso_actual(array $definition): array
{
    // Estas relaciones representan el uso que el usuario espera ver en la
    // tabla de Configuración. No incluyen auditorías ni historial de cambios,
    // porque sumar esas referencias duplica/triplica visualmente una misma
    // asociación (por ejemplo, una categoría asignada a un socio).
    return match ((string)$definition['lista']) {
        'categoria' => [
            ['tabla' => 'socios', 'columna' => 'id_categoria'],
        ],
        'cobrador' => [
            ['tabla' => 'socios', 'columna' => 'id_cobrador'],
        ],
        'estado' => [
            ['tabla' => 'socios', 'columna' => 'id_estado'],
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

function configuracion_relaciones(array $definition): array
{
    // Relaciones que protegen la integridad referencial/histórica. Esta lista
    // puede ser más amplia que la que se muestra como "Uso actual" en UI.
    $relations = configuracion_relaciones_uso_actual($definition);

    if ((string)$definition['lista'] === 'estado') {
        $relations[] = ['tabla' => 'socios_historial_estados', 'columna' => 'id_estado_anterior'];
        $relations[] = ['tabla' => 'socios_historial_estados', 'columna' => 'id_estado_nuevo'];
    }

    return $relations;
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

function configuracion_cantidad_usos_actuales(PDO $db, array $definition, int $id): int
{
    $total = 0;
    foreach (configuracion_relaciones_uso_actual($definition) as $relation) {
        $table = (string)$relation['tabla'];
        $column = (string)$relation['columna'];
        if (!configuracion_tabla_columna_existe($db, $table, $column)) continue;
        $statement = $db->prepare("SELECT COUNT(*) FROM `{$table}` WHERE `{$column}` = ?");
        $statement->execute([$id]);
        $total += (int)$statement->fetchColumn();
    }
    return $total;
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
