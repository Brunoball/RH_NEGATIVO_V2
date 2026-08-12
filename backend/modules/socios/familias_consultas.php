<?php
declare(strict_types=1);

trait FamiliasConsultas
{
    private static function listarDatos(PDO $db, array $filters): array
    {
        $where = [];
        $params = [];

        $status = strtolower(trim((string)($filters['estado'] ?? 'activo')));
        if (!in_array($status, ['', 'activo', 'inactivo'], true)) {
            api_error('El estado solicitado no es válido.', 'FILTRO_INVALIDO');
        }
        if ($status === 'activo') $where[] = 'f.activo = 1';
        if ($status === 'inactivo') $where[] = 'f.activo = 0';

        $searchFilter = build_search_filter(
            $filters['buscar'] ?? '',
            [
                "CONCAT_WS(' ', f.nombre, f.descripcion) LIKE {param}",
                "EXISTS (
                    SELECT 1
                    FROM familias_socios fsb
                    INNER JOIN socios_personas pb ON pb.id_socio = fsb.id_socio
                    WHERE fsb.id_familia = f.id_familia
                      AND fsb.fecha_desvinculacion IS NULL
                      AND CONCAT_WS(' ', pb.apellido, pb.nombre, pb.dni) LIKE {param}
                )",
            ],
            150,
            'buscar_familia'
        );
        if ($searchFilter['sql'] !== '') {
            $where[] = $searchFilter['sql'];
            $params = array_merge($params, $searchFilter['params']);
        }

        $sqlWhere = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);
        $statement = $db->prepare(
            "SELECT f.id_familia, f.nombre, f.descripcion, f.activo, f.creado_en, f.actualizado_en,
                    COUNT(CASE WHEN fs.fecha_desvinculacion IS NULL AND s.estado = 'ACTIVO' THEN 1 END) AS cantidad_integrantes,
                    MAX(CASE WHEN fs.fecha_desvinculacion IS NULL AND fs.es_titular = 1 THEN
                        CONCAT(p.apellido, ', ', p.nombre) END) AS titular
             FROM familias f
             LEFT JOIN familias_socios fs ON fs.id_familia = f.id_familia
             LEFT JOIN socios s ON s.id_socio = fs.id_socio
             LEFT JOIN socios_personas p ON p.id_socio = fs.id_socio
             {$sqlWhere}
             GROUP BY f.id_familia
             ORDER BY f.activo DESC, f.nombre ASC"
        );
        $statement->execute($params);
        $families = $statement->fetchAll();
        $items = self::hydrateFamilies($db, $families, false);

        $summary = $db->query(
            "SELECT COUNT(*) AS total,
                    COALESCE(SUM(activo = 1), 0) AS activas,
                    COALESCE(SUM(activo = 0), 0) AS inactivas
             FROM familias"
        )->fetch() ?: [];

        $members = (int)$db->query(
            "SELECT COUNT(*)
             FROM familias_socios fs
             INNER JOIN familias f ON f.id_familia = fs.id_familia AND f.activo = 1
             INNER JOIN socios s ON s.id_socio = fs.id_socio AND s.estado = 'ACTIVO'
             WHERE fs.fecha_desvinculacion IS NULL"
        )->fetchColumn();

        return [
            'items' => $items,
            'resumen' => [
                'total' => (int)($summary['total'] ?? 0),
                'activas' => (int)($summary['activas'] ?? 0),
                'inactivas' => (int)($summary['inactivas'] ?? 0),
                'integrantes_activos' => $members,
            ],
            'catalogos' => ['socios' => self::peopleCatalog($db)],
        ];
    }

    private static function obtenerDatos(PDO $db, int $id): array
    {
        $item = self::familyDetail($db, $id, true);
        if (!$item) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);
        return [
            'item' => $item,
            'catalogos' => ['socios' => self::peopleCatalog($db)],
        ];
    }

    private static function peopleCatalog(PDO $db): array
    {
        $rows = $db->query(
            "SELECT s.id_socio, s.estado, s.id_categoria,
                    p.apellido, p.nombre, p.dni,
                    c.nombre AS categoria,
                    fs.id_familia_socio, fs.id_familia, f.nombre AS familia, f.activo AS familia_activa,
                    fs.parentesco, fs.es_titular, fs.fecha_incorporacion
             FROM socios s
             INNER JOIN socios_personas p ON p.id_socio = s.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             LEFT JOIN familias_socios fs
                ON fs.id_socio = s.id_socio AND fs.fecha_desvinculacion IS NULL
             LEFT JOIN familias f ON f.id_familia = fs.id_familia
             WHERE s.tipo_socio = 'PERSONA'
             ORDER BY (s.estado = 'ACTIVO') DESC, p.apellido ASC, p.nombre ASC"
        )->fetchAll();

        foreach ($rows as &$row) {
            $row['id_socio'] = (int)$row['id_socio'];
            $row['id_categoria'] = $row['id_categoria'] === null ? null : (int)$row['id_categoria'];
            $row['id_familia_socio'] = $row['id_familia_socio'] === null ? null : (int)$row['id_familia_socio'];
            $row['id_familia'] = $row['id_familia'] === null ? null : (int)$row['id_familia'];
            $row['es_titular'] = $row['es_titular'] === null ? false : (bool)$row['es_titular'];
            $row['familia_activa'] = $row['familia_activa'] === null ? false : (bool)$row['familia_activa'];
            $row['activo'] = $row['estado'] === 'ACTIVO';
            $row['denominacion'] = trim((string)$row['apellido'] . ', ' . (string)$row['nombre'], ', ');
        }
        unset($row);
        return $rows;
    }

    private static function familyDetail(PDO $db, int $id, bool $includeHistory = false): ?array
    {
        $statement = $db->prepare(
            "SELECT f.id_familia, f.nombre, f.descripcion, f.activo, f.creado_en, f.actualizado_en,
                    COUNT(CASE WHEN fs.fecha_desvinculacion IS NULL AND s.estado = 'ACTIVO' THEN 1 END) AS cantidad_integrantes,
                    MAX(CASE WHEN fs.fecha_desvinculacion IS NULL AND fs.es_titular = 1 THEN
                        CONCAT(p.apellido, ', ', p.nombre) END) AS titular
             FROM familias f
             LEFT JOIN familias_socios fs ON fs.id_familia = f.id_familia
             LEFT JOIN socios s ON s.id_socio = fs.id_socio
             LEFT JOIN socios_personas p ON p.id_socio = fs.id_socio
             WHERE f.id_familia = ?
             GROUP BY f.id_familia"
        );
        $statement->execute([$id]);
        $family = $statement->fetch();
        if (!$family) return null;
        return self::hydrateFamilies($db, [$family], $includeHistory)[0] ?? null;
    }

    private static function hydrateFamilies(PDO $db, array $families, bool $includeHistory): array
    {
        if ($families === []) return [];
        $indexed = [];
        foreach ($families as $family) {
            $familyId = (int)$family['id_familia'];
            $indexed[$familyId] = [
                ...$family,
                'id_familia' => $familyId,
                'activo' => (bool)$family['activo'],
                'cantidad_integrantes' => (int)($family['cantidad_integrantes'] ?? 0),
                'integrantes' => [],
                'historial_integrantes' => [],
            ];
        }

        $ids = array_keys($indexed);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $active = $db->prepare(
            "SELECT fs.id_familia_socio, fs.id_familia, fs.id_socio, fs.parentesco,
                    fs.es_titular, fs.observaciones, fs.fecha_incorporacion,
                    s.estado, s.id_categoria, c.nombre AS categoria,
                    p.apellido, p.nombre, p.dni
             FROM familias_socios fs
             INNER JOIN socios s ON s.id_socio = fs.id_socio
             INNER JOIN socios_personas p ON p.id_socio = fs.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             WHERE fs.id_familia IN ({$placeholders})
               AND fs.fecha_desvinculacion IS NULL
             ORDER BY fs.es_titular DESC, p.apellido ASC, p.nombre ASC"
        );
        $active->execute($ids);
        foreach ($active->fetchAll() as $member) {
            $familyId = (int)$member['id_familia'];
            $member['id_familia_socio'] = (int)$member['id_familia_socio'];
            $member['id_familia'] = $familyId;
            $member['id_socio'] = (int)$member['id_socio'];
            $member['id_categoria'] = $member['id_categoria'] === null ? null : (int)$member['id_categoria'];
            $member['es_titular'] = (bool)$member['es_titular'];
            $member['activo'] = $member['estado'] === 'ACTIVO';
            $member['denominacion'] = trim((string)$member['apellido'] . ', ' . (string)$member['nombre'], ', ');
            $indexed[$familyId]['integrantes'][] = $member;
        }

        if ($includeHistory) {
            $history = $db->prepare(
                "SELECT fs.id_familia_socio, fs.id_familia, fs.id_socio, fs.parentesco,
                        fs.es_titular, fs.observaciones, fs.fecha_incorporacion,
                        fs.fecha_desvinculacion, fs.motivo_desvinculacion,
                        p.apellido, p.nombre, p.dni
                 FROM familias_socios fs
                 INNER JOIN socios_personas p ON p.id_socio = fs.id_socio
                 WHERE fs.id_familia IN ({$placeholders})
                 ORDER BY fs.fecha_incorporacion DESC, fs.id_familia_socio DESC"
            );
            $history->execute($ids);
            foreach ($history->fetchAll() as $member) {
                $familyId = (int)$member['id_familia'];
                $member['id_familia_socio'] = (int)$member['id_familia_socio'];
                $member['id_familia'] = $familyId;
                $member['id_socio'] = (int)$member['id_socio'];
                $member['es_titular'] = (bool)$member['es_titular'];
                $member['activo'] = $member['fecha_desvinculacion'] === null;
                $member['denominacion'] = trim((string)$member['apellido'] . ', ' . (string)$member['nombre'], ', ');
                $indexed[$familyId]['historial_integrantes'][] = $member;
            }
        }

        foreach ($indexed as &$family) {
            $family['integrante_ids'] = array_map(
                static fn(array $member): int => (int)$member['id_socio'],
                $family['integrantes']
            );
        }
        unset($family);
        return array_values($indexed);
    }
}
