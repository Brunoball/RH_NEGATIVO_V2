<?php
declare(strict_types=1);

trait FamiliasConsultas
{
    private static function familiasEsNombreArchivado(string $name): bool
    {
        return str_starts_with($name, '__ELIMINADA__') && str_contains($name, '::');
    }

    private static function familiasNombreArchivado(int $id, string $name): string
    {
        $prefix = '__ELIMINADA__' . $id . '::';
        $maxLength = max(0, 120 - strlen($prefix));
        $visibleName = function_exists('mb_substr')
            ? mb_substr($name, 0, $maxLength, 'UTF-8')
            : substr($name, 0, $maxLength);
        return $prefix . $visibleName;
    }

    private static function familiasArchivoSociosEliminadosDisponible(PDO $db): bool
    {
        try {
            $db->query('SELECT 1 FROM socios_eliminados LIMIT 0');
            return true;
        } catch (Throwable) {
            return false;
        }
    }

    private static function familiasFiltroSociosOperativos(PDO $db, string $alias = 's'): string
    {
        if (!self::familiasArchivoSociosEliminadosDisponible($db)) return '1 = 1';
        if (!preg_match('/^[A-Za-z0-9_]+$/D', $alias)) $alias = 's';
        return "NOT EXISTS (SELECT 1 FROM socios_eliminados se_arch WHERE se_arch.id_socio = {$alias}.id_socio)";
    }

    private static function listarDatos(PDO $db, array $filters): array
    {
        // Las familias eliminadas conservan una lápida sólo para reconstruir
        // períodos financieros. Nunca vuelven a aparecer en la gestión.
        $where = ["NOT (
            LEFT(f.nombre_familia, 13) = '__ELIMINADA__'
            AND LOCATE('::', f.nombre_familia) > 13
        )"];
        $params = [];
        $archiveAvailable = self::familiasArchivoSociosEliminadosDisponible($db);
        $historicalDniJoin = $archiveAvailable
            ? 'LEFT JOIN socios_eliminados seb ON seb.id_socio = sb.id_socio'
            : '';
        $historicalDniExpr = $archiveAvailable ? 'COALESCE(sb.dni, seb.dni)' : 'sb.dni';

        $status = strtolower(trim((string)($filters['estado'] ?? 'activo')));
        if (!in_array($status, ['', 'activo', 'inactivo'], true)) {
            api_error('El estado solicitado no es válido.', 'FILTRO_INVALIDO', 422);
        }
        if ($status === 'activo') $where[] = 'f.activo = 1';
        if ($status === 'inactivo') $where[] = 'f.activo = 0';

        $searchFilter = build_search_filter(
            $filters['buscar'] ?? '',
            [
                "CONCAT_WS(' ', f.nombre_familia, f.observaciones) LIKE {param}",
                "EXISTS (
                    SELECT 1
                    FROM familias_socios fsb
                    INNER JOIN socios sb ON sb.id_socio = fsb.id_socio
                    {$historicalDniJoin}
                    WHERE fsb.id_familia = f.id_familia
                      AND CONCAT_WS(' ', sb.nombre, {$historicalDniExpr}) LIKE {param}
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
            "SELECT f.id_familia,
                    f.nombre_familia,
                    f.nombre_familia AS nombre,
                    f.observaciones,
                    f.observaciones AS descripcion,
                    f.activo,
                    f.creado_en,
                    f.actualizado_en,
                    COALESCE(SUM(fs.activo = 1 AND fs.hasta IS NULL), 0) AS cantidad_integrantes
             FROM familias f
             LEFT JOIN familias_socios fs ON fs.id_familia = f.id_familia
             {$sqlWhere}
             GROUP BY f.id_familia, f.nombre_familia, f.observaciones, f.activo, f.creado_en, f.actualizado_en
             ORDER BY f.activo DESC, f.nombre_familia ASC, f.id_familia ASC"
        );
        $statement->execute($params);
        $families = $statement->fetchAll();
        $items = self::hydrateFamilies($db, $families, false);

        $summary = $db->query(
            "SELECT COUNT(*) AS total,
                    COALESCE(SUM(activo = 1), 0) AS activas,
                    COALESCE(SUM(activo = 0), 0) AS inactivas
             FROM familias
             WHERE NOT (
                LEFT(nombre_familia, 13) = '__ELIMINADA__'
                AND LOCATE('::', nombre_familia) > 13
             )"
        )->fetch() ?: [];

        $members = (int)$db->query(
            "SELECT COUNT(*)
             FROM familias_socios fs
             INNER JOIN familias f ON f.id_familia = fs.id_familia AND f.activo = 1
             WHERE fs.activo = 1
               AND fs.hasta IS NULL"
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

    /**
     * Catálogo de socios para armar familias.
     *
     * `familia_activa` solo se considera cuando tanto el vínculo como la
     * familia están activos. Un vínculo histórico nunca bloquea al socio.
     */
    private static function peopleCatalog(PDO $db): array
    {
        $rows = $db->query(
            "SELECT s.id_socio,
                    s.nombre,
                    s.dni,
                    s.vigente,
                    s.id_categoria,
                    c.nombre AS categoria,
                    fs.id_familia_socio,
                    fs.id_familia AS id_familia_activa,
                    f.nombre_familia AS familia,
                    CASE WHEN fs.id_familia_socio IS NULL THEN 0 ELSE 1 END AS familia_activa,
                    fs.desde
             FROM socios s
             LEFT JOIN categoria c ON c.id_categoria = s.id_categoria
             LEFT JOIN familias_socios fs
               ON fs.id_familia_socio = (
                    SELECT fs2.id_familia_socio
                    FROM familias_socios fs2
                    INNER JOIN familias f2
                       ON f2.id_familia = fs2.id_familia
                      AND f2.activo = 1
                    WHERE fs2.id_socio = s.id_socio
                      AND fs2.activo = 1
                      AND fs2.hasta IS NULL
                    ORDER BY fs2.id_familia_socio DESC
                    LIMIT 1
               )
             LEFT JOIN familias f ON f.id_familia = fs.id_familia
             WHERE " . self::familiasFiltroSociosOperativos($db, 's') . "
             ORDER BY s.vigente DESC, s.nombre ASC, s.id_socio ASC"
        )->fetchAll();

        foreach ($rows as &$row) {
            $row['id_socio'] = (int)$row['id_socio'];
            $row['id_categoria'] = $row['id_categoria'] === null ? null : (int)$row['id_categoria'];
            $row['id_familia_socio'] = $row['id_familia_socio'] === null ? null : (int)$row['id_familia_socio'];
            $row['id_familia_activa'] = $row['id_familia_activa'] === null ? null : (int)$row['id_familia_activa'];
            // Alias conservado para componentes que ya lo consultaban.
            $row['id_familia'] = $row['id_familia_activa'];
            $row['familia_activa'] = (bool)$row['familia_activa'];
            $row['activo'] = (bool)$row['vigente'];
            $row['vigente'] = (bool)$row['vigente'];
            $row['denominacion'] = trim((string)$row['nombre']);
        }
        unset($row);

        return $rows;
    }

    private static function familyDetail(PDO $db, int $id, bool $includeHistory = false): ?array
    {
        $statement = $db->prepare(
            "SELECT f.id_familia,
                    f.nombre_familia,
                    f.nombre_familia AS nombre,
                    f.observaciones,
                    f.observaciones AS descripcion,
                    f.activo,
                    f.creado_en,
                    f.actualizado_en,
                    COALESCE(SUM(fs.activo = 1 AND fs.hasta IS NULL), 0) AS cantidad_integrantes
             FROM familias f
             LEFT JOIN familias_socios fs ON fs.id_familia = f.id_familia
             WHERE f.id_familia = ?
               AND NOT (
                    LEFT(f.nombre_familia, 13) = '__ELIMINADA__'
                    AND LOCATE('::', f.nombre_familia) > 13
               )
             GROUP BY f.id_familia, f.nombre_familia, f.observaciones, f.activo, f.creado_en, f.actualizado_en"
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
                'nombre_familia' => (string)($family['nombre_familia'] ?? $family['nombre'] ?? ''),
                'nombre' => (string)($family['nombre'] ?? $family['nombre_familia'] ?? ''),
                'observaciones' => $family['observaciones'] ?? $family['descripcion'] ?? null,
                'descripcion' => $family['descripcion'] ?? $family['observaciones'] ?? null,
                'activo' => (bool)$family['activo'],
                'cantidad_integrantes' => (int)($family['cantidad_integrantes'] ?? 0),
                'integrantes' => [],
                'historial_integrantes' => [],
            ];
        }

        $ids = array_keys($indexed);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));

        $active = $db->prepare(
            "SELECT fs.id_familia_socio,
                    fs.id_familia,
                    fs.id_socio,
                    fs.desde,
                    fs.hasta,
                    fs.activo AS vinculo_activo,
                    fs.creado_en,
                    fs.actualizado_en,
                    s.nombre,
                    s.dni,
                    s.vigente,
                    s.id_categoria,
                    c.nombre AS categoria
             FROM familias_socios fs
             INNER JOIN socios s ON s.id_socio = fs.id_socio
             LEFT JOIN categoria c ON c.id_categoria = s.id_categoria
             WHERE fs.id_familia IN ({$placeholders})
               AND fs.activo = 1
               AND fs.hasta IS NULL
               AND " . self::familiasFiltroSociosOperativos($db, 's') . "
             ORDER BY s.nombre ASC, s.id_socio ASC"
        );
        $active->execute($ids);
        foreach ($active->fetchAll() as $member) {
            $familyId = (int)$member['id_familia'];
            $member = self::normalizeFamilyMemberRow($member);
            $indexed[$familyId]['integrantes'][] = $member;
        }

        if ($includeHistory) {
            $archiveAvailable = self::familiasArchivoSociosEliminadosDisponible($db);
            $historyDniExpr = $archiveAvailable ? 'COALESCE(s.dni, se_arch.dni)' : 's.dni';
            $historyArchiveJoin = $archiveAvailable
                ? 'LEFT JOIN socios_eliminados se_arch ON se_arch.id_socio = s.id_socio'
                : '';
            $history = $db->prepare(
                "SELECT fs.id_familia_socio,
                        fs.id_familia,
                        fs.id_socio,
                        fs.desde,
                        fs.hasta,
                        fs.activo AS vinculo_activo,
                        fs.creado_en,
                        fs.actualizado_en,
                        s.nombre,
                        {$historyDniExpr} AS dni,
                        s.vigente,
                        s.id_categoria,
                        c.nombre AS categoria
                 FROM familias_socios fs
                 INNER JOIN socios s ON s.id_socio = fs.id_socio
                 {$historyArchiveJoin}
                 LEFT JOIN categoria c ON c.id_categoria = s.id_categoria
                 WHERE fs.id_familia IN ({$placeholders})
                 ORDER BY COALESCE(fs.desde, DATE(fs.creado_en)) DESC,
                          fs.id_familia_socio DESC"
            );
            $history->execute($ids);
            foreach ($history->fetchAll() as $member) {
                $familyId = (int)$member['id_familia'];
                $member = self::normalizeFamilyMemberRow($member);
                $indexed[$familyId]['historial_integrantes'][] = $member;
            }
        }

        foreach ($indexed as &$family) {
            $family['cantidad_integrantes'] = count($family['integrantes']);
            $family['integrante_ids'] = array_map(
                static fn(array $member): int => (int)$member['id_socio'],
                $family['integrantes']
            );
            $family['impacto_eliminacion'] = [
                'socios_sin_familia' => count($family['integrantes']),
                'vinculos_eliminados' => $includeHistory
                    ? count($family['historial_integrantes'])
                    : count($family['integrantes']),
            ];
        }
        unset($family);

        return array_values($indexed);
    }

    private static function normalizeFamilyMemberRow(array $member): array
    {
        $member['id_familia_socio'] = (int)$member['id_familia_socio'];
        $member['id_familia'] = (int)$member['id_familia'];
        $member['id_socio'] = (int)$member['id_socio'];
        $member['id_categoria'] = $member['id_categoria'] === null ? null : (int)$member['id_categoria'];
        $member['vinculo_activo'] = (bool)$member['vinculo_activo'];
        $member['vigente'] = (bool)$member['vigente'];
        $member['activo'] = $member['vinculo_activo'] && $member['hasta'] === null;
        $member['socio_vigente'] = $member['vigente'];
        $member['denominacion'] = trim((string)$member['nombre']);

        // Alias de lectura para mantener compatibilidad con la UI mientras el
        // modelo real usa `desde` / `hasta`.
        $member['fecha_incorporacion'] = $member['desde'];
        $member['fecha_desvinculacion'] = $member['hasta'];

        return $member;
    }
}
