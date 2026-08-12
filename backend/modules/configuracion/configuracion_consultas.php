<?php
declare(strict_types=1);

trait ConfiguracionConsultas
{
    private static function obtenerDatos(PDO $db): array
    {
        $lists = [];
        $summary = [];

        foreach (configuracion_listas_definiciones() as $key => $definition) {
            $items = self::listarConfiguracion($db, $definition);
            $lists[$key] = $items;
            $summary[$key . '_activos'] = count(array_filter(
                $items,
                static fn(array $item): bool => (bool)$item['activo']
            ));
        }

        return [
            'listas' => $lists,
            'resumen' => $summary,
        ];
    }

    private static function listarConfiguracion(PDO $db, array $definition): array
    {
        $table = $definition['tabla'];
        $idField = $definition['id_campo'];
        $rows = $db->query(
            "SELECT {$idField}, nombre, activo, creado_en, actualizado_en
             FROM {$table}
             ORDER BY activo DESC, nombre ASC, {$idField} ASC"
        )->fetchAll();

        foreach ($rows as &$row) {
            $id = (int)$row[$idField];
            $row[$idField] = $id;
            $row['activo'] = (bool)$row['activo'];
            $row['cantidad_usos'] = configuracion_cantidad_usos($db, $definition, $id);
        }
        unset($row);

        return $rows;
    }
}
