<?php
declare(strict_types=1);

trait CategoriasConsultas
{
    private static function listarDatos(PDO $db, array $filters): array
    {
        $status = trim((string)($filters['estado'] ?? ''));
        if (!in_array($status, ['', 'activo', 'inactivo'], true)) {
            api_error('El estado solicitado no es válido.', 'FILTRO_INVALIDO');
        }

        $where = [];
        $params = [];
        $searchFilter = build_search_filter(
            $filters['buscar'] ?? '',
            ["CONCAT_WS(' ', c.nombre, c.descripcion) LIKE {param}"],
            120,
            'buscar_categoria'
        );
        if ($searchFilter['sql'] !== '') {
            $where[] = $searchFilter['sql'];
            $params = array_merge($params, $searchFilter['params']);
        }
        if ($status === 'activo') $where[] = 'c.activo = 1';
        if ($status === 'inactivo') $where[] = 'c.activo = 0';
        $sqlWhere = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);

        $statement = $db->prepare(
            "SELECT c.id_categoria,
                    c.nombre,
                    c.descripcion,
                    c.monto_cuota AS monto_actual,
                    c.activo,
                    c.creado_en AS created_at,
                    c.actualizado_en AS updated_at,
                    COUNT(DISTINCT CASE WHEN s.estado = 'ACTIVO' THEN s.id_socio END) AS cantidad_socios
             FROM categorias c
             LEFT JOIN socios s ON s.id_categoria = c.id_categoria
             {$sqlWhere}
             GROUP BY c.id_categoria, c.nombre, c.descripcion, c.monto_cuota,
                      c.activo, c.creado_en, c.actualizado_en
             ORDER BY c.activo DESC, c.nombre ASC"
        );
        $statement->execute($params);
        $items = $statement->fetchAll();
        foreach ($items as &$item) self::castCategoria($item);
        unset($item);

        $summary = $db->query(
            'SELECT COUNT(*) AS total,
                    COALESCE(SUM(activo = 1), 0) AS activas,
                    COALESCE(SUM(activo = 0), 0) AS inactivas,
                    COALESCE(AVG(CASE WHEN activo = 1 THEN monto_cuota END), 0) AS promedio
             FROM categorias'
        )->fetch();

        return [
            'items' => $items,
            'resumen' => [
                'total' => (int)($summary['total'] ?? 0),
                'activas' => (int)($summary['activas'] ?? 0),
                'inactivas' => (int)($summary['inactivas'] ?? 0),
                'promedio' => number_format((float)($summary['promedio'] ?? 0), 2, '.', ''),
            ],
        ];
    }

    private static function obtenerDatos(PDO $db, int $id): array
    {
        $category = self::detalle($db, $id);
        if (!$category) api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);
        return ['item' => $category];
    }

    private static function historialDatos(PDO $db, int $id): array
    {
        if (!self::detalle($db, $id)) {
            api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);
        }

        $statement = $db->prepare(
            'SELECT id_historial_precio AS id_historial,
                    monto_anterior,
                    monto_nuevo,
                    fecha_cambio,
                    DATE(fecha_cambio) AS vigente_desde,
                    NULL AS vigente_hasta,
                    fecha_cambio AS created_at
             FROM categorias_historial_precios
             WHERE id_categoria = ?
             ORDER BY fecha_cambio DESC, id_historial_precio DESC'
        );
        $statement->execute([$id]);
        $items = $statement->fetchAll();
        foreach ($items as &$item) {
            $item['id_historial'] = (int)$item['id_historial'];
            $item['monto_anterior'] = number_format((float)$item['monto_anterior'], 2, '.', '');
            $item['monto_nuevo'] = number_format((float)$item['monto_nuevo'], 2, '.', '');
        }
        unset($item);

        return ['items' => $items];
    }

    private static function detalle(PDO $db, int $id): ?array
    {
        $statement = $db->prepare(
            "SELECT c.id_categoria,
                    c.nombre,
                    c.descripcion,
                    c.monto_cuota AS monto_actual,
                    c.activo,
                    c.creado_en AS created_at,
                    c.actualizado_en AS updated_at,
                    COUNT(DISTINCT CASE WHEN s.estado = 'ACTIVO' THEN s.id_socio END) AS cantidad_socios
             FROM categorias c
             LEFT JOIN socios s ON s.id_categoria = c.id_categoria
             WHERE c.id_categoria = ?
             GROUP BY c.id_categoria, c.nombre, c.descripcion, c.monto_cuota,
                      c.activo, c.creado_en, c.actualizado_en"
        );
        $statement->execute([$id]);
        $category = $statement->fetch();
        if (!$category) return null;
        self::castCategoria($category);
        return $category;
    }

    private static function castCategoria(array &$category): void
    {
        $category['id_categoria'] = (int)$category['id_categoria'];
        $category['cantidad_socios'] = (int)$category['cantidad_socios'];
        $category['activo'] = (bool)$category['activo'];
        $category['monto_actual'] = number_format((float)$category['monto_actual'], 2, '.', '');
    }
}
