<?php
declare(strict_types=1);

trait ContableConsultas
{
    abstract protected static function filtroAnio(mixed $value): int;
    abstract protected static function filtroMes(mixed $value, bool $required = true): ?int;
    abstract protected static function textoBusqueda(mixed $value): string;
    abstract protected static function idOpcional(mixed $value, string $label): ?int;
    abstract protected static function rangoAnio(int $year): array;
    abstract protected static function rangoMes(int $year, int $month): array;
    abstract protected static function centavos(mixed $value): int;
    abstract protected static function importeDesdeCentavos(int $cents): string;
    abstract protected static function nombreMes(int $month): string;
    abstract protected static function importePagoSql(string $paymentAlias = 'p', string $partnerAlias = 's', string $categoryAlias = 'c'): string;
    abstract protected static function opcion(PDO $db, int $id, string $expectedType): array;

    protected static function resumenDatos(PDO $db, int $year, int $selectedMonth): array
    {
        [$yearStart, $yearEnd] = self::rangoAnio($year);
        $feesByMonth = array_fill(1, 12, 0);
        $registrationsByMonth = array_fill(1, 12, 0);
        $otherByMonth = array_fill(1, 12, 0);
        $expensesByMonth = array_fill(1, 12, 0);
        $estimatedByMonth = array_fill(1, 12, 0);
        foreach (self::pagosHistoricosContables($db, $yearStart, $yearEnd) as $payment) {
            $month = (int)$payment['mes'];
            if ($month < 1 || $month > 12) continue;
            $feesByMonth[$month] += (int)$payment['monto_cents'];
            if (!empty($payment['estimado'])) $estimatedByMonth[$month]++;
        }

        self::acumularTotalesMensuales(
            $db,
            'SELECT MONTH(fecha_pago) AS mes, SUM(monto) AS total
             FROM pagos_inscripcion WHERE fecha_pago >= ? AND fecha_pago < ?
             GROUP BY MONTH(fecha_pago)',
            [$yearStart, $yearEnd],
            $registrationsByMonth
        );
        self::acumularTotalesMensuales(
            $db,
            'SELECT MONTH(fecha) AS mes, SUM(importe) AS total
             FROM contable_ingresos WHERE fecha >= ? AND fecha < ? GROUP BY MONTH(fecha)',
            [$yearStart, $yearEnd],
            $otherByMonth
        );
        self::acumularTotalesMensuales(
            $db,
            'SELECT MONTH(fecha) AS mes, SUM(importe) AS total
             FROM contable_egresos WHERE fecha >= ? AND fecha < ? GROUP BY MONTH(fecha)',
            [$yearStart, $yearEnd],
            $expensesByMonth
        );

        $months = [];
        $totFees = $totRegistrations = $totOther = $totExpenses = $totEstimated = 0;
        foreach (range(1, 12) as $month) {
            $fees = $feesByMonth[$month];
            $registrations = $registrationsByMonth[$month];
            $partners = $fees + $registrations;
            $other = $otherByMonth[$month];
            $expenses = $expensesByMonth[$month];
            $income = $partners + $other;
            $months[] = [
                'mes' => $month,
                'nombre' => self::nombreMes($month),
                'ingresos_cuotas' => self::importeDesdeCentavos($fees),
                'ingresos_inscripciones' => self::importeDesdeCentavos($registrations),
                'ingresos_socios' => self::importeDesdeCentavos($partners),
                'otros_ingresos' => self::importeDesdeCentavos($other),
                'ingresos' => self::importeDesdeCentavos($income),
                'egresos' => self::importeDesdeCentavos($expenses),
                'resultado' => self::importeDesdeCentavos($income - $expenses),
                'pagos_estimados' => $estimatedByMonth[$month],
            ];
            $totFees += $fees;
            $totRegistrations += $registrations;
            $totOther += $other;
            $totExpenses += $expenses;
            $totEstimated += $estimatedByMonth[$month];
        }

        $selectedFees = $feesByMonth[$selectedMonth] ?? 0;
        $selectedRegistrations = $registrationsByMonth[$selectedMonth] ?? 0;
        $selectedPartners = $selectedFees + $selectedRegistrations;
        $selectedOther = $otherByMonth[$selectedMonth] ?? 0;
        $selectedExpenses = $expensesByMonth[$selectedMonth] ?? 0;
        $selectedIncome = $selectedPartners + $selectedOther;
        $totalPartners = $totFees + $totRegistrations;
        $totalIncome = $totalPartners + $totOther;

        $incomeCategories = self::resumenCategoriasIngresos($db, $year, $selectedMonth);
        $expenseCategories = self::resumenCategoriasEgresos($db, $year, $selectedMonth);
        $means = self::resumenMedios($db, $year, $selectedMonth);
        $sumRows = static function (array $rows): int {
            $total = 0;
            foreach ($rows as $row) $total += self::centavos($row['total'] ?? 0);
            return $total;
        };
        if ($sumRows($incomeCategories) !== $selectedIncome) {
            api_error('El desglose mensual de ingresos no coincide con el total.', 'CONTABLE_DESCUADRE_CATEGORIAS_INGRESOS', 500);
        }
        if ($sumRows($expenseCategories) !== $selectedExpenses) {
            api_error('El desglose mensual de egresos no coincide con el total.', 'CONTABLE_DESCUADRE_CATEGORIAS_EGRESOS', 500);
        }
        if ($sumRows($means) !== $selectedIncome) {
            api_error('El desglose mensual por medios de cobro no coincide con el total.', 'CONTABLE_DESCUADRE_MEDIOS_RESUMEN', 500);
        }
        $monthIncomeSum = $monthExpenseSum = 0;
        foreach ($months as $row) {
            $monthIncomeSum += self::centavos($row['ingresos']);
            $monthExpenseSum += self::centavos($row['egresos']);
            if (self::centavos($row['resultado']) !== self::centavos($row['ingresos']) - self::centavos($row['egresos'])) {
                api_error('El resultado de un mes no coincide con ingresos menos egresos.', 'CONTABLE_DESCUADRE_RESULTADO_MENSUAL', 500);
            }
        }
        if ($monthIncomeSum !== $totalIncome || $monthExpenseSum !== $totExpenses) {
            api_error('Los totales anuales no coinciden con la suma mensual.', 'CONTABLE_DESCUADRE_ANUAL', 500);
        }

        return [
            'anio' => $year,
            'mes_seleccionado' => $selectedMonth,
            'totales_mes' => [
                'mes' => $selectedMonth,
                'nombre' => self::nombreMes($selectedMonth),
                'ingresos_cuotas' => self::importeDesdeCentavos($selectedFees),
                'ingresos_inscripciones' => self::importeDesdeCentavos($selectedRegistrations),
                'ingresos_socios' => self::importeDesdeCentavos($selectedPartners),
                'otros_ingresos' => self::importeDesdeCentavos($selectedOther),
                'ingresos' => self::importeDesdeCentavos($selectedIncome),
                'egresos' => self::importeDesdeCentavos($selectedExpenses),
                'resultado' => self::importeDesdeCentavos($selectedIncome - $selectedExpenses),
                'pagos_estimados' => $estimatedByMonth[$selectedMonth] ?? 0,
            ],
            'totales' => [
                'ingresos_cuotas' => self::importeDesdeCentavos($totFees),
                'ingresos_inscripciones' => self::importeDesdeCentavos($totRegistrations),
                'ingresos_socios' => self::importeDesdeCentavos($totalPartners),
                'otros_ingresos' => self::importeDesdeCentavos($totOther),
                'ingresos' => self::importeDesdeCentavos($totalIncome),
                'egresos' => self::importeDesdeCentavos($totExpenses),
                'resultado' => self::importeDesdeCentavos($totalIncome - $totExpenses),
                'pagos_estimados' => $totEstimated,
            ],
            'meses' => $months,
            'detalle_mes' => [
                'categorias_ingresos' => $incomeCategories,
                'categorias_egresos' => $expenseCategories,
                'medios' => $means,
                'pagos_estimados' => $estimatedByMonth[$selectedMonth] ?? 0,
            ],
        ];
    }

    /**
     * Caja histórica de cuotas. La categoría/cobrador de un socio puede cambiar
     * con el tiempo, pero un resumen viejo debe conservar la clasificación que
     * correspondía en la fecha en que se cobró.
     *
     * @return array<int,array{mes:int,monto_cents:int,categoria:string,medio:string,estimado:bool}>
     */
    private static function pagosHistoricosContables(PDO $db, string $start, string $endExclusive): array
    {
        static $cache = [];
        $key = spl_object_id($db) . '|' . $start . '|' . $endExclusive;
        if (isset($cache[$key])) return $cache[$key];

        $statement = $db->prepare(
            "SELECT p.id_pago, p.id_socio, p.id_periodo, p.anio_aplicado,
                    p.fecha_pago, p.monto,
                    COALESCE(NULLIF(mp.nombre,''), 'SIN MEDIO ESPECIFICADO') AS medio
             FROM pagos p
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.estado = 'PAGADO'
               AND p.fecha_pago >= ?
               AND p.fecha_pago < ?
             ORDER BY p.fecha_pago, p.id_pago"
        );
        $statement->execute([$start, $endExclusive]);

        $rows = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $date = substr((string)$row['fecha_pago'], 0, 10);
            $partnerId = (int)$row['id_socio'];
            $historical = self::snapshotSociosEnFecha($db, $date)[$partnerId] ?? [];
            $categoryId = (int)($historical['id_categoria'] ?? 0);
            $categoryName = trim((string)($historical['categoria'] ?? '')) ?: 'SIN CATEGORÍA';

            $periodId = (int)$row['id_periodo'];
            $year = (int)$row['anio_aplicado'];
            $referenceDate = sprintf(
                '%04d-%02d-01',
                $year,
                $periodId === 7 ? 1 : (($periodId - 1) * 2 + 1)
            );
            $fallback = $categoryId > 0
                ? self::precioHistorico(
                    $db,
                    $categoryId,
                    $periodId === 7 ? 'anual' : 'mensual',
                    $referenceDate
                )
                : 0.0;
            $amount = $row['monto'] === null
                ? self::centavos($fallback)
                : self::centavos($row['monto']);

            $rows[] = [
                'mes' => (int)substr($date, 5, 2),
                'monto_cents' => $amount,
                'categoria' => $categoryName,
                'medio' => (string)$row['medio'],
                'estimado' => $row['monto'] === null,
            ];
        }
        return $cache[$key] = $rows;
    }

    private static function acumularTotalesMensuales(PDO $db, string $sql, array $params, array &$target): void
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        foreach ($statement->fetchAll() as $row) {
            $month = (int)($row['mes'] ?? 0);
            if ($month >= 1 && $month <= 12) $target[$month] += self::centavos($row['total'] ?? 0);
        }
    }

    private static function acumularConteosMensuales(PDO $db, string $sql, array $params, array &$target): void
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        foreach ($statement->fetchAll() as $row) {
            $month = (int)($row['mes'] ?? 0);
            if ($month >= 1 && $month <= 12) $target[$month] += (int)($row['total'] ?? 0);
        }
    }

    private static function resumenCategoriasIngresos(PDO $db, int $year, int $month): array
    {
        [$start, $end] = self::rangoMes($year, $month);
        $totals = [];
        foreach (self::pagosHistoricosContables($db, $start, $end) as $payment) {
            $name = 'CUOTAS · ' . ((string)$payment['categoria'] ?: 'SIN CATEGORÍA');
            $totals[$name] = ($totals[$name] ?? 0) + (int)$payment['monto_cents'];
        }
        self::acumularAgrupacion(
            $db,
            "SELECT 'INSCRIPCIONES' AS nombre, SUM(monto) AS total
             FROM pagos_inscripcion WHERE fecha_pago >= ? AND fecha_pago < ? HAVING SUM(monto) IS NOT NULL",
            [$start, $end], $totals
        );
        self::acumularAgrupacion(
            $db,
            "SELECT CONCAT('OTROS · ', COALESCE(NULLIF(categoria, ''), 'SIN CATEGORÍA')) AS nombre, SUM(importe) AS total
             FROM contable_ingresos WHERE fecha >= ? AND fecha < ? GROUP BY categoria",
            [$start, $end], $totals
        );
        return self::agruparRespuesta($totals);
    }

    private static function resumenCategoriasEgresos(PDO $db, int $year, int $month): array
    {
        [$start, $end] = self::rangoMes($year, $month);
        $totals = [];
        self::acumularAgrupacion(
            $db,
            "SELECT COALESCE(NULLIF(categoria, ''), 'SIN CATEGORÍA') AS nombre, SUM(importe) AS total
             FROM contable_egresos WHERE fecha >= ? AND fecha < ? GROUP BY categoria",
            [$start, $end], $totals
        );
        return self::agruparRespuesta($totals);
    }

    private static function resumenMedios(PDO $db, int $year, int $month): array
    {
        [$start, $end] = self::rangoMes($year, $month);
        $totals = [];
        foreach (self::pagosHistoricosContables($db, $start, $end) as $payment) {
            $name = trim((string)$payment['medio']) ?: 'SIN MEDIO ESPECIFICADO';
            $totals[$name] = ($totals[$name] ?? 0) + (int)$payment['monto_cents'];
        }
        self::acumularAgrupacion(
            $db,
            "SELECT COALESCE(NULLIF(mp.nombre, ''), 'SIN MEDIO ESPECIFICADO') AS nombre, SUM(pi.monto) AS total
             FROM pagos_inscripcion pi LEFT JOIN medios_pago mp ON mp.id_medio_pago = pi.id_medio_pago
             WHERE pi.fecha_pago >= ? AND pi.fecha_pago < ?
             GROUP BY mp.id_medio_pago, mp.nombre",
            [$start, $end], $totals
        );
        self::acumularAgrupacion(
            $db,
            "SELECT COALESCE(NULLIF(mp.nombre, ''), 'SIN MEDIO ESPECIFICADO') AS nombre, SUM(i.importe) AS total
             FROM contable_ingresos i LEFT JOIN medios_pago mp ON mp.id_medio_pago = i.id_medio_pago
             WHERE i.fecha >= ? AND i.fecha < ?
             GROUP BY mp.id_medio_pago, mp.nombre",
            [$start, $end], $totals
        );
        return self::agruparRespuesta($totals);
    }

    private static function acumularAgrupacion(PDO $db, string $sql, array $params, array &$target): void
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        foreach ($statement->fetchAll() as $row) {
            $name = trim((string)($row['nombre'] ?? '')) ?: 'SIN CLASIFICAR';
            $target[$name] = ($target[$name] ?? 0) + self::centavos($row['total'] ?? 0);
        }
    }

    private static function agruparRespuesta(array $totals): array
    {
        arsort($totals, SORT_NUMERIC);
        $response = [];
        foreach ($totals as $name => $cents) {
            $response[] = ['nombre' => $name, 'total' => self::importeDesdeCentavos((int)$cents)];
        }
        return $response;
    }

    protected static function listarIngresosDatos(PDO $db, array $filters): array
    {
        return self::listarMovimientosManuales($db, 'ingreso', $filters);
    }

    protected static function listarEgresosDatos(PDO $db, array $filters): array
    {
        return self::listarMovimientosManuales($db, 'egreso', $filters);
    }

    private static function listarMovimientosManuales(PDO $db, string $type, array $filters): array
    {
        $isIncome = $type === 'ingreso';
        $table = $isIncome ? 'contable_ingresos' : 'contable_egresos';
        $idColumn = $isIncome ? 'id_ingreso' : 'id_egreso';
        $categoryType = $isIncome ? 'CATEGORIA_INGRESO' : 'CATEGORIA_EGRESO';
        $conceptType = $isIncome ? 'CONCEPTO_INGRESO' : 'CONCEPTO_EGRESO';
        $year = self::filtroAnio($filters['anio'] ?? null);
        $month = self::filtroMes($filters['mes'] ?? date('n'));
        $search = self::textoBusqueda($filters['buscar'] ?? '');
        $categoryId = self::idOpcional($filters['categoria'] ?? null, 'categoría');
        $meanId = self::idOpcional($filters['medio'] ?? null, 'medio de pago');
        [$start, $end] = self::rangoMes($year, $month);

        $where = ['m.fecha >= ?', 'm.fecha < ?'];
        $params = [$start, $end];
        if ($categoryId !== null) {
            $category = self::opcion($db, $categoryId, $categoryType);
            $where[] = 'm.categoria = ?';
            $params[] = $category['nombre'];
        }
        if ($meanId !== null) {
            $where[] = 'm.id_medio_pago = ?';
            $params[] = $meanId;
        }
        $manualSearchExpression = $isIncome
            ? "CONCAT_WS(' ', m.proveedor, m.categoria, m.concepto, mp.nombre, m.detalle) LIKE {param}"
            : "CONCAT_WS(' ', m.proveedor, m.categoria, m.concepto, mp.nombre, m.detalle, m.numero_comprobante) LIKE {param}";
        $searchFilter = build_search_filter($search, [$manualSearchExpression], 160, null);
        if ($searchFilter['sql'] !== '') {
            $where[] = $searchFilter['sql'];
            array_push($params, ...$searchFilter['params']);
        }

        $extra = $isIncome ? "'' AS numero_comprobante, NULL AS archivo_path" : 'm.numero_comprobante, m.archivo_path';
        $statement = $db->prepare(
            "SELECT m.{$idColumn}, m.fecha, m.id_medio_pago, m.proveedor, m.categoria,
                    m.concepto, m.importe, m.detalle, m.creado_en, m.actualizado_en,
                    COALESCE(NULLIF(mp.nombre, ''), 'SIN ESPECIFICAR') AS medio,
                    (SELECT o.id_opcion FROM contable_opciones o WHERE o.tipo = 'PROVEEDOR' AND o.nombre = m.proveedor LIMIT 1) AS id_proveedor,
                    (SELECT o.id_opcion FROM contable_opciones o WHERE o.tipo = '{$categoryType}' AND o.nombre = m.categoria LIMIT 1) AS id_categoria,
                    (SELECT o.id_opcion FROM contable_opciones o WHERE o.tipo = '{$conceptType}' AND o.nombre = m.concepto LIMIT 1) AS id_concepto,
                    {$extra}
             FROM {$table} m LEFT JOIN medios_pago mp ON mp.id_medio_pago = m.id_medio_pago
             WHERE " . implode(' AND ', $where) . " ORDER BY m.fecha DESC, m.{$idColumn} DESC"
        );
        $statement->execute($params);

        $items = [];
        $total = 0;
        $categories = [];
        foreach ($statement->fetchAll() as $row) {
            $amountCents = self::centavos($row['importe'] ?? 0);
            $categoryName = $row['categoria'] === null ? null : (string)$row['categoria'];
            $item = [
                $idColumn => (int)$row[$idColumn],
                'fecha' => (string)$row['fecha'],
                'id_medio_pago' => $row['id_medio_pago'] === null ? null : (int)$row['id_medio_pago'],
                'id_proveedor' => $row['id_proveedor'] === null ? null : (int)$row['id_proveedor'],
                'id_categoria' => $row['id_categoria'] === null ? null : (int)$row['id_categoria'],
                'id_concepto' => $row['id_concepto'] === null ? null : (int)$row['id_concepto'],
                'medio' => (string)$row['medio'],
                'proveedor' => $row['proveedor'] === null ? null : (string)$row['proveedor'],
                'categoria' => $categoryName,
                'concepto' => $row['concepto'] === null ? null : (string)$row['concepto'],
                'detalle' => $row['detalle'] === null ? '' : (string)$row['detalle'],
                'importe' => self::importeDesdeCentavos($amountCents),
                'creado_en' => (string)$row['creado_en'],
                'actualizado_en' => (string)$row['actualizado_en'],
            ];
            if (!$isIncome) {
                $path = trim((string)($row['archivo_path'] ?? ''));
                $item['numero_comprobante'] = $row['numero_comprobante'] === null ? '' : (string)$row['numero_comprobante'];
                $item['archivo_nombre'] = $path === '' ? '' : basename(str_replace('\\', '/', $path));
                $item['tiene_archivo'] = $path !== '';
            }
            $items[] = $item;
            $total += $amountCents;
            $summaryCategory = $categoryName === null || trim($categoryName) === '' ? 'SIN CATEGORÍA' : $categoryName;
            if (!isset($categories[$summaryCategory])) $categories[$summaryCategory] = ['registros' => 0, 'total' => 0];
            $categories[$summaryCategory]['registros']++;
            $categories[$summaryCategory]['total'] += $amountCents;
        }

        return [
            'items' => $items,
            'resumen' => [
                'registros' => count($items),
                'importe' => self::importeDesdeCentavos($total),
                'categorias' => self::categoriasDesdeAcumulado($categories),
            ],
            'periodo' => ['anio' => $year, 'mes' => $month, 'nombre' => self::nombreMes($month)],
        ];
    }

    private static function categoriasDesdeAcumulado(array $categories): array
    {
        uasort($categories, static fn(array $a, array $b): int => $b['total'] <=> $a['total']);
        $response = [];
        foreach ($categories as $name => $values) {
            $response[] = [
                'nombre' => $name,
                'registros' => (int)$values['registros'],
                'total' => self::importeDesdeCentavos((int)$values['total']),
            ];
        }
        return $response;
    }
}
