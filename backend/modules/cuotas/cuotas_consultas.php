<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_soporte.php';

abstract class CuotasConsultas extends CuotasSoporte
{
    protected static function listarDatos(PDO $db, array $filters): array
    {
        self::validarEsquema($db);
        $type = strtoupper(trim((string)($filters['tipo'] ?? 'PERSONA')));
        if ($type !== 'PERSONA') api_error('El tipo de cuota solicitado no es válido.', 'FILTRO_INVALIDO');

        $state = strtoupper(trim((string)($filters['estado'] ?? 'DEUDORES')));
        if (!in_array($state, ['DEUDORES', 'PAGADOS', 'CONDONADOS'], true)) {
            api_error('El estado de cuota solicitado no es válido.', 'FILTRO_INVALIDO');
        }

        $year = self::validarAnio($filters['anio'] ?? date('Y'));
        $period = self::periodo($db, $filters['mes'] ?? $filters['id_periodo'] ?? 1);
        $periodId = (int)$period['id_periodo'];
        $periodEnd = self::finPeriodo($year, $periodId);
        $periodReference = self::inicioPeriodo($year, $periodId);
        $search = clean_text($filters['buscar'] ?? '', 160, false);
        $categoryId = self::idOpcional($filters['categoria'] ?? null, 'categoría');
        $page = max(1, (int)($filters['pagina'] ?? 1));
        $perPage = max(1, min(200, (int)($filters['por_pagina'] ?? 100)));
        $includeCatalogs = filter_var(
            $filters['incluir_catalogos'] ?? true,
            FILTER_VALIDATE_BOOL,
            FILTER_NULL_ON_FAILURE
        );
        if ($includeCatalogs === null) $includeCatalogs = true;

        $where = ['1 = 1'];
        $params = [];
        if ($state === 'DEUDORES') {
            $where[] = 's.vigente = 1';
            $where[] = '(s.fecha_ingreso IS NULL OR s.fecha_ingreso <= ?)';
            $params[] = $periodEnd;
        }
        $rows = self::consultarSocios($db, implode(' AND ', $where), $params, $periodReference);
        $partnerIds = array_map('intval', array_column($rows, 'id_socio'));
        $historicalCategories = self::categoriasSociosEnFecha($db, $partnerIds, $periodReference);
        foreach ($rows as &$row) {
            $partnerId = (int)$row['id_socio'];
            if (isset($historicalCategories[$partnerId])) {
                $row['id_categoria'] = (int)$historicalCategories[$partnerId];
            }
        }
        unset($row);
        $categoryIds = array_values(array_unique(array_map('intval', array_column($rows, 'id_categoria'))));
        $categoryNames = self::mapaCategorias($db, $categoryIds);
        foreach ($rows as &$row) {
            $category = $categoryNames[(int)$row['id_categoria']] ?? null;
            if ($category) {
                $row['categoria'] = (string)$category['nombre'];
                $row['categoria_activa'] = (bool)$category['activo'];
            }
        }
        unset($row);
        if ($categoryId !== null) {
            $rows = array_values(array_filter(
                $rows,
                static fn(array $row): bool => (int)$row['id_categoria'] === $categoryId
            ));
        }
        if ($search !== '') {
            $needle = function_exists('mb_strtoupper')
                ? mb_strtoupper($search, 'UTF-8')
                : strtoupper($search);
            $rows = array_values(array_filter($rows, static function (array $row) use ($needle): bool {
                $haystack = implode(' ', [
                    $row['nombre'] ?? '',
                    $row['dni'] ?? '',
                    $row['categoria'] ?? '',
                    $row['cobrador'] ?? '',
                    $row['familia'] ?? '',
                ]);
                $haystack = function_exists('mb_strtoupper')
                    ? mb_strtoupper($haystack, 'UTF-8')
                    : strtoupper($haystack);
                return str_contains($haystack, $needle);
            }));
        }
        $partnerIds = array_map('intval', array_column($rows, 'id_socio'));
        $payments = self::pagosRegistrados($db, $partnerIds, $year);
        $categoryIds = array_map('intval', array_column($rows, 'id_categoria'));
        $categories = self::mapaCategorias($db, $categoryIds);
        $histories = self::historialesPrecios($db, $categoryIds);
        $rules = self::reglasDescuento($db, $periodReference);

        $items = [];
        foreach ($rows as $row) {
            $partnerId = (int)$row['id_socio'];
            $directPayment = $payments[$partnerId . '-' . $periodId] ?? null;
            $annualPayment = $periodId !== 7
                ? ($payments[$partnerId . '-7'] ?? null)
                : null;
            $payment = $directPayment ?? $annualPayment;
            $annualOrigin = $directPayment === null && $annualPayment !== null;
            $conflict = self::conflictoModalidad($payments, $partnerId, $periodId);

            if ($state === 'DEUDORES' && ($payment !== null || $conflict !== null)) continue;
            if ($state === 'PAGADOS' && ($payment === null || (string)$payment['estado'] !== 'PAGADO')) continue;
            if ($state === 'CONDONADOS' && ($payment === null || (string)$payment['estado'] !== 'CONDONADO')) continue;

            $category = $categories[(int)$row['id_categoria']] ?? null;
            $historicalPeriod = $periodEnd < date('Y-m-d');
            if ($state === 'DEUDORES' && (!$category || (!(bool)$category['activo'] && !$historicalPeriod))) continue;
            $items[] = self::armarItem(
                $row,
                $category,
                $histories[(int)$row['id_categoria']][self::tipoPrecio($annualOrigin ? 7 : $periodId)] ?? [],
                $rules,
                $period,
                $year,
                $payment,
                $conflict,
                $annualOrigin,
                $periodReference
            );
        }

        $totalAmount = array_reduce($items, static function (float $total, array $item) use ($state): float {
            return $total + (float)($state === 'DEUDORES' ? $item['monto_sugerido'] : ($item['monto'] ?? 0));
        }, 0.0);
        $totalItems = count($items);
        $totalPages = $totalItems === 0 ? 0 : (int)ceil($totalItems / $perPage);
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        $offset = ($page - 1) * $perPage;
        $paged = array_slice($items, $offset, $perPage);

        $result = [
            'items' => $paged,
            'resumen' => [
                'total' => $totalItems,
                'importe' => number_format($totalAmount, 2, '.', ''),
                'con_categoria' => $totalItems,
                'sin_categoria' => 0,
            ],
            'periodo' => [
                'anio' => $year,
                'mes' => $periodId,
                'id_periodo' => $periodId,
                'mes_nombre' => (string)$period['nombre'],
                'nombre' => (string)$period['nombre'],
                'meses' => (string)$period['meses'],
            ],
            'paginacion' => [
                'pagina' => $page,
                'por_pagina' => $perPage,
                'total' => $totalItems,
                'total_paginas' => $totalPages,
                'desde' => $totalItems === 0 ? 0 : $offset + 1,
                'hasta' => $totalItems === 0 ? 0 : min($offset + count($paged), $totalItems),
                'tiene_anterior' => $page > 1,
                'tiene_siguiente' => $totalPages > 0 && $page < $totalPages,
            ],
        ];

        if ($includeCatalogs) $result += self::catalogosDatos($db, $year, $periodId);
        return $result;
    }

    protected static function catalogosDatos(PDO $db, ?int $year = null, ?int $periodId = null): array
    {
        self::validarEsquema($db);
        $year ??= (int)date('Y');
        $periodId ??= 1;
        $period = self::periodo($db, $periodId);
        $date = date('Y-m-d');

        $categoryRows = $db->query(
            'SELECT id_categoria, nombre, monto_mensual, monto_anual, activo
             FROM categoria ORDER BY activo DESC, nombre ASC'
        )->fetchAll(PDO::FETCH_ASSOC);
        $categories = array_map(static function (array $row) use ($periodId): array {
            $monthly = number_format((float)$row['monto_mensual'], 2, '.', '');
            $annual = number_format((float)$row['monto_anual'], 2, '.', '');
            return [
                'id_categoria' => (int)$row['id_categoria'],
                'nombre' => (string)$row['nombre'],
                'monto_mensual' => $monthly,
                'monto_anual' => $annual,
                'monto_cuota' => self::esAnual($periodId) ? $annual : $monthly,
                'activo' => (bool)$row['activo'],
            ];
        }, $categoryRows);

        $mediaRows = $db->query(
            'SELECT id_medio_pago, nombre FROM medios_pago WHERE activo = 1 ORDER BY nombre ASC'
        )->fetchAll(PDO::FETCH_ASSOC);
        $media = array_map(static fn(array $row): array => [
            'id_medio_pago' => (int)$row['id_medio_pago'],
            'nombre' => (string)$row['nombre'],
        ], $mediaRows);

        $partnerRows = self::consultarSocios($db, 's.vigente = 1', [], $date);
        $categoryIds = array_map('intval', array_column($partnerRows, 'id_categoria'));
        $categoryMap = self::mapaCategorias($db, $categoryIds);
        $rules = self::reglasDescuento($db, $date);
        $partners = [];
        foreach ($partnerRows as $row) {
            $category = $categoryMap[(int)$row['id_categoria']] ?? null;
            if (!$category || !(bool)$category['activo']) continue;
            $count = (int)($row['cantidad_integrantes'] ?? 0);
            $discount = $row['id_familia'] === null ? 0.0 : self::porcentajeDescuento($rules, $count);
            $base = self::montoActual($category, $periodId);
            $partners[] = [
                'id_socio' => (int)$row['id_socio'],
                'tipo_socio' => 'PERSONA',
                'id_categoria' => (int)$row['id_categoria'],
                'id_medio_pago' => null,
                'denominacion' => (string)$row['nombre'],
                'documento' => $row['dni'],
                'categoria' => (string)$row['categoria'],
                'domicilio' => trim((string)$row['domicilio'] . ' ' . (string)$row['numero']),
                'cobrador' => $row['cobrador'],
                'id_familia' => $row['id_familia'] === null ? null : (int)$row['id_familia'],
                'familia' => $row['familia'],
                'cantidad_integrantes' => $count,
                'monto_base' => number_format($base, 2, '.', ''),
                'porcentaje_descuento_familiar' => number_format($discount, 2, '.', ''),
                'monto_sugerido' => number_format(self::aplicarDescuento($base, $discount), 2, '.', ''),
            ];
        }

        // El selector solo necesita años con movimientos reales. El año
        // actual se conserva aunque todavía no tenga pagos para poder iniciar
        // la cobranza, y el backend admite como máximo el año siguiente.
        $currentYear = (int)date('Y');
        $yearRows = $db->query(
            'SELECT DISTINCT anio_aplicado
             FROM pagos
             WHERE anio_aplicado BETWEEN 2000 AND YEAR(CURDATE()) + 1
             ORDER BY anio_aplicado DESC'
        )->fetchAll(PDO::FETCH_ASSOC);
        $years = array_map('intval', array_column($yearRows, 'anio_aplicado'));
        if (!in_array($currentYear, $years, true)) $years[] = $currentYear;
        rsort($years, SORT_NUMERIC);

        return ['catalogos' => [
            'categorias' => $categories,
            'medios_pago' => $media,
            'socios' => $partners,
            'anios' => array_values(array_unique($years)),
            'meses' => self::periodos($db),
            'periodos' => self::periodos($db),
        ]];
    }

    protected static function contextosPagoDatos(
        PDO $db,
        int $partnerId,
        int $year,
        string $paymentDate
    ): array {
        self::validarEsquema($db);

        // La fecha de pago define cuándo entra dinero en caja; categoría,
        // precio y familia de una cuota retroactiva pertenecen al período
        // aplicado. Por eso cada período reconstruye su propio contexto.
        $exists = self::consultarSocios($db, 's.id_socio = ?', [$partnerId], $paymentDate);
        if ($exists === []) api_error('El socio seleccionado no existe.', 'SOCIO_NO_ENCONTRADO', 404);

        $result = [];
        foreach (self::periodos($db) as $period) {
            $periodId = (int)$period['id_periodo'];
            $referenceDate = self::inicioPeriodo($year, $periodId);
            $family = self::familiaDeSocio($db, $partnerId, $referenceDate);
            $memberIds = $family
                ? self::integrantesFamilia($db, (int)$family['id_familia'], $referenceDate)
                : [$partnerId];
            if (!in_array($partnerId, $memberIds, true)) $memberIds[] = $partnerId;
            $memberIds = array_values(array_unique(array_map('intval', $memberIds)));

            $memberRows = self::consultarSocios(
                $db,
                's.id_socio IN (' . implode(',', array_fill(0, count($memberIds), '?')) . ')',
                $memberIds,
                $referenceDate
            );
            $rowsById = [];
            foreach ($memberRows as $row) $rowsById[(int)$row['id_socio']] = $row;
            if (!isset($rowsById[$partnerId])) {
                api_error('El socio seleccionado no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            }

            $historicalCategories = self::categoriasSociosEnFecha($db, $memberIds, $referenceDate);
            $categoryIds = array_values(array_unique(array_filter(array_map(
                static function (int $id) use ($historicalCategories, $rowsById): int {
                    return (int)($historicalCategories[$id] ?? ($rowsById[$id]['id_categoria'] ?? 0));
                },
                $memberIds
            ))));
            $categories = self::mapaCategorias($db, $categoryIds);
            $histories = self::historialesPrecios($db, $categoryIds);

            foreach ($rowsById as $id => &$row) {
                $categoryId = (int)($historicalCategories[$id] ?? $row['id_categoria']);
                $row['id_categoria'] = $categoryId;
                if (isset($categories[$categoryId])) {
                    $row['categoria'] = (string)$categories[$categoryId]['nombre'];
                    $row['categoria_activa'] = (bool)$categories[$categoryId]['activo'];
                }
            }
            unset($row);

            $payments = self::pagosRegistrados($db, $memberIds, $year);
            $rules = self::reglasDescuento($db, $referenceDate);
            $familyCount = count($memberIds);

            $principalItem = self::armarContextoSocio(
                $rowsById[$partnerId],
                $categories,
                $histories,
                $payments,
                $rules,
                $period,
                $year,
                $familyCount,
                $referenceDate
            );

            $members = [];
            foreach ($memberIds as $memberId) {
                if (!isset($rowsById[$memberId])) continue;
                $members[] = self::armarContextoSocio(
                    $rowsById[$memberId],
                    $categories,
                    $histories,
                    $payments,
                    $rules,
                    $period,
                    $year,
                    $familyCount,
                    $referenceDate
                );
            }

            $result[(string)$periodId] = [
                'principal' => $principalItem,
                'familia' => $family ? [
                    'id_familia' => (int)$family['id_familia'],
                    'nombre' => (string)$family['nombre'],
                    'cantidad_integrantes' => $familyCount,
                    'integrantes' => $members,
                ] : null,
            ];
        }
        return $result;
    }

    protected static function contextoPagoDatos(
        PDO $db,
        int $partnerId,
        int $year,
        int $periodId,
        string $paymentDate
    ): array {
        $contexts = self::contextosPagoDatos($db, $partnerId, $year, $paymentDate);
        if (!isset($contexts[(string)$periodId])) api_error('El período seleccionado no existe.', 'PERIODO_INVALIDO');
        return $contexts[(string)$periodId];
    }

    private static function consultarSocios(PDO $db, string $where, array $params, string $familyDate): array
    {
        $sql =
            "SELECT s.id_socio, s.nombre, s.dni, s.id_categoria, s.id_cobrador,
                    s.domicilio, s.numero, s.domicilio_cobro,
                    s.telefono_fijo, s.telefono_movil,
                    s.fecha_ingreso, s.vigente,
                    c.nombre AS categoria, c.activo AS categoria_activa,
                    co.nombre AS cobrador,
                    f.id_familia, f.nombre_familia AS familia,
                    fc.cantidad_integrantes
             FROM socios s
             INNER JOIN categoria c ON c.id_categoria = s.id_categoria
             LEFT JOIN cobrador co ON co.id_cobrador = s.id_cobrador
             LEFT JOIN familias_socios fs ON fs.id_familia_socio = (
                SELECT MAX(fs2.id_familia_socio)
                FROM familias_socios fs2
                INNER JOIN familias f2 ON f2.id_familia = fs2.id_familia
                WHERE fs2.id_socio = s.id_socio
                  AND (fs2.desde IS NULL OR fs2.desde <= ?)
                  AND (fs2.hasta IS NULL OR fs2.hasta >= ?)
             )
             LEFT JOIN familias f ON f.id_familia = fs.id_familia
             LEFT JOIN (
                SELECT fs3.id_familia, COUNT(DISTINCT fs3.id_socio) AS cantidad_integrantes
                FROM familias_socios fs3
                INNER JOIN socios s3 ON s3.id_socio = fs3.id_socio
                WHERE (fs3.desde IS NULL OR fs3.desde <= ?)
                  AND (fs3.hasta IS NULL OR fs3.hasta >= ?)
                GROUP BY fs3.id_familia
             ) fc ON fc.id_familia = f.id_familia
             WHERE {$where}
             ORDER BY s.nombre ASC, s.id_socio ASC";
        $statement = $db->prepare($sql);
        $statement->execute(array_merge([$familyDate, $familyDate, $familyDate, $familyDate], $params));
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    private static function armarItem(
        array $row,
        ?array $category,
        array $history,
        array $rules,
        array $period,
        int $year,
        ?array $payment,
        ?string $conflict,
        bool $annualOrigin = false,
        ?string $pricingDate = null
    ): array {
        $periodId = (int)$period['id_periodo'];
        $familyCount = (int)($row['cantidad_integrantes'] ?? 0);
        $discount = $row['id_familia'] === null ? 0.0 : self::porcentajeDescuento($rules, $familyCount);
        // Cuando un Contado Anual se proyecta sobre un período bimestral,
        // los importes y el comprobante deben conservar la modalidad que
        // realmente fue abonada, no mostrar el valor del bimestre consultado.
        $amountPeriodId = $annualOrigin ? 7 : $periodId;
        $historyForAmount = $history;
        $base = $category
            ? ($pricingDate !== null
                ? self::montoCategoriaEnFecha($category, $amountPeriodId, $historyForAmount, $pricingDate)
                : self::montoActual($category, $amountPeriodId))
            : 0.0;
        $suggested = self::aplicarDescuento($base, $discount);
        return [
            'id_socio' => (int)$row['id_socio'],
            'tipo_socio' => 'PERSONA',
            'estado_socio' => (bool)$row['vigente'] ? 'ACTIVO' : 'INACTIVO',
            'fecha_alta' => $row['fecha_ingreso'],
            'id_categoria' => (int)$row['id_categoria'],
            'denominacion' => (string)$row['nombre'],
            'documento' => $row['dni'],
            'categoria' => (string)$row['categoria'],
            'domicilio' => trim((string)$row['domicilio'] . ' ' . (string)$row['numero']),
            'domicilio_cobro' => $row['domicilio_cobro'],
            'telefono_fijo' => $row['telefono_fijo'],
            'telefono_movil' => $row['telefono_movil'],
            'cobrador' => $row['cobrador'],
            'id_familia' => $row['id_familia'] === null ? null : (int)$row['id_familia'],
            'familia' => $row['familia'],
            'cantidad_integrantes' => $familyCount,
            'anio' => $year,
            'mes' => $periodId,
            'id_periodo' => $periodId,
            'periodo' => (string)$period['nombre'] . ' ' . $year,
            'periodo_meses' => (string)$period['meses'],
            'monto_actual_categoria' => number_format($base, 2, '.', ''),
            'monto_base' => number_format($base, 2, '.', ''),
            'porcentaje_descuento_familiar' => number_format($discount, 2, '.', ''),
            'monto_sugerido' => number_format($suggested, 2, '.', ''),
            'opciones_monto' => $category ? self::opcionesMonto($category, $periodId, $history, $discount, $pricingDate) : [],
            'id_pago' => $payment ? (int)$payment['id_pago'] : null,
            // Se genera también para deudas: la asociación imprime los
            // comprobantes antes de salir a realizar la cobranza.
            'codigo_barra' => self::codigoBarra(
                $annualOrigin ? 7 : $periodId,
                $year,
                (int)$row['id_socio']
            ),
            'fecha_pago' => $payment['fecha_pago'] ?? null,
            'monto' => $payment ? number_format((float)($payment['monto'] ?? 0), 2, '.', '') : null,
            'id_medio_pago' => isset($payment['id_medio_pago']) && $payment['id_medio_pago'] !== null
                ? (int)$payment['id_medio_pago'] : null,
            'medio_pago' => $payment['medio_pago'] ?? null,
            'estado' => $payment['estado'] ?? null,
            'origen_anual' => $annualOrigin,
            'id_periodo_pago' => $annualOrigin ? 7 : $periodId,
            'periodo_pago' => $annualOrigin
                ? 'CONTADO ANUAL ' . $year
                : (string)$period['nombre'] . ' ' . $year,
            'pagado' => $payment !== null,
            'ya_pagado' => $payment !== null,
            'puede_pagar' => $payment === null && $conflict === null,
            'disponible' => $payment === null && $conflict === null,
            'motivo_no_disponible' => $conflict,
        ];
    }

    private static function armarContextoSocio(
        array $row,
        array $categories,
        array $histories,
        array $payments,
        array $rules,
        array $period,
        int $year,
        int $familyCount,
        ?string $pricingDate = null
    ): array {
        $periodId = (int)$period['id_periodo'];
        $partnerId = (int)$row['id_socio'];
        $categoryId = (int)$row['id_categoria'];
        $category = $categories[$categoryId] ?? null;
        $directPayment = $payments[$partnerId . '-' . $periodId] ?? null;
        $annualPayment = $periodId !== 7
            ? ($payments[$partnerId . '-7'] ?? null)
            : null;
        $payment = $directPayment ?? $annualPayment;
        $annualOrigin = $directPayment === null && $annualPayment !== null;
        $conflict = self::conflictoModalidad($payments, $partnerId, $periodId);
        $eligibleDate = $row['fecha_ingreso'] === null || (string)$row['fecha_ingreso'] <= self::finPeriodo($year, $periodId);
        $active = (bool)$row['vigente'];
        $categoryAvailable = $category
            && ((bool)$category['activo'] || ($pricingDate !== null && $pricingDate < date('Y-m-d')));
        $amountPeriodId = $annualOrigin ? 7 : $periodId;
        $base = $category
            ? ($pricingDate !== null
                ? self::montoCategoriaEnFecha(
                    $category,
                    $amountPeriodId,
                    $histories[$categoryId][self::tipoPrecio($amountPeriodId)] ?? [],
                    $pricingDate
                )
                : self::montoActual($category, $amountPeriodId))
            : 0.0;
        $discount = $row['id_familia'] === null ? 0.0 : self::porcentajeDescuento($rules, $familyCount);
        $canPay = $payment === null && $conflict === null && $active && $eligibleDate && $categoryAvailable && $base > 0;
        $reason = $payment !== null
            ? ($annualOrigin
                ? 'El período está cubierto por el Contado Anual.'
                : 'El período ya está pagado o condonado.')
            : $conflict;
        if ($reason === null && !$active) $reason = 'El socio está dado de baja.';
        if ($reason === null && !$eligibleDate) $reason = 'El período es anterior al ingreso del socio.';
        if ($reason === null && !$categoryAvailable) $reason = 'La categoría está inactiva.';
        if ($reason === null && $base <= 0) $reason = 'La categoría no tiene un monto configurado.';

        return array_replace(self::armarItem(
            $row,
            $category,
            $histories[$categoryId][self::tipoPrecio($annualOrigin ? 7 : $periodId)] ?? [],
            $rules,
            $period,
            $year,
            $payment,
            $reason,
            $annualOrigin,
            $pricingDate
        ), [
            'puede_pagar' => $canPay,
            'disponible' => $canPay,
            'motivo_no_disponible' => $reason,
        ]);
    }
}
