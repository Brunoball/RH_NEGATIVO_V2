<?php
declare(strict_types=1);

/** Dashboard compatible con los esquemas histórico y RH Negativo V2. */
final class Dashboard
{
    public static function resumen(): never
    {
        $auth = auth_context();
        api_success(['resumen' => self::resumenDatos($auth['db'])]);
    }

    private static function resumenDatos(PDO $db): array
    {
        $today = new DateTimeImmutable('today');
        $start = $today->modify('first day of this month');
        $end = $start->modify('+1 month');
        $year = (int)$today->format('Y');
        $month = (int)$today->format('n');
        $modern = self::columnExists($db, 'socios', 'vigente');
        $hasDeletedArchive = self::tableExists($db, 'socios_eliminados');
        $notDeleted = $hasDeletedArchive
            ? ' AND NOT EXISTS (SELECT 1 FROM socios_eliminados se_arch WHERE se_arch.id_socio = socios.id_socio)'
            : '';
        $notDeletedAlias = $hasDeletedArchive
            ? ' AND NOT EXISTS (SELECT 1 FROM socios_eliminados se_arch WHERE se_arch.id_socio = s.id_socio)'
            : '';
        $activeWhere = ($modern ? 'vigente = 1' : "tipo_socio = 'PERSONA' AND estado = 'ACTIVO'") . $notDeleted;
        $activeSocioWhere = ($modern ? 's.vigente = 1' : "s.tipo_socio = 'PERSONA' AND s.estado = 'ACTIVO'") . $notDeletedAlias;
        $inactiveWhere = ($modern ? 'vigente = 0' : "tipo_socio = 'PERSONA' AND estado = 'INACTIVO'") . $notDeleted;
        $dateColumn = self::columnExists($db, 'socios', 'fecha_ingreso') ? 'fecha_ingreso' : 'fecha_alta';

        $active = self::safeCount($db, "SELECT COUNT(*) FROM socios WHERE {$activeWhere}");
        $inactive = self::safeCount($db, "SELECT COUNT(*) FROM socios WHERE {$inactiveWhere}");
        $new = self::safeCount($db, "SELECT COUNT(*) FROM socios WHERE {$activeWhere} AND {$dateColumn} >= ? AND {$dateColumn} < ?", [$start->format('Y-m-d'), $end->format('Y-m-d')]);
        $withCategory = self::columnExists($db, 'socios', 'id_categoria')
            ? self::safeCount($db, "SELECT COUNT(*) FROM socios WHERE {$activeWhere} AND id_categoria IS NOT NULL") : 0;
        $withReminder = self::columnExists($db, 'socios', 'enviar_recordatorio')
            ? self::safeCount($db, "SELECT COUNT(*) FROM socios WHERE {$activeWhere} AND enviar_recordatorio = 1") : 0;

        [$familyTable, $familyLink] = self::familyTables($db);
        $families = $familyTable === null ? 0 : self::safeCount($db, "SELECT COUNT(*) FROM `{$familyTable}`" . (self::columnExists($db, $familyTable, 'activo') ? ' WHERE activo = 1' : ''));
        $familyWhere = $activeSocioWhere;
        if ($familyLink !== null && self::columnExists($db, $familyLink, 'activo')) $familyWhere .= ' AND fs.activo = 1';
        if ($familyLink !== null && self::columnExists($db, $familyLink, 'desde')) $familyWhere .= ' AND (fs.desde IS NULL OR fs.desde <= CURDATE())';
        if ($familyLink !== null && self::columnExists($db, $familyLink, 'hasta')) $familyWhere .= ' AND (fs.hasta IS NULL OR fs.hasta >= CURDATE())';
        $withFamily = $familyLink === null ? 0 : self::safeCount($db, "SELECT COUNT(DISTINCT s.id_socio) FROM socios s INNER JOIN `{$familyLink}` fs ON fs.id_socio = s.id_socio WHERE {$familyWhere}");

        $payments = self::currentPayments($db, $year, $month);
        $expected = $withCategory > 0 ? $withCategory : $active;
        $resolved = min($expected, $payments['pagadas'] + $payments['condonadas']);
        $partnerIncome = self::safeSum($db, "SELECT COALESCE(SUM(monto), 0) FROM pagos WHERE estado = 'PAGADO' AND fecha_pago >= ? AND fecha_pago < ?", [$start->format('Y-m-d'), $end->format('Y-m-d')]);
        $otherIncome = self::accountingSum($db, 'contable_ingresos', $start, $end);
        $expenses = self::accountingSum($db, 'contable_egresos', $start, $end);

        return [
            'periodo' => ['fecha' => $today->format('Y-m-d'), 'anio' => $year, 'mes' => $month, 'mes_nombre' => self::monthName($month)],
            'socios' => [
                'activos' => $active, 'inactivos' => $inactive, 'personas_activas' => $active,
                'altas_mes' => $new, 'con_familia' => $withFamily, 'sin_familia' => max(0, $active - $withFamily),
                'con_categoria' => $withCategory, 'sin_categoria' => max(0, $active - $withCategory),
                'con_recordatorio' => $withReminder, 'sin_recordatorio' => max(0, $active - $withReminder),
            ],
            'familias' => ['activas' => $families],
            'categorias' => ['activas' => self::activeCategories($db), 'distribucion' => self::categoryDistribution($db, $activeSocioWhere)],
            'cuotas' => [
                'esperadas_mes' => $expected, 'pagadas_mes' => $payments['pagadas'],
                'condonadas_mes' => $payments['condonadas'], 'pendientes_mes' => max(0, $expected - $resolved),
                'cumplimiento_mes' => self::percentage($resolved, $expected),
                'cobros_registrados_mes' => $payments['operaciones'], 'cobros_sin_importe_mes' => $payments['sin_importe'],
            ],
            'contable' => [
                'ingresos_socios_mes' => self::money($partnerIncome), 'otros_ingresos_mes' => self::money($otherIncome),
                'ingresos_mes' => self::money($partnerIncome + $otherIncome), 'egresos_mes' => self::money($expenses),
                'saldo_mes' => self::money($partnerIncome + $otherIncome - $expenses),
            ],
            'estado' => [
                'socios_con_familia' => self::percentage($withFamily, $active),
                'socios_con_categoria' => self::percentage($withCategory, $active),
                'socios_con_recordatorio' => self::percentage($withReminder, $active),
            ],
            'actividad' => [
                'altas_mes' => $new, 'bajas_mes' => self::stateEvents($db, 'BAJA', $start, $end),
                'reactivaciones_mes' => self::stateEvents($db, 'REACTIVACION', $start, $end), 'cobros_mes' => $payments['operaciones'],
            ],
            'serie_cuotas' => self::paymentSeries($db, $start->modify('-5 months'), $end),
            'pagos_recientes' => [],
            'fuentes' => [
                'contable_disponible' => self::tableExists($db, 'contable_ingresos') && self::tableExists($db, 'contable_egresos'),
                'importes_legacy_incompletos' => $payments['sin_importe'] > 0,
                'recordatorios_disponibles' => self::columnExists($db, 'socios', 'enviar_recordatorio'),
            ],
        ];
    }

    private static function currentPayments(PDO $db, int $year, int $month): array
    {
        if (self::columnExists($db, 'pagos', 'anio') && self::columnExists($db, 'pagos', 'id_mes')) {
            $where = 'anio = ? AND id_mes = ?'; $params = [$year, $month];
        } elseif (self::columnExists($db, 'pagos', 'anio') && self::columnExists($db, 'pagos', 'mes')) {
            $where = 'anio = ? AND mes = ?'; $params = [$year, $month];
        } elseif (self::columnExists($db, 'pagos', 'anio_aplicado') && self::columnExists($db, 'pagos', 'id_periodo')) {
            $where = 'anio_aplicado = ? AND id_periodo IN (?, 7)'; $params = [$year, (int)ceil($month / 2)];
        } else {
            $periodStart = new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month));
            $where = 'fecha_pago >= ? AND fecha_pago < ?'; $params = [$periodStart->format('Y-m-d'), $periodStart->modify('+1 month')->format('Y-m-d')];
        }
        $rows = self::safeRows($db, "SELECT estado, COUNT(DISTINCT id_socio) AS socios, COUNT(*) AS operaciones, SUM(monto IS NULL) AS sin_importe FROM pagos WHERE {$where} GROUP BY estado", $params);
        $result = ['pagadas' => 0, 'condonadas' => 0, 'operaciones' => 0, 'sin_importe' => 0];
        foreach ($rows as $row) {
            $state = strtoupper((string)($row['estado'] ?? ''));
            if ($state === 'PAGADO') $result['pagadas'] += (int)$row['socios'];
            if ($state === 'CONDONADO') $result['condonadas'] += (int)$row['socios'];
            if (in_array($state, ['PAGADO', 'CONDONADO'], true)) {
                $result['operaciones'] += (int)$row['operaciones'];
                $result['sin_importe'] += (int)$row['sin_importe'];
            }
        }
        return $result;
    }

    private static function paymentSeries(PDO $db, DateTimeImmutable $start, DateTimeImmutable $end): array
    {
        $rows = self::safeRows($db, "SELECT YEAR(fecha_pago) AS anio, MONTH(fecha_pago) AS mes, COUNT(*) AS pagadas, COALESCE(SUM(monto), 0) AS importe FROM pagos WHERE estado = 'PAGADO' AND fecha_pago >= ? AND fecha_pago < ? GROUP BY YEAR(fecha_pago), MONTH(fecha_pago)", [$start->format('Y-m-d'), $end->format('Y-m-d')]);
        $indexed = [];
        foreach ($rows as $row) $indexed[sprintf('%04d-%02d', $row['anio'], $row['mes'])] = $row;
        $series = [];
        for ($cursor = $start; $cursor < $end; $cursor = $cursor->modify('+1 month')) {
            $key = $cursor->format('Y-m'); $row = $indexed[$key] ?? [];
            $series[] = ['periodo' => $key, 'anio' => (int)$cursor->format('Y'), 'mes' => (int)$cursor->format('n'),
                'etiqueta' => substr(self::monthName((int)$cursor->format('n')), 0, 3),
                'pagadas' => (int)($row['pagadas'] ?? 0), 'importe' => self::money((float)($row['importe'] ?? 0))];
        }
        return $series;
    }

    private static function categoryDistribution(PDO $db, string $activeSocioWhere): array
    {
        $table = self::categoryTable($db);
        if ($table === null || !self::columnExists($db, 'socios', 'id_categoria')) return [];
        $rows = self::safeRows($db, "SELECT COALESCE(c.nombre, 'SIN CATEGORÍA') AS categoria, COUNT(*) AS cantidad FROM socios s LEFT JOIN `{$table}` c ON c.id_categoria = s.id_categoria WHERE {$activeSocioWhere} GROUP BY s.id_categoria, c.nombre ORDER BY cantidad DESC LIMIT 8");
        return array_map(static fn(array $row): array => ['categoria' => (string)$row['categoria'], 'cantidad' => (int)$row['cantidad']], $rows);
    }

    private static function activeCategories(PDO $db): int
    {
        $table = self::categoryTable($db);
        if ($table === null) return 0;
        return self::safeCount($db, "SELECT COUNT(*) FROM `{$table}`" . (self::columnExists($db, $table, 'activo') ? ' WHERE activo = 1' : ''));
    }

    private static function categoryTable(PDO $db): ?string
    {
        if (self::tableExists($db, 'categoria')) return 'categoria';
        if (self::tableExists($db, 'categorias')) return 'categorias';
        return null;
    }

    private static function familyTables(PDO $db): array
    {
        $family = self::tableExists($db, 'familias') ? 'familias' : null;
        $link = self::tableExists($db, 'familias_socios') ? 'familias_socios' : (self::tableExists($db, 'familia_socios') ? 'familia_socios' : null);
        return [$family, $link];
    }

    private static function stateEvents(PDO $db, string $event, DateTimeImmutable $start, DateTimeImmutable $end): int
    {
        if (!self::tableExists($db, 'socios_historial_estados')) return 0;
        $date = self::columnExists($db, 'socios_historial_estados', 'fecha_evento') ? 'fecha_evento' : 'creado_en';
        return self::safeCount($db, "SELECT COUNT(*) FROM socios_historial_estados WHERE tipo_evento = ? AND {$date} >= ? AND {$date} < ?", [$event, $start->format('Y-m-d'), $end->format('Y-m-d')]);
    }

    private static function accountingSum(PDO $db, string $table, DateTimeImmutable $start, DateTimeImmutable $end): float
    {
        if (!self::tableExists($db, $table)) return 0.0;
        $active = self::columnExists($db, $table, 'estado') ? " AND estado = 'ACTIVO'" : '';
        return self::safeSum($db, "SELECT COALESCE(SUM(importe), 0) FROM `{$table}` WHERE fecha >= ? AND fecha < ?{$active}", [$start->format('Y-m-d'), $end->format('Y-m-d')]);
    }

    private static function tableExists(PDO $db, string $table): bool
    { return self::safeCount($db, 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table]) > 0; }

    private static function columnExists(PDO $db, string $table, string $column): bool
    { return self::safeCount($db, 'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$table, $column]) > 0; }

    private static function safeRows(PDO $db, string $sql, array $params = []): array
    {
        try { $statement = $db->prepare($sql); $statement->execute($params); return $statement->fetchAll() ?: []; }
        catch (Throwable $error) { error_log('[dashboard] ' . $error->getMessage()); return []; }
    }

    private static function safeCount(PDO $db, string $sql, array $params = []): int
    {
        try { $statement = $db->prepare($sql); $statement->execute($params); return (int)$statement->fetchColumn(); }
        catch (Throwable $error) { error_log('[dashboard] ' . $error->getMessage()); return 0; }
    }

    private static function safeSum(PDO $db, string $sql, array $params = []): float
    {
        try { $statement = $db->prepare($sql); $statement->execute($params); return (float)$statement->fetchColumn(); }
        catch (Throwable $error) { error_log('[dashboard] ' . $error->getMessage()); return 0.0; }
    }

    private static function money(float $value): string { return number_format($value, 2, '.', ''); }
    private static function percentage(int $part, int $total): int { return $total <= 0 ? 0 : max(0, min(100, (int)round(($part / $total) * 100))); }
    private static function monthName(int $month): string
    {
        return [1 => 'ENERO', 2 => 'FEBRERO', 3 => 'MARZO', 4 => 'ABRIL', 5 => 'MAYO', 6 => 'JUNIO',
            7 => 'JULIO', 8 => 'AGOSTO', 9 => 'SEPTIEMBRE', 10 => 'OCTUBRE', 11 => 'NOVIEMBRE', 12 => 'DICIEMBRE'][$month] ?? '';
    }
}
