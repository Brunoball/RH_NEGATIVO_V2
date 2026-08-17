<?php
declare(strict_types=1);

/**
 * Informes de socios usados por Contabilidad.
 *
 * Regla de oro:
 * - Caja / ingresos => fecha real del movimiento (`fecha_pago`).
 * - Obligaciones / deuda => año aplicado + período.
 * Nunca se usa `creado_en` para decidir a qué período pertenece un importe.
 */
trait ContableSocios
{
    abstract protected static function filtroAnio(mixed $value): int;
    abstract protected static function filtroPeriodo(mixed $value): int;
    abstract protected static function rangoPeriodo(int $year, int $periodId): array;
    abstract protected static function etiquetaPeriodo(int $periodId, int $year, bool $withWord = false): string;
    abstract protected static function mesesPeriodo(int $periodId): string;
    abstract protected static function precioHistorico(PDO $db, int $categoryId, string $type, string $date): float;
    abstract protected static function centavos(mixed $value): int;
    abstract protected static function importeDesdeCentavos(int $cents): string;
    abstract protected static function importePagoSql(string $paymentAlias = 'p', string $partnerAlias = 's', string $categoryAlias = 'c'): string;
    abstract protected static function textoBusqueda(mixed $value): string;
    abstract protected static function idOpcional(mixed $value, string $label): ?int;

    protected static function ingresosSociosDatos(PDO $db, array $filters): array
    {
        $year = self::filtroAnio($filters['anio'] ?? null);
        $periodId = self::filtroPeriodo($filters['periodo'] ?? null);
        [$start, $endExclusive] = self::rangoPeriodo($year, $periodId);
        $endInclusive = (new DateTimeImmutable($endExclusive))->modify('-1 day')->format('Y-m-d');

        $detail = self::detalleCobrosSocios($db, $year, $periodId, $start, $endExclusive, $filters);
        $partners = self::detallePadronSocios($db, $year);
        $collection = self::detalleCobranza($db, $year, $periodId, $start, $endExclusive);

        // Identidades contables: si se incumplen por un cambio futuro, no se
        // devuelve un informe inconsistente a la contadora.
        $fees = self::centavos($collection['resumen']['cuotas_recaudadas']);
        $registrations = self::centavos($collection['resumen']['inscripciones_recaudadas']);
        $totalIncome = self::centavos($collection['resumen']['total_ingresado']);
        if ($fees + $registrations !== $totalIncome) {
            api_error('La conciliación interna de ingresos no coincide.', 'CONTABLE_DESCUADRE_INGRESOS', 500);
        }
        $expected = self::centavos($collection['resumen']['cuotas_esperadas']);
        $difference = self::centavos($collection['resumen']['diferencia_cuotas']);
        if ($expected - $fees !== $difference) {
            api_error('La conciliación interna de cobranza no coincide.', 'CONTABLE_DESCUADRE_COBRANZA', 500);
        }
        if (self::centavos($detail['resumen_general']['importe'] ?? 0) !== $fees) {
            api_error('El detalle de cobros no coincide con la recaudación de cuotas.', 'CONTABLE_DESCUADRE_DETALLE_COBROS', 500);
        }
        $partnerSummary = $partners['resumen'] ?? [];
        $classifiedPartners = (int)($partnerSummary['activos'] ?? 0)
            + (int)($partnerSummary['pasivos'] ?? 0)
            + (int)($partnerSummary['sin_estado'] ?? 0);
        if ((int)($partnerSummary['total'] ?? 0) !== $classifiedPartners) {
            api_error('La clasificación del padrón de socios no coincide.', 'CONTABLE_DESCUADRE_PADRON', 500);
        }

        return [
            'periodo' => [
                'anio' => $year,
                'id_periodo' => $periodId,
                'etiqueta' => self::etiquetaPeriodo($periodId, $year, true),
                'meses' => self::mesesPeriodo($periodId),
                'desde' => $start,
                'hasta' => $endInclusive,
            ],
            'detalle' => $detail,
            'socios' => $partners,
            'cobranza' => $collection,
        ];
    }

    private static function detalleCobrosSocios(
        PDO $db,
        int $year,
        int $periodId,
        string $start,
        string $endExclusive,
        array $filters
    ): array {
        $search = self::textoBusqueda($filters['buscar'] ?? '');
        $categoryId = self::idOpcional($filters['categoria'] ?? null, 'categoría');
        $meanId = self::idOpcional($filters['medio'] ?? null, 'medio de pago');
        $page = filter_var($filters['pagina'] ?? 1, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);
        if ($page === false) {
            api_error('La página solicitada no es válida.', 'PAGINA_INVALIDA');
        }
        $page = (int)$page;
        $perPage = 100;
        $paymentAmount = self::importePagoSql();

        // Caja / ingresos siempre se determina por la fecha real de cobro.
        // Contado Anual agrega la modalidad como filtro, pero sigue respetando
        // el año de caja seleccionado (puede incluir un anual aplicado a otro año).
        $baseWhere = ["p.estado = 'PAGADO'", 'p.fecha_pago >= ?', 'p.fecha_pago < ?'];
        $baseParams = [$start, $endExclusive];
        if ($periodId === 7) {
            $baseWhere[] = 'p.id_periodo = 7';
        }

        $where = $baseWhere;
        $params = $baseParams;
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
            ["CONCAT_WS(' ', s.nombre, s.dni, c.nombre, cb.nombre, mp.nombre, pe.nombre, p.anio_aplicado) LIKE {param}"],
            160,
            null
        );
        if ($searchFilter['sql'] !== '') {
            $where[] = $searchFilter['sql'];
            array_push($params, ...$searchFilter['params']);
        }

        $fromSql =
            ' FROM pagos p' .
            ' INNER JOIN socios s ON s.id_socio = p.id_socio' .
            ' LEFT JOIN categoria c ON c.id_categoria = s.id_categoria' .
            ' LEFT JOIN cobrador cb ON cb.id_cobrador = s.id_cobrador' .
            ' LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago' .
            ' LEFT JOIN periodo pe ON pe.id_periodo = p.id_periodo';

        $summaryStatement = $db->prepare(
            "SELECT COUNT(*) AS registros,
                    COUNT(DISTINCT p.id_socio) AS socios_distintos,
                    COALESCE(SUM({$paymentAmount}), 0) AS importe
             {$fromSql}
             WHERE " . implode(' AND ', $where)
        );
        $summaryStatement->execute($params);
        $summaryRow = $summaryStatement->fetch(PDO::FETCH_ASSOC) ?: [];
        $totalRecords = (int)($summaryRow['registros'] ?? 0);
        $totalPages = $totalRecords > 0 ? (int)ceil($totalRecords / $perPage) : 0;
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        $offset = ($page - 1) * $perPage;

        // Este total sin filtros de búsqueda se conserva para las identidades
        // contables internas. La paginación o una búsqueda nunca deben hacer
        // parecer que el detalle dejó de conciliar con la cobranza completa.
        $generalStatement = $db->prepare(
            "SELECT COUNT(*) AS registros,
                    COUNT(DISTINCT p.id_socio) AS socios_distintos,
                    COALESCE(SUM({$paymentAmount}), 0) AS importe
             {$fromSql}
             WHERE " . implode(' AND ', $baseWhere)
        );
        $generalStatement->execute($baseParams);
        $generalRow = $generalStatement->fetch(PDO::FETCH_ASSOC) ?: [];

        $statement = $db->prepare(
            "SELECT p.id_pago, p.id_socio, p.id_periodo, p.anio_aplicado, p.fecha_pago,
                    p.id_medio_pago, {$paymentAmount} AS monto_calculado,
                    CASE WHEN p.monto IS NULL THEN 1 ELSE 0 END AS monto_estimado,
                    s.nombre AS socio, s.dni, s.id_categoria,
                    COALESCE(NULLIF(c.nombre,''), 'SIN CATEGORÍA') AS categoria_nombre,
                    COALESCE(NULLIF(cb.nombre,''), 'SIN COBRADOR') AS cobrador,
                    COALESCE(NULLIF(mp.nombre,''), 'SIN MEDIO ESPECIFICADO') AS medio
             {$fromSql}
             WHERE " . implode(' AND ', $where) . "
             ORDER BY p.fecha_pago DESC, p.creado_en DESC, p.id_pago DESC
             LIMIT {$perPage} OFFSET {$offset}"
        );
        $statement->execute($params);

        $items = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $appliedPeriod = (int)$row['id_periodo'];
            $appliedYear = (int)$row['anio_aplicado'];
            $referenceDate = sprintf(
                '%04d-%02d-01',
                $appliedYear,
                $appliedPeriod === 7 ? 1 : (($appliedPeriod - 1) * 2 + 1)
            );
            $historicalCategory = self::precioHistorico(
                $db,
                (int)$row['id_categoria'],
                $appliedPeriod === 7 ? 'anual' : 'mensual',
                $referenceDate
            );
            $amount = self::centavos($row['monto_calculado'] ?? 0);
            $items[] = [
                'clave' => 'PAGO-' . (int)$row['id_pago'],
                'id_pago' => (int)$row['id_pago'],
                'id_socio' => (int)$row['id_socio'],
                'socio' => (string)$row['socio'],
                'dni' => $row['dni'] === null ? '' : (string)$row['dni'],
                'categoria' => (string)$row['categoria_nombre'],
                'categoria_monto_historico' => number_format($historicalCategory, 2, '.', ''),
                'categoria_etiqueta' => (string)$row['categoria_nombre'] . ' (' . number_format($historicalCategory, 0, ',', '.') . ')',
                'cobrador' => (string)$row['cobrador'],
                'fecha' => (string)$row['fecha_pago'],
                'periodo' => self::etiquetaPeriodo($appliedPeriod, $appliedYear),
                'id_periodo' => $appliedPeriod,
                'anio_aplicado' => $appliedYear,
                'medio' => (string)$row['medio'],
                'id_medio_pago' => $row['id_medio_pago'] === null ? null : (int)$row['id_medio_pago'],
                'monto' => self::importeDesdeCentavos($amount),
                'monto_estimado' => (bool)$row['monto_estimado'],
            ];
        }

        return [
            'items' => $items,
            'resumen' => [
                'registros' => $totalRecords,
                'socios_distintos' => (int)($summaryRow['socios_distintos'] ?? 0),
                'importe' => self::importeDesdeCentavos(self::centavos($summaryRow['importe'] ?? 0)),
            ],
            'resumen_general' => [
                'registros' => (int)($generalRow['registros'] ?? 0),
                'socios_distintos' => (int)($generalRow['socios_distintos'] ?? 0),
                'importe' => self::importeDesdeCentavos(self::centavos($generalRow['importe'] ?? 0)),
            ],
            'paginacion' => [
                'pagina' => $page,
                'por_pagina' => $perPage,
                'total' => $totalRecords,
                'total_paginas' => $totalPages,
                'desde' => $totalRecords === 0 || $offset >= $totalRecords ? 0 : $offset + 1,
                'hasta' => $totalRecords === 0 || $offset >= $totalRecords ? 0 : min($offset + count($items), $totalRecords),
                'tiene_anterior' => $page > 1,
                'tiene_siguiente' => $page < $totalPages,
            ],
        ];
    }

    private static function detallePadronSocios(PDO $db, int $year): array
    {
        $rows = $db->query(
            "SELECT s.id_socio,
                    COALESCE(NULLIF(e.nombre,''), 'SIN ESTADO') AS estado,
                    COALESCE(NULLIF(gs.nombre,''), 'SIN GRUPO') AS grupo
             FROM socios s
             LEFT JOIN estado e ON e.id_estado = s.id_estado
             LEFT JOIN grupo_sanguineo gs ON gs.id_grupo_sanguineo = s.id_grupo_sanguineo
             WHERE s.vigente = 1
             ORDER BY estado, grupo, s.id_socio"
        )->fetchAll(PDO::FETCH_ASSOC);

        $states = ['ACTIVO' => 0, 'PASIVO' => 0, 'SIN ESTADO' => 0];
        $groups = [];
        foreach ($rows as $row) {
            $state = strtoupper(trim((string)$row['estado'])) ?: 'SIN ESTADO';
            if (!isset($states[$state])) $states[$state] = 0;
            $states[$state]++;
            $group = trim((string)$row['grupo']) ?: 'SIN GRUPO';
            $key = $state . '|' . $group;
            if (!isset($groups[$key])) $groups[$key] = ['servicio' => $state, 'categoria' => $group, 'cantidad' => 0];
            $groups[$key]['cantidad']++;
        }
        usort($groups, static function (array $a, array $b): int {
            $order = ['ACTIVO' => 1, 'PASIVO' => 2, 'SIN ESTADO' => 3];
            return [$order[$a['servicio']] ?? 9, $a['categoria']] <=> [$order[$b['servicio']] ?? 9, $b['categoria']];
        });

        return [
            'anio' => $year,
            'resumen' => [
                'activos' => (int)($states['ACTIVO'] ?? 0),
                'pasivos' => (int)($states['PASIVO'] ?? 0),
                'sin_estado' => (int)($states['SIN ESTADO'] ?? 0),
                'total' => count($rows),
            ],
            'items' => array_values($groups),
        ];
    }

    private static function detalleCobranza(PDO $db, int $year, int $periodId, string $start, string $endExclusive): array
    {
        $endInclusive = (new DateTimeImmutable($endExclusive))->modify('-1 day')->format('Y-m-d');
        $partners = $db->query(
            "SELECT s.id_socio, s.id_categoria,
                    COALESCE(NULLIF(cb.nombre,''), 'SIN COBRADOR') AS cobrador,
                    COALESCE(NULLIF(e.nombre,''), 'SIN ESTADO') AS estado
             FROM socios s
             LEFT JOIN cobrador cb ON cb.id_cobrador = s.id_cobrador
             LEFT JOIN estado e ON e.id_estado = s.id_estado
             WHERE s.vigente = 1
             ORDER BY cobrador, estado, s.id_socio"
        )->fetchAll(PDO::FETCH_ASSOC);

        $expectedTotal = 0;
        $expectedGroups = [];
        foreach ($partners as $partner) {
            $partnerId = (int)$partner['id_socio'];
            $base = self::precioHistorico($db, (int)$partner['id_categoria'], $periodId === 7 ? 'anual' : 'mensual', $start);
            $discount = self::porcentajeDescuentoSocio($db, $partnerId, $start, true);
            $expected = self::centavos(round($base * (1 - $discount / 100), 2));
            $expectedTotal += $expected;
            $collector = (string)$partner['cobrador'];
            $state = (string)$partner['estado'];
            if (!isset($expectedGroups[$collector])) $expectedGroups[$collector] = ['expected' => 0, 'partners' => 0, 'states' => []];
            $expectedGroups[$collector]['expected'] += $expected;
            $expectedGroups[$collector]['partners']++;
            if (!isset($expectedGroups[$collector]['states'][$state])) {
                $expectedGroups[$collector]['states'][$state] = ['expected' => 0, 'partners' => 0];
            }
            $expectedGroups[$collector]['states'][$state]['expected'] += $expected;
            $expectedGroups[$collector]['states'][$state]['partners']++;
        }

        $paymentAmount = self::importePagoSql();
        $paymentWhere = "p.estado = 'PAGADO' AND p.fecha_pago >= ? AND p.fecha_pago < ?";
        if ($periodId === 7) $paymentWhere .= ' AND p.id_periodo = 7';
        $statement = $db->prepare(
            "SELECT p.id_pago, p.id_socio, p.id_medio_pago, {$paymentAmount} AS monto,
                    COALESCE(NULLIF(cb.nombre,''), 'SIN COBRADOR') AS cobrador,
                    COALESCE(NULLIF(e.nombre,''), 'SIN ESTADO') AS estado,
                    COALESCE(NULLIF(mp.nombre,''), 'SIN MEDIO ESPECIFICADO') AS medio
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN categoria c ON c.id_categoria = s.id_categoria
             LEFT JOIN cobrador cb ON cb.id_cobrador = s.id_cobrador
             LEFT JOIN estado e ON e.id_estado = s.id_estado
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE {$paymentWhere}"
        );
        $statement->execute([$start, $endExclusive]);
        $payments = $statement->fetchAll(PDO::FETCH_ASSOC);

        $collectedTotal = 0;
        $collectedGroups = [];
        foreach ($payments as $payment) {
            $amount = self::centavos($payment['monto'] ?? 0);
            $collectedTotal += $amount;
            $collector = (string)$payment['cobrador'];
            $state = (string)$payment['estado'];
            $mean = (string)$payment['medio'];
            if (!isset($collectedGroups[$collector])) $collectedGroups[$collector] = ['total' => 0, 'states' => []];
            $collectedGroups[$collector]['total'] += $amount;
            if (!isset($collectedGroups[$collector]['states'][$state])) $collectedGroups[$collector]['states'][$state] = ['total' => 0, 'means' => []];
            $collectedGroups[$collector]['states'][$state]['total'] += $amount;
            if (!isset($collectedGroups[$collector]['states'][$state]['means'][$mean])) {
                $collectedGroups[$collector]['states'][$state]['means'][$mean] = ['total' => 0, 'partners' => []];
            }
            $collectedGroups[$collector]['states'][$state]['means'][$mean]['total'] += $amount;
            $collectedGroups[$collector]['states'][$state]['means'][$mean]['partners'][(int)$payment['id_socio']] = true;
        }

        $registrationStatement = $db->prepare(
            'SELECT COUNT(DISTINCT id_socio) AS socios, COALESCE(SUM(monto),0) AS total
             FROM pagos_inscripcion WHERE fecha_pago >= ? AND fecha_pago < ?'
        );
        $registrationStatement->execute([$start, $endExclusive]);
        $registration = $registrationStatement->fetch(PDO::FETCH_ASSOC) ?: ['socios' => 0, 'total' => 0];
        $registrationTotal = self::centavos($registration['total'] ?? 0);

        $hierarchy = [];
        $collectors = array_values(array_unique(array_merge(array_keys($expectedGroups), array_keys($collectedGroups))));
        sort($collectors, SORT_NATURAL | SORT_FLAG_CASE);
        foreach ($collectors as $collector) {
            $expectedCollector = $expectedGroups[$collector] ?? ['expected' => 0, 'partners' => 0, 'states' => []];
            $collectedCollector = $collectedGroups[$collector] ?? ['total' => 0, 'states' => []];
            $children = [];
            $states = array_values(array_unique(array_merge(array_keys($expectedCollector['states']), array_keys($collectedCollector['states']))));
            sort($states, SORT_NATURAL | SORT_FLAG_CASE);
            foreach ($states as $state) {
                $expectedState = $expectedCollector['states'][$state] ?? ['expected' => 0, 'partners' => 0];
                $collectedState = $collectedCollector['states'][$state] ?? ['total' => 0, 'means' => []];
                $means = [];
                foreach ($collectedState['means'] as $mean => $values) {
                    $means[] = [
                        'tipo' => 'medio', 'nombre' => $mean,
                        'esperado' => null,
                        'recaudado' => self::importeDesdeCentavos((int)$values['total']),
                        'socios' => count($values['partners']),
                        'diferencia' => null,
                    ];
                }
                usort($means, static fn(array $a, array $b): int => strnatcasecmp($a['nombre'], $b['nombre']));
                $children[] = [
                    'tipo' => 'estado', 'nombre' => $state,
                    'esperado' => self::importeDesdeCentavos((int)$expectedState['expected']),
                    'recaudado' => self::importeDesdeCentavos((int)$collectedState['total']),
                    'socios' => (int)$expectedState['partners'],
                    'diferencia' => self::importeDesdeCentavos((int)$expectedState['expected'] - (int)$collectedState['total']),
                    'hijos' => $means,
                ];
            }
            $hierarchy[] = [
                'tipo' => 'cobrador', 'nombre' => $collector,
                'esperado' => self::importeDesdeCentavos((int)$expectedCollector['expected']),
                'recaudado' => self::importeDesdeCentavos((int)$collectedCollector['total']),
                'socios' => (int)$expectedCollector['partners'],
                'diferencia' => self::importeDesdeCentavos((int)$expectedCollector['expected'] - (int)$collectedCollector['total']),
                'hijos' => $children,
            ];
        }

        $hierarchyExpected = 0;
        $hierarchyCollected = 0;
        $hierarchyPartners = 0;
        foreach ($hierarchy as $collectorRow) {
            $statesExpected = 0;
            $statesCollected = 0;
            $statesPartners = 0;
            foreach ($collectorRow['hijos'] as $stateRow) {
                $meansCollected = 0;
                foreach ($stateRow['hijos'] as $meanRow) {
                    $meansCollected += self::centavos($meanRow['recaudado']);
                }
                if ($meansCollected !== self::centavos($stateRow['recaudado'])) {
                    api_error('El desglose por medio de pago no coincide con su estado.', 'CONTABLE_DESCUADRE_MEDIOS', 500);
                }
                $statesExpected += self::centavos($stateRow['esperado']);
                $statesCollected += self::centavos($stateRow['recaudado']);
                $statesPartners += (int)$stateRow['socios'];
            }
            if ($statesExpected !== self::centavos($collectorRow['esperado'])
                || $statesCollected !== self::centavos($collectorRow['recaudado'])
                || $statesPartners !== (int)$collectorRow['socios']) {
                api_error('El desglose por estado no coincide con su cobrador.', 'CONTABLE_DESCUADRE_ESTADOS', 500);
            }
            $hierarchyExpected += self::centavos($collectorRow['esperado']);
            $hierarchyCollected += self::centavos($collectorRow['recaudado']);
            $hierarchyPartners += (int)$collectorRow['socios'];
        }
        if ($hierarchyExpected !== $expectedTotal
            || $hierarchyCollected !== $collectedTotal
            || $hierarchyPartners !== count($partners)) {
            api_error('La jerarquía de cobranza no coincide con sus totales.', 'CONTABLE_DESCUADRE_JERARQUIA', 500);
        }

        $categories = $db->query('SELECT id_categoria, nombre FROM categoria WHERE activo = 1 ORDER BY nombre')->fetchAll(PDO::FETCH_ASSOC);
        $categoryAmounts = [];
        foreach ($categories as $category) {
            $id = (int)$category['id_categoria'];
            $categoryAmounts[] = [
                'id_categoria' => $id,
                'nombre' => (string)$category['nombre'],
                'mensual' => number_format(self::precioHistorico($db, $id, 'mensual', $start), 2, '.', ''),
                'anual' => number_format(self::precioHistorico($db, $id, 'anual', sprintf('%04d-01-01', $year)), 2, '.', ''),
            ];
        }

        $totalIncome = $collectedTotal + $registrationTotal;
        return [
            'categorias_monto' => $categoryAmounts,
            'resumen' => [
                'cuotas_recaudadas' => self::importeDesdeCentavos($collectedTotal),
                'inscripciones_recaudadas' => self::importeDesdeCentavos($registrationTotal),
                'inscripciones_socios' => (int)($registration['socios'] ?? 0),
                'cuotas_esperadas' => self::importeDesdeCentavos($expectedTotal),
                'diferencia_cuotas' => self::importeDesdeCentavos($expectedTotal - $collectedTotal),
                'total_ingresado' => self::importeDesdeCentavos($totalIncome),
                'socios_esperados' => count($partners),
                'desde' => $start,
                'hasta' => $endInclusive,
            ],
            'items' => $hierarchy,
        ];
    }

    private static function porcentajeDescuentoSocio(PDO $db, int $partnerId, string $date, bool $historical): float
    {
        static $cache = [];
        $key = spl_object_id($db) . '|' . $partnerId . '|' . $date . '|' . ($historical ? 'H' : 'A');
        if (isset($cache[$key])) return $cache[$key];

        $familySql =
            'SELECT fs.id_familia
             FROM familias_socios fs
             INNER JOIN familias f ON f.id_familia = fs.id_familia
             WHERE fs.id_socio = ?
               AND (fs.desde IS NULL OR fs.desde <= ?)
               AND (fs.hasta IS NULL OR fs.hasta >= ?)';
        if (!$historical) $familySql .= ' AND fs.activo = 1 AND f.activo = 1';
        $familySql .= ' ORDER BY fs.id_familia_socio DESC LIMIT 1';
        $statement = $db->prepare($familySql);
        $statement->execute([$partnerId, $date, $date]);
        $familyId = $statement->fetchColumn();
        if ($familyId === false) return $cache[$key] = 0.0;

        $countSql =
            'SELECT COUNT(DISTINCT fs.id_socio)
             FROM familias_socios fs
             INNER JOIN socios s ON s.id_socio = fs.id_socio
             WHERE fs.id_familia = ?
               AND (fs.desde IS NULL OR fs.desde <= ?)
               AND (fs.hasta IS NULL OR fs.hasta >= ?)';
        if (!$historical) $countSql .= ' AND fs.activo = 1 AND s.vigente = 1';
        $statement = $db->prepare($countSql);
        $statement->execute([(int)$familyId, $date, $date]);
        $count = (int)$statement->fetchColumn();
        if ($count < 2) return $cache[$key] = 0.0;

        $ruleSql =
            'SELECT porcentaje_descuento
             FROM descuentos_familiares
             WHERE vigencia_desde <= ? AND (vigencia_hasta IS NULL OR vigencia_hasta >= ?)
               AND cantidad_integrantes_desde <= ?
               AND (cantidad_integrantes_hasta IS NULL OR cantidad_integrantes_hasta >= ?)';
        if (!$historical) $ruleSql .= ' AND activo = 1';
        $ruleSql .= ' ORDER BY cantidad_integrantes_desde DESC, id_descuento_familiar DESC LIMIT 1';
        $statement = $db->prepare($ruleSql);
        $statement->execute([$date, $date, $count, $count]);
        $percentage = $statement->fetchColumn();
        return $cache[$key] = max(0.0, min(100.0, $percentage === false ? 0.0 : (float)$percentage));
    }

    protected static function balanceDatos(PDO $db, array $filters): array
    {
        $from = valid_date($filters['desde'] ?? null, 'fecha desde');
        $to = valid_date($filters['hasta'] ?? null, 'fecha hasta');
        if ($from > $to) api_error('La fecha Desde no puede ser posterior a Hasta.', 'RANGO_FECHAS_INVALIDO');
        $fromDate = new DateTimeImmutable($from);
        $toDate = new DateTimeImmutable($to);
        if ($fromDate->diff($toDate)->days > 3660) {
            api_error('El rango del balance no puede superar 10 años.', 'RANGO_FECHAS_DEMASIADO_AMPLIO');
        }

        $periods = self::periodosBalance($from, $to);
        if ($periods === []) api_error('El rango no contiene ningún período bimestral.', 'BALANCE_SIN_PERIODOS');

        $registrations = self::balanceInscripciones($db, $from, $to);
        $leavers = self::balanceBajas($db, $from, $to, $periods);
        $debtors = self::balanceDeudores($db, $periods);

        self::validarBalance($registrations, $leavers, $debtors);

        return [
            'desde' => $from,
            'hasta' => $to,
            'titulo' => 'Balance ' . substr($from, 2, 2) . '/' . substr($to, 2, 2),
            'periodos' => $periods,
            'inscripciones' => $registrations,
            'bajas' => $leavers,
            'deudores' => $debtors,
        ];
    }

    private static function periodosBalance(string $from, string $to): array
    {
        $fromYear = (int)substr($from, 0, 4);
        $toYear = (int)substr($to, 0, 4);
        $result = [];
        for ($year = $fromYear; $year <= $toYear; $year++) {
            for ($period = 1; $period <= 6; $period++) {
                [$start, $endExclusive] = self::rangoPeriodo($year, $period);
                $end = (new DateTimeImmutable($endExclusive))->modify('-1 day')->format('Y-m-d');
                if ($end < $from || $start > $to) continue;
                $result[] = [
                    'anio' => $year, 'id_periodo' => $period,
                    'etiqueta' => self::etiquetaPeriodo($period, $year),
                    'meses' => self::mesesPeriodo($period),
                    'desde' => $start, 'hasta' => $end,
                ];
            }
        }
        return $result;
    }

    private static function balanceInscripciones(PDO $db, string $from, string $to): array
    {
        // Históricos migrados: pagos_inscripcion es la fuente canónica.
        $statement = $db->prepare(
            "SELECT pi.id_inscripcion, pi.id_socio, pi.monto, pi.fecha_pago, pi.id_medio_pago,
                    s.nombre AS socio, s.dni, s.fecha_ingreso,
                    COALESCE(NULLIF(e.nombre,''),'SIN ESTADO') AS estado,
                    COALESCE(NULLIF(mp.nombre,''),'SIN MEDIO ESPECIFICADO') AS medio
             FROM pagos_inscripcion pi
             INNER JOIN socios s ON s.id_socio = pi.id_socio
             LEFT JOIN estado e ON e.id_estado = s.id_estado
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = pi.id_medio_pago
             WHERE COALESCE(s.fecha_ingreso, pi.fecha_pago) >= ?
               AND COALESCE(s.fecha_ingreso, pi.fecha_pago) <= ?
             ORDER BY COALESCE(s.fecha_ingreso, pi.fecha_pago), pi.id_inscripcion"
        );
        $statement->execute([$from, $to]);
        $items = [];
        $seenPartners = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $date = (string)($row['fecha_ingreso'] ?: $row['fecha_pago']);
            $period = self::periodoDeFecha($date);
            $items[] = [
                'id_inscripcion' => (int)$row['id_inscripcion'],
                'id_socio' => (int)$row['id_socio'],
                'socio' => (string)$row['socio'], 'dni' => (string)($row['dni'] ?? ''),
                'estado' => (string)$row['estado'], 'fecha_alta' => $date,
                'periodo' => $period['etiqueta'], 'fecha_pago' => (string)$row['fecha_pago'],
                'medio' => (string)$row['medio'],
                'monto' => number_format((float)$row['monto'], 2, '.', ''),
                'tipo' => (float)$row['monto'] > 0 ? 'PAGADA' : 'SIN_IMPORTE',
            ];
            $seenPartners[(int)$row['id_socio']] = true;
        }

        // Altas creadas por el sistema nuevo sin un registro de inscripción.
        $statement = $db->prepare(
            "SELECT h.id_socio, MIN(DATE(h.fecha_evento)) AS fecha_alta,
                    s.nombre AS socio, s.dni,
                    COALESCE(NULLIF(e.nombre,''),'SIN ESTADO') AS estado
             FROM socios_historial_estados h
             INNER JOIN socios s ON s.id_socio = h.id_socio
             LEFT JOIN estado e ON e.id_estado = s.id_estado
             LEFT JOIN pagos_inscripcion pi ON pi.id_socio = h.id_socio
             WHERE h.tipo_evento = 'ALTA' AND h.origen <> 'MIGRACION'
               AND DATE(h.fecha_evento) >= ? AND DATE(h.fecha_evento) <= ?
               AND pi.id_inscripcion IS NULL
             GROUP BY h.id_socio, s.nombre, s.dni, e.nombre
             ORDER BY fecha_alta, h.id_socio"
        );
        $statement->execute([$from, $to]);
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (isset($seenPartners[(int)$row['id_socio']])) continue;
            $date = (string)$row['fecha_alta'];
            $period = self::periodoDeFecha($date);
            $items[] = [
                'id_inscripcion' => null, 'id_socio' => (int)$row['id_socio'],
                'socio' => (string)$row['socio'], 'dni' => (string)($row['dni'] ?? ''),
                'estado' => (string)$row['estado'], 'fecha_alta' => $date,
                'periodo' => $period['etiqueta'], 'fecha_pago' => null,
                'medio' => 'SIN REGISTRO', 'monto' => '0.00', 'tipo' => 'SIN_REGISTRO',
            ];
        }
        usort($items, static fn(array $a, array $b): int => [$a['fecha_alta'],$a['id_socio']] <=> [$b['fecha_alta'],$b['id_socio']]);

        $summary = ['total' => 0, 'pagadas' => 0, 'sin_importe' => 0, 'sin_registro' => 0, 'importe' => 0, 'activos' => 0, 'pasivos' => 0, 'sin_estado' => 0];
        $groups = [];
        foreach ($items as $item) {
            $summary['total']++;
            if ($item['tipo'] === 'PAGADA') $summary['pagadas']++;
            elseif ($item['tipo'] === 'SIN_IMPORTE') $summary['sin_importe']++;
            else $summary['sin_registro']++;
            $summary['importe'] += self::centavos($item['monto']);
            $state = strtoupper($item['estado']);
            if ($state === 'ACTIVO') $summary['activos']++;
            elseif ($state === 'PASIVO') $summary['pasivos']++;
            else $summary['sin_estado']++;
            $key = $item['periodo'];
            if (!isset($groups[$key])) {
                $period = self::periodoDeFecha($item['fecha_alta']);
                $groups[$key] = [
                    'periodo' => $key, 'meses' => self::mesesPeriodo($period['id_periodo']),
                    'total' => 0, 'activos' => 0, 'pasivos' => 0, 'sin_estado' => 0,
                    'pagadas' => 0, 'sin_importe' => 0, 'sin_registro' => 0, 'total_cobrado_cents' => 0,
                ];
            }
            $groups[$key]['total']++;
            if ($state === 'ACTIVO') $groups[$key]['activos']++;
            elseif ($state === 'PASIVO') $groups[$key]['pasivos']++;
            else $groups[$key]['sin_estado']++;
            if ($item['tipo'] === 'PAGADA') $groups[$key]['pagadas']++;
            elseif ($item['tipo'] === 'SIN_IMPORTE') $groups[$key]['sin_importe']++;
            else $groups[$key]['sin_registro']++;
            $groups[$key]['total_cobrado_cents'] += self::centavos($item['monto']);
        }
        foreach ($groups as &$group) {
            $group['total_cobrado'] = self::importeDesdeCentavos($group['total_cobrado_cents']);
            unset($group['total_cobrado_cents']);
        }
        unset($group);

        return [
            'resumen' => [
                'inscripciones' => $summary['total'], 'pagadas' => $summary['pagadas'],
                'sin_importe' => $summary['sin_importe'], 'sin_registro' => $summary['sin_registro'],
                'total_inscripcion' => self::importeDesdeCentavos($summary['importe']),
                'activos' => $summary['activos'], 'pasivos' => $summary['pasivos'], 'sin_estado' => $summary['sin_estado'],
            ],
            'por_periodo' => array_values($groups), 'items' => $items,
        ];
    }

    private static function balanceBajas(PDO $db, string $from, string $to, array $periods): array
    {
        $statement = $db->prepare(
            "SELECT h.id_historial, h.id_socio, DATE(h.fecha_evento) AS fecha_baja, h.motivo,
                    h.id_estado_anterior, s.nombre AS socio,
                    COALESCE(NULLIF(e.nombre,''),'SIN ESTADO') AS estado
             FROM socios_historial_estados h
             INNER JOIN socios s ON s.id_socio = h.id_socio
             LEFT JOIN estado e ON e.id_estado = h.id_estado_anterior
             WHERE h.tipo_evento = 'BAJA' AND DATE(h.fecha_evento) >= ? AND DATE(h.fecha_evento) <= ?
             ORDER BY h.fecha_evento, h.id_historial"
        );
        $statement->execute([$from, $to]);
        $events = $statement->fetchAll(PDO::FETCH_ASSOC);
        $partnerIds = array_values(array_unique(array_map('intval', array_column($events, 'id_socio'))));
        $paymentsByPartner = [];
        if ($partnerIds !== []) {
            $placeholders = implode(',', array_fill(0, count($partnerIds), '?'));
            $paymentAmount = self::importePagoSql();
            $pay = $db->prepare(
                "SELECT p.id_pago, p.id_socio, p.id_periodo, p.anio_aplicado, p.estado,
                        {$paymentAmount} AS monto_calculado
                 FROM pagos p
                 INNER JOIN socios s ON s.id_socio = p.id_socio
                 LEFT JOIN categoria c ON c.id_categoria = s.id_categoria
                 WHERE p.id_socio IN ({$placeholders}) ORDER BY p.id_pago"
            );
            $pay->execute($partnerIds);
            foreach ($pay->fetchAll(PDO::FETCH_ASSOC) as $row) $paymentsByPartner[(int)$row['id_socio']][] = $row;
        }
        $allowed = [];
        $years = [];
        foreach ($periods as $period) {
            $allowed[(int)$period['anio'] . '-' . (int)$period['id_periodo']] = true;
            $years[(int)$period['anio']] = true;
        }

        $items = [];
        $groups = [];
        $paidCount = $condonedCount = $paidTotal = 0;
        foreach ($events as $event) {
            $covered = [];
            $partnerPaid = 0;
            $partnerPaidCount = 0;
            $partnerCondoned = 0;
            foreach ($paymentsByPartner[(int)$event['id_socio']] ?? [] as $payment) {
                $key = (int)$payment['anio_aplicado'] . '-' . (int)$payment['id_periodo'];
                $isAnnual = (int)$payment['id_periodo'] === 7 && isset($years[(int)$payment['anio_aplicado']]);
                if (!isset($allowed[$key]) && !$isAnnual) continue;
                $covered[] = self::etiquetaPeriodo((int)$payment['id_periodo'], (int)$payment['anio_aplicado']);
                if ((string)$payment['estado'] === 'PAGADO') {
                    $partnerPaidCount++;
                    $partnerPaid += self::centavos($payment['monto_calculado'] ?? 0);
                } else {
                    $partnerCondoned++;
                }
            }
            $paidCount += $partnerPaidCount;
            $condonedCount += $partnerCondoned;
            $paidTotal += $partnerPaid;
            $period = self::periodoDeFecha((string)$event['fecha_baja']);
            $state = strtoupper(trim((string)$event['estado'])) ?: 'SIN ESTADO';
            $item = [
                'id_historial' => (int)$event['id_historial'], 'id_socio' => (int)$event['id_socio'],
                'socio' => (string)$event['socio'], 'estado' => $state,
                'fecha_baja' => (string)$event['fecha_baja'], 'periodo_baja' => $period['etiqueta'],
                'periodos_cubiertos' => array_values(array_unique($covered)),
                'total_pagado' => self::importeDesdeCentavos($partnerPaid),
                'pagos' => $partnerPaidCount, 'condonaciones' => $partnerCondoned,
                'motivo' => trim((string)($event['motivo'] ?? '')),
            ];
            $items[] = $item;
            $gkey = $state . '|' . $period['etiqueta'];
            if (!isset($groups[$gkey])) $groups[$gkey] = [
                'grupo' => 'Bajas ' . strtolower($state), 'estado' => $state,
                'periodo' => $period['etiqueta'], 'bajas' => 0, 'pagos' => 0,
                'condonaciones' => 0, 'monto_pagado_cents' => 0,
            ];
            $groups[$gkey]['bajas']++;
            $groups[$gkey]['pagos'] += $partnerPaidCount;
            $groups[$gkey]['condonaciones'] += $partnerCondoned;
            $groups[$gkey]['monto_pagado_cents'] += $partnerPaid;
        }
        foreach ($groups as &$group) {
            $group['monto_pagado'] = self::importeDesdeCentavos($group['monto_pagado_cents']);
            unset($group['monto_pagado_cents']);
        }
        unset($group);

        $states = array_count_values(array_map(static fn(array $i): string => $i['estado'], $items));
        return [
            'resumen' => [
                'total_bajas' => count($items), 'pasivos' => (int)($states['PASIVO'] ?? 0),
                'activos' => (int)($states['ACTIVO'] ?? 0), 'sin_estado' => (int)($states['SIN ESTADO'] ?? 0),
                'pagos' => $paidCount, 'condonaciones' => $condonedCount,
                'total_pagado' => self::importeDesdeCentavos($paidTotal),
            ],
            'por_periodo' => array_values($groups), 'items' => $items,
        ];
    }

    private static function balanceDeudores(PDO $db, array $periods): array
    {
        $partners = $db->query(
            "SELECT s.id_socio, s.nombre AS socio, s.dni, s.id_categoria, s.fecha_ingreso,
                    s.domicilio, s.numero, s.telefono_movil, s.telefono_fijo,
                    COALESCE(NULLIF(e.nombre,''),'SIN ESTADO') AS estado,
                    COALESCE(NULLIF(c.nombre,''),'SIN CATEGORÍA') AS categoria,
                    COALESCE(NULLIF(cb.nombre,''),'SIN COBRADOR') AS cobrador
             FROM socios s
             LEFT JOIN estado e ON e.id_estado = s.id_estado
             LEFT JOIN categoria c ON c.id_categoria = s.id_categoria
             LEFT JOIN cobrador cb ON cb.id_cobrador = s.id_cobrador
             WHERE s.vigente = 1 ORDER BY s.id_socio"
        )->fetchAll(PDO::FETCH_ASSOC);
        $partnerIds = array_map('intval', array_column($partners, 'id_socio'));
        $payments = [];
        if ($partnerIds !== []) {
            $placeholders = implode(',', array_fill(0, count($partnerIds), '?'));
            $statement = $db->prepare(
                "SELECT id_socio, anio_aplicado, id_periodo, estado FROM pagos
                 WHERE id_socio IN ({$placeholders})"
            );
            $statement->execute($partnerIds);
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $payments[(int)$row['id_socio'] . '-' . (int)$row['anio_aplicado'] . '-' . (int)$row['id_periodo']] = (string)$row['estado'];
            }
        }

        $items = [];
        $groups = [];
        $total = 0;
        foreach ($periods as $period) {
            $year = (int)$period['anio'];
            $periodId = (int)$period['id_periodo'];
            $reference = (string)$period['desde'];
            $periodEnd = (string)$period['hasta'];
            foreach ($partners as $partner) {
                $partnerId = (int)$partner['id_socio'];
                $joined = trim((string)($partner['fecha_ingreso'] ?? ''));
                if ($joined !== '' && $joined > $periodEnd) continue;
                if (isset($payments[$partnerId . '-' . $year . '-' . $periodId])) continue;
                if (isset($payments[$partnerId . '-' . $year . '-7'])) continue;

                $base = self::precioHistorico($db, (int)$partner['id_categoria'], 'mensual', $reference);
                $discount = self::porcentajeDescuentoSocio($db, $partnerId, $reference, true);
                $amount = self::centavos(round($base * (1 - $discount / 100), 2));
                $total += $amount;
                $state = strtoupper((string)$partner['estado']);
                $item = [
                    'periodo' => (string)$period['etiqueta'], 'anio' => $year, 'id_periodo' => $periodId,
                    'id_socio' => $partnerId, 'socio' => (string)$partner['socio'],
                    'dni' => (string)($partner['dni'] ?? ''), 'estado' => $state,
                    'categoria' => (string)$partner['categoria'], 'ingreso' => $joined ?: null,
                    'domicilio' => trim((string)($partner['domicilio'] ?? '') . ' ' . (string)($partner['numero'] ?? '')),
                    'telefono' => trim((string)($partner['telefono_movil'] ?: $partner['telefono_fijo'] ?: '')),
                    'cobrador' => (string)$partner['cobrador'],
                    'monto_base' => number_format($base, 2, '.', ''),
                    'descuento_familiar' => number_format($discount, 2, '.', ''),
                    'monto' => self::importeDesdeCentavos($amount),
                ];
                $items[] = $item;
                $key = $period['etiqueta'];
                if (!isset($groups[$key])) $groups[$key] = [
                    'periodo' => $key, 'deudores' => 0, 'activos' => 0, 'pasivos' => 0,
                    'sin_estado' => 0, 'monto_cents' => 0,
                ];
                $groups[$key]['deudores']++;
                if ($state === 'ACTIVO') $groups[$key]['activos']++;
                elseif ($state === 'PASIVO') $groups[$key]['pasivos']++;
                else $groups[$key]['sin_estado']++;
                $groups[$key]['monto_cents'] += $amount;
            }
        }
        foreach ($groups as &$group) {
            $group['monto_adeudado'] = self::importeDesdeCentavos($group['monto_cents']);
            unset($group['monto_cents']);
        }
        unset($group);
        $states = array_count_values(array_map(static fn(array $i): string => $i['estado'], $items));
        return [
            'resumen' => [
                'total_deudas' => count($items), 'pasivos' => (int)($states['PASIVO'] ?? 0),
                'activos' => (int)($states['ACTIVO'] ?? 0), 'sin_estado' => (int)($states['SIN ESTADO'] ?? 0),
                'periodos_analizados' => count($periods), 'total_adeudado' => self::importeDesdeCentavos($total),
            ],
            'por_periodo' => array_values($groups), 'items' => $items,
        ];
    }

    private static function validarBalance(array $registrations, array $leavers, array $debtors): void
    {
        $r = $registrations['resumen'];
        if ((int)$r['inscripciones'] !== (int)$r['pagadas'] + (int)$r['sin_importe'] + (int)$r['sin_registro']) {
            api_error('La conciliación de inscripciones del balance no coincide.', 'BALANCE_DESCUADRE_INSCRIPCIONES', 500);
        }
        if ((int)$r['inscripciones'] !== (int)$r['activos'] + (int)$r['pasivos'] + (int)$r['sin_estado']) {
            api_error('La clasificación de inscripciones del balance no coincide.', 'BALANCE_DESCUADRE_ESTADOS_INSCRIPCION', 500);
        }
        $registrationGroups = $registrations['por_periodo'] ?? [];
        $registrationGroupTotal = $registrationGroupPaid = $registrationGroupNoAmount = $registrationGroupNoRecord = 0;
        $registrationGroupAmount = 0;
        foreach ($registrationGroups as $group) {
            $registrationGroupTotal += (int)$group['total'];
            $registrationGroupPaid += (int)$group['pagadas'];
            $registrationGroupNoAmount += (int)$group['sin_importe'];
            $registrationGroupNoRecord += (int)$group['sin_registro'];
            $registrationGroupAmount += self::centavos($group['total_cobrado']);
        }
        if ($registrationGroupTotal !== (int)$r['inscripciones']
            || $registrationGroupPaid !== (int)$r['pagadas']
            || $registrationGroupNoAmount !== (int)$r['sin_importe']
            || $registrationGroupNoRecord !== (int)$r['sin_registro']
            || $registrationGroupAmount !== self::centavos($r['total_inscripcion'])) {
            api_error('El resumen por período de inscripciones no coincide.', 'BALANCE_DESCUADRE_PERIODOS_INSCRIPCION', 500);
        }

        $b = $leavers['resumen'];
        if ((int)$b['total_bajas'] !== (int)$b['activos'] + (int)$b['pasivos'] + (int)$b['sin_estado']) {
            api_error('La clasificación de bajas del balance no coincide.', 'BALANCE_DESCUADRE_BAJAS', 500);
        }
        $bajaGroupBajas = $bajaGroupPayments = $bajaGroupCondoned = 0;
        $bajaGroupAmount = 0;
        foreach ($leavers['por_periodo'] ?? [] as $group) {
            $bajaGroupBajas += (int)$group['bajas'];
            $bajaGroupPayments += (int)$group['pagos'];
            $bajaGroupCondoned += (int)$group['condonaciones'];
            $bajaGroupAmount += self::centavos($group['monto_pagado']);
        }
        if ($bajaGroupBajas !== (int)$b['total_bajas']
            || $bajaGroupPayments !== (int)$b['pagos']
            || $bajaGroupCondoned !== (int)$b['condonaciones']
            || $bajaGroupAmount !== self::centavos($b['total_pagado'])) {
            api_error('El resumen por período de bajas no coincide.', 'BALANCE_DESCUADRE_PERIODOS_BAJAS', 500);
        }

        $d = $debtors['resumen'];
        if ((int)$d['total_deudas'] !== (int)$d['activos'] + (int)$d['pasivos'] + (int)$d['sin_estado']) {
            api_error('La clasificación de deudores del balance no coincide.', 'BALANCE_DESCUADRE_DEUDORES', 500);
        }
        $debtGroupCount = $debtGroupActive = $debtGroupPassive = $debtGroupNoState = 0;
        $debtGroupAmount = 0;
        foreach ($debtors['por_periodo'] ?? [] as $group) {
            $debtGroupCount += (int)$group['deudores'];
            $debtGroupActive += (int)$group['activos'];
            $debtGroupPassive += (int)$group['pasivos'];
            $debtGroupNoState += (int)$group['sin_estado'];
            $debtGroupAmount += self::centavos($group['monto_adeudado']);
        }
        if ($debtGroupCount !== (int)$d['total_deudas']
            || $debtGroupActive !== (int)$d['activos']
            || $debtGroupPassive !== (int)$d['pasivos']
            || $debtGroupNoState !== (int)$d['sin_estado']
            || $debtGroupAmount !== self::centavos($d['total_adeudado'])) {
            api_error('El resumen por período de deudores no coincide.', 'BALANCE_DESCUADRE_PERIODOS_DEUDORES', 500);
        }
    }
}
