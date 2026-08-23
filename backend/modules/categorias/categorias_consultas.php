<?php
declare(strict_types=1);

trait CategoriasConsultas
{
    private static function listarDatos(PDO $db, array $filters): array
    {
        $socioOperativo = self::filtroSocioOperativoCategoria($db, 's');
        $status = trim((string)($filters['estado'] ?? 'activo'));
        if (!in_array($status, ['', 'activo', 'inactivo'], true)) {
            api_error('El estado solicitado no es válido.', 'FILTRO_INVALIDO');
        }

        $where = [];
        $params = [];
        $searchFilter = build_search_filter(
            $filters['buscar'] ?? '',
            ['c.nombre LIKE {param}'],
            100,
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
                    c.monto_mensual,
                    c.monto_anual,
                    c.activo,
                    c.creado_en AS created_at,
                    COALESCE(MAX(ph.fecha_cambio), c.creado_en) AS updated_at,
                    COUNT(DISTINCT CASE WHEN s.vigente = 1 THEN s.id_socio END) AS cantidad_socios
             FROM categoria c
             LEFT JOIN socios s ON s.id_categoria = c.id_categoria AND {$socioOperativo}
             LEFT JOIN precios_historicos ph ON ph.id_categoria = c.id_categoria
             {$sqlWhere}
             GROUP BY c.id_categoria, c.nombre, c.monto_mensual, c.monto_anual,
                      c.activo, c.creado_en
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
                    COALESCE(AVG(CASE WHEN activo = 1 THEN monto_mensual END), 0) AS promedio_mensual,
                    COALESCE(AVG(CASE WHEN activo = 1 THEN monto_anual END), 0) AS promedio_anual
             FROM categoria'
        )->fetch();

        return [
            'items' => $items,
            'resumen' => [
                'total' => (int)($summary['total'] ?? 0),
                'activas' => (int)($summary['activas'] ?? 0),
                'inactivas' => (int)($summary['inactivas'] ?? 0),
                'promedio_mensual' => number_format((float)($summary['promedio_mensual'] ?? 0), 2, '.', ''),
                'promedio_anual' => number_format((float)($summary['promedio_anual'] ?? 0), 2, '.', ''),
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
            'SELECT id_historial,
                    tipo,
                    precio_viejo AS monto_anterior,
                    precio_nuevo AS monto_nuevo,
                    fecha_cambio,
                    fecha_cambio AS vigente_desde
             FROM precios_historicos
             WHERE id_categoria = ?
             ORDER BY fecha_cambio DESC, id_historial DESC'
        );
        $statement->execute([$id]);
        $items = $statement->fetchAll();
        foreach ($items as &$item) {
            $item['id_historial'] = (int)$item['id_historial'];
            $item['tipo'] = strtolower((string)$item['tipo']);
            $item['monto_anterior'] = number_format((float)$item['monto_anterior'], 2, '.', '');
            $item['monto_nuevo'] = number_format((float)$item['monto_nuevo'], 2, '.', '');
        }
        unset($item);

        return ['items' => $items];
    }

    private static function detalle(PDO $db, int $id): ?array
    {
        $socioOperativo = self::filtroSocioOperativoCategoria($db, 's');
        $statement = $db->prepare(
            "SELECT c.id_categoria,
                    c.nombre,
                    c.monto_mensual,
                    c.monto_anual,
                    c.activo,
                    c.creado_en AS created_at,
                    COALESCE(MAX(ph.fecha_cambio), c.creado_en) AS updated_at,
                    COUNT(DISTINCT CASE WHEN s.vigente = 1 THEN s.id_socio END) AS cantidad_socios
             FROM categoria c
             LEFT JOIN socios s ON s.id_categoria = c.id_categoria AND {$socioOperativo}
             LEFT JOIN precios_historicos ph ON ph.id_categoria = c.id_categoria
             WHERE c.id_categoria = ?
             GROUP BY c.id_categoria, c.nombre, c.monto_mensual, c.monto_anual,
                      c.activo, c.creado_en"
        );
        $statement->execute([$id]);
        $category = $statement->fetch();
        if (!$category) return null;
        self::castCategoria($category);
        return $category;
    }

    private static function filtroSocioOperativoCategoria(PDO $db, string $alias = 's'): string
    {
        try {
            $db->query('SELECT 1 FROM socios_eliminados LIMIT 0');
        } catch (Throwable) {
            return '1 = 1';
        }
        if (!preg_match('/^[A-Za-z0-9_]+$/D', $alias)) $alias = 's';
        return "NOT EXISTS (SELECT 1 FROM socios_eliminados se_arch WHERE se_arch.id_socio = {$alias}.id_socio)";
    }

    private static function castCategoria(array &$category): void
    {
        $category['id_categoria'] = (int)$category['id_categoria'];
        $category['cantidad_socios'] = (int)$category['cantidad_socios'];
        $category['activo'] = (bool)$category['activo'];
        $category['monto_mensual'] = number_format((float)$category['monto_mensual'], 2, '.', '');
        $category['monto_anual'] = number_format((float)$category['monto_anual'], 2, '.', '');

        // Alias temporal para no romper consumidores antiguos mientras el resto
        // del sistema termina de migrar a monto_mensual/monto_anual.
        $category['monto_actual'] = $category['monto_mensual'];
    }
}
