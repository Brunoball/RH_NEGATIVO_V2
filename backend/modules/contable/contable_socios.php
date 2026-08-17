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
    abstract protected static function periodoDeFecha(string $date): array;
    abstract protected static function precioHistorico(PDO $db, int $categoryId, string $type, string $date): float;
    abstract protected static function centavos(mixed $value): int;
    abstract protected static function importeDesdeCentavos(int $cents): string;
    abstract protected static function importePagoSql(string $paymentAlias = 'p', string $partnerAlias = 's', string $categoryAlias = 'c'): string;
    abstract protected static function textoBusqueda(mixed $value): string;
    abstract protected static function idOpcional(mixed $value, string $label): ?int;

    /**
     * Contabilidad trabaja con las dos clasificaciones históricas del padrón
     * (ACTIVO/PASIVO). Cualquier estado auxiliar creado desde Configuración se
     * informa como SIN ESTADO para no romper conciliaciones ni ocultar socios.
     */
    private static function estadoContable(mixed $value): string
    {
        $state = strtoupper(trim((string)$value));
        return in_array($state, ['ACTIVO', 'PASIVO'], true) ? $state : 'SIN ESTADO';
    }

    protected static function ingresosSociosDatos(PDO $db, array $filters): array
    {
        $year = self::filtroAnio($filters['anio'] ?? null);
        $periodId = self::filtroPeriodo($filters['periodo'] ?? null);
        [$start, $endExclusive] = self::rangoPeriodo($year, $periodId);
        $endInclusive = (new DateTimeImmutable($endExclusive))->modify('-1 day')->format('Y-m-d');

        $snapshot = self::snapshotSociosEnFecha($db, $endInclusive);
        $detail = self::detalleCobrosSocios($db, $year, $periodId, $start, $endExclusive, $filters);
        $partners = self::detallePadronSocios($db, $year, $snapshot);
        $collection = self::detalleCobranza($db, $year, $periodId, $start, $endExclusive, $snapshot);

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

        // Caja / ingresos siempre se determina por fecha real de cobro. Para
        // clasificar cada movimiento se usa, además, el padrón histórico de la
        // propia fecha de pago; cambiar categoría/cobrador hoy no reclasifica
        // cobros de años anteriores.
        $where = ["p.estado = 'PAGADO'", 'p.fecha_pago >= ?', 'p.fecha_pago < ?'];
        $params = [$start, $endExclusive];
        if ($periodId === 7) $where[] = 'p.id_periodo = 7';

        $statement = $db->prepare(
            "SELECT p.id_pago, p.id_socio, p.id_periodo, p.anio_aplicado, p.fecha_pago,
                    p.id_medio_pago, p.monto,
                    s.nombre AS socio, s.dni,
                    COALESCE(NULLIF(mp.nombre,''), 'SIN MEDIO ESPECIFICADO') AS medio,
                    COALESCE(NULLIF(pe.nombre,''), '') AS periodo_nombre
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             LEFT JOIN periodo pe ON pe.id_periodo = p.id_periodo
             WHERE " . implode(' AND ', $where) . "
             ORDER BY p.fecha_pago DESC, p.creado_en DESC, p.id_pago DESC"
        );
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        $normalize = static function (mixed $value): string {
            $text = trim((string)$value);
            if ($text === '') return '';
            return function_exists('mb_strtoupper')
                ? mb_strtoupper($text, 'UTF-8')
                : strtoupper($text);
        };
        $searchNeedle = $normalize($search);

        $generalCount = 0;
        $generalPartners = [];
        $generalCents = 0;
        $filtered = [];
        $filteredPartners = [];
        $filteredCents = 0;

        foreach ($rows as $row) {
            $partnerId = (int)$row['id_socio'];
            $paymentDate = substr((string)$row['fecha_pago'], 0, 10);
            $snapshot = self::snapshotSociosEnFecha($db, $paymentDate);
            $historical = $snapshot[$partnerId] ?? [];
            $historicalCategoryId = (int)($historical['id_categoria'] ?? 0);
            $historicalCategoryName = trim((string)($historical['categoria'] ?? '')) ?: 'SIN CATEGORÍA';
            $historicalCollector = trim((string)($historical['cobrador'] ?? '')) ?: 'SIN COBRADOR';

            $appliedPeriod = (int)$row['id_periodo'];
            $appliedYear = (int)$row['anio_aplicado'];
            $referenceDate = sprintf(
                '%04d-%02d-01',
                $appliedYear,
                $appliedPeriod === 7 ? 1 : (($appliedPeriod - 1) * 2 + 1)
            );
            $historicalCategoryAmount = $historicalCategoryId > 0
                ? self::precioHistorico(
                    $db,
                    $historicalCategoryId,
                    $appliedPeriod === 7 ? 'anual' : 'mensual',
                    $referenceDate
                )
                : 0.0;

            // Los pagos actuales guardan el monto definitivo. El fallback sólo
            // existe para históricos migrados con monto NULL y usa la categoría
            // histórica, nunca la categoría que el socio tenga hoy.
            $amount = $row['monto'] === null
                ? self::centavos($historicalCategoryAmount)
                : self::centavos($row['monto']);

            $generalCount++;
            $generalPartners[$partnerId] = true;
            $generalCents += $amount;

            if ($categoryId !== null && $historicalCategoryId !== $categoryId) continue;
            if ($meanId !== null && (int)($row['id_medio_pago'] ?? 0) !== $meanId) continue;

            if ($searchNeedle !== '') {
                $haystack = $normalize(implode(' ', [
                    $row['socio'] ?? '',
                    $row['dni'] ?? '',
                    $historicalCategoryName,
                    $historicalCollector,
                    $row['medio'] ?? '',
                    $row['periodo_nombre'] ?? '',
                    $appliedYear,
                ]));
                if (!str_contains($haystack, $searchNeedle)) continue;
            }

            $filteredPartners[$partnerId] = true;
            $filteredCents += $amount;
            $filtered[] = [
                'clave' => 'PAGO-' . (int)$row['id_pago'],
                'id_pago' => (int)$row['id_pago'],
                'id_socio' => $partnerId,
                'socio' => (string)$row['socio'],
                'dni' => $row['dni'] === null ? '' : (string)$row['dni'],
                'categoria' => $historicalCategoryName,
                'categoria_monto_historico' => number_format($historicalCategoryAmount, 2, '.', ''),
                'categoria_etiqueta' => $historicalCategoryName . ' (' . number_format($historicalCategoryAmount, 0, ',', '.') . ')',
                'cobrador' => $historicalCollector,
                'fecha' => (string)$row['fecha_pago'],
                'periodo' => self::etiquetaPeriodo($appliedPeriod, $appliedYear),
                'id_periodo' => $appliedPeriod,
                'anio_aplicado' => $appliedYear,
                'medio' => (string)$row['medio'],
                'id_medio_pago' => $row['id_medio_pago'] === null ? null : (int)$row['id_medio_pago'],
                'monto' => self::importeDesdeCentavos($amount),
                'monto_estimado' => $row['monto'] === null,
            ];
        }

        $totalRecords = count($filtered);
        $totalPages = $totalRecords > 0 ? (int)ceil($totalRecords / $perPage) : 0;
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        $offset = ($page - 1) * $perPage;
        $items = array_slice($filtered, $offset, $perPage);

        return [
            'items' => $items,
            'resumen' => [
                'registros' => $totalRecords,
                'socios_distintos' => count($filteredPartners),
                'importe' => self::importeDesdeCentavos($filteredCents),
            ],
            'resumen_general' => [
                'registros' => $generalCount,
                'socios_distintos' => count($generalPartners),
                'importe' => self::importeDesdeCentavos($generalCents),
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

    private static function detallePadronSocios(PDO $db, int $year, array $snapshot): array
    {
        $states = ['ACTIVO' => 0, 'PASIVO' => 0, 'SIN ESTADO' => 0];
        $groups = [];
        $total = 0;
        foreach ($snapshot as $row) {
            if (empty($row['vigente_fecha'])) continue;
            $total++;
            $state = self::estadoContable($row['estado'] ?? null);
            if (!isset($states[$state])) $states[$state] = 0;
            $states[$state]++;
            $group = trim((string)($row['grupo'] ?? '')) ?: 'SIN GRUPO';
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
                'total' => $total,
            ],
            'items' => array_values($groups),
        ];
    }

    private static function detalleCobranza(
        PDO $db,
        int $year,
        int $periodId,
        string $start,
        string $endExclusive,
        array $snapshot
    ): array {
        $endInclusive = (new DateTimeImmutable($endExclusive))->modify('-1 day')->format('Y-m-d');
        $partners = [];
        foreach ($snapshot as $partner) {
            if (empty($partner['vigente_fecha'])) continue;
            $partners[] = [
                'id_socio' => (int)$partner['id_socio'],
                'id_categoria' => (int)$partner['id_categoria'],
                'cobrador' => (string)($partner['cobrador'] ?? 'SIN COBRADOR'),
                'estado' => (string)($partner['estado'] ?? 'SIN ESTADO'),
            ];
        }

        $partnerIds = array_map('intval', array_column($partners, 'id_socio'));
        $discountsByPartner = self::porcentajesDescuentoSocios($db, $partnerIds, $start, true);

        $expectedTotal = 0;
        $expectedGroups = [];
        foreach ($partners as $partner) {
            $partnerId = (int)$partner['id_socio'];
            $base = self::precioHistorico($db, (int)$partner['id_categoria'], $periodId === 7 ? 'anual' : 'mensual', $start);
            $discount = (float)($discountsByPartner[$partnerId] ?? 0.0);
            $expected = self::centavos(round($base * (1 - $discount / 100), 2));
            $expectedTotal += $expected;
            $collector = (string)$partner['cobrador'];
            $state = self::estadoContable($partner['estado'] ?? null);
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
                    COALESCE(NULLIF(mp.nombre,''), 'SIN MEDIO ESPECIFICADO') AS medio
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN categoria c ON c.id_categoria = s.id_categoria
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
            $paymentPartner = $snapshot[(int)$payment['id_socio']] ?? null;
            $collector = trim((string)($paymentPartner['cobrador'] ?? '')) ?: 'SIN COBRADOR';
            $state = self::estadoContable($paymentPartner['estado'] ?? null);
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

    /**
     * Reconstruye el padrón tal como correspondía a una fecha histórica.
     *
     * - Alta/baja/reactivación salen del historial de estados.
     * - Categoría/cobrador/grupo se rebobinan usando la auditoría de UPDATE.
     * - Para datos migrados, una actividad financiera anterior a la fecha_ingreso
     *   actual se toma como evidencia mínima de que el socio ya existía.
     *
     * @return array<int,array<string,mixed>> indexado por id_socio
     */
    private static function snapshotSociosEnFecha(PDO $db, string $date): array
    {
        static $rawCache = [];
        static $snapshotCache = [];

        $dbKey = spl_object_id($db);
        $snapshotKey = $dbKey . '|' . $date;
        if (isset($snapshotCache[$snapshotKey])) return $snapshotCache[$snapshotKey];

        if (!isset($rawCache[$dbKey])) {
            $baseRows = $db->query(
                'SELECT id_socio, id_categoria, id_cobrador, id_grupo_sanguineo,
                        id_estado, fecha_ingreso, vigente
                 FROM socios'
            )->fetchAll(PDO::FETCH_ASSOC);

            $auditRows = $db->query(
                "SELECT id_registro, datos_anteriores, fecha, id_auditoria
                 FROM auditoria
                 WHERE tabla = 'socios' AND accion = 'UPDATE'
                 ORDER BY fecha DESC, id_auditoria DESC"
            )->fetchAll(PDO::FETCH_ASSOC);

            // También preservamos los nombres históricos de los catálogos. El
            // socio puede conservar correctamente el ID de su categoría/cobrador
            // de 2025, pero si esa opción se renombró en 2026 no debe cambiar la
            // etiqueta visible de un informe ya pasado.
            $catalogAuditRows = $db->query(
                "SELECT tabla, id_registro, accion, datos_anteriores, fecha, id_auditoria
                 FROM auditoria
                 WHERE tabla IN ('categoria','cobrador','grupo_sanguineo','estado')
                   AND accion IN ('INSERT','UPDATE','DELETE')
                 ORDER BY fecha DESC, id_auditoria DESC"
            )->fetchAll(PDO::FETCH_ASSOC);

            $financial = [];
            $paymentRows = $db->query(
                "SELECT id_socio,
                        MIN(fecha_pago) AS min_fecha_pago,
                        MIN(CASE
                            WHEN id_periodo = 7 THEN STR_TO_DATE(CONCAT(anio_aplicado, '-01-01'), '%Y-%m-%d')
                            WHEN id_periodo BETWEEN 1 AND 6 THEN STR_TO_DATE(CONCAT(anio_aplicado, '-', LPAD(((id_periodo - 1) * 2) + 1, 2, '0'), '-01'), '%Y-%m-%d')
                            ELSE NULL END) AS min_periodo
                 FROM pagos GROUP BY id_socio"
            )->fetchAll(PDO::FETCH_ASSOC);
            foreach ($paymentRows as $row) {
                $dates = array_values(array_filter([$row['min_fecha_pago'] ?? null, $row['min_periodo'] ?? null]));
                if ($dates !== []) $financial[(int)$row['id_socio']] = min($dates);
            }
            $registrationRows = $db->query(
                'SELECT id_socio, MIN(fecha_pago) AS min_fecha FROM pagos_inscripcion GROUP BY id_socio'
            )->fetchAll(PDO::FETCH_ASSOC);
            foreach ($registrationRows as $row) {
                if (empty($row['min_fecha'])) continue;
                $id = (int)$row['id_socio'];
                $financial[$id] = isset($financial[$id]) ? min($financial[$id], (string)$row['min_fecha']) : (string)$row['min_fecha'];
            }

            $events = $db->query(
                'SELECT id_socio, tipo_evento, id_estado_anterior, id_estado_nuevo,
                        vigente_anterior, vigente_nuevo, fecha_evento, id_historial
                 FROM socios_historial_estados
                 WHERE fecha_evento IS NOT NULL
                 ORDER BY id_socio, fecha_evento, id_historial'
            )->fetchAll(PDO::FETCH_ASSOC);
            $eventsByPartner = [];
            foreach ($events as $event) $eventsByPartner[(int)$event['id_socio']][] = $event;

            $catalogMap = static function (PDO $db, string $table, string $idField): array {
                $allowed = [
                    'estado' => 'id_estado',
                    'cobrador' => 'id_cobrador',
                    'grupo_sanguineo' => 'id_grupo_sanguineo',
                    'categoria' => 'id_categoria',
                ];
                if (($allowed[$table] ?? null) !== $idField) return [];
                $result = [];
                foreach ($db->query("SELECT {$idField} AS id, nombre FROM {$table}")->fetchAll(PDO::FETCH_ASSOC) as $item) {
                    $result[(int)$item['id']] = trim((string)$item['nombre']);
                }
                return $result;
            };

            $rawCache[$dbKey] = [
                'base' => $baseRows,
                'audit' => $auditRows,
                'catalog_audit' => $catalogAuditRows,
                'financial' => $financial,
                'events' => $eventsByPartner,
                'states' => $catalogMap($db, 'estado', 'id_estado'),
                'collectors' => $catalogMap($db, 'cobrador', 'id_cobrador'),
                'groups' => $catalogMap($db, 'grupo_sanguineo', 'id_grupo_sanguineo'),
                'categories' => $catalogMap($db, 'categoria', 'id_categoria'),
            ];
        }

        $raw = $rawCache[$dbKey];
        $targetEnd = $date . ' 23:59:59';

        $catalogsAtDate = [
            'estado' => $raw['states'],
            'cobrador' => $raw['collectors'],
            'grupo_sanguineo' => $raw['groups'],
            'categoria' => $raw['categories'],
        ];
        foreach ($raw['catalog_audit'] as $entry) {
            if ((string)$entry['fecha'] <= $targetEnd) break;
            $table = (string)$entry['tabla'];
            if (!isset($catalogsAtDate[$table])) continue;
            $id = (int)$entry['id_registro'];
            $action = (string)$entry['accion'];
            if ($action === 'INSERT') {
                // Antes de un alta futura, esa opción todavía no existía.
                unset($catalogsAtDate[$table][$id]);
                continue;
            }
            $before = json_decode((string)($entry['datos_anteriores'] ?? ''), true);
            if (!is_array($before) || !array_key_exists('nombre', $before)) continue;
            $name = trim((string)$before['nombre']);
            $catalogsAtDate[$table][$id] = $name === '' ? 'SIN NOMBRE' : $name;
        }

        $snapshot = [];
        foreach ($raw['base'] as $base) {
            $id = (int)$base['id_socio'];
            $snapshot[$id] = [
                'id_socio' => $id,
                'id_categoria' => (int)($base['id_categoria'] ?? 0),
                'id_cobrador' => $base['id_cobrador'] === null ? null : (int)$base['id_cobrador'],
                'id_grupo_sanguineo' => $base['id_grupo_sanguineo'] === null ? null : (int)$base['id_grupo_sanguineo'],
                'id_estado' => $base['id_estado'] === null ? null : (int)$base['id_estado'],
                'fecha_ingreso' => $base['fecha_ingreso'] === null ? null : (string)$base['fecha_ingreso'],
                'vigente_fecha' => (int)$base['vigente'] === 1,
            ];
        }

        // Rebobina dimensiones editables desde el presente hasta el corte. La
        // auditoría se carga una sola vez aunque un Balance recorra muchos períodos.
        foreach ($raw['audit'] as $entry) {
            if ((string)$entry['fecha'] <= $targetEnd) break;
            $id = (int)$entry['id_registro'];
            if (!isset($snapshot[$id])) continue;
            $before = json_decode((string)($entry['datos_anteriores'] ?? ''), true);
            if (!is_array($before)) continue;
            foreach (['id_categoria', 'id_cobrador', 'id_grupo_sanguineo'] as $field) {
                if (!array_key_exists($field, $before)) continue;
                $snapshot[$id][$field] = $before[$field] === null ? null : (int)$before[$field];
            }
        }

        foreach ($snapshot as $id => &$row) {
            $join = $row['fecha_ingreso'];
            if (isset($raw['financial'][$id]) && ($join === null || $raw['financial'][$id] < $join)) {
                $join = $raw['financial'][$id];
            }
            $row['fecha_ingreso_efectiva'] = $join;
            if ($join !== null && $join > $date) $row['vigente_fecha'] = false;
        }
        unset($row);

        // Estado/vigencia histórica: el último evento hasta el corte manda. Si
        // todavía no existía ninguno, el primer evento posterior aporta el estado
        // anterior. Una ALTA futura sin estado anterior implica que aún no existía,
        // salvo que haya actividad financiera heredada que demuestre lo contrario.
        foreach ($raw['events'] as $id => $partnerEvents) {
            if (!isset($snapshot[$id])) continue;
            $lastBefore = null;
            $firstAfter = null;
            foreach ($partnerEvents as $event) {
                $eventDate = substr((string)$event['fecha_evento'], 0, 10);
                if ($eventDate <= $date) $lastBefore = $event;
                elseif ($firstAfter === null) { $firstAfter = $event; break; }
            }
            if ($lastBefore !== null) {
                if ($lastBefore['vigente_nuevo'] !== null) $snapshot[$id]['vigente_fecha'] = (int)$lastBefore['vigente_nuevo'] === 1;
                if ($lastBefore['id_estado_nuevo'] !== null) $snapshot[$id]['id_estado'] = (int)$lastBefore['id_estado_nuevo'];
            } elseif ($firstAfter !== null) {
                if ($firstAfter['vigente_anterior'] !== null) {
                    $snapshot[$id]['vigente_fecha'] = (int)$firstAfter['vigente_anterior'] === 1;
                } elseif ((string)$firstAfter['tipo_evento'] === 'ALTA') {
                    $hasEarlierFinancialEvidence = isset($raw['financial'][$id]) && $raw['financial'][$id] <= $date;
                    if (!$hasEarlierFinancialEvidence) $snapshot[$id]['vigente_fecha'] = false;
                }
                if ($firstAfter['id_estado_anterior'] !== null) $snapshot[$id]['id_estado'] = (int)$firstAfter['id_estado_anterior'];
            }
            $join = $snapshot[$id]['fecha_ingreso_efectiva'] ?? null;
            if ($join !== null && $join > $date) $snapshot[$id]['vigente_fecha'] = false;
        }

        foreach ($snapshot as &$row) {
            $row['estado'] = $catalogsAtDate['estado'][(int)($row['id_estado'] ?? 0)] ?? 'SIN ESTADO';
            $row['cobrador'] = $catalogsAtDate['cobrador'][(int)($row['id_cobrador'] ?? 0)] ?? 'SIN COBRADOR';
            $row['grupo'] = $catalogsAtDate['grupo_sanguineo'][(int)($row['id_grupo_sanguineo'] ?? 0)] ?? 'SIN GRUPO';
            $row['categoria'] = $catalogsAtDate['categoria'][(int)($row['id_categoria'] ?? 0)] ?? 'SIN CATEGORÍA';
        }
        unset($row);

        return $snapshotCache[$snapshotKey] = $snapshot;
    }

    /**
     * Resuelve descuentos familiares en lote.
     *
     * Antes, cobranza ejecutaba entre 1 y 3 consultas por socio. Con un padrón
     * grande eso convertía una sola apertura de Contable en miles de consultas.
     * Esta versión conserva exactamente las mismas reglas históricas, pero lee
     * membresías, cantidades y reglas una sola vez por fecha.
     *
     * @return array<int,float> porcentaje indexado por id_socio
     */
    private static function porcentajesDescuentoSocios(
        PDO $db,
        array $partnerIds,
        string $date,
        bool $historical
    ): array {
        $partnerIds = array_values(array_unique(array_filter(
            array_map('intval', $partnerIds),
            static fn(int $id): bool => $id > 0
        )));
        if ($partnerIds === []) return [];

        static $cache = [];
        $scopeKey = spl_object_id($db) . '|' . $date . '|' . ($historical ? 'H' : 'A');
        if (!isset($cache[$scopeKey])) $cache[$scopeKey] = [];

        $missing = array_values(array_filter(
            $partnerIds,
            static fn(int $id): bool => !array_key_exists($id, $cache[$scopeKey])
        ));

        if ($missing !== []) {
            foreach ($missing as $partnerId) $cache[$scopeKey][$partnerId] = 0.0;

            $placeholders = implode(',', array_fill(0, count($missing), '?'));
            $familySql =
                "SELECT fs.id_socio, fs.id_familia, fs.id_familia_socio
                 FROM familias_socios fs
                 INNER JOIN familias f ON f.id_familia = fs.id_familia
                 WHERE fs.id_socio IN ({$placeholders})
                   AND (fs.desde IS NULL OR fs.desde <= ?)
                   AND (fs.hasta IS NULL OR fs.hasta >= ?)";
            if (!$historical) $familySql .= ' AND fs.activo = 1 AND f.activo = 1';
            $familySql .= ' ORDER BY fs.id_socio, fs.id_familia_socio DESC';

            $statement = $db->prepare($familySql);
            $statement->execute([...$missing, $date, $date]);

            // La consulta individual histórica elegía el vínculo más reciente
            // (id_familia_socio DESC). Al venir ordenados, el primero por socio
            // mantiene exactamente esa semántica.
            $familyByPartner = [];
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $partnerId = (int)$row['id_socio'];
                if (!isset($familyByPartner[$partnerId])) {
                    $familyByPartner[$partnerId] = (int)$row['id_familia'];
                }
            }

            if ($familyByPartner !== []) {
                $familyIds = array_values(array_unique(array_values($familyByPartner)));
                $familyPlaceholders = implode(',', array_fill(0, count($familyIds), '?'));
                $countSql =
                    "SELECT fs.id_familia, COUNT(DISTINCT fs.id_socio) AS cantidad
                     FROM familias_socios fs
                     INNER JOIN socios s ON s.id_socio = fs.id_socio
                     WHERE fs.id_familia IN ({$familyPlaceholders})
                       AND (fs.desde IS NULL OR fs.desde <= ?)
                       AND (fs.hasta IS NULL OR fs.hasta >= ?)";
                if (!$historical) $countSql .= ' AND fs.activo = 1 AND s.vigente = 1';
                $countSql .= ' GROUP BY fs.id_familia';

                $statement = $db->prepare($countSql);
                $statement->execute([...$familyIds, $date, $date]);
                $countByFamily = [];
                foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                    $countByFamily[(int)$row['id_familia']] = (int)$row['cantidad'];
                }

                $rulesSql =
                    'SELECT id_descuento_familiar, cantidad_integrantes_desde,
                            cantidad_integrantes_hasta, porcentaje_descuento
                     FROM descuentos_familiares
                     WHERE vigencia_desde <= ? AND (vigencia_hasta IS NULL OR vigencia_hasta >= ?)';
                if (!$historical) $rulesSql .= ' AND activo = 1';
                $rulesSql .= ' ORDER BY cantidad_integrantes_desde DESC, id_descuento_familiar DESC';
                $statement = $db->prepare($rulesSql);
                $statement->execute([$date, $date]);
                $rules = $statement->fetchAll(PDO::FETCH_ASSOC);

                foreach ($familyByPartner as $partnerId => $familyId) {
                    $count = (int)($countByFamily[$familyId] ?? 0);
                    if ($count < 2) continue;

                    foreach ($rules as $rule) {
                        $from = (int)$rule['cantidad_integrantes_desde'];
                        $to = $rule['cantidad_integrantes_hasta'] === null
                            ? null
                            : (int)$rule['cantidad_integrantes_hasta'];
                        if ($from <= $count && ($to === null || $to >= $count)) {
                            $cache[$scopeKey][$partnerId] = max(
                                0.0,
                                min(100.0, (float)$rule['porcentaje_descuento'])
                            );
                            break;
                        }
                    }
                }
            }
        }

        $result = [];
        foreach ($partnerIds as $partnerId) {
            $result[$partnerId] = (float)($cache[$scopeKey][$partnerId] ?? 0.0);
        }
        return $result;
    }

    private static function porcentajeDescuentoSocio(PDO $db, int $partnerId, string $date, bool $historical): float
    {
        $values = self::porcentajesDescuentoSocios($db, [$partnerId], $date, $historical);
        return (float)($values[$partnerId] ?? 0.0);
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
            $historical = self::snapshotSociosEnFecha($db, $date)[(int)$row['id_socio']] ?? [];
            $items[] = [
                'id_inscripcion' => (int)$row['id_inscripcion'],
                'id_socio' => (int)$row['id_socio'],
                'socio' => (string)$row['socio'], 'dni' => (string)($row['dni'] ?? ''),
                'estado' => self::estadoContable($historical['estado'] ?? $row['estado'] ?? null), 'fecha_alta' => $date,
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
            $historical = self::snapshotSociosEnFecha($db, $date)[(int)$row['id_socio']] ?? [];
            $items[] = [
                'id_inscripcion' => null, 'id_socio' => (int)$row['id_socio'],
                'socio' => (string)$row['socio'], 'dni' => (string)($row['dni'] ?? ''),
                'estado' => self::estadoContable($historical['estado'] ?? $row['estado'] ?? null), 'fecha_alta' => $date,
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
            $state = self::estadoContable($item['estado'] ?? null);
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
            $state = self::estadoContable($event['estado'] ?? null);
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
        $identityRows = $db->query(
            "SELECT id_socio, nombre AS socio, dni, domicilio, numero, telefono_movil, telefono_fijo
             FROM socios
             ORDER BY id_socio"
        )->fetchAll(PDO::FETCH_ASSOC);
        $partnersById = [];
        foreach ($identityRows as $row) $partnersById[(int)$row['id_socio']] = $row;
        $allPartnerIds = array_keys($partnersById);

        $payments = [];
        if ($allPartnerIds !== []) {
            $placeholders = implode(',', array_fill(0, count($allPartnerIds), '?'));
            $statement = $db->prepare(
                "SELECT id_socio, anio_aplicado, id_periodo, estado FROM pagos
                 WHERE id_socio IN ({$placeholders})"
            );
            $statement->execute($allPartnerIds);
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
            $snapshot = self::snapshotSociosEnFecha($db, $periodEnd);
            $eligibleIds = [];
            foreach ($snapshot as $partnerId => $historical) {
                if (!empty($historical['vigente_fecha']) && isset($partnersById[$partnerId])) $eligibleIds[] = (int)$partnerId;
            }
            $discountsByPartner = self::porcentajesDescuentoSocios($db, $eligibleIds, $reference, true);

            foreach ($eligibleIds as $partnerId) {
                $historical = $snapshot[$partnerId];
                $identity = $partnersById[$partnerId];
                if (isset($payments[$partnerId . '-' . $year . '-' . $periodId])) continue;
                if (isset($payments[$partnerId . '-' . $year . '-7'])) continue;

                $categoryId = (int)($historical['id_categoria'] ?? 0);
                $base = $categoryId > 0 ? self::precioHistorico($db, $categoryId, 'mensual', $reference) : 0.0;
                $discount = (float)($discountsByPartner[$partnerId] ?? 0.0);
                $amount = self::centavos(round($base * (1 - $discount / 100), 2));
                $total += $amount;
                $state = self::estadoContable($historical['estado'] ?? null);
                $joined = trim((string)($historical['fecha_ingreso_efectiva'] ?? ''));
                $item = [
                    'periodo' => (string)$period['etiqueta'], 'anio' => $year, 'id_periodo' => $periodId,
                    'id_socio' => $partnerId, 'socio' => (string)$identity['socio'],
                    'dni' => (string)($identity['dni'] ?? ''), 'estado' => $state,
                    'categoria' => (string)($historical['categoria'] ?? 'SIN CATEGORÍA'), 'ingreso' => $joined ?: null,
                    'domicilio' => trim((string)($identity['domicilio'] ?? '') . ' ' . (string)($identity['numero'] ?? '')),
                    'telefono' => trim((string)(($identity['telefono_movil'] ?? '') ?: ($identity['telefono_fijo'] ?? '') ?: '')),
                    'cobrador' => (string)($historical['cobrador'] ?? 'SIN COBRADOR'),
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
