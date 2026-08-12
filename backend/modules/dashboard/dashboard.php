<?php
declare(strict_types=1);

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
        $monthStart = $today->modify('first day of this month');
        $monthEnd = $monthStart->modify('+1 month');
        $currentYear = (int)$today->format('Y');
        $currentMonth = (int)$today->format('n');

        $activePartners = self::count($db, "SELECT COUNT(*) FROM socios WHERE estado = 'ACTIVO'");
        $inactivePartners = self::count($db, "SELECT COUNT(*) FROM socios WHERE estado = 'INACTIVO'");
        $activePeople = self::count(
            $db,
            "SELECT COUNT(*) FROM socios WHERE tipo_socio = 'PERSONA' AND estado = 'ACTIVO'"
        );
        $activeCompanies = self::count(
            $db,
            "SELECT COUNT(*) FROM socios WHERE tipo_socio = 'EMPRESA' AND estado = 'ACTIVO'"
        );
        $newPartners = self::count(
            $db,
            'SELECT COUNT(*) FROM socios WHERE fecha_alta >= ? AND fecha_alta < ?',
            [$monthStart->format('Y-m-d'), $monthEnd->format('Y-m-d')]
        );
        $activeFamilies = self::count($db, 'SELECT COUNT(*) FROM familias WHERE activo = 1');
        $peopleWithFamily = self::count(
            $db,
            "SELECT COUNT(*)
             FROM socios s
             WHERE s.tipo_socio = 'PERSONA'
               AND s.estado = 'ACTIVO'
               AND EXISTS (
                    SELECT 1
                    FROM familias_socios fs
                    INNER JOIN familias f
                        ON f.id_familia = fs.id_familia
                       AND f.activo = 1
                    WHERE fs.id_socio = s.id_socio
                      AND fs.fecha_desvinculacion IS NULL
               )"
        );
        $withCategory = self::count(
            $db,
            "SELECT COUNT(*) FROM socios WHERE estado = 'ACTIVO' AND id_categoria IS NOT NULL"
        );
        $withReminder = self::count(
            $db,
            "SELECT COUNT(*) FROM socios WHERE estado = 'ACTIVO' AND enviar_recordatorio = 1"
        );
        $activeCategories = self::count($db, 'SELECT COUNT(*) FROM categorias WHERE activo = 1');

        $expectedCurrent = self::count(
            $db,
            "SELECT COUNT(*)
             FROM socios
             WHERE estado = 'ACTIVO'
               AND id_categoria IS NOT NULL
               AND (fecha_alta IS NULL OR fecha_alta < ?)",
            [$monthEnd->format('Y-m-d')]
        );
        $resolvedCurrent = self::count(
            $db,
            "SELECT COUNT(DISTINCT p.id_socio)
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             WHERE p.anio = ?
               AND p.mes = ?
               AND s.estado = 'ACTIVO'
               AND s.id_categoria IS NOT NULL",
            [$currentYear, $currentMonth]
        );
        $paidCurrent = self::count(
            $db,
            "SELECT COUNT(DISTINCT p.id_socio)
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             WHERE p.anio = ?
               AND p.mes = ?
               AND p.estado = 'PAGADO'
               AND s.estado = 'ACTIVO'
               AND s.id_categoria IS NOT NULL",
            [$currentYear, $currentMonth]
        );
        $condonedCurrent = max(0, $resolvedCurrent - $paidCurrent);
        $pendingCurrent = max(0, $expectedCurrent - $resolvedCurrent);

        $paymentOperations = self::count(
            $db,
            "SELECT COUNT(*) FROM pagos WHERE estado = 'PAGADO' AND fecha_pago >= ? AND fecha_pago < ?",
            [$monthStart->format('Y-m-d'), $monthEnd->format('Y-m-d')]
        );
        $paymentsWithoutAmount = self::count(
            $db,
            "SELECT COUNT(*) FROM pagos WHERE estado = 'PAGADO' AND fecha_pago >= ? AND fecha_pago < ? AND monto IS NULL",
            [$monthStart->format('Y-m-d'), $monthEnd->format('Y-m-d')]
        );
        $partnerIncome = self::sum(
            $db,
            "SELECT COALESCE(SUM(monto), 0) FROM pagos WHERE estado = 'PAGADO' AND fecha_pago >= ? AND fecha_pago < ?",
            [$monthStart->format('Y-m-d'), $monthEnd->format('Y-m-d')]
        );

        $contableAvailable = self::tableExists($db, 'contable_ingresos')
            && self::tableExists($db, 'contable_egresos');
        $otherIncome = $contableAvailable
            ? self::optionalSum(
                $db,
                "SELECT COALESCE(SUM(importe), 0)
                 FROM contable_ingresos
                 WHERE estado = 'ACTIVO' AND fecha >= ? AND fecha < ?",
                [$monthStart->format('Y-m-d'), $monthEnd->format('Y-m-d')]
            )
            : 0.0;
        $expenses = $contableAvailable
            ? self::optionalSum(
                $db,
                "SELECT COALESCE(SUM(importe), 0)
                 FROM contable_egresos
                 WHERE estado = 'ACTIVO' AND fecha >= ? AND fecha < ?",
                [$monthStart->format('Y-m-d'), $monthEnd->format('Y-m-d')]
            )
            : 0.0;
        $income = $partnerIncome + $otherIncome;

        $stateActivity = self::stateActivity($db, $monthStart, $monthEnd);

        return [
            'periodo' => [
                'fecha' => $today->format('Y-m-d'),
                'anio' => $currentYear,
                'mes' => $currentMonth,
                'mes_nombre' => self::monthName($currentMonth),
            ],
            'socios' => [
                'activos' => $activePartners,
                'inactivos' => $inactivePartners,
                'personas_activas' => $activePeople,
                'empresas_activas' => $activeCompanies,
                'altas_mes' => $newPartners,
                'con_familia' => $peopleWithFamily,
                'sin_familia' => max(0, $activePeople - $peopleWithFamily),
                'con_categoria' => $withCategory,
                'sin_categoria' => max(0, $activePartners - $withCategory),
                'con_recordatorio' => $withReminder,
                'sin_recordatorio' => max(0, $activePartners - $withReminder),
            ],
            'familias' => [
                'activas' => $activeFamilies,
            ],
            'categorias' => [
                'activas' => $activeCategories,
                'distribucion' => self::categoryDistribution($db),
            ],
            'cuotas' => [
                'esperadas_mes' => $expectedCurrent,
                'pagadas_mes' => $paidCurrent,
                'condonadas_mes' => $condonedCurrent,
                'pendientes_mes' => $pendingCurrent,
                'cumplimiento_mes' => self::percentage($resolvedCurrent, $expectedCurrent),
                'cobros_registrados_mes' => $paymentOperations,
                'cobros_sin_importe_mes' => $paymentsWithoutAmount,
            ],
            'contable' => [
                'ingresos_socios_mes' => self::money($partnerIncome),
                'otros_ingresos_mes' => self::money($otherIncome),
                'ingresos_mes' => self::money($income),
                'egresos_mes' => self::money($expenses),
                'saldo_mes' => self::money($income - $expenses),
            ],
            'estado' => [
                'socios_con_familia' => self::percentage($peopleWithFamily, $activePeople),
                'socios_con_categoria' => self::percentage($withCategory, $activePartners),
                'socios_con_recordatorio' => self::percentage($withReminder, $activePartners),
            ],
            'actividad' => [
                'altas_mes' => $newPartners,
                'bajas_mes' => $stateActivity['bajas'],
                'reactivaciones_mes' => $stateActivity['reactivaciones'],
                'cobros_mes' => $paymentOperations,
            ],
            'serie_cuotas' => self::monthlyPaymentSeries($db, $monthStart->modify('-5 months'), $monthEnd),
            'pagos_recientes' => self::recentPayments($db),
            'fuentes' => [
                'contable_disponible' => $contableAvailable,
                'importes_legacy_incompletos' => $paymentsWithoutAmount > 0,
            ],
        ];
    }

    private static function stateActivity(PDO $db, DateTimeImmutable $start, DateTimeImmutable $end): array
    {
        if (!self::tableExists($db, 'socios_historial_estados')) {
            return ['bajas' => 0, 'reactivaciones' => 0];
        }

        $statement = $db->prepare(
            "SELECT
                SUM(CASE WHEN tipo_evento = 'BAJA' THEN 1 ELSE 0 END) AS bajas,
                SUM(CASE WHEN tipo_evento = 'REACTIVACION' THEN 1 ELSE 0 END) AS reactivaciones
             FROM socios_historial_estados
             WHERE COALESCE(fecha_efectiva, DATE(creado_en)) >= ?
               AND COALESCE(fecha_efectiva, DATE(creado_en)) < ?"
        );
        $statement->execute([$start->format('Y-m-d'), $end->format('Y-m-d')]);
        $row = $statement->fetch() ?: [];

        return [
            'bajas' => (int)($row['bajas'] ?? 0),
            'reactivaciones' => (int)($row['reactivaciones'] ?? 0),
        ];
    }

    private static function monthlyPaymentSeries(PDO $db, DateTimeImmutable $start, DateTimeImmutable $end): array
    {
        $startKey = ((int)$start->format('Y') * 100) + (int)$start->format('n');
        $lastMonth = $end->modify('-1 month');
        $endKey = ((int)$lastMonth->format('Y') * 100) + (int)$lastMonth->format('n');

        $statement = $db->prepare(
            "SELECT anio, mes, COUNT(*) AS pagadas, COALESCE(SUM(monto), 0) AS importe
             FROM pagos
             WHERE estado = 'PAGADO'
               AND (anio * 100 + mes) BETWEEN ? AND ?
             GROUP BY anio, mes"
        );
        $statement->execute([$startKey, $endKey]);

        $indexed = [];
        foreach ($statement->fetchAll() as $row) {
            $key = sprintf('%04d-%02d', (int)$row['anio'], (int)$row['mes']);
            $indexed[$key] = [
                'pagadas' => (int)$row['pagadas'],
                'importe' => (float)$row['importe'],
            ];
        }

        $series = [];
        for ($cursor = $start; $cursor < $end; $cursor = $cursor->modify('+1 month')) {
            $key = $cursor->format('Y-m');
            $values = $indexed[$key] ?? ['pagadas' => 0, 'importe' => 0.0];
            $month = (int)$cursor->format('n');
            $series[] = [
                'periodo' => $key,
                'anio' => (int)$cursor->format('Y'),
                'mes' => $month,
                'etiqueta' => substr(self::monthName($month), 0, 3),
                'pagadas' => $values['pagadas'],
                'importe' => self::money($values['importe']),
            ];
        }

        return $series;
    }

    private static function categoryDistribution(PDO $db): array
    {
        $statement = $db->query(
            "SELECT
                COALESCE(c.nombre, 'SIN CATEGORÍA') AS categoria,
                COUNT(*) AS cantidad
             FROM socios s
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             WHERE s.estado = 'ACTIVO'
             GROUP BY s.id_categoria, c.nombre
             ORDER BY cantidad DESC, categoria ASC
             LIMIT 8"
        );

        return array_map(
            static fn(array $row): array => [
                'categoria' => (string)$row['categoria'],
                'cantidad' => (int)$row['cantidad'],
            ],
            $statement->fetchAll()
        );
    }

    private static function recentPayments(PDO $db): array
    {
        $statement = $db->query(
            "SELECT
                p.id_pago,
                p.id_socio,
                p.anio,
                p.mes,
                p.fecha_pago,
                p.monto,
                s.tipo_socio,
                COALESCE(mp.nombre, 'SIN MEDIO') AS medio_pago,
                CASE
                    WHEN s.tipo_socio = 'PERSONA'
                        THEN TRIM(CONCAT(COALESCE(sp.apellido, ''), ', ', COALESCE(sp.nombre, '')))
                    ELSE COALESCE(se.razon_social, 'EMPRESA SIN RAZÓN SOCIAL')
                END AS socio
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN socios_personas sp ON sp.id_socio = s.id_socio
             LEFT JOIN socios_empresas se ON se.id_socio = s.id_socio
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.estado = 'PAGADO'
             ORDER BY p.fecha_pago DESC, p.creado_en DESC, p.id_pago DESC
             LIMIT 8"
        );

        return array_map(
            static fn(array $row): array => [
                'id_pago' => (int)$row['id_pago'],
                'id_socio' => (int)$row['id_socio'],
                'socio' => (string)$row['socio'],
                'tipo_socio' => (string)$row['tipo_socio'],
                'periodo' => sprintf('%02d/%04d', (int)$row['mes'], (int)$row['anio']),
                'mes_nombre' => self::monthName((int)$row['mes']),
                'fecha_pago' => (string)$row['fecha_pago'],
                'monto' => $row['monto'] === null ? null : self::money((float)$row['monto']),
                'medio_pago' => (string)$row['medio_pago'],
            ],
            $statement->fetchAll()
        );
    }

    private static function tableExists(PDO $db, string $table): bool
    {
        static $cache = [];
        $cacheKey = spl_object_id($db) . ':' . $table;
        if (array_key_exists($cacheKey, $cache)) return $cache[$cacheKey];

        $statement = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
        );
        $statement->execute([$table]);
        $cache[$cacheKey] = (int)$statement->fetchColumn() > 0;
        return $cache[$cacheKey];
    }

    private static function count(PDO $db, string $sql, array $params = []): int
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        return (int)$statement->fetchColumn();
    }

    private static function sum(PDO $db, string $sql, array $params = []): float
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        return (float)$statement->fetchColumn();
    }

    private static function optionalSum(PDO $db, string $sql, array $params = []): float
    {
        try {
            return self::sum($db, $sql, $params);
        } catch (Throwable $error) {
            error_log('Dashboard: no se pudo leer un total opcional. ' . $error->getMessage());
            return 0.0;
        }
    }

    private static function money(float $value): string
    {
        return number_format($value, 2, '.', '');
    }

    private static function percentage(int $part, int $total): int
    {
        if ($total <= 0) return 0;
        return max(0, min(100, (int)round(($part / $total) * 100)));
    }

    private static function monthName(int $month): string
    {
        return [
            1 => 'ENERO', 2 => 'FEBRERO', 3 => 'MARZO', 4 => 'ABRIL',
            5 => 'MAYO', 6 => 'JUNIO', 7 => 'JULIO', 8 => 'AGOSTO',
            9 => 'SEPTIEMBRE', 10 => 'OCTUBRE', 11 => 'NOVIEMBRE', 12 => 'DICIEMBRE',
        ][$month] ?? '';
    }
}
