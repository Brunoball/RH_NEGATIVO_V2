<?php
declare(strict_types=1);

function configuracion_listas_definiciones(): array
{
    return [
        'medios_pago' => [
            'lista' => 'medios_pago',
            'tabla' => 'medios_pago',
            'id_campo' => 'id_medio_pago',
            'etiqueta' => 'medio de pago',
            'max_nombre' => 100,
            'entidad' => 'MEDIO_PAGO',
        ],
        'condiciones_iva' => [
            'lista' => 'condiciones_iva',
            'tabla' => 'condiciones_iva',
            'id_campo' => 'id_condicion_iva',
            'etiqueta' => 'condición frente al IVA',
            'max_nombre' => 100,
            'entidad' => 'CONDICION_IVA',
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

function configuracion_item(PDO $db, array $definition, int $id, bool $lock = false): ?array
{
    $table = $definition['tabla'];
    $idField = $definition['id_campo'];
    $suffix = $lock ? ' FOR UPDATE' : '';

    $statement = $db->prepare(
        "SELECT {$idField}, nombre, activo, creado_en, actualizado_en
         FROM {$table}
         WHERE {$idField} = ?{$suffix}"
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
        'medios_pago' => [
            ['tabla' => 'pagos', 'columna' => 'id_medio_pago'],
            ['tabla' => 'socios', 'columna' => 'id_medio_pago'],
            ['tabla' => 'contable_ingresos', 'columna' => 'id_medio_pago'],
            ['tabla' => 'contable_egresos', 'columna' => 'id_medio_pago'],
        ],
        'condiciones_iva' => [
            ['tabla' => 'socios_empresas', 'columna' => 'id_condicion_iva'],
        ],
        default => [],
    };
}

function configuracion_tabla_columna_existe(PDO $db, string $table, string $column): bool
{
    $statement = $db->prepare(
        "SELECT COUNT(*)
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?"
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
    return $total;
}

/**
 * Hace nullable una columna hija sin modificar ni recrear la clave foránea.
 * Esto es suficiente porque la eliminación definitiva primero hace UPDATE ...
 * SET columna = NULL y recién después elimina la opción padre.
 */
function configuracion_asegurar_columna_nullable(PDO $db, string $table, string $column): void
{
    if (!preg_match('/^[A-Za-z0-9_]+$/', $table) || !preg_match('/^[A-Za-z0-9_]+$/', $column)) {
        throw new RuntimeException('Se detectó una relación de configuración con un nombre no válido.');
    }

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
    if (!$info || strtoupper((string)$info['IS_NULLABLE']) === 'YES') return;

    $columnType = trim((string)$info['COLUMN_TYPE']);
    $charset = trim((string)($info['CHARACTER_SET_NAME'] ?? ''));
    $collation = trim((string)($info['COLLATION_NAME'] ?? ''));

    $sql = "ALTER TABLE `{$table}` MODIFY COLUMN `{$column}` {$columnType}";
    if ($charset !== '') $sql .= " CHARACTER SET {$charset}";
    if ($collation !== '') $sql .= " COLLATE {$collation}";
    $sql .= ' NULL';

    try {
        $db->exec($sql);
    } catch (Throwable $error) {
        throw new RuntimeException(
            "No se pudo preparar {$table}.{$column} para conservar los registros asociados al eliminar la opción. Detalle: "
            . $error->getMessage(),
            0,
            $error
        );
    }
}

/**
 * Prepara únicamente las columnas que hoy son NOT NULL. No toca reglas de FK:
 * las FK RESTRICT pueden permanecer intactas porque antes del DELETE las filas
 * hijas se actualizan explícitamente a NULL.
 */
function configuracion_preparar_referencias_nullable(PDO $db, array $definition): void
{
    foreach (configuracion_relaciones($definition) as $relation) {
        $table = (string)$relation['tabla'];
        $column = (string)$relation['columna'];
        if (!configuracion_tabla_columna_existe($db, $table, $column)) continue;
        configuracion_asegurar_columna_nullable($db, $table, $column);
    }
}

/**
 * Desvincula los registros históricos antes de borrar una opción. De esta
 * manera las FK RESTRICT no bloquean el DELETE y ningún registro hijo se borra.
 */
function configuracion_desvincular_referencias(PDO $db, array $definition, int $id): int
{
    $updated = 0;
    foreach (configuracion_relaciones($definition) as $relation) {
        $table = (string)$relation['tabla'];
        $column = (string)$relation['columna'];
        if (!configuracion_tabla_columna_existe($db, $table, $column)) continue;

        $statement = $db->prepare("UPDATE `{$table}` SET `{$column}` = NULL WHERE `{$column}` = ?");
        $statement->execute([$id]);
        $updated += $statement->rowCount();
    }
    return $updated;
}
