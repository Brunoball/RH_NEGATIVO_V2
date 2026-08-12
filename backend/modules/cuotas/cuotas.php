<?php
declare(strict_types=1);

final class Cuotas
{
    private const TIPOS = ['PERSONA', 'EMPRESA'];
    private const ESTADOS = ['DEUDORES', 'PAGADOS', 'CONDONADOS'];
    private const MAX_PAGOS_LOTE = 200;

    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos($auth['db'], $_GET));
    }

    public static function catalogos(): never
    {
        $auth = auth_context();
        $year = isset($_GET['anio']) && $_GET['anio'] !== ''
            ? self::validYear($_GET['anio'])
            : null;
        $month = isset($_GET['mes']) && $_GET['mes'] !== ''
            ? self::validMonth($_GET['mes'])
            : null;
        api_success(self::catalogosDatos($auth['db'], $year, $month));
    }

    public static function contextoPago(): never
    {
        $auth = auth_context();
        $partnerId = positive_id($_GET['id_socio'] ?? null, 'socio o empresa');
        $year = self::validYear($_GET['anio'] ?? date('Y'));
        $month = self::validMonth($_GET['mes'] ?? date('n'));
        $paymentDate = valid_date($_GET['fecha_pago'] ?? date('Y-m-d'), 'pago');
        api_success(self::paymentContextData($auth['db'], $partnerId, $year, $month, $paymentDate));
    }

    public static function contextosPago(): never
    {
        $auth = auth_context();
        $partnerId = positive_id($_GET['id_socio'] ?? null, 'socio o empresa');
        $year = self::validYear($_GET['anio'] ?? date('Y'));
        $paymentDate = valid_date($_GET['fecha_pago'] ?? date('Y-m-d'), 'pago');

        api_success([
            'anio' => $year,
            'fecha_pago' => $paymentDate,
            'periodos' => self::paymentContextsData(
                $auth['db'],
                $partnerId,
                $year,
                $paymentDate
            ),
        ]);
    }

    public static function registrarPago(): never
    {
        $auth = require_admin();
        $result = self::registrarPagosDatos($auth, request_body());
        $message = count($result['items']) > 1
            ? 'Pagos registrados correctamente.'
            : 'Pago registrado correctamente.';
        api_success($result, $message);
    }

    public static function registrarPagos(): never
    {
        self::registrarPago();
    }

    public static function condonarPago(): never
    {
        $auth = require_admin();
        $item = self::condonarPagoDatos($auth, request_body());
        api_success(['item' => $item], 'Cuota condonada correctamente. El período ya no figura como deuda.');
    }

    public static function eliminarPago(): never
    {
        $auth = require_admin();
        $item = self::eliminarPagoDatos($auth, request_body());
        $message = ($item['estado'] ?? 'PAGADO') === 'CONDONADO'
            ? 'Condonación eliminada correctamente. El período volvió a quedar como deuda.'
            : 'Pago eliminado correctamente. El período volvió a quedar como deuda.';
        api_success(['item' => $item], $message);
    }

    /** Alias conservado para clientes anteriores del frontend. */
    public static function registrarCobro(): never
    {
        self::registrarPago();
    }

    /** Alias conservado para clientes anteriores del frontend. */
    public static function anular(): never
    {
        self::eliminarPago();
    }

    private static function listarDatos(PDO $db, array $filters): array
    {
        $tipo = strtoupper(trim((string)($filters['tipo'] ?? 'PERSONA')));
        $estado = strtoupper(trim((string)($filters['estado'] ?? 'DEUDORES')));
        if (!in_array($tipo, self::TIPOS, true)) {
            api_error('El tipo de cuota solicitado no es válido.', 'FILTRO_INVALIDO');
        }
        if (!in_array($estado, self::ESTADOS, true)) {
            api_error('El estado de cuota solicitado no es válido.', 'FILTRO_INVALIDO');
        }

        $now = new DateTimeImmutable('today');
        $anio = self::validYear($filters['anio'] ?? $now->format('Y'));
        $mes = self::validMonth($filters['mes'] ?? $now->format('n'));
        $buscar = clean_text($filters['buscar'] ?? '', 120, false);
        $categoria = self::optionalPositiveId($filters['categoria'] ?? null);
        $periodEnd = self::periodEnd($anio, $mes);
        $page = max(1, (int)($filters['pagina'] ?? 1));
        $perPage = max(1, min(200, (int)($filters['por_pagina'] ?? 100)));
        $includeCatalogs = filter_var(
            $filters['incluir_catalogos'] ?? true,
            FILTER_VALIDATE_BOOL,
            FILTER_NULL_ON_FAILURE
        );
        if ($includeCatalogs === null) $includeCatalogs = true;

        $where = ['s.tipo_socio = ?'];
        $params = [$anio, $mes, $tipo];

        if ($estado === 'DEUDORES') {
            $where[] = "s.estado = 'ACTIVO'";
            $where[] = 's.id_categoria IS NOT NULL';
            $where[] = '(s.fecha_alta IS NULL OR s.fecha_alta <= ?)';
            $where[] = 'p.id_pago IS NULL';
            $params[] = $periodEnd;
        } elseif ($estado === 'PAGADOS') {
            $where[] = 'p.id_pago IS NOT NULL';
            $where[] = "p.estado = 'PAGADO'";
        } else {
            $where[] = 'p.id_pago IS NOT NULL';
            $where[] = "p.estado = 'CONDONADO'";
        }

        if ($categoria !== null) {
            $where[] = 's.id_categoria = ?';
            $params[] = $categoria;
        }

        $searchFilter = build_search_filter(
            $buscar,
            ["CONCAT_WS(' ',
                sp.apellido, sp.nombre, sp.dni,
                se.razon_social, se.cuit,
                c.nombre, mp_preferido.nombre, mp.nombre, f.nombre, p.estado
            ) LIKE {param}"],
            120,
            null
        );
        if ($searchFilter['sql'] !== '') {
            $where[] = $searchFilter['sql'];
            array_push($params, ...$searchFilter['params']);
        }

        $statement = $db->prepare(
            "SELECT
                s.id_socio,
                s.tipo_socio,
                s.estado AS estado_socio,
                s.fecha_alta,
                s.id_categoria,
                s.id_medio_pago AS id_medio_pago_preferido,
                CASE
                    WHEN s.tipo_socio = 'EMPRESA' THEN se.razon_social
                    ELSE TRIM(CONCAT(COALESCE(sp.apellido, ''), ', ', COALESCE(sp.nombre, '')))
                END AS denominacion,
                CASE WHEN s.tipo_socio = 'EMPRESA' THEN se.cuit ELSE sp.dni END AS documento,
                c.nombre AS categoria,
                c.monto_cuota AS monto_actual,
                mp_preferido.nombre AS medio_pago_preferido,
                f.id_familia,
                f.nombre AS familia,
                fc.cantidad_integrantes,
                p.id_pago,
                p.anio,
                p.mes,
                p.fecha_pago,
                p.monto,
                p.id_medio_pago,
                p.estado AS estado_pago,
                mp.nombre AS medio_pago
             FROM socios s
             LEFT JOIN socios_personas sp ON sp.id_socio = s.id_socio
             LEFT JOIN socios_empresas se ON se.id_socio = s.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             LEFT JOIN medios_pago mp_preferido ON mp_preferido.id_medio_pago = s.id_medio_pago
             LEFT JOIN familias_socios fs
                    ON fs.id_socio = s.id_socio
                   AND fs.fecha_desvinculacion IS NULL
             LEFT JOIN familias f
                    ON f.id_familia = fs.id_familia
                   AND f.activo = 1
             LEFT JOIN (" . self::familyCountSql() . ") fc ON fc.id_familia = f.id_familia
             LEFT JOIN pagos p
                    ON p.id_socio = s.id_socio
                   AND p.anio = ?
                   AND p.mes = ?
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE " . implode(' AND ', $where) . "
             ORDER BY denominacion ASC, s.id_socio ASC"
        );
        $statement->execute($params);
        $rows = $statement->fetchAll();

        $categoryIds = [];
        foreach ($rows as $row) {
            if ($row['id_categoria'] !== null) {
                $categoryIds[(int)$row['id_categoria']] = true;
            }
        }
        $history = self::priceHistoryByCategory($db, array_keys($categoryIds));
        $discountRules = self::discountRulesForDate($db, date('Y-m-d'));

        $items = [];
        foreach ($rows as $row) {
            $categoryId = $row['id_categoria'] === null ? null : (int)$row['id_categoria'];
            $baseAmount = $categoryId === null
                ? 0.0
                : self::priceForPeriod(
                    $history[$categoryId] ?? [],
                    (float)($row['monto_actual'] ?? 0),
                    $periodEnd
                );
            $familyCount = (int)($row['cantidad_integrantes'] ?? 0);
            $discount = $row['id_familia'] === null
                ? 0.0
                : self::discountForCount($discountRules, $familyCount);
            $row['monto_base'] = $baseAmount;
            $row['monto_actual_categoria'] = (float)($row['monto_actual'] ?? 0);
            $row['porcentaje_descuento_familiar'] = $discount;
            $row['monto_sugerido'] = self::discountedAmount($baseAmount, $discount);
            $row['opciones_monto'] = $categoryId === null
                ? []
                : self::amountOptionsForCategory(
                    $history[$categoryId] ?? [],
                    (float)($row['monto_actual'] ?? 0),
                    $discount
                );
            $items[] = self::castRow($row, $anio, $mes);
        }

        $totalAmount = 0.0;
        $withCategory = 0;
        foreach ($items as $item) {
            if ($item['id_categoria'] !== null) $withCategory++;
            $totalAmount += (float)($estado === 'PAGADOS'
                ? ($item['monto'] ?? 0)
                : ($estado === 'CONDONADOS' ? 0 : $item['monto_sugerido']));
        }

        $totalItems = count($items);
        $totalPages = $totalItems === 0 ? 0 : (int)ceil($totalItems / $perPage);
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        $offset = ($page - 1) * $perPage;
        $pagedItems = array_slice($items, $offset, $perPage);
        $from = $totalItems === 0 ? 0 : $offset + 1;
        $to = $totalItems === 0 ? 0 : min($offset + count($pagedItems), $totalItems);

        $result = [
            'items' => $pagedItems,
            'resumen' => [
                'total' => $totalItems,
                'importe' => number_format($totalAmount, 2, '.', ''),
                'con_categoria' => $withCategory,
                'sin_categoria' => $totalItems - $withCategory,
            ],
            'periodo' => [
                'anio' => $anio,
                'mes' => $mes,
                'mes_nombre' => self::monthName($mes),
            ],
            'paginacion' => [
                'pagina' => $page,
                'por_pagina' => $perPage,
                'total' => $totalItems,
                'total_paginas' => $totalPages,
                'desde' => $from,
                'hasta' => $to,
                'tiene_anterior' => $page > 1,
                'tiene_siguiente' => $totalPages > 0 && $page < $totalPages,
            ],
        ];

        if ($includeCatalogs) {
            $result = array_merge($result, self::catalogosDatos($db, $anio, $mes));
        }

        return $result;
    }

    private static function catalogosDatos(PDO $db, ?int $year = null, ?int $month = null): array
    {
        $year ??= (int)date('Y');
        $month ??= (int)date('n');
        $periodEnd = self::periodEnd($year, $month);

        $categories = $db->query(
            "SELECT id_categoria, nombre, monto_cuota, activo
             FROM categorias
             ORDER BY activo DESC, nombre ASC"
        )->fetchAll();
        foreach ($categories as &$category) {
            $category['id_categoria'] = (int)$category['id_categoria'];
            $category['monto_cuota'] = number_format((float)$category['monto_cuota'], 2, '.', '');
            $category['activo'] = (bool)$category['activo'];
        }
        unset($category);

        $media = $db->query(
            "SELECT id_medio_pago, nombre
             FROM medios_pago
             WHERE activo = 1
             ORDER BY nombre ASC"
        )->fetchAll();
        foreach ($media as &$medium) $medium['id_medio_pago'] = (int)$medium['id_medio_pago'];
        unset($medium);

        $partners = $db->query(
            "SELECT
                s.id_socio,
                s.tipo_socio,
                s.id_categoria,
                s.id_medio_pago,
                CASE
                    WHEN s.tipo_socio = 'EMPRESA' THEN se.razon_social
                    ELSE TRIM(CONCAT(COALESCE(sp.apellido, ''), ', ', COALESCE(sp.nombre, '')))
                END AS denominacion,
                CASE WHEN s.tipo_socio = 'EMPRESA' THEN se.cuit ELSE sp.dni END AS documento,
                c.nombre AS categoria,
                c.monto_cuota AS monto_actual,
                f.id_familia,
                f.nombre AS familia,
                fc.cantidad_integrantes
             FROM socios s
             LEFT JOIN socios_personas sp ON sp.id_socio = s.id_socio
             LEFT JOIN socios_empresas se ON se.id_socio = s.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             LEFT JOIN familias_socios fs
                    ON fs.id_socio = s.id_socio
                   AND fs.fecha_desvinculacion IS NULL
             LEFT JOIN familias f
                    ON f.id_familia = fs.id_familia
                   AND f.activo = 1
             LEFT JOIN (" . self::familyCountSql() . ") fc ON fc.id_familia = f.id_familia
             WHERE s.estado = 'ACTIVO'
               AND s.id_categoria IS NOT NULL
             ORDER BY s.tipo_socio, denominacion"
        )->fetchAll();

        $partnerCategoryIds = [];
        foreach ($partners as $partner) {
            if ($partner['id_categoria'] !== null) {
                $partnerCategoryIds[(int)$partner['id_categoria']] = true;
            }
        }
        $partnerHistory = self::priceHistoryByCategory($db, array_keys($partnerCategoryIds));
        $discountRules = self::discountRulesForDate($db, date('Y-m-d'));

        foreach ($partners as &$partner) {
            $partner['id_socio'] = (int)$partner['id_socio'];
            $partner['id_categoria'] = $partner['id_categoria'] === null ? null : (int)$partner['id_categoria'];
            $partner['id_medio_pago'] = $partner['id_medio_pago'] === null ? null : (int)$partner['id_medio_pago'];
            $partner['id_familia'] = $partner['id_familia'] === null ? null : (int)$partner['id_familia'];
            $partner['cantidad_integrantes'] = (int)($partner['cantidad_integrantes'] ?? 0);
            $baseAmount = $partner['id_categoria'] === null
                ? 0.0
                : self::priceForPeriod(
                    $partnerHistory[$partner['id_categoria']] ?? [],
                    (float)($partner['monto_actual'] ?? 0),
                    $periodEnd
                );
            $discount = $partner['id_familia'] === null
                ? 0.0
                : self::discountForCount($discountRules, $partner['cantidad_integrantes']);
            $partner['monto_base'] = number_format($baseAmount, 2, '.', '');
            $partner['porcentaje_descuento_familiar'] = number_format($discount, 2, '.', '');
            $partner['monto_sugerido'] = number_format(self::discountedAmount($baseAmount, $discount), 2, '.', '');
            unset($partner['monto_actual']);
            $partner['denominacion'] = trim((string)$partner['denominacion']);
        }
        unset($partner);

        // Años visibles en Cuotas:
        // - desde el alta del socio más antiguo hasta el año actual;
        // - años futuros únicamente cuando ya existe al menos un pago registrado.
        // Así evitamos mostrar años futuros vacíos como si ya fueran períodos normales.
        $firstPartnerYear = $db->query(
            "SELECT MIN(YEAR(fecha_alta))
             FROM socios
             WHERE fecha_alta IS NOT NULL"
        )->fetchColumn();
        $currentYear = (int)date('Y');
        $firstYear = $firstPartnerYear !== false && $firstPartnerYear !== null
            ? max(2000, min($currentYear, (int)$firstPartnerYear))
            : $currentYear;

        $futurePaymentYearsStatement = $db->prepare(
            'SELECT DISTINCT anio
             FROM pagos
             WHERE anio > ?
             ORDER BY anio DESC'
        );
        $futurePaymentYearsStatement->execute([$currentYear]);
        $futurePaymentYears = array_map(
            'intval',
            array_column($futurePaymentYearsStatement->fetchAll(), 'anio')
        );

        $years = $futurePaymentYears;
        for ($catalogYear = $currentYear; $catalogYear >= $firstYear; $catalogYear--) {
            $years[] = $catalogYear;
        }

        $months = [];
        for ($catalogMonth = 1; $catalogMonth <= 12; $catalogMonth++) {
            $months[] = ['id_mes' => $catalogMonth, 'nombre' => self::monthName($catalogMonth)];
        }

        return [
            'catalogos' => [
                'categorias' => $categories,
                'medios_pago' => $media,
                'socios' => array_values(array_filter($partners, static fn(array $item): bool => $item['tipo_socio'] === 'PERSONA')),
                'empresas' => array_values(array_filter($partners, static fn(array $item): bool => $item['tipo_socio'] === 'EMPRESA')),
                'anios' => $years,
                'meses' => $months,
            ],
        ];
    }

    private static function paymentContextsData(PDO $db, int $partnerId, int $year, string $paymentDate): array
    {
        $principalStatement = $db->prepare(
            "SELECT
                s.id_socio, s.tipo_socio, s.estado AS estado_socio, s.fecha_alta,
                s.id_categoria, s.id_medio_pago AS id_medio_pago_preferido,
                CASE
                    WHEN s.tipo_socio = 'EMPRESA' THEN se.razon_social
                    ELSE TRIM(CONCAT(COALESCE(sp.apellido, ''), ', ', COALESCE(sp.nombre, '')))
                END AS denominacion,
                CASE WHEN s.tipo_socio = 'EMPRESA' THEN se.cuit ELSE sp.dni END AS documento,
                c.nombre AS categoria, c.monto_cuota AS monto_actual,
                f.id_familia, f.nombre AS familia,
                fc.cantidad_integrantes
             FROM socios s
             LEFT JOIN socios_personas sp ON sp.id_socio = s.id_socio
             LEFT JOIN socios_empresas se ON se.id_socio = s.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             LEFT JOIN familias_socios fs
                    ON fs.id_socio = s.id_socio
                   AND fs.fecha_desvinculacion IS NULL
             LEFT JOIN familias f
                    ON f.id_familia = fs.id_familia
                   AND f.activo = 1
             LEFT JOIN (" . self::familyCountSql() . ") fc ON fc.id_familia = f.id_familia
             WHERE s.id_socio = ?
             LIMIT 1"
        );
        $principalStatement->execute([$partnerId]);
        $principalRow = $principalStatement->fetch();
        if (!$principalRow) api_error('El socio o empresa seleccionado no existe.', 'SOCIO_NO_ENCONTRADO', 404);

        $familyCount = (int)($principalRow['cantidad_integrantes'] ?? 0);
        $discountRules = self::discountRulesForDate($db, $paymentDate);
        $discount = $principalRow['id_familia'] === null
            ? 0.0
            : self::discountForCount($discountRules, $familyCount);

        $memberRows = [$principalRow];
        if ($principalRow['tipo_socio'] === 'PERSONA' && $principalRow['id_familia'] !== null) {
            $membersStatement = $db->prepare(
                "SELECT
                    s.id_socio, s.tipo_socio, s.estado AS estado_socio, s.fecha_alta,
                    s.id_categoria, s.id_medio_pago AS id_medio_pago_preferido,
                    TRIM(CONCAT(COALESCE(sp.apellido, ''), ', ', COALESCE(sp.nombre, ''))) AS denominacion,
                    sp.dni AS documento,
                    c.nombre AS categoria, c.monto_cuota AS monto_actual,
                    fs.es_titular, fs.parentesco
                 FROM familias_socios fs
                 INNER JOIN socios s ON s.id_socio = fs.id_socio
                 INNER JOIN socios_personas sp ON sp.id_socio = s.id_socio
                 LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
                 WHERE fs.id_familia = ?
                   AND fs.fecha_desvinculacion IS NULL
                 ORDER BY fs.es_titular DESC, sp.apellido ASC, sp.nombre ASC"
            );
            $membersStatement->execute([(int)$principalRow['id_familia']]);
            $memberRows = $membersStatement->fetchAll();
            foreach ($memberRows as &$memberRow) {
                $memberRow['id_familia'] = (int)$principalRow['id_familia'];
                $memberRow['familia'] = (string)$principalRow['familia'];
            }
            unset($memberRow);
        }

        $categoryIds = [];
        $memberIds = [];
        foreach ($memberRows as $memberRow) {
            $memberIds[] = (int)$memberRow['id_socio'];
            if ($memberRow['id_categoria'] !== null) {
                $categoryIds[(int)$memberRow['id_categoria']] = true;
            }
        }
        $history = self::priceHistoryByCategory($db, array_keys($categoryIds));

        $paymentsByPartner = [];
        if ($memberIds !== []) {
            $placeholders = implode(',', array_fill(0, count($memberIds), '?'));
            $paymentsStatement = $db->prepare(
                "SELECT id_pago, id_socio, mes, fecha_pago, monto, id_medio_pago, estado
                 FROM pagos
                 WHERE anio = ?
                   AND id_socio IN ($placeholders)"
            );
            $paymentsStatement->execute(array_merge([$year], $memberIds));
            foreach ($paymentsStatement->fetchAll() as $payment) {
                $paymentsByPartner[(int)$payment['id_socio']][(int)$payment['mes']] = $payment;
            }
        }

        $periods = [];
        for ($month = 1; $month <= 12; $month++) {
            $periodEnd = self::periodEnd($year, $month);
            $members = [];

            foreach ($memberRows as $memberRow) {
                $payment = $paymentsByPartner[(int)$memberRow['id_socio']][$month] ?? null;
                $row = $memberRow;
                $row['id_pago'] = $payment['id_pago'] ?? null;
                $row['fecha_pago'] = $payment['fecha_pago'] ?? null;
                $row['monto'] = $payment['monto'] ?? null;
                $row['id_medio_pago'] = $payment['id_medio_pago'] ?? null;
                $row['estado_pago'] = $payment['estado'] ?? null;
                $members[] = self::hydratePaymentCandidate(
                    $row,
                    $year,
                    $month,
                    $periodEnd,
                    $history,
                    $discount
                );
            }

            $principal = null;
            foreach ($members as $member) {
                if ((int)$member['id_socio'] === $partnerId) {
                    $principal = $member;
                    break;
                }
            }

            if ($principal === null) {
                $payment = $paymentsByPartner[$partnerId][$month] ?? null;
                $row = $principalRow;
                $row['id_pago'] = $payment['id_pago'] ?? null;
                $row['fecha_pago'] = $payment['fecha_pago'] ?? null;
                $row['monto'] = $payment['monto'] ?? null;
                $row['id_medio_pago'] = $payment['id_medio_pago'] ?? null;
                $row['estado_pago'] = $payment['estado'] ?? null;
                $principal = self::hydratePaymentCandidate(
                    $row,
                    $year,
                    $month,
                    $periodEnd,
                    $history,
                    $discount
                );
            }

            $family = null;
            if ($principalRow['tipo_socio'] === 'PERSONA' && $principalRow['id_familia'] !== null) {
                $pendingMembers = array_values(array_filter(
                    $members,
                    static fn(array $member): bool => (bool)$member['puede_pagar']
                ));
                $family = [
                    'id_familia' => (int)$principalRow['id_familia'],
                    'nombre' => (string)$principalRow['familia'],
                    'cantidad_integrantes' => $familyCount,
                    'porcentaje_descuento' => number_format($discount, 2, '.', ''),
                    'integrantes' => $members,
                    'cantidad_pendientes' => count($pendingMembers),
                    'monto_base_total' => number_format(array_sum(array_map(
                        static fn(array $member): float => (bool)$member['puede_pagar'] ? (float)$member['monto_base'] : 0.0,
                        $members
                    )), 2, '.', ''),
                    'monto_total' => number_format(array_sum(array_map(
                        static fn(array $member): float => (bool)$member['puede_pagar'] ? (float)$member['monto_sugerido'] : 0.0,
                        $members
                    )), 2, '.', ''),
                ];
            }

            $periods[(string)$month] = [
                'principal' => $principal,
                'familia' => $family,
                'periodo' => [
                    'anio' => $year,
                    'mes' => $month,
                    'mes_nombre' => self::monthName($month),
                ],
                'fecha_pago' => $paymentDate,
            ];
        }

        return $periods;
    }

    private static function paymentContextData(PDO $db, int $partnerId, int $year, int $month, string $paymentDate): array
    {
        $periodEnd = self::periodEnd($year, $month);
        $principalStatement = $db->prepare(
            "SELECT
                s.id_socio, s.tipo_socio, s.estado AS estado_socio, s.fecha_alta,
                s.id_categoria, s.id_medio_pago AS id_medio_pago_preferido,
                CASE
                    WHEN s.tipo_socio = 'EMPRESA' THEN se.razon_social
                    ELSE TRIM(CONCAT(COALESCE(sp.apellido, ''), ', ', COALESCE(sp.nombre, '')))
                END AS denominacion,
                CASE WHEN s.tipo_socio = 'EMPRESA' THEN se.cuit ELSE sp.dni END AS documento,
                c.nombre AS categoria, c.monto_cuota AS monto_actual,
                f.id_familia, f.nombre AS familia,
                fc.cantidad_integrantes,
                p.id_pago, p.fecha_pago, p.monto, p.id_medio_pago, p.estado AS estado_pago
             FROM socios s
             LEFT JOIN socios_personas sp ON sp.id_socio = s.id_socio
             LEFT JOIN socios_empresas se ON se.id_socio = s.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             LEFT JOIN familias_socios fs
                    ON fs.id_socio = s.id_socio
                   AND fs.fecha_desvinculacion IS NULL
             LEFT JOIN familias f
                    ON f.id_familia = fs.id_familia
                   AND f.activo = 1
             LEFT JOIN (" . self::familyCountSql() . ") fc ON fc.id_familia = f.id_familia
             LEFT JOIN pagos p
                    ON p.id_socio = s.id_socio
                   AND p.anio = ?
                   AND p.mes = ?
             WHERE s.id_socio = ?
             LIMIT 1"
        );
        $principalStatement->execute([$year, $month, $partnerId]);
        $principalRow = $principalStatement->fetch();
        if (!$principalRow) api_error('El socio o empresa seleccionado no existe.', 'SOCIO_NO_ENCONTRADO', 404);

        $familyCount = (int)($principalRow['cantidad_integrantes'] ?? 0);
        $discountRules = self::discountRulesForDate($db, $paymentDate);
        $discount = $principalRow['id_familia'] === null
            ? 0.0
            : self::discountForCount($discountRules, $familyCount);

        $memberRows = [$principalRow];
        if ($principalRow['tipo_socio'] === 'PERSONA' && $principalRow['id_familia'] !== null) {
            $membersStatement = $db->prepare(
                "SELECT
                    s.id_socio, s.tipo_socio, s.estado AS estado_socio, s.fecha_alta,
                    s.id_categoria, s.id_medio_pago AS id_medio_pago_preferido,
                    TRIM(CONCAT(COALESCE(sp.apellido, ''), ', ', COALESCE(sp.nombre, ''))) AS denominacion,
                    sp.dni AS documento,
                    c.nombre AS categoria, c.monto_cuota AS monto_actual,
                    fs.es_titular, fs.parentesco,
                    p.id_pago, p.fecha_pago, p.monto, p.id_medio_pago, p.estado AS estado_pago
                 FROM familias_socios fs
                 INNER JOIN socios s ON s.id_socio = fs.id_socio
                 INNER JOIN socios_personas sp ON sp.id_socio = s.id_socio
                 LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
                 LEFT JOIN pagos p
                        ON p.id_socio = s.id_socio
                       AND p.anio = ?
                       AND p.mes = ?
                 WHERE fs.id_familia = ?
                   AND fs.fecha_desvinculacion IS NULL
                 ORDER BY fs.es_titular DESC, sp.apellido ASC, sp.nombre ASC"
            );
            $membersStatement->execute([$year, $month, (int)$principalRow['id_familia']]);
            $memberRows = $membersStatement->fetchAll();
            foreach ($memberRows as &$memberRow) {
                $memberRow['id_familia'] = (int)$principalRow['id_familia'];
                $memberRow['familia'] = (string)$principalRow['familia'];
            }
            unset($memberRow);
        }

        $categoryIds = [];
        foreach ($memberRows as $memberRow) {
            if ($memberRow['id_categoria'] !== null) $categoryIds[(int)$memberRow['id_categoria']] = true;
        }
        $history = self::priceHistoryByCategory($db, array_keys($categoryIds));

        $members = [];
        foreach ($memberRows as $memberRow) {
            $members[] = self::hydratePaymentCandidate(
                $memberRow,
                $year,
                $month,
                $periodEnd,
                $history,
                $discount
            );
        }

        $principal = null;
        foreach ($members as $member) {
            if ((int)$member['id_socio'] === $partnerId) {
                $principal = $member;
                break;
            }
        }
        if ($principal === null) {
            $principal = self::hydratePaymentCandidate(
                $principalRow,
                $year,
                $month,
                $periodEnd,
                $history,
                $discount
            );
        }

        $family = null;
        if ($principalRow['tipo_socio'] === 'PERSONA' && $principalRow['id_familia'] !== null) {
            $pendingMembers = array_values(array_filter(
                $members,
                static fn(array $member): bool => (bool)$member['puede_pagar']
            ));
            $family = [
                'id_familia' => (int)$principalRow['id_familia'],
                'nombre' => (string)$principalRow['familia'],
                'cantidad_integrantes' => $familyCount,
                'porcentaje_descuento' => number_format($discount, 2, '.', ''),
                'integrantes' => $members,
                'cantidad_pendientes' => count($pendingMembers),
                'monto_base_total' => number_format(array_sum(array_map(
                    static fn(array $member): float => (bool)$member['puede_pagar'] ? (float)$member['monto_base'] : 0.0,
                    $members
                )), 2, '.', ''),
                'monto_total' => number_format(array_sum(array_map(
                    static fn(array $member): float => (bool)$member['puede_pagar'] ? (float)$member['monto_sugerido'] : 0.0,
                    $members
                )), 2, '.', ''),
            ];
        }

        return [
            'principal' => $principal,
            'familia' => $family,
            'periodo' => [
                'anio' => $year,
                'mes' => $month,
                'mes_nombre' => self::monthName($month),
            ],
            'fecha_pago' => $paymentDate,
        ];
    }

    private static function registrarPagosDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $paymentDate = valid_date($body['fecha_pago'] ?? null, 'pago');
        $mediumId = positive_id($body['id_medio_pago'] ?? null, 'medio de pago');
        $applyFamily = filter_var($body['aplicar_familia'] ?? false, FILTER_VALIDATE_BOOL);

        $mediumStatement = $db->prepare(
            'SELECT id_medio_pago, nombre FROM medios_pago WHERE id_medio_pago = ? AND activo = 1'
        );
        $mediumStatement->execute([$mediumId]);
        $medium = $mediumStatement->fetch();
        if (!$medium) api_error('El medio de pago seleccionado no existe o está inactivo.', 'MEDIO_PAGO_INVALIDO');

        $targets = [];
        $familyData = null;

        if ($applyFamily) {
            $principalId = positive_id($body['id_socio'] ?? null, 'socio');
            $year = self::validYear($body['anio'] ?? null);

            $requestedMonths = [];
            if (is_array($body['meses'] ?? null)) {
                foreach ($body['meses'] as $rawMonth) {
                    $month = self::validMonth($rawMonth);
                    $requestedMonths[$month] = $month;
                }
            } elseif (array_key_exists('mes', $body)) {
                $month = self::validMonth($body['mes']);
                $requestedMonths[$month] = $month;
            }

            if ($requestedMonths === []) {
                api_error('Seleccioná al menos un mes para registrar el pago familiar.', 'VALIDATION_ERROR');
            }

            ksort($requestedMonths, SORT_NUMERIC);
            $contexts = self::paymentContextsData($db, $principalId, $year, $paymentDate);

            foreach ($requestedMonths as $month) {
                $context = $contexts[(string)$month] ?? null;
                if (!is_array($context)) continue;

                $contextFamily = $context['familia'] ?? null;
                if ($contextFamily !== null) {
                    if ($familyData === null) $familyData = $contextFamily;
                    foreach ($contextFamily['integrantes'] as $member) {
                        // Los períodos ya pagados o no disponibles se omiten de forma
                        // individual. Esto permite cobrar varios meses a una familia
                        // aunque algún integrante ya tenga uno de ellos abonado.
                        if (!(bool)($member['puede_pagar'] ?? false)) continue;
                        $targets[] = self::targetFromCandidate($member, null);
                    }
                    continue;
                }

                // Compatibilidad: si por algún motivo el socio ya no tiene una familia
                // asociada, no perdemos el cobro del período del socio principal.
                if ((bool)($context['principal']['puede_pagar'] ?? false)) {
                    $targets[] = self::targetFromCandidate(
                        $context['principal'],
                        count($requestedMonths) === 1 ? ($body['monto'] ?? null) : null
                    );
                }
            }
        } elseif (is_array($body['pagos'] ?? null)) {
            $requested = $body['pagos'];
            if ($requested === [] || count($requested) > self::MAX_PAGOS_LOTE) {
                api_error('Seleccioná entre 1 y ' . self::MAX_PAGOS_LOTE . ' pagos.', 'VALIDATION_ERROR');
            }

            $normalized = [];
            foreach ($requested as $payment) {
                if (!is_array($payment)) continue;
                $partnerId = positive_id($payment['id_socio'] ?? null, 'socio o empresa');
                $year = self::validYear($payment['anio'] ?? null);
                $month = self::validMonth($payment['mes'] ?? null);
                $key = $partnerId . '-' . $year . '-' . $month;
                $normalized[$key] = [
                    'id_socio' => $partnerId,
                    'anio' => $year,
                    'mes' => $month,
                    'monto' => $payment['monto'] ?? null,
                ];
            }
            if ($normalized === []) api_error('No hay pagos válidos seleccionados.', 'VALIDATION_ERROR');

            foreach ($normalized as $payment) {
                $context = self::paymentContextData(
                    $db,
                    $payment['id_socio'],
                    $payment['anio'],
                    $payment['mes'],
                    $paymentDate
                );
                if (!(bool)$context['principal']['puede_pagar']) {
                    self::paymentCandidateError($context['principal']);
                }
                $targets[] = self::targetFromCandidate($context['principal'], $payment['monto']);
            }
        } else {
            $partnerId = positive_id($body['id_socio'] ?? null, 'socio o empresa');
            $year = self::validYear($body['anio'] ?? null);
            $month = self::validMonth($body['mes'] ?? null);
            $context = self::paymentContextData($db, $partnerId, $year, $month, $paymentDate);
            if (!(bool)$context['principal']['puede_pagar']) {
                self::paymentCandidateError($context['principal']);
            }
            $targets[] = self::targetFromCandidate($context['principal'], $body['monto'] ?? null);
        }

        if ($targets === []) api_error('No hay cuotas pendientes para registrar.', 'SIN_CUOTAS_PENDIENTES', 409);
        if (count($targets) > self::MAX_PAGOS_LOTE) {
            api_error('La operación supera el máximo de pagos permitidos.', 'VALIDATION_ERROR');
        }

        $operationCode = self::operationCode();
        try {
            $saved = transaction($db, static function () use (
                $db,
                $auth,
                $targets,
                $paymentDate,
                $mediumId,
                $medium,
                $operationCode,
                $familyData,
                $applyFamily
            ): array {
                $insert = $db->prepare(
                    "INSERT INTO pagos (id_socio, mes, anio, fecha_pago, monto, id_medio_pago, estado)
                     VALUES (?, ?, ?, ?, ?, ?, 'PAGADO')"
                );
                $items = [];
                $lines = [];

                foreach ($targets as $target) {
                    $insert->execute([
                        $target['id_socio'],
                        $target['mes'],
                        $target['anio'],
                        $paymentDate,
                        $target['monto'],
                        $mediumId,
                    ]);
                    $paymentId = (int)$db->lastInsertId();

                    $auditData = [
                        'id_pago' => $paymentId,
                        'codigo_operacion' => $operationCode,
                        'id_socio' => $target['id_socio'],
                        'denominacion' => $target['denominacion'],
                        'tipo_socio' => $target['tipo_socio'],
                        'categoria' => $target['categoria'],
                        'anio' => $target['anio'],
                        'mes' => $target['mes'],
                        'fecha_pago' => $paymentDate,
                        'monto_base' => $target['monto_base'],
                        'porcentaje_descuento_familiar' => $target['porcentaje_descuento_familiar'],
                        'monto' => $target['monto'],
                        'id_medio_pago' => $mediumId,
                        'medio_pago' => $medium['nombre'],
                        'estado' => 'PAGADO',
                        'id_familia' => $target['id_familia'],
                        'familia' => $target['familia'],
                        'pago_familiar' => $applyFamily,
                    ];
                    audit_change(
                        $db,
                        $auth,
                        'CUOTAS',
                        count($targets) > 1 ? 'REGISTRAR_PAGOS' : 'REGISTRAR_PAGO',
                        'pagos',
                        $paymentId,
                        sprintf(
                            'Se registró la cuota de %s %d para %s%s.',
                            self::monthName($target['mes']),
                            $target['anio'],
                            $target['denominacion'],
                            $target['familia'] ? ' (' . $target['familia'] . ')' : ''
                        ),
                        null,
                        $auditData
                    );

                    $item = self::paymentById($db, $paymentId);
                    $items[] = $item;
                    $lines[] = [
                        'id' => $paymentId,
                        'id_pago' => $paymentId,
                        'id_socio' => $target['id_socio'],
                        'socio' => $target['denominacion'],
                        'categoria' => $target['categoria'] ?: 'SIN CATEGORÍA',
                        'periodo' => self::monthName($target['mes']) . ' ' . $target['anio'],
                        'monto_base' => number_format((float)$target['monto_base'], 2, '.', ''),
                        'porcentaje_descuento_familiar' => number_format((float)$target['porcentaje_descuento_familiar'], 2, '.', ''),
                        'monto' => number_format((float)$target['monto'], 2, '.', ''),
                        'familia' => $target['familia'],
                    ];
                }

                return ['items' => $items, 'lineas' => $lines];
            });
        } catch (PDOException $error) {
            if (duplicate_key($error)) {
                api_error('Uno de los períodos seleccionados ya figura como pagado o condonado.', 'PAGO_YA_REGISTRADO', 409);
            }
            throw $error;
        }

        $totalBase = array_sum(array_map(static fn(array $line): float => (float)$line['monto_base'], $saved['lineas']));
        $total = array_sum(array_map(static fn(array $line): float => (float)$line['monto'], $saved['lineas']));
        $names = array_values(array_unique(array_column($saved['lineas'], 'socio')));
        $familyPayment = $applyFamily && $familyData !== null && count($saved['lineas']) > 1;

        $receipt = [
            'organizacion' => 'LALCEC',
            'codigo_operacion' => $operationCode,
            'estado' => 'PAGADO',
            'fecha_pago' => $paymentDate,
            'socios_label' => self::compactNames($names),
            'modalidad_label' => $familyPayment
                ? 'Pago de grupo familiar'
                : (count($saved['lineas']) > 1 ? 'Pago múltiple de cuotas' : 'Pago mensual de cuota'),
            'medio_pago' => (string)$medium['nombre'],
            'monto_base' => number_format($totalBase, 2, '.', ''),
            'monto' => number_format($total, 2, '.', ''),
            'lineas' => $saved['lineas'],
            'familia' => $familyData === null ? null : [
                'id_familia' => $familyData['id_familia'],
                'nombre' => $familyData['nombre'],
                'porcentaje_descuento' => $familyData['porcentaje_descuento'],
            ],
        ];

        return [
            'item' => $saved['items'][0] ?? null,
            'items' => $saved['items'],
            'comprobante' => $receipt,
            'codigo_operacion' => $operationCode,
            'aplico_familia' => $familyPayment,
        ];
    }

    private static function targetFromCandidate(array $candidate, mixed $amount): array
    {
        $resolvedAmount = $amount === null || $amount === ''
            ? number_format((float)$candidate['monto_sugerido'], 2, '.', '')
            : decimal_amount($amount, 'monto', 0.01);

        return [
            'id_socio' => (int)$candidate['id_socio'],
            'tipo_socio' => (string)$candidate['tipo_socio'],
            'denominacion' => (string)$candidate['denominacion'],
            'documento' => $candidate['documento'],
            'id_categoria' => (int)$candidate['id_categoria'],
            'categoria' => $candidate['categoria'],
            'anio' => (int)$candidate['anio'],
            'mes' => (int)$candidate['mes'],
            'monto_base' => number_format((float)$candidate['monto_base'], 2, '.', ''),
            'porcentaje_descuento_familiar' => number_format((float)$candidate['porcentaje_descuento_familiar'], 2, '.', ''),
            'monto' => $resolvedAmount,
            'id_familia' => $candidate['id_familia'],
            'familia' => $candidate['familia'],
        ];
    }

    private static function paymentCandidateError(array $candidate): never
    {
        if ((bool)($candidate['pagado'] ?? false)) {
            api_error('Ese período ya figura como pagado o condonado.', 'PAGO_YA_REGISTRADO', 409);
        }
        if (($candidate['estado_socio'] ?? '') !== 'ACTIVO') {
            api_error('No se puede registrar una cuota a un socio o empresa inactiva.', 'SOCIO_INACTIVO', 409);
        }
        if (($candidate['id_categoria'] ?? null) === null) {
            api_error('Asigná una categoría antes de registrar la cuota.', 'CATEGORIA_REQUERIDA', 409);
        }
        if (($candidate['motivo_no_disponible'] ?? '') === 'PERIODO_ANTERIOR_AL_ALTA') {
            api_error('El período seleccionado es anterior a la fecha de alta.', 'PERIODO_ANTERIOR_AL_ALTA', 409);
        }
        api_error('La cuota seleccionada no está disponible para registrar.', 'CUOTA_NO_DISPONIBLE', 409);
    }

    private static function hydratePaymentCandidate(
        array $row,
        int $year,
        int $month,
        string $periodEnd,
        array $history,
        float $discount
    ): array {
        $categoryId = $row['id_categoria'] === null ? null : (int)$row['id_categoria'];
        $baseAmount = $categoryId === null
            ? 0.0
            : self::priceForPeriod(
                $history[$categoryId] ?? [],
                (float)($row['monto_actual'] ?? 0),
                $periodEnd
            );
        $paid = $row['id_pago'] !== null;
        $active = (string)($row['estado_socio'] ?? '') === 'ACTIVO';
        $afterRegistration = $row['fecha_alta'] === null || (string)$row['fecha_alta'] <= $periodEnd;
        $canPay = $active && $categoryId !== null && $afterRegistration && !$paid;

        $reason = null;
        if ($paid) $reason = 'PAGO_YA_REGISTRADO';
        elseif (!$active) $reason = 'SOCIO_INACTIVO';
        elseif ($categoryId === null) $reason = 'CATEGORIA_REQUERIDA';
        elseif (!$afterRegistration) $reason = 'PERIODO_ANTERIOR_AL_ALTA';

        $amountOptions = $categoryId === null
            ? []
            : self::amountOptionsForCategory(
                $history[$categoryId] ?? [],
                (float)($row['monto_actual'] ?? 0),
                $discount
            );

        return [
            'id_socio' => (int)$row['id_socio'],
            'tipo_socio' => (string)$row['tipo_socio'],
            'estado_socio' => (string)($row['estado_socio'] ?? ''),
            'denominacion' => trim((string)($row['denominacion'] ?? '')),
            'documento' => $row['documento'] === null ? null : (string)$row['documento'],
            'id_categoria' => $categoryId,
            'categoria' => $row['categoria'] === null ? null : (string)$row['categoria'],
            'anio' => $year,
            'mes' => $month,
            'periodo' => self::monthName($month) . ' ' . $year,
            'id_medio_pago_preferido' => isset($row['id_medio_pago_preferido']) && $row['id_medio_pago_preferido'] !== null
                ? (int)$row['id_medio_pago_preferido']
                : null,
            'monto_base' => number_format($baseAmount, 2, '.', ''),
            'monto_actual_categoria' => number_format((float)($row['monto_actual'] ?? 0), 2, '.', ''),
            'porcentaje_descuento_familiar' => number_format($discount, 2, '.', ''),
            'monto_sugerido' => number_format(self::discountedAmount($baseAmount, $discount), 2, '.', ''),
            'opciones_monto' => $amountOptions,
            'id_familia' => isset($row['id_familia']) && $row['id_familia'] !== null ? (int)$row['id_familia'] : null,
            'familia' => $row['familia'] ?? null,
            'es_titular' => isset($row['es_titular']) ? (bool)$row['es_titular'] : false,
            'parentesco' => $row['parentesco'] ?? null,
            'pagado' => $paid,
            'id_pago' => $paid ? (int)$row['id_pago'] : null,
            'estado' => $paid ? (string)($row['estado_pago'] ?? 'PAGADO') : null,
            'puede_pagar' => $canPay,
            'motivo_no_disponible' => $reason,
        ];
    }

    private static function condonarPagoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $partnerId = positive_id($body['id_socio'] ?? null, 'socio o empresa');
        $year = self::validYear($body['anio'] ?? null);
        $month = self::validMonth($body['mes'] ?? null);
        $condonationDate = valid_date(
            $body['fecha_condonacion'] ?? $body['fecha'] ?? date('Y-m-d'),
            'condonación'
        );

        $context = self::paymentContextData($db, $partnerId, $year, $month, $condonationDate);
        $candidate = $context['principal'];
        if (!(bool)($candidate['puede_pagar'] ?? false)) {
            self::paymentCandidateError($candidate);
        }

        try {
            $paymentId = transaction($db, static function () use (
                $db,
                $auth,
                $partnerId,
                $year,
                $month,
                $condonationDate,
                $candidate
            ): int {
                $insert = $db->prepare(
                    "INSERT INTO pagos (id_socio, mes, anio, fecha_pago, monto, id_medio_pago, estado)
                     VALUES (?, ?, ?, ?, 0.00, NULL, 'CONDONADO')"
                );
                $insert->execute([$partnerId, $month, $year, $condonationDate]);
                $paymentId = (int)$db->lastInsertId();

                $auditData = [
                    'id_pago' => $paymentId,
                    'id_socio' => $partnerId,
                    'denominacion' => $candidate['denominacion'],
                    'tipo_socio' => $candidate['tipo_socio'],
                    'categoria' => $candidate['categoria'],
                    'anio' => $year,
                    'mes' => $month,
                    'fecha_condonacion' => $condonationDate,
                    'monto' => '0.00',
                    'id_medio_pago' => null,
                    'medio_pago' => null,
                    'estado' => 'CONDONADO',
                    'id_familia' => $candidate['id_familia'],
                    'familia' => $candidate['familia'],
                ];

                audit_change(
                    $db,
                    $auth,
                    'CUOTAS',
                    'CONDONAR_PAGO',
                    'pagos',
                    $paymentId,
                    sprintf(
                        'Se condonó la cuota de %s %d para %s%s.',
                        self::monthName($month),
                        $year,
                        $candidate['denominacion'],
                        $candidate['familia'] ? ' (' . $candidate['familia'] . ')' : ''
                    ),
                    null,
                    $auditData
                );

                return $paymentId;
            });
        } catch (PDOException $error) {
            if (duplicate_key($error)) {
                api_error('Ese período ya figura como pagado o condonado.', 'PAGO_YA_REGISTRADO', 409);
            }
            throw $error;
        }

        return self::paymentById($db, $paymentId);
    }

    private static function eliminarPagoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $paymentId = positive_id($body['id_pago'] ?? $body['id'] ?? null, 'pago');
        $payment = self::paymentById($db, $paymentId);

        transaction($db, static function () use ($db, $auth, $paymentId, $payment): void {
            $delete = $db->prepare('DELETE FROM pagos WHERE id_pago = ?');
            $delete->execute([$paymentId]);
            if ($delete->rowCount() !== 1) {
                api_error('El pago ya no existe.', 'PAGO_NO_ENCONTRADO', 404);
            }
            $isCondoned = ($payment['estado'] ?? 'PAGADO') === 'CONDONADO';
            audit_change(
                $db,
                $auth,
                'CUOTAS',
                $isCondoned ? 'ELIMINAR_CONDONACION' : 'ELIMINAR_PAGO',
                'pagos',
                $paymentId,
                sprintf(
                    $isCondoned
                        ? 'Se eliminó la condonación de %s %d de %s.'
                        : 'Se eliminó el pago de %s %d de %s.',
                    self::monthName((int)$payment['mes']),
                    (int)$payment['anio'],
                    $payment['denominacion']
                ),
                $payment,
                null
            );
        });

        return $payment;
    }

    private static function paymentById(PDO $db, int $paymentId): array
    {
        $statement = $db->prepare(
            "SELECT
                p.id_pago, p.id_socio, p.mes, p.anio, p.fecha_pago, p.monto, p.id_medio_pago,
                p.estado AS estado_pago,
                s.tipo_socio, s.estado AS estado_socio, s.fecha_alta, s.id_categoria,
                COALESCE(se.razon_social, CONCAT(sp.apellido, ', ', sp.nombre)) AS denominacion,
                CASE WHEN s.tipo_socio = 'EMPRESA' THEN se.cuit ELSE sp.dni END AS documento,
                c.nombre AS categoria,
                mp.nombre AS medio_pago
             FROM pagos p
             INNER JOIN socios s ON s.id_socio = p.id_socio
             LEFT JOIN socios_personas sp ON sp.id_socio = s.id_socio
             LEFT JOIN socios_empresas se ON se.id_socio = s.id_socio
             LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.id_pago = ?
             LIMIT 1"
        );
        $statement->execute([$paymentId]);
        $row = $statement->fetch();
        if (!$row) api_error('El pago solicitado no existe.', 'PAGO_NO_ENCONTRADO', 404);
        return self::castRow($row, (int)$row['anio'], (int)$row['mes']);
    }

    private static function castRow(array $row, int $year, int $month): array
    {
        return [
            'id_pago' => isset($row['id_pago']) && $row['id_pago'] !== null ? (int)$row['id_pago'] : null,
            'id_socio' => (int)$row['id_socio'],
            'tipo_socio' => (string)$row['tipo_socio'],
            'estado_socio' => (string)($row['estado_socio'] ?? 'ACTIVO'),
            'denominacion' => trim((string)($row['denominacion'] ?? '')),
            'documento' => $row['documento'] === null ? null : (string)$row['documento'],
            'id_categoria' => isset($row['id_categoria']) && $row['id_categoria'] !== null ? (int)$row['id_categoria'] : null,
            'categoria' => $row['categoria'] === null ? null : (string)$row['categoria'],
            'fecha_alta' => $row['fecha_alta'] ?? null,
            'id_medio_pago_preferido' => isset($row['id_medio_pago_preferido']) && $row['id_medio_pago_preferido'] !== null
                ? (int)$row['id_medio_pago_preferido']
                : null,
            'medio_pago_preferido' => $row['medio_pago_preferido'] ?? null,
            'id_familia' => isset($row['id_familia']) && $row['id_familia'] !== null ? (int)$row['id_familia'] : null,
            'familia' => $row['familia'] ?? null,
            'cantidad_integrantes' => (int)($row['cantidad_integrantes'] ?? 0),
            'anio' => isset($row['anio']) && $row['anio'] !== null ? (int)$row['anio'] : $year,
            'mes' => isset($row['mes']) && $row['mes'] !== null ? (int)$row['mes'] : $month,
            'mes_nombre' => self::monthName(isset($row['mes']) && $row['mes'] !== null ? (int)$row['mes'] : $month),
            'periodo' => self::monthName(isset($row['mes']) && $row['mes'] !== null ? (int)$row['mes'] : $month) . ' ' . (isset($row['anio']) && $row['anio'] !== null ? (int)$row['anio'] : $year),
            'fecha_pago' => $row['fecha_pago'] ?? null,
            'monto_base' => number_format((float)($row['monto_base'] ?? $row['monto_sugerido'] ?? 0), 2, '.', ''),
            'monto_actual_categoria' => number_format((float)($row['monto_actual_categoria'] ?? $row['monto_actual'] ?? $row['monto_base'] ?? 0), 2, '.', ''),
            'porcentaje_descuento_familiar' => number_format((float)($row['porcentaje_descuento_familiar'] ?? 0), 2, '.', ''),
            'monto_sugerido' => number_format((float)($row['monto_sugerido'] ?? 0), 2, '.', ''),
            'opciones_monto' => is_array($row['opciones_monto'] ?? null) ? $row['opciones_monto'] : [],
            'monto' => !isset($row['monto']) || $row['monto'] === null ? null : number_format((float)$row['monto'], 2, '.', ''),
            'id_medio_pago' => isset($row['id_medio_pago']) && $row['id_medio_pago'] !== null ? (int)$row['id_medio_pago'] : null,
            'medio_pago' => $row['medio_pago'] ?? null,
            'estado' => isset($row['estado_pago']) && $row['estado_pago'] !== null
                ? (string)$row['estado_pago']
                : (isset($row['id_pago']) && $row['id_pago'] !== null ? 'PAGADO' : null),
        ];
    }

    private static function familyCountSql(): string
    {
        return "SELECT fs_count.id_familia, COUNT(*) AS cantidad_integrantes
                FROM familias_socios fs_count
                INNER JOIN socios s_count
                        ON s_count.id_socio = fs_count.id_socio
                       AND s_count.estado = 'ACTIVO'
                       AND s_count.tipo_socio = 'PERSONA'
                WHERE fs_count.fecha_desvinculacion IS NULL
                GROUP BY fs_count.id_familia";
    }

    private static function discountRulesForDate(PDO $db, string $date): array
    {
        $statement = $db->prepare(
            "SELECT cantidad_integrantes_desde, cantidad_integrantes_hasta, porcentaje_descuento
             FROM descuentos_familiares
             WHERE activo = 1
               AND vigencia_desde <= ?
               AND (vigencia_hasta IS NULL OR vigencia_hasta >= ?)
             ORDER BY cantidad_integrantes_desde DESC, id_descuento_familiar DESC"
        );
        $statement->execute([$date, $date]);
        return $statement->fetchAll();
    }

    private static function discountForCount(array $rules, int $count): float
    {
        if ($count < 2) return 0.0;
        foreach ($rules as $rule) {
            $from = (int)$rule['cantidad_integrantes_desde'];
            $to = $rule['cantidad_integrantes_hasta'] === null ? null : (int)$rule['cantidad_integrantes_hasta'];
            if ($count >= $from && ($to === null || $count <= $to)) {
                return max(0.0, min(100.0, (float)$rule['porcentaje_descuento']));
            }
        }
        return 0.0;
    }

    private static function discountedAmount(float $baseAmount, float $discount): float
    {
        return round(max(0.0, $baseAmount) * (1 - max(0.0, min(100.0, $discount)) / 100), 2);
    }

    private static function amountOptionsForCategory(array $history, float $currentAmount, float $discount): array
    {
        $options = [];
        $currentAmount = max(0.0, $currentAmount);

        if ($currentAmount > 0) {
            $currentFrom = null;
            if ($history !== []) {
                $latest = $history[0];
                if (abs((float)$latest['monto_nuevo'] - $currentAmount) < 0.005) {
                    $currentFrom = substr((string)$latest['fecha_cambio'], 0, 10);
                }
            }

            $options[] = [
                'id' => 'actual',
                'actual' => true,
                'monto_base' => number_format($currentAmount, 2, '.', ''),
                'monto' => number_format(self::discountedAmount($currentAmount, $discount), 2, '.', ''),
                'vigente_desde' => $currentFrom,
                'vigente_hasta' => null,
            ];
        }

        foreach ($history as $index => $row) {
            $historicalAmount = max(0.0, (float)$row['monto_anterior']);
            if ($historicalAmount <= 0) continue;

            $changeDate = substr((string)$row['fecha_cambio'], 0, 10);
            $previousChangeDate = isset($history[$index + 1])
                ? substr((string)$history[$index + 1]['fecha_cambio'], 0, 10)
                : null;

            $validUntil = null;
            try {
                $validUntil = (new DateTimeImmutable($changeDate))
                    ->modify('-1 day')
                    ->format('Y-m-d');
            } catch (Throwable) {
                $validUntil = $changeDate;
            }

            // Si hubo varios cambios el mismo día, evitamos mostrar un rango invertido.
            if ($previousChangeDate !== null && $previousChangeDate > $validUntil) {
                $previousChangeDate = $changeDate;
                $validUntil = $changeDate;
            }

            $options[] = [
                'id' => 'hist-' . (int)$index,
                'actual' => false,
                'monto_base' => number_format($historicalAmount, 2, '.', ''),
                'monto' => number_format(self::discountedAmount($historicalAmount, $discount), 2, '.', ''),
                'vigente_desde' => $previousChangeDate,
                'vigente_hasta' => $validUntil,
            ];
        }

        return $options;
    }

    private static function priceHistoryByCategory(PDO $db, array $categoryIds): array
    {
        if ($categoryIds === []) return [];
        $categoryIds = array_values(array_map('intval', $categoryIds));
        $placeholders = implode(',', array_fill(0, count($categoryIds), '?'));
        $statement = $db->prepare(
            "SELECT id_categoria, monto_anterior, monto_nuevo, fecha_cambio
             FROM categorias_historial_precios
             WHERE id_categoria IN ({$placeholders})
             ORDER BY id_categoria ASC, fecha_cambio DESC, id_historial_precio DESC"
        );
        $statement->execute($categoryIds);
        $history = [];
        foreach ($statement->fetchAll() as $row) {
            $history[(int)$row['id_categoria']][] = $row;
        }
        return $history;
    }

    private static function priceForPeriod(array $history, float $fallback, string $periodEnd): float
    {
        foreach ($history as $row) {
            if (substr((string)$row['fecha_cambio'], 0, 10) <= $periodEnd) {
                return (float)$row['monto_nuevo'];
            }
        }
        if ($history !== []) {
            $oldest = $history[count($history) - 1];
            return (float)$oldest['monto_anterior'];
        }
        return $fallback;
    }

    private static function operationCode(): string
    {
        try {
            $suffix = strtoupper(bin2hex(random_bytes(2)));
        } catch (Throwable) {
            $suffix = strtoupper(substr(uniqid('', true), -4));
        }
        return 'CUO-' . date('Ymd-His') . '-' . $suffix;
    }

    private static function compactNames(array $names): string
    {
        $names = array_values(array_filter(array_map('trim', $names)));
        if ($names === []) return '—';
        if (count($names) <= 3) return implode(' · ', $names);
        return implode(' · ', array_slice($names, 0, 3)) . ' · +' . (count($names) - 3) . ' más';
    }

    private static function periodEnd(int $year, int $month): string
    {
        return (new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month)))
            ->modify('last day of this month')
            ->format('Y-m-d');
    }

    private static function validYear(mixed $value): int
    {
        $year = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 2000, 'max_range' => 2100]]);
        if ($year === false) api_error('El año seleccionado no es válido.', 'VALIDATION_ERROR');
        return (int)$year;
    }

    private static function validMonth(mixed $value): int
    {
        $month = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 12]]);
        if ($month === false) api_error('El mes seleccionado no es válido.', 'VALIDATION_ERROR');
        return (int)$month;
    }

    private static function optionalPositiveId(mixed $value): ?int
    {
        if ($value === null || $value === '') return null;
        return positive_id($value, 'categoría');
    }

    private static function monthName(int $month): string
    {
        return [
            1 => 'ENERO', 2 => 'FEBRERO', 3 => 'MARZO', 4 => 'ABRIL',
            5 => 'MAYO', 6 => 'JUNIO', 7 => 'JULIO', 8 => 'AGOSTO',
            9 => 'SEPTIEMBRE', 10 => 'OCTUBRE', 11 => 'NOVIEMBRE', 12 => 'DICIEMBRE',
        ][$month] ?? 'MES';
    }
}
