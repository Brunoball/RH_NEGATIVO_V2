<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_soporte.php';

abstract class CuotasConsultas extends CuotasSoporte
{
    protected static function listarDatos(PDO $db, array $filters): array
    {
        $tab = strtolower(trim((string)($filters['pestana'] ?? 'deudores')));
        if (!in_array($tab, ['deudores', 'pagados', 'condonados'], true)) {
            api_error('La pestaña solicitada no es válida.', 'FILTRO_INVALIDO');
        }

        $search = clean_text($filters['buscar'] ?? '', 160, false);
        $categoryId = trim((string)($filters['categoria'] ?? ''));
        $categoryId = $categoryId === '' ? null : positive_id($categoryId, 'categoría');

        $yearText = trim((string)($filters['anio'] ?? ''));
        $year = $yearText === '' ? null : filter_var($yearText, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 2000, 'max_range' => self::maximumEnabledYear()],
        ]);
        if ($year === false) api_error('El año seleccionado no es válido.', 'FILTRO_INVALIDO');
        $year = $year === null ? null : (int)$year;

        $monthText = trim((string)($filters['mes'] ?? ''));
        $month = $monthText === '' ? null : filter_var($monthText, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 12],
        ]);
        if ($month === false) api_error('El mes seleccionado no es válido.', 'FILTRO_INVALIDO');
        $month = $month === null ? null : (int)$month;

        $modalityText = self::upper(clean_text($filters['modalidad'] ?? '', 40, false));
        $allowedModalities = ['', 'MENSUAL', 'PRIMERA_MITAD', 'SEGUNDA_MITAD', 'CONTADO_ANUAL', 'INSCRIPCION'];
        if (!in_array($modalityText, $allowedModalities, true)) {
            api_error('La modalidad seleccionada no es válida.', 'FILTRO_INVALIDO');
        }
        $modality = $modalityText === '' ? null : $modalityText;

        $result = $tab === 'deudores'
            ? self::listarDeudores($db, $search, $categoryId, $year, $month)
            : self::listarOperaciones(
                $db,
                $tab === 'pagados' ? 'PAGADO' : 'CONDONADO',
                $search,
                $categoryId,
                $year,
                $month,
                $modality
            );

        $result['catalogos'] = [
            'categorias' => self::categoriasCatalogo($db, false),
            'anios' => self::aniosCatalogo($db),
            'meses' => self::mesesCatalogo($db),
            'modalidades' => self::modalidadesCatalogo($db),
        ];
        $result['filtros'] = [
            'anio' => $year,
            'mes' => $month,
            'modalidad' => $modality,
        ];
        return $result;
    }

    protected static function catalogosDatos(PDO $db): array
    {
        $socios = $db->query(
            'SELECT s.id_socio, s.apellido, s.nombre, s.dni, f.nombre AS familia
             FROM socios s
             LEFT JOIN familia_socios fs ON fs.id_socio = s.id_socio
             LEFT JOIN familias f ON f.id_familia = fs.id_familia AND f.activo = 1
             WHERE s.activo = 1
             ORDER BY s.apellido, s.nombre'
        )->fetchAll();
        foreach ($socios as &$socio) $socio['id_socio'] = (int)$socio['id_socio'];
        unset($socio);

        return [
            'socios' => $socios,
            'categorias' => self::categoriasCatalogo($db, true),
            'medios_pago' => self::mediosPagoCatalogo($db),
        ];
    }

    protected static function listarDeudores(
        PDO $db,
        string $search,
        ?int $categoryId,
        ?int $selectedYear,
        ?int $selectedMonth
    ): array
    {
        $where = [];
        $params = [];
        if ($search !== '') {
            $where[] = '(s.nombre LIKE :buscar_nombre OR s.apellido LIKE :buscar_apellido OR s.dni LIKE :buscar_dni OR c.nombre LIKE :buscar_categoria)';
            $term = '%' . $search . '%';
            $params = [
                'buscar_nombre' => $term,
                'buscar_apellido' => $term,
                'buscar_dni' => $term,
                'buscar_categoria' => $term,
            ];
        }
        if ($categoryId !== null) {
            $where[] = 'c.id_categoria = :categoria';
            $params['categoria'] = $categoryId;
        }

        $sqlWhere = $where === [] ? '' : ' AND ' . implode(' AND ', $where);
        $statement = $db->prepare(
            "SELECT s.id_socio, s.apellido, s.nombre, s.dni,
                    sc.id_categoria,
                    GREATEST(sc.fecha_desde, spa.vigente_desde, cpa.vigente_desde) AS fecha_desde,
                    LEAST(COALESCE(sc.fecha_hasta, '9999-12-31'),
                          COALESCE(spa.vigente_hasta, '9999-12-31'),
                          COALESCE(cpa.vigente_hasta, '9999-12-31')) AS fecha_hasta,
                    c.nombre AS categoria, c.monto_actual,
                    f.id_familia, f.nombre AS familia
             FROM socios s
             INNER JOIN socio_categorias sc ON sc.id_socio = s.id_socio
             INNER JOIN categorias c ON c.id_categoria = sc.id_categoria
             INNER JOIN socios_periodos_activos spa ON spa.id_socio = s.id_socio
             INNER JOIN categorias_periodos_activos cpa ON cpa.id_categoria = c.id_categoria
             LEFT JOIN familia_socios fs ON fs.id_socio = s.id_socio
             LEFT JOIN familias f ON f.id_familia = fs.id_familia AND f.activo = 1
             WHERE GREATEST(sc.fecha_desde, spa.vigente_desde, cpa.vigente_desde)
                   <= LEAST(COALESCE(sc.fecha_hasta, '9999-12-31'),
                            COALESCE(spa.vigente_hasta, '9999-12-31'),
                            COALESCE(cpa.vigente_hasta, '9999-12-31'))
                   {$sqlWhere}
             ORDER BY s.apellido, s.nombre, c.nombre, fecha_desde"
        );
        $statement->execute($params);
        $assignments = $statement->fetchAll();
        if ($assignments === []) {
            return ['items' => [], 'resumen' => ['registros' => 0, 'periodos' => 0, 'monto' => '0.00']];
        }

        $paymentRows = $db->query(
            "SELECT id_socio, id_categoria, anio, id_mes, estado
             FROM pagos WHERE estado IN ('PAGADO','CONDONADO')"
        )->fetchAll();
        $registered = [];
        foreach ($paymentRows as $payment) {
            $registered[self::periodKey((int)$payment['id_socio'], (int)$payment['id_categoria'], (int)$payment['anio'], (int)$payment['id_mes'])] = $payment['estado'];
        }

        $categoryIds = array_values(array_unique(array_map(static fn(array $row): int => (int)$row['id_categoria'], $assignments)));
        $prices = self::priceHistory($db, $categoryIds);
        $rules = self::discountRules($db);
        $familyCounts = self::familyCounts($db);
        // Cada socio conserva su deuda individual. Para permitir el pago
        // anticipado, se muestran los períodos hasta diciembre del año
        // consultado (o del año actual cuando no hay filtro de año).
        $listingEndYear = $selectedYear ?? (int)date('Y');
        $listingEndMonth = new DateTimeImmutable($listingEndYear . '-12-01');
        $itemsByPartnerCategory = [];

        foreach ($assignments as $assignment) {
            $start = new DateTimeImmutable(substr((string)$assignment['fecha_desde'], 0, 7) . '-01');
            $end = $listingEndMonth;
            $assignmentEnd = self::lastChargeableMonth($assignment['fecha_hasta'] ?? null);
            if ($assignmentEnd !== null && $assignmentEnd < $end) {
                $end = $assignmentEnd;
            }
            if ($start > $end) continue;

            $itemKey = (int)$assignment['id_socio'] . '-' . (int)$assignment['id_categoria'];
            $familyId = $assignment['id_familia'] === null ? null : (int)$assignment['id_familia'];
            $memberCount = $familyId === null ? 0 : ($familyCounts[$familyId] ?? 0);
            $discount = self::discountForCount($rules, $memberCount);
            if (!isset($itemsByPartnerCategory[$itemKey])) {
                $itemsByPartnerCategory[$itemKey] = [
                    'id_socio' => (int)$assignment['id_socio'],
                    'socio' => trim($assignment['apellido'] . ', ' . $assignment['nombre']),
                    'dni' => (string)$assignment['dni'],
                    'id_categoria' => (int)$assignment['id_categoria'],
                    'categoria' => (string)$assignment['categoria'],
                    'id_familia' => $familyId,
                    'familia' => $assignment['familia'],
                    'cantidad_integrantes' => $memberCount,
                    'porcentaje_descuento' => number_format($discount, 2, '.', ''),
                    'periodos_pendientes' => [],
                ];
            }

            for ($period = $start; $period <= $end; $period = $period->modify('+1 month')) {
                $year = (int)$period->format('Y');
                $month = (int)$period->format('n');
                if ($selectedYear !== null && $year !== $selectedYear) continue;
                if ($selectedMonth !== null && $month !== $selectedMonth) continue;
                $key = self::periodKey((int)$assignment['id_socio'], (int)$assignment['id_categoria'], $year, $month);
                if (isset($registered[$key])) continue;
                $base = self::priceForPeriod($prices[(int)$assignment['id_categoria']] ?? [], (float)$assignment['monto_actual'], $year, $month);
                $amount = self::amountWithFamilyDiscount($base, $discount);
                $label = self::monthName($month) . ' ' . $year;
                $itemsByPartnerCategory[$itemKey]['periodos_pendientes'][$key] = [
                    'anio' => $year,
                    'mes' => $month,
                    'label' => $label,
                    'monto_base' => $base,
                    'monto' => $amount,
                ];
            }
        }

        $items = [];
        $totalPeriods = 0;
        $totalAmount = 0.0;
        foreach ($itemsByPartnerCategory as $item) {
            $periods = array_values($item['periodos_pendientes']);
            usort($periods, static fn(array $a, array $b): int => [$a['anio'], $a['mes']] <=> [$b['anio'], $b['mes']]);
            if ($periods === []) continue;
            unset($item['periodos_pendientes']);
            $baseTotal = array_sum(array_column($periods, 'monto_base'));
            $amountTotal = array_sum(array_column($periods, 'monto'));
            $item['cantidad_periodos'] = count($periods);
            $item['primer_periodo'] = array_intersect_key($periods[0], array_flip(['anio', 'mes', 'label']));
            $item['ultimo_periodo'] = array_intersect_key($periods[count($periods) - 1], array_flip(['anio', 'mes', 'label']));
            $item['monto_base'] = number_format($baseTotal, 2, '.', '');
            $item['monto'] = number_format($amountTotal, 2, '.', '');
            $items[] = $item;
            $totalPeriods += count($periods);
            $totalAmount += $amountTotal;
        }

        return [
            'items' => $items,
            'resumen' => [
                'registros' => count($items),
                'periodos' => $totalPeriods,
                'monto' => number_format($totalAmount, 2, '.', ''),
            ],
        ];
    }

    protected static function listarOperaciones(
        PDO $db,
        string $status,
        string $search,
        ?int $categoryId,
        ?int $selectedYear,
        ?int $selectedMonth,
        ?string $selectedModality = null
    ): array
    {
        $allRows = array_merge(
            self::paymentRows($db, $status),
            self::registrationRows($db, $status)
        );
        $rows = $allRows;

        // El filtro se aplica sobre las líneas antes de agrupar. Los paquetes
        // semestrales/anuales se conservan completos cuando incluyen el mes
        // consultado, de manera que una anulación nunca corte solo una parte.
        $rows = array_values(array_filter(
            $rows,
            static function (array $row) use (
                $categoryId,
                $selectedYear,
                $selectedMonth,
                $selectedModality
            ): bool {
                if ($categoryId !== null && (int)$row['id_categoria'] !== $categoryId) {
                    return false;
                }
                if ($selectedYear !== null && (int)$row['anio'] !== $selectedYear) {
                    return false;
                }

                $modalityCode = self::upper((string)(
                    $row['modalidad_codigo']
                    ?? ($row['tipo_registro'] === 'INSCRIPCION' ? 'INSCRIPCION' : 'MENSUAL')
                ));

                // Una inscripción no pertenece a un mes de cuota. Por eso no
                // debe aparecer en "Pagados/Condonados del mes". Solo se
                // incluye cuando se elige expresamente el filtro INSCRIPCIÓN
                // o cuando la consulta no está acotada a ningún mes.
                if ($row['tipo_registro'] === 'INSCRIPCION') {
                    if ($selectedModality === 'INSCRIPCION') {
                        return true;
                    }
                    return $selectedModality === null && $selectedMonth === null;
                }

                if ($selectedModality !== null && $modalityCode !== $selectedModality) {
                    return false;
                }

                if ($selectedMonth !== null && $row['tipo_registro'] === 'CUOTA') {
                    if (
                        !self::isPackageModality($modalityCode)
                        && (int)$row['id_mes'] !== $selectedMonth
                    ) {
                        return false;
                    }
                }
                return true;
            }
        ));

        // Cuotas e inscripción registradas desde el mismo modal comparten un
        // código COB-* y forman un único cobro atómico. Si cualquier línea
        // coincide con los filtros, se recuperan también las demás líneas de
        // ese cobro para mostrar el total real y evitar anulaciones parciales.
        $matchedKeys = [];
        $combinedCodes = [];
        foreach ($rows as $row) {
            $matchedKeys[$row['tipo_registro'] . '-' . $row['id_linea']] = true;
            $rowCode = (string)$row['codigo_operacion'];
            if (preg_match('/^(?:COND-)?COB-/', $rowCode) === 1) {
                $combinedCodes[$rowCode] = true;
            }
        }
        if ($combinedCodes !== []) {
            $rows = array_values(array_filter(
                $allRows,
                static function (array $row) use ($matchedKeys, $combinedCodes): bool {
                    $key = $row['tipo_registro'] . '-' . $row['id_linea'];
                    return isset($matchedKeys[$key])
                        || isset($combinedCodes[(string)$row['codigo_operacion']]);
                }
            ));
        }

        $operations = self::groupOperations($rows, true);
        if ($selectedMonth !== null) {
            $operations = array_values(array_filter(
                $operations,
                static function (array $operation) use ($selectedMonth, $selectedModality): bool {
                    if ($operation['tipo'] === 'INSCRIPCION') {
                        return $selectedModality === 'INSCRIPCION';
                    }
                    if (!$operation['es_paquete']) {
                        return true;
                    }
                    foreach ($operation['lineas'] as $line) {
                        if ((int)($line['id_mes'] ?? 0) === $selectedMonth) {
                            return true;
                        }
                    }
                    return false;
                }
            ));
        }

        $needle = self::lower($search);
        $operations = array_values(array_filter(
            $operations,
            static function (array $operation) use ($needle): bool {
                return $needle === ''
                    || str_contains(self::lower((string)$operation['busqueda']), $needle);
            }
        ));

        usort($operations, static function (array $a, array $b): int {
            $byOperation = strcmp(
                (string)$b['fecha_pago'] . (string)$b['codigo_operacion'],
                (string)$a['fecha_pago'] . (string)$a['codigo_operacion']
            );
            return $byOperation !== 0
                ? $byOperation
                : strcmp((string)$a['socios_label'], (string)$b['socios_label']);
        });

        $collected = 0.0;
        $base = 0.0;
        foreach ($operations as $operation) {
            $collected += (float)$operation['monto'];
            $base += (float)$operation['monto_base'];
        }

        return [
            'items' => $operations,
            'resumen' => [
                'registros' => count($operations),
                'monto_base' => number_format($base, 2, '.', ''),
                'monto' => number_format($collected, 2, '.', ''),
            ],
        ];
    }

    protected static function detalleSocioDatos(PDO $db, int $partnerId): array
    {
        $statement = $db->prepare('SELECT id_socio, apellido, nombre, dni, fecha_ingreso, activo FROM socios WHERE id_socio = ?');
        $statement->execute([$partnerId]);
        $principal = $statement->fetch();
        if (!$principal) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

        $family = null;
        if ((bool)$principal['activo']) {
            $familyStatement = $db->prepare(
                'SELECT f.id_familia, f.nombre
                 FROM familia_socios fs INNER JOIN familias f ON f.id_familia = fs.id_familia
                 WHERE fs.id_socio = ? AND f.activo = 1 LIMIT 1'
            );
            $familyStatement->execute([$partnerId]);
            $family = $familyStatement->fetch() ?: null;
        }

        if ($family) {
            $membersStatement = $db->prepare(
                'SELECT s.id_socio, s.apellido, s.nombre, s.dni, s.fecha_ingreso, s.activo
                 FROM familia_socios fs INNER JOIN socios s ON s.id_socio = fs.id_socio
                 WHERE fs.id_familia = ? AND s.activo = 1
                 ORDER BY s.apellido, s.nombre'
            );
            $membersStatement->execute([(int)$family['id_familia']]);
            $members = $membersStatement->fetchAll();
        } else {
            $members = [$principal];
        }
        $memberIds = array_map(static fn(array $member): int => (int)$member['id_socio'], $members);
        $placeholders = implode(',', array_fill(0, count($memberIds), '?'));

        $assignmentsStatement = $db->prepare(
            "SELECT sc.id_socio, sc.id_categoria,
                    GREATEST(sc.fecha_desde, spa.vigente_desde, cpa.vigente_desde) AS fecha_desde,
                    LEAST(COALESCE(sc.fecha_hasta, '9999-12-31'),
                          COALESCE(spa.vigente_hasta, '9999-12-31'),
                          COALESCE(cpa.vigente_hasta, '9999-12-31')) AS fecha_hasta,
                    c.nombre AS categoria, c.monto_actual
             FROM socio_categorias sc
             INNER JOIN categorias c ON c.id_categoria = sc.id_categoria
             INNER JOIN socios_periodos_activos spa ON spa.id_socio = sc.id_socio
             INNER JOIN categorias_periodos_activos cpa ON cpa.id_categoria = sc.id_categoria
             WHERE sc.id_socio IN ({$placeholders})
               AND GREATEST(sc.fecha_desde, spa.vigente_desde, cpa.vigente_desde)
                   <= LEAST(COALESCE(sc.fecha_hasta, '9999-12-31'),
                            COALESCE(spa.vigente_hasta, '9999-12-31'),
                            COALESCE(cpa.vigente_hasta, '9999-12-31'))
             ORDER BY c.nombre, fecha_desde"
        );
        $assignmentsStatement->execute($memberIds);
        $assignments = $assignmentsStatement->fetchAll();

        $categoryIds = array_values(array_unique(array_map(static fn(array $row): int => (int)$row['id_categoria'], $assignments)));
        $prices = self::priceHistory($db, $categoryIds);
        $paymentsStatement = $db->prepare(
            "SELECT id_pago, id_socio, id_categoria, anio, id_mes, estado
             FROM pagos
             WHERE id_socio IN ({$placeholders}) AND estado IN ('PAGADO','CONDONADO')"
        );
        $paymentsStatement->execute($memberIds);
        $paymentMap = [];
        foreach ($paymentsStatement->fetchAll() as $payment) {
            $paymentMap[self::periodKey((int)$payment['id_socio'], (int)$payment['id_categoria'], (int)$payment['anio'], (int)$payment['id_mes'])] = $payment;
        }

        $rules = self::discountRules($db);
        $memberCount = count($members);
        $discount = $family ? self::discountForCount($rules, $memberCount) : 0.0;
        $currentYear = (int)date('Y');
        $maximumEnabledYear = self::maximumEnabledYear();
        $endOfEnabledYear = new DateTimeImmutable($maximumEnabledYear . '-12-01');
        $periods = [];
        $earliestYear = $currentYear;
        $memberMap = [];
        foreach ($members as &$member) {
            $member['id_socio'] = (int)$member['id_socio'];
            $member['activo'] = (bool)$member['activo'];
            $member['socio'] = trim($member['apellido'] . ', ' . $member['nombre']);
            $member['es_principal'] = $member['id_socio'] === $partnerId;
            $memberMap[$member['id_socio']] = $member;
        }
        unset($member);

        foreach ($assignments as $assignment) {
            $member = $memberMap[(int)$assignment['id_socio']];
            $start = new DateTimeImmutable(substr((string)$assignment['fecha_desde'], 0, 7) . '-01');
            $earliestYear = min($earliestYear, (int)$start->format('Y'));
            $end = $endOfEnabledYear;
            $assignmentEnd = self::lastChargeableMonth($assignment['fecha_hasta'] ?? null);
            if ($assignmentEnd !== null && $assignmentEnd < $end) {
                $end = $assignmentEnd;
            }
            if ($start > $end) continue;

            for ($period = $start; $period <= $end; $period = $period->modify('+1 month')) {
                $year = (int)$period->format('Y');
                $month = (int)$period->format('n');
                $key = self::periodKey((int)$assignment['id_socio'], (int)$assignment['id_categoria'], $year, $month);
                $payment = $paymentMap[$key] ?? null;
                $base = self::priceForPeriod($prices[(int)$assignment['id_categoria']] ?? [], (float)$assignment['monto_actual'], $year, $month);
                $amount = self::amountWithFamilyDiscount($base, $discount);
                $periods[$key] = [
                    'clave' => $key,
                    'id_socio' => (int)$assignment['id_socio'],
                    'socio' => $member['socio'],
                    'id_categoria' => (int)$assignment['id_categoria'],
                    'categoria' => (string)$assignment['categoria'],
                    'anio' => $year,
                    'id_mes' => $month,
                    'mes' => self::monthName($month),
                    'periodo' => self::monthName($month) . ' ' . $year,
                    'estado' => $payment['estado'] ?? 'PENDIENTE',
                    'es_futuro' => $period > new DateTimeImmutable(date('Y-m-01')),
                    'monto_base' => number_format($base, 2, '.', ''),
                    'porcentaje_descuento' => number_format($discount, 2, '.', ''),
                    'monto' => number_format($amount, 2, '.', ''),
                ];
            }
        }

        $periods = array_values($periods);
        usort($periods, static function (array $a, array $b): int {
            return [$a['socio'], $a['categoria'], -$a['anio'], $a['id_mes']] <=> [$b['socio'], $b['categoria'], -$b['anio'], $b['id_mes']];
        });

        $registrationsStatement = $db->prepare(
            "SELECT id_pago_inscripcion, id_socio, id_categoria, anio, estado
             FROM pagos_inscripciones
             WHERE id_socio IN ({$placeholders}) AND estado IN ('PAGADO','CONDONADO')"
        );
        $registrationsStatement->execute($memberIds);
        $registrations = $registrationsStatement->fetchAll();
        foreach ($registrations as &$registration) {
            $registration['id_pago_inscripcion'] = (int)$registration['id_pago_inscripcion'];
            $registration['id_socio'] = (int)$registration['id_socio'];
            $registration['id_categoria'] = (int)$registration['id_categoria'];
            $registration['anio'] = (int)$registration['anio'];
        }
        unset($registration);

        // El selector del modal se arma con categorías que realmente tienen
        // algún período válido. Una asignación quitada en el mismo mes ya no
        // queda visible como opción vacía ni vuelve a generar deuda fantasma.
        $categories = [];
        foreach ($periods as $period) {
            $id = (int)$period['id_categoria'];
            $categories[$id] = [
                'id_categoria' => $id,
                'nombre' => (string)$period['categoria'],
            ];
        }

        $years = [];
        for ($year = $maximumEnabledYear; $year >= $earliestYear; $year--) $years[] = $year;
        return [
            'socio' => $memberMap[$partnerId],
            'familia' => $family ? [
                'id_familia' => (int)$family['id_familia'],
                'nombre' => $family['nombre'],
                'cantidad_integrantes' => $memberCount,
                'porcentaje_descuento' => number_format($discount, 2, '.', ''),
            ] : null,
            'integrantes' => array_values($memberMap),
            'categorias' => array_values($categories),
            'periodos' => $periods,
            'inscripciones' => $registrations,
            'anios' => $years,
            'anio_maximo_habilitado' => $maximumEnabledYear,
            'medios_pago' => self::mediosPagoCatalogo($db),
            'modalidades' => self::modalidadesCatalogo($db),
            'monto_inscripcion' => self::registrationAmount($db),
        ];
    }

    protected static function aniosCatalogo(PDO $db): array
    {
        $currentYear = (int)date('Y');
        $maximumEnabledYear = self::maximumEnabledYear();
        $earliest = $db->query(
            "SELECT MIN(anio) FROM (
                SELECT YEAR(GREATEST(sc.fecha_desde, spa.vigente_desde, cpa.vigente_desde)) AS anio
                FROM socio_categorias sc
                INNER JOIN socios_periodos_activos spa ON spa.id_socio = sc.id_socio
                INNER JOIN categorias_periodos_activos cpa ON cpa.id_categoria = sc.id_categoria
                WHERE GREATEST(sc.fecha_desde, spa.vigente_desde, cpa.vigente_desde)
                      <= LEAST(COALESCE(sc.fecha_hasta, '9999-12-31'), COALESCE(spa.vigente_hasta, '9999-12-31'), COALESCE(cpa.vigente_hasta, '9999-12-31'))
                UNION ALL SELECT anio FROM pagos
                UNION ALL SELECT anio FROM pagos_inscripciones
             ) periodos"
        )->fetchColumn();
        $firstYear = max(2000, min($currentYear, (int)($earliest ?: $currentYear)));
        $years = [];
        for ($year = $maximumEnabledYear; $year >= $firstYear; $year--) $years[] = $year;
        return $years;
    }

    protected static function mesesCatalogo(PDO $db): array
    {
        $rows = $db->query('SELECT id_mes, nombre FROM meses ORDER BY id_mes')->fetchAll();
        foreach ($rows as &$row) $row['id_mes'] = (int)$row['id_mes'];
        unset($row);
        return $rows;
    }

    protected static function modalidadesCatalogo(PDO $db): array
    {
        $fallback = [
            ['id_modalidad_pago' => null, 'codigo' => 'MENSUAL', 'nombre' => 'CUOTAS MENSUALES', 'mes_desde' => null, 'mes_hasta' => null, 'cantidad_meses' => 1],
            ['id_modalidad_pago' => null, 'codigo' => 'PRIMERA_MITAD', 'nombre' => 'PRIMERA MITAD', 'mes_desde' => 1, 'mes_hasta' => 6, 'cantidad_meses' => 6],
            ['id_modalidad_pago' => null, 'codigo' => 'SEGUNDA_MITAD', 'nombre' => 'SEGUNDA MITAD', 'mes_desde' => 7, 'mes_hasta' => 12, 'cantidad_meses' => 6],
            ['id_modalidad_pago' => null, 'codigo' => 'CONTADO_ANUAL', 'nombre' => 'CONTADO ANUAL', 'mes_desde' => 1, 'mes_hasta' => 12, 'cantidad_meses' => 12],
            ['id_modalidad_pago' => null, 'codigo' => 'INSCRIPCION', 'nombre' => 'INSCRIPCIÓN', 'mes_desde' => null, 'mes_hasta' => null, 'cantidad_meses' => 0],
        ];

        try {
            $map = self::modalitiesMap($db);
        } catch (Throwable) {
            $map = [];
        }

        $rows = [];
        foreach ($fallback as $default) {
            $code = $default['codigo'];
            $row = isset($map[$code]) ? ($map[$code] + $default) : $default;
            $row['es_paquete'] = self::isPackageModality($code);
            $rows[] = $row;
        }
        return $rows;
    }

    protected static function categoriasCatalogo(PDO $db, bool $onlyActive): array
    {
        $rows = $db->query(
            'SELECT id_categoria, nombre, monto_actual, activo FROM categorias '
            . ($onlyActive ? 'WHERE activo = 1 ' : '')
            . 'ORDER BY activo DESC, nombre'
        )->fetchAll();
        foreach ($rows as &$row) {
            $row['id_categoria'] = (int)$row['id_categoria'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);
        return $rows;
    }

    protected static function mediosPagoCatalogo(PDO $db): array
    {
        $rows = $db->query("SELECT id_medio_pago, nombre FROM medios_pago WHERE activo = 1 AND nombre <> 'CONDONACIÓN' ORDER BY nombre")->fetchAll();
        foreach ($rows as &$row) $row['id_medio_pago'] = (int)$row['id_medio_pago'];
        unset($row);
        return $rows;
    }

    /**
     * Devuelve las columnas reales de una tabla del sistema. Esto permite leer
     * pagos históricos creados antes de las últimas migraciones sin provocar
     * un error 500 por una columna opcional todavía ausente.
     */
    protected static function columnasTabla(PDO $db, string $table): array
    {
        static $cache = [];
        $allowed = ['pagos', 'pagos_inscripciones', 'modalidades_pago'];
        if (!in_array($table, $allowed, true)) {
            throw new InvalidArgumentException('Tabla no permitida para inspección.');
        }

        $key = spl_object_id($db) . ':' . $table;
        if (isset($cache[$key])) return $cache[$key];

        try {
            $statement = $db->prepare(
                'SELECT COLUMN_NAME
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
            );
            $statement->execute([$table]);
            $names = $statement->fetchAll(PDO::FETCH_COLUMN);
            $cache[$key] = array_fill_keys(array_map('strval', $names), true);
        } catch (Throwable) {
            // Las columnas básicas pertenecen a la estructura original.
            // Las opcionales se omiten de la consulta si no se pudieron leer.
            $cache[$key] = [];
        }
        return $cache[$key];
    }

    protected static function paymentRows(PDO $db, ?string $status = null, ?string $code = null, ?int $id = null): array
    {
        $columns = self::columnasTabla($db, 'pagos');
        $has = static fn(string $column): bool => isset($columns[$column]);

        $where = [];
        $params = [];
        if ($status !== null) {
            $where[] = 'p.estado = ?';
            $params[] = $status;
        }
        if ($code !== null) {
            if ($has('codigo_operacion')) {
                $where[] = 'p.codigo_operacion = ?';
                $params[] = $code;
            } elseif (preg_match('/^PAGO-(\d+)$/', $code, $match)) {
                $where[] = 'p.id_pago = ?';
                $params[] = (int)$match[1];
            } else {
                return [];
            }
        }
        if ($id !== null) {
            $where[] = 'p.id_pago = ?';
            $params[] = $id;
        }
        $sqlWhere = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);

        $operationExpression = $has('codigo_operacion')
            ? "COALESCE(NULLIF(p.codigo_operacion, ''), CONCAT('PAGO-', p.id_pago))"
            : "CONCAT('PAGO-', p.id_pago)";
        $partnerExpression = $has('socio_nombre_snapshot')
            ? "COALESCE(NULLIF(p.socio_nombre_snapshot, ''), CONCAT(s.apellido, ', ', s.nombre))"
            : "CONCAT(s.apellido, ', ', s.nombre)";
        $documentExpression = $has('socio_dni_snapshot')
            ? "COALESCE(NULLIF(p.socio_dni_snapshot, ''), s.dni)"
            : 's.dni';
        $categoryExpression = $has('categoria_nombre_snapshot')
            ? "COALESCE(NULLIF(p.categoria_nombre_snapshot, ''), c.nombre)"
            : 'c.nombre';
        $mediumExpression = $has('medio_pago_nombre_snapshot')
            ? "COALESCE(NULLIF(p.medio_pago_nombre_snapshot, ''), mp.nombre)"
            : 'mp.nombre';
        $modalityIdExpression = $has('id_modalidad_pago')
            ? 'p.id_modalidad_pago'
            : 'NULL';
        $modalityDiscountExpression = $has('porcentaje_descuento_modalidad')
            ? 'p.porcentaje_descuento_modalidad'
            : '0';
        $familyDiscountExpression = $has('porcentaje_descuento_familiar')
            ? 'p.porcentaje_descuento_familiar'
            : '0';
        $baseExpression = $has('monto_base') ? 'p.monto_base' : 'p.monto';
        $reasonExpression = $has('motivo_condonacion')
            ? 'p.motivo_condonacion'
            : 'NULL';
        $observationsExpression = $has('observaciones')
            ? 'p.observaciones'
            : 'NULL';

        $statement = $db->prepare(
            "SELECT 'CUOTA' AS tipo_registro,
                    p.id_pago AS id_linea,
                    {$operationExpression} AS codigo_operacion,
                    p.id_socio,
                    {$partnerExpression} AS socio,
                    {$documentExpression} AS dni,
                    p.id_categoria,
                    {$categoryExpression} AS categoria,
                    p.anio,
                    p.id_mes,
                    COALESCE(m.nombre, CONCAT('MES ', p.id_mes)) AS periodo,
                    {$modalityIdExpression} AS id_modalidad_pago,
                    {$baseExpression} AS monto_base,
                    {$modalityDiscountExpression} AS porcentaje_descuento_modalidad,
                    {$familyDiscountExpression} AS porcentaje_descuento_familiar,
                    p.monto,
                    p.fecha_pago,
                    p.estado,
                    {$reasonExpression} AS motivo_condonacion,
                    {$observationsExpression} AS observaciones,
                    {$mediumExpression} AS medio_pago
             FROM pagos p
             LEFT JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
             LEFT JOIN meses m ON m.id_mes = p.id_mes
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             {$sqlWhere}
             ORDER BY p.fecha_pago DESC, p.id_pago DESC"
        );
        $statement->execute($params);
        $rows = $statement->fetchAll();

        $modalitiesById = [];
        if ($has('id_modalidad_pago')) {
            try {
                foreach (self::modalitiesMap($db) as $modality) {
                    $modalitiesById[(int)$modality['id_modalidad_pago']] = $modality;
                }
            } catch (Throwable) {
                $modalitiesById = [];
            }
        }

        foreach ($rows as &$row) {
            $modalityId = $row['id_modalidad_pago'] === null
                ? null
                : (int)$row['id_modalidad_pago'];
            $modality = $modalityId === null
                ? null
                : ($modalitiesById[$modalityId] ?? null);
            $row['modalidad_codigo'] = $modality['codigo'] ?? 'MENSUAL';
            $row['modalidad_nombre'] = $modality['nombre'] ?? self::modalityLabel((string)$row['modalidad_codigo']);
        }
        unset($row);
        return $rows;
    }

    protected static function registrationRows(PDO $db, ?string $status = null, ?string $code = null, ?int $id = null): array
    {
        $columns = self::columnasTabla($db, 'pagos_inscripciones');
        $has = static fn(string $column): bool => isset($columns[$column]);

        $where = [];
        $params = [];
        if ($status !== null) {
            $where[] = 'pi.estado = ?';
            $params[] = $status;
        }
        if ($code !== null) {
            if ($has('codigo_operacion')) {
                $where[] = 'pi.codigo_operacion = ?';
                $params[] = $code;
            } elseif (preg_match('/^INSCRIPCION-(\d+)$/', $code, $match)) {
                $where[] = 'pi.id_pago_inscripcion = ?';
                $params[] = (int)$match[1];
            } else {
                return [];
            }
        }
        if ($id !== null) {
            $where[] = 'pi.id_pago_inscripcion = ?';
            $params[] = $id;
        }
        $sqlWhere = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);

        $operationExpression = $has('codigo_operacion')
            ? "COALESCE(NULLIF(pi.codigo_operacion, ''), CONCAT('INSCRIPCION-', pi.id_pago_inscripcion))"
            : "CONCAT('INSCRIPCION-', pi.id_pago_inscripcion)";
        $partnerExpression = $has('socio_nombre_snapshot')
            ? "COALESCE(NULLIF(pi.socio_nombre_snapshot, ''), CONCAT(s.apellido, ', ', s.nombre))"
            : "CONCAT(s.apellido, ', ', s.nombre)";
        $documentExpression = $has('socio_dni_snapshot')
            ? "COALESCE(NULLIF(pi.socio_dni_snapshot, ''), s.dni)"
            : 's.dni';
        $categoryExpression = $has('categoria_nombre_snapshot')
            ? "COALESCE(NULLIF(pi.categoria_nombre_snapshot, ''), c.nombre)"
            : 'c.nombre';
        $mediumExpression = $has('medio_pago_nombre_snapshot')
            ? "COALESCE(NULLIF(pi.medio_pago_nombre_snapshot, ''), mp.nombre)"
            : 'mp.nombre';
        $yearExpression = $has('anio') ? 'pi.anio' : 'YEAR(pi.fecha_pago)';
        $baseExpression = $has('monto_base') ? 'pi.monto_base' : 'pi.monto';
        $familyDiscountExpression = $has('porcentaje_descuento_familiar')
            ? 'pi.porcentaje_descuento_familiar'
            : '0';
        $reasonExpression = $has('motivo_condonacion')
            ? 'pi.motivo_condonacion'
            : 'NULL';
        $observationsExpression = $has('observaciones')
            ? 'pi.observaciones'
            : 'NULL';

        $statement = $db->prepare(
            "SELECT 'INSCRIPCION' AS tipo_registro,
                    pi.id_pago_inscripcion AS id_linea,
                    {$operationExpression} AS codigo_operacion,
                    pi.id_socio,
                    {$partnerExpression} AS socio,
                    {$documentExpression} AS dni,
                    pi.id_categoria,
                    {$categoryExpression} AS categoria,
                    {$yearExpression} AS anio,
                    NULL AS id_mes,
                    pi.descripcion AS periodo,
                    NULL AS id_modalidad_pago,
                    'INSCRIPCION' AS modalidad_codigo,
                    'INSCRIPCIÓN' AS modalidad_nombre,
                    {$baseExpression} AS monto_base,
                    0 AS porcentaje_descuento_modalidad,
                    {$familyDiscountExpression} AS porcentaje_descuento_familiar,
                    pi.monto,
                    pi.fecha_pago,
                    pi.estado,
                    {$reasonExpression} AS motivo_condonacion,
                    {$observationsExpression} AS observaciones,
                    {$mediumExpression} AS medio_pago
             FROM pagos_inscripciones pi
             LEFT JOIN socios s ON s.id_socio = pi.id_socio
             LEFT JOIN categorias c ON c.id_categoria = pi.id_categoria
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = pi.id_medio_pago
             {$sqlWhere}
             ORDER BY pi.fecha_pago DESC, pi.id_pago_inscripcion DESC"
        );
        $statement->execute($params);
        return $statement->fetchAll();
    }

    protected static function groupOperations(array $rows, bool $separateByPartner = false): array
    {
        $grouped = [];
        foreach ($rows as $row) {
            $code = (string)$row['codigo_operacion'];
            $groupKey = $separateByPartner ? $code . '-SOCIO-' . (int)$row['id_socio'] : $code;
            $modalityCode = self::upper((string)($row['modalidad_codigo'] ?? ($row['tipo_registro'] === 'INSCRIPCION' ? 'INSCRIPCION' : 'MENSUAL')));
            $modalityName = (string)($row['modalidad_nombre'] ?? self::modalityLabel($modalityCode));
            if (!isset($grouped[$groupKey])) {
                $grouped[$groupKey] = [
                    'codigo_operacion' => $code,
                    'tipo' => $row['tipo_registro'],
                    'estado' => $row['estado'],
                    'fecha_pago' => $row['fecha_pago'],
                    'medio_pago' => $row['medio_pago'],
                    'motivo_condonacion' => $row['motivo_condonacion'],
                    'observaciones' => $row['observaciones'],
                    'socios_map' => [],
                    'dni_map' => [],
                    'categorias_map' => [],
                    'modalidades_map' => [],
                    'descuentos_familia_map' => [],
                    'descuentos_modalidad_map' => [],
                    'monto_base_num' => 0.0,
                    'monto_num' => 0.0,
                    'lineas' => [],
                ];
            }
            $grouped[$groupKey]['socios_map'][(int)$row['id_socio']] = $row['socio'];
            $grouped[$groupKey]['dni_map'][(int)$row['id_socio']] = (string)$row['dni'];
            $grouped[$groupKey]['categorias_map'][(int)$row['id_categoria']] = $row['categoria'];
            $grouped[$groupKey]['modalidades_map'][$modalityCode] = $modalityName;
            $grouped[$groupKey]['descuentos_familia_map'][(string)$row['porcentaje_descuento_familiar']] = (float)$row['porcentaje_descuento_familiar'];
            $grouped[$groupKey]['descuentos_modalidad_map'][(string)($row['porcentaje_descuento_modalidad'] ?? 0)] = (float)($row['porcentaje_descuento_modalidad'] ?? 0);
            $grouped[$groupKey]['monto_base_num'] += (float)$row['monto_base'];
            $grouped[$groupKey]['monto_num'] += (float)$row['monto'];
            $periodLabel = $row['tipo_registro'] === 'INSCRIPCION'
                ? $row['periodo'] . ' (' . $row['anio'] . ')'
                : $row['periodo'] . ' ' . $row['anio'];
            $grouped[$groupKey]['lineas'][] = [
                'id_linea' => (int)$row['id_linea'],
                'tipo' => $row['tipo_registro'],
                'id_socio' => (int)$row['id_socio'],
                'id_categoria' => (int)$row['id_categoria'],
                'anio' => (int)$row['anio'],
                'id_mes' => $row['id_mes'] === null ? null : (int)$row['id_mes'],
                'id_modalidad_pago' => $row['id_modalidad_pago'] === null ? null : (int)$row['id_modalidad_pago'],
                'modalidad_codigo' => $modalityCode,
                'modalidad' => $modalityName,
                'socio' => $row['socio'],
                'dni' => $row['dni'],
                'categoria' => $row['categoria'],
                'periodo' => $periodLabel,
                'monto_base' => (string)$row['monto_base'],
                'porcentaje_descuento_modalidad' => (string)($row['porcentaje_descuento_modalidad'] ?? '0.00'),
                'porcentaje_descuento_familiar' => (string)$row['porcentaje_descuento_familiar'],
                'monto' => (string)$row['monto'],
            ];
        }

        $result = [];
        foreach ($grouped as $operation) {
            usort($operation['lineas'], static function (array $a, array $b): int {
                return [$a['anio'], $a['id_mes'] ?? 0, $a['id_linea']] <=> [$b['anio'], $b['id_mes'] ?? 0, $b['id_linea']];
            });
            $partners = array_values($operation['socios_map']);
            $partnerIds = array_keys($operation['socios_map']);
            $partnerDocuments = array_values($operation['dni_map']);
            $categories = array_values($operation['categorias_map']);
            $periods = array_values(array_unique(array_column($operation['lineas'], 'periodo')));
            $familyDiscounts = array_values($operation['descuentos_familia_map']);
            $modalityDiscounts = array_values($operation['descuentos_modalidad_map']);
            $modalityCodes = array_keys($operation['modalidades_map']);
            $modalityNames = array_values($operation['modalidades_map']);
            $isCombined = preg_match('/^(?:COND-)?COB-/', (string)$operation['codigo_operacion']) === 1;
            $modalityCode = $isCombined
                ? 'COBRO_COMBINADO'
                : (count($modalityCodes) === 1 ? $modalityCodes[0] : 'VARIAS');
            $modalityLabel = $isCombined
                ? 'CUOTAS + INSCRIPCIÓN'
                : (count($modalityNames) === 1 ? $modalityNames[0] : 'VARIAS MODALIDADES');
            $isPackage = !$isCombined
                && count($modalityCodes) === 1
                && self::isPackageModality($modalityCode);
            $years = array_values(array_unique(array_column($operation['lineas'], 'anio')));

            if ($isPackage && count($years) === 1) {
                $periodSummary = match ($modalityCode) {
                    'PRIMERA_MITAD' => 'ENERO A JUNIO ' . $years[0],
                    'SEGUNDA_MITAD' => 'JULIO A DICIEMBRE ' . $years[0],
                    'CONTADO_ANUAL' => 'ENERO A DICIEMBRE ' . $years[0],
                    default => implode(' · ', $periods),
                };
            } else {
                $periodSummary = count($periods) <= 6
                    ? implode(' · ', $periods)
                    : implode(' · ', array_slice($periods, 0, 5)) . ' · +' . (count($periods) - 5);
            }

            $familyDiscountLabel = count($familyDiscounts) === 1
                ? number_format($familyDiscounts[0], 2, ',', '') . '%'
                : 'VARIOS';
            $modalityDiscountLabel = count($modalityDiscounts) === 1 && $modalityDiscounts[0] > 0
                ? number_format($modalityDiscounts[0], 2, ',', '') . '% MOD.'
                : null;
            $discountLabel = $modalityDiscountLabel === null
                ? $familyDiscountLabel
                : $modalityDiscountLabel . ' · ' . $familyDiscountLabel . ' FAM.';

            $result[] = [
                'fila_id' => $operation['codigo_operacion'] . '-SOCIO-' . implode('-', $partnerIds),
                'codigo_operacion' => $operation['codigo_operacion'],
                'tipo' => $operation['tipo'],
                'concepto' => $modalityLabel,
                'modalidad_codigo' => $modalityCode,
                'modalidad_label' => $modalityLabel,
                'es_paquete' => $isPackage,
                'eliminacion_atomica' => $isPackage || $isCombined,
                'cobro_combinado' => $isCombined,
                'estado' => $operation['estado'],
                'fecha_pago' => $operation['fecha_pago'],
                'medio_pago' => $operation['medio_pago'],
                'socios' => $partners,
                'socios_label' => implode(' · ', $partners),
                'id_socio' => count($partnerIds) === 1 ? (int)$partnerIds[0] : null,
                'socio' => count($partners) === 1 ? $partners[0] : implode(' · ', $partners),
                'dni' => count($partnerDocuments) === 1 ? $partnerDocuments[0] : implode(' · ', $partnerDocuments),
                'categoria_ids' => array_keys($operation['categorias_map']),
                'categorias' => $categories,
                'categorias_label' => implode(' · ', $categories),
                'periodos' => $periods,
                'periodos_label' => $periodSummary,
                'cantidad_lineas' => count($operation['lineas']),
                'porcentaje_descuento' => count($familyDiscounts) === 1 ? number_format($familyDiscounts[0], 2, '.', '') : null,
                'descuento_label' => $discountLabel,
                'monto_base' => number_format($operation['monto_base_num'], 2, '.', ''),
                'monto' => number_format($operation['monto_num'], 2, '.', ''),
                'motivo_condonacion' => $operation['motivo_condonacion'],
                'observaciones' => $operation['observaciones'],
                'lineas' => $operation['lineas'],
                // El código se conserva únicamente para enlazar comprobantes,
                // anulaciones y auditoría. No es necesario mostrarlo al usuario.
                'busqueda' => implode(' ', [$operation['codigo_operacion'], $modalityLabel, implode(' ', $partners), implode(' ', $partnerDocuments), implode(' ', $categories), implode(' ', $periods)]),
            ];
        }
        return $result;
    }

    protected static function operacionPorCodigo(PDO $db, string $code): ?array
    {
        if (preg_match('/^PAGO-(\d+)$/', $code, $match)) {
            $rows = self::paymentRows($db, null, null, (int)$match[1]);
        } elseif (preg_match('/^INSCRIPCION-(\d+)$/', $code, $match)) {
            $rows = self::registrationRows($db, null, null, (int)$match[1]);
        } else {
            $rows = array_merge(self::paymentRows($db, null, $code), self::registrationRows($db, null, $code));
        }
        return self::groupOperations($rows)[0] ?? null;
    }
}
