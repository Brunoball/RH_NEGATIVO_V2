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
        $partnerByMonth = array_fill(1, 12, 0);
        $otherByMonth = array_fill(1, 12, 0);
        $expensesByMonth = array_fill(1, 12, 0);
        $estimatedByMonth = array_fill(1, 12, 0);
        $paymentAmount = self::importePagoSql();

        self::acumularTotalesMensuales(
            $db,
            "SELECT MONTH(p.fecha_pago) AS mes, SUM({$paymentAmount}) AS total
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             WHERE p.estado = 'PAGADO'
               AND p.fecha_pago >= ? AND p.fecha_pago < ?
             GROUP BY MONTH(p.fecha_pago)",
            [$yearStart, $yearEnd],
            $partnerByMonth
        );
        self::acumularConteosMensuales(
            $db,
            "SELECT MONTH(fecha_pago) AS mes, COUNT(*) AS total
             FROM pagos
             WHERE estado = 'PAGADO'
               AND monto IS NULL AND fecha_pago >= ? AND fecha_pago < ?
             GROUP BY MONTH(fecha_pago)",
            [$yearStart, $yearEnd],
            $estimatedByMonth
        );
        self::acumularTotalesMensuales(
            $db,
            'SELECT MONTH(fecha) AS mes, SUM(importe) AS total
             FROM contable_ingresos
             WHERE fecha >= ? AND fecha < ?
             GROUP BY MONTH(fecha)',
            [$yearStart, $yearEnd],
            $otherByMonth
        );
        self::acumularTotalesMensuales(
            $db,
            'SELECT MONTH(fecha) AS mes, SUM(importe) AS total
             FROM contable_egresos
             WHERE fecha >= ? AND fecha < ?
             GROUP BY MONTH(fecha)',
            [$yearStart, $yearEnd],
            $expensesByMonth
        );

        $months = [];
        $totalPartner = 0;
        $totalOther = 0;
        $totalExpenses = 0;
        $totalEstimated = 0;
        foreach (range(1, 12) as $month) {
            $partner = $partnerByMonth[$month];
            $other = $otherByMonth[$month];
            $expenses = $expensesByMonth[$month];
            $income = $partner + $other;
            $months[] = [
                'mes' => $month,
                'nombre' => self::nombreMes($month),
                'ingresos_socios' => self::importeDesdeCentavos($partner),
                'otros_ingresos' => self::importeDesdeCentavos($other),
                'ingresos' => self::importeDesdeCentavos($income),
                'egresos' => self::importeDesdeCentavos($expenses),
                'resultado' => self::importeDesdeCentavos($income - $expenses),
                'pagos_estimados' => $estimatedByMonth[$month],
            ];
            $totalPartner += $partner;
            $totalOther += $other;
            $totalExpenses += $expenses;
            $totalEstimated += $estimatedByMonth[$month];
        }

        $income = $totalPartner + $totalOther;
        $selectedPartner = $partnerByMonth[$selectedMonth] ?? 0;
        $selectedOther = $otherByMonth[$selectedMonth] ?? 0;
        $selectedExpenses = $expensesByMonth[$selectedMonth] ?? 0;
        $selectedIncome = $selectedPartner + $selectedOther;

        return [
            'anio' => $year,
            'mes_seleccionado' => $selectedMonth,
            'totales_mes' => [
                'mes' => $selectedMonth,
                'nombre' => self::nombreMes($selectedMonth),
                'ingresos_socios' => self::importeDesdeCentavos($selectedPartner),
                'otros_ingresos' => self::importeDesdeCentavos($selectedOther),
                'ingresos' => self::importeDesdeCentavos($selectedIncome),
                'egresos' => self::importeDesdeCentavos($selectedExpenses),
                'resultado' => self::importeDesdeCentavos($selectedIncome - $selectedExpenses),
                'pagos_estimados' => $estimatedByMonth[$selectedMonth] ?? 0,
            ],
            'totales' => [
                'ingresos_socios' => self::importeDesdeCentavos($totalPartner),
                'otros_ingresos' => self::importeDesdeCentavos($totalOther),
                'ingresos' => self::importeDesdeCentavos($income),
                'egresos' => self::importeDesdeCentavos($totalExpenses),
                'resultado' => self::importeDesdeCentavos($income - $totalExpenses),
                'pagos_estimados' => $totalEstimated,
            ],
            'meses' => $months,
            'detalle_mes' => [
                'categorias_ingresos' => self::resumenCategoriasIngresos($db, $year, $selectedMonth),
                'categorias_egresos' => self::resumenCategoriasEgresos($db, $year, $selectedMonth),
                'medios' => self::resumenMedios($db, $year, $selectedMonth),
                'pagos_estimados' => $estimatedByMonth[$selectedMonth] ?? 0,
            ],
        ];
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
        [$monthStart, $monthEnd] = self::rangoMes($year, $month);
        $totals = [];
        $paymentAmount = self::importePagoSql();

        self::acumularAgrupacion(
            $db,
            "SELECT COALESCE(NULLIF(c.nombre, ''), 'CUOTAS SIN CATEGORÍA') AS nombre,
                    SUM({$paymentAmount}) AS total
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             WHERE p.estado = 'PAGADO'
               AND p.fecha_pago >= ? AND p.fecha_pago < ?
             GROUP BY COALESCE(NULLIF(c.nombre, ''), 'CUOTAS SIN CATEGORÍA')",
            [$monthStart, $monthEnd],
            $totals
        );
        self::acumularAgrupacion(
            $db,
            'SELECT categoria AS nombre, SUM(importe) AS total
             FROM contable_ingresos
             WHERE fecha >= ? AND fecha < ?
             GROUP BY categoria',
            [$monthStart, $monthEnd],
            $totals
        );

        return self::agruparRespuesta($totals);
    }

    private static function resumenCategoriasEgresos(PDO $db, int $year, int $month): array
    {
        [$monthStart, $monthEnd] = self::rangoMes($year, $month);
        $totals = [];
        self::acumularAgrupacion(
            $db,
            'SELECT categoria AS nombre, SUM(importe) AS total
             FROM contable_egresos
             WHERE fecha >= ? AND fecha < ?
             GROUP BY categoria',
            [$monthStart, $monthEnd],
            $totals
        );
        return self::agruparRespuesta($totals);
    }

    private static function resumenMedios(PDO $db, int $year, int $month): array
    {
        [$monthStart, $monthEnd] = self::rangoMes($year, $month);
        $totals = [];
        $paymentAmount = self::importePagoSql();

        self::acumularAgrupacion(
            $db,
            "SELECT COALESCE(NULLIF(mp.nombre, ''), 'SIN MEDIO ESPECIFICADO') AS nombre,
                    SUM({$paymentAmount}) AS total
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.estado = 'PAGADO'
               AND p.fecha_pago >= ? AND p.fecha_pago < ?
             GROUP BY COALESCE(NULLIF(mp.nombre, ''), 'SIN MEDIO ESPECIFICADO')",
            [$monthStart, $monthEnd],
            $totals
        );
        self::acumularAgrupacion(
            $db,
            "SELECT COALESCE(NULLIF(mp.nombre, ''), 'SIN MEDIO ESPECIFICADO') AS nombre,
                    SUM(i.importe) AS total
             FROM contable_ingresos i
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = i.id_medio_pago
             WHERE i.fecha >= ? AND i.fecha < ?
             GROUP BY COALESCE(NULLIF(mp.nombre, ''), 'SIN MEDIO ESPECIFICADO')",
            [$monthStart, $monthEnd],
            $totals
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
            $response[] = ['nombre' => $name, 'total' => self::importeDesdeCentavos($cents)];
        }
        return $response;
    }

    protected static function listarIngresosSociosDatos(PDO $db, array $filters): array
    {
        $year = self::filtroAnio($filters['anio'] ?? null);
        $month = self::filtroMes($filters['mes'] ?? date('n'));
        $search = self::textoBusqueda($filters['buscar'] ?? '');
        $categoryId = self::idOpcional($filters['categoria'] ?? null, 'categoría');
        $meanId = self::idOpcional($filters['medio'] ?? null, 'medio de pago');
        $partnerType = strtoupper(trim((string)($filters['tipo'] ?? '')));
        if ($partnerType !== '' && !in_array($partnerType, ['PERSONA', 'EMPRESA'], true)) {
            api_error('El tipo de socio indicado no es válido.', 'TIPO_SOCIO_INVALIDO', 422);
        }
        [$start, $end] = self::rangoMes($year, $month);
        $paymentAmount = self::importePagoSql();

        $where = ["p.estado = 'PAGADO'", 'p.fecha_pago >= ?', 'p.fecha_pago < ?'];
        $params = [$start, $end];
        if ($partnerType !== '') {
            $where[] = 's.tipo_socio = ?';
            $params[] = $partnerType;
        }
        if ($categoryId !== null) {
            $where[] = 's.id_categoria = ?';
            $params[] = $categoryId;
        }
        if ($meanId !== null) {
            $where[] = 'p.id_medio_pago = ?';
            $params[] = $meanId;
        }
        $searchFilter = build_search_filter(
            $search,
            ["CONCAT_WS(' ',
                sp.apellido, sp.nombre, sp.dni,
                se.razon_social, se.cuit,
                c.nombre, mp.nombre
            ) LIKE {param}"],
            160,
            null
        );
        if ($searchFilter['sql'] !== '') {
            $where[] = $searchFilter['sql'];
            array_push($params, ...$searchFilter['params']);
        }

        $statement = $db->prepare(
            "SELECT
                p.id_pago, p.id_socio, p.anio, p.mes, p.fecha_pago, p.id_medio_pago,
                {$paymentAmount} AS monto_calculado,
                CASE WHEN p.monto IS NULL THEN 1 ELSE 0 END AS monto_estimado,
                s.tipo_socio, s.id_categoria,
                CASE
                    WHEN s.tipo_socio = 'EMPRESA' THEN COALESCE(NULLIF(se.razon_social, ''), CONCAT('EMPRESA #', s.id_socio))
                    ELSE COALESCE(NULLIF(TRIM(CONCAT(COALESCE(sp.apellido, ''), ', ', COALESCE(sp.nombre, ''))), ', '), CONCAT('SOCIO #', s.id_socio))
                END AS socio,
                CASE WHEN s.tipo_socio = 'EMPRESA' THEN se.cuit ELSE sp.dni END AS documento,
                COALESCE(NULLIF(c.nombre, ''), 'SIN CATEGORÍA') AS categoria,
                COALESCE(NULLIF(mp.nombre, ''), 'SIN ESPECIFICAR') AS medio
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN socios_personas sp ON sp.id_socio = s.id_socio
             LEFT JOIN socios_empresas se ON se.id_socio = s.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE " . implode(' AND ', $where) . "
             ORDER BY p.fecha_pago DESC, p.id_pago DESC"
        );
        $statement->execute($params);

        $items = [];
        $total = 0;
        $estimated = 0;
        $categories = [];
        foreach ($statement->fetchAll() as $row) {
            $amountCents = self::centavos($row['monto_calculado'] ?? 0);
            $isEstimated = (bool)$row['monto_estimado'];
            $categoryName = $row['categoria'] === null ? null : (string)$row['categoria'];
            $items[] = [
                'clave' => 'PAGO-' . (int)$row['id_pago'],
                'origen' => $row['tipo_socio'] === 'EMPRESA' ? 'CUOTA_EMPRESA' : 'CUOTA_SOCIO',
                'id_registro' => (int)$row['id_pago'],
                'id_pago' => (int)$row['id_pago'],
                'id_socio' => (int)$row['id_socio'],
                'fecha' => (string)$row['fecha_pago'],
                'socio' => (string)$row['socio'],
                'tipo_socio' => (string)$row['tipo_socio'],
                'documento' => $row['documento'] === null ? '—' : (string)$row['documento'],
                // Se conserva `dni` por compatibilidad con exportaciones/clientes anteriores.
                'dni' => $row['documento'] === null ? '—' : (string)$row['documento'],
                'categoria' => $categoryName,
                'id_categoria' => $row['id_categoria'] === null ? null : (int)$row['id_categoria'],
                'periodo' => self::nombreMes((int)$row['mes']) . ' ' . (int)$row['anio'],
                'anio' => (int)$row['anio'],
                'mes' => (int)$row['mes'],
                'medio' => (string)$row['medio'],
                'id_medio_pago' => $row['id_medio_pago'] === null ? null : (int)$row['id_medio_pago'],
                'monto' => self::importeDesdeCentavos($amountCents),
                'monto_estimado' => $isEstimated,
            ];
            $total += $amountCents;
            if ($isEstimated) $estimated++;
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
                'estimados' => $estimated,
                'categorias' => self::categoriasDesdeAcumulado($categories),
            ],
            'periodo' => ['anio' => $year, 'mes' => $month, 'nombre' => self::nombreMes($month)],
        ];
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
        $searchFilter = build_search_filter(
            $search,
            [$manualSearchExpression],
            160,
            null
        );
        if ($searchFilter['sql'] !== '') {
            $where[] = $searchFilter['sql'];
            array_push($params, ...$searchFilter['params']);
        }

        $extra = $isIncome
            ? "'' AS numero_comprobante, NULL AS archivo_path"
            : 'm.numero_comprobante, m.archivo_path';
        $statement = $db->prepare(
            "SELECT
                m.{$idColumn}, m.fecha, m.id_medio_pago, m.proveedor, m.categoria,
                m.concepto, m.importe, m.detalle, m.creado_en, m.actualizado_en,
                COALESCE(NULLIF(mp.nombre, ''), 'SIN ESPECIFICAR') AS medio,
                (SELECT o.id_opcion FROM contable_opciones o WHERE o.tipo = 'PROVEEDOR' AND o.nombre = m.proveedor LIMIT 1) AS id_proveedor,
                (SELECT o.id_opcion FROM contable_opciones o WHERE o.tipo = '{$categoryType}' AND o.nombre = m.categoria LIMIT 1) AS id_categoria,
                (SELECT o.id_opcion FROM contable_opciones o WHERE o.tipo = '{$conceptType}' AND o.nombre = m.concepto LIMIT 1) AS id_concepto,
                {$extra}
             FROM {$table} m
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = m.id_medio_pago
             WHERE " . implode(' AND ', $where) . "
             ORDER BY m.fecha DESC, m.{$idColumn} DESC"
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
