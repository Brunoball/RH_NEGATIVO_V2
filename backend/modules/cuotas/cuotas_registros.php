<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_consultas.php';

abstract class CuotasRegistros extends CuotasConsultas
{
    protected static function registrarPagosDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        self::validarEsquema($db);
        $date = self::fechaPago($body['fecha_pago'] ?? date('Y-m-d'));
        $medium = self::medioPago($db, $body['id_medio_pago'] ?? null);
        $targets = self::normalizarObjetivos($db, $body);
        return self::guardarObjetivos($auth, $targets, $date, $medium, false, null);
    }

    protected static function registrarInscripcionDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        self::validarEsquema($db);
        $partnerId = positive_id($body['id_socio'] ?? null, 'socio');
        $date = self::fechaPago($body['fecha_pago'] ?? date('Y-m-d'));
        $medium = self::medioPago($db, $body['id_medio_pago'] ?? null);

        $mediumName = function_exists('mb_strtoupper')
            ? mb_strtoupper(trim((string)$medium['nombre']), 'UTF-8')
            : strtoupper(trim((string)$medium['nombre']));
        if (!str_contains($mediumName, 'EFECTIVO') && !str_contains($mediumName, 'TRANSFERENCIA')) {
            api_error(
                'La inscripción sólo puede registrarse en efectivo o transferencia.',
                'MEDIO_PAGO_INSCRIPCION_INVALIDO'
            );
        }

        $rawAmount = trim((string)($body['monto'] ?? ''));
        if ($rawAmount === '' || !preg_match('/^[0-9]{1,10}$/', $rawAmount)) {
            api_error('Ingresá un monto de inscripción válido, sin decimales.', 'MONTO_INSCRIPCION_INVALIDO');
        }
        $amount = (int)$rawAmount;
        if ($amount <= 0) {
            api_error('El monto de inscripción debe ser mayor a cero.', 'MONTO_INSCRIPCION_INVALIDO');
        }
        if ($amount > 2147483647) {
            api_error('El monto de inscripción supera el máximo permitido.', 'MONTO_INSCRIPCION_INVALIDO');
        }

        return transaction($db, static function () use (
            $db,
            $auth,
            $partnerId,
            $date,
            $medium,
            $amount
        ): array {
            // Bloquear la fila del socio serializa dos intentos simultáneos de
            // inscripción aun en bases históricas que no tengan UNIQUE por socio.
            $partnerStatement = $db->prepare(
                'SELECT s.id_socio, s.nombre, s.dni, s.vigente,
                        s.domicilio, s.numero, s.domicilio_cobro,
                        s.telefono_fijo, s.telefono_movil,
                        co.nombre AS cobrador
                 FROM socios s
                 LEFT JOIN cobrador co ON co.id_cobrador = s.id_cobrador
                 WHERE s.id_socio = ?
                   AND ' . self::filtroSociosOperativos($db, 's') . '
                 LIMIT 1
                 FOR UPDATE'
            );
            $partnerStatement->execute([$partnerId]);
            $partner = $partnerStatement->fetch(PDO::FETCH_ASSOC);
            if (!$partner) api_error('El socio seleccionado no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            if (!(bool)$partner['vigente']) {
                api_error('No se puede registrar la inscripción a un socio dado de baja.', 'SOCIO_INACTIVO', 409);
            }

            $existing = $db->prepare(
                'SELECT id_inscripcion, monto, fecha_pago
                 FROM pagos_inscripcion
                 WHERE id_socio = ?
                 ORDER BY id_inscripcion ASC
                 LIMIT 1'
            );
            $existing->execute([$partnerId]);
            $existingRow = $existing->fetch(PDO::FETCH_ASSOC);
            if ($existingRow) {
                api_error(
                    'Este socio ya tiene la inscripción registrada.',
                    'INSCRIPCION_YA_REGISTRADA',
                    409,
                    [
                        'id_inscripcion' => (int)$existingRow['id_inscripcion'],
                        'fecha_pago' => (string)$existingRow['fecha_pago'],
                        'monto' => (int)$existingRow['monto'],
                    ]
                );
            }

            $insert = $db->prepare(
                'INSERT INTO pagos_inscripcion
                 (id_socio, monto, fecha_pago, id_medio_pago)
                 VALUES (?, ?, ?, ?)'
            );
            $insert->execute([
                $partnerId,
                $amount,
                $date,
                (int)$medium['id_medio_pago'],
            ]);
            $registrationId = (int)$db->lastInsertId();

            $item = [
                'id_inscripcion' => $registrationId,
                'id_socio' => $partnerId,
                'socio' => (string)$partner['nombre'],
                'documento' => $partner['dni'],
                'fecha_pago' => $date,
                'monto' => $amount,
                'id_medio_pago' => (int)$medium['id_medio_pago'],
                'medio_pago' => (string)$medium['nombre'],
                'domicilio' => trim((string)$partner['domicilio'] . ' ' . (string)$partner['numero']),
                'domicilio_cobro' => $partner['domicilio_cobro'],
                'telefono_fijo' => $partner['telefono_fijo'],
                'telefono_movil' => $partner['telefono_movil'],
                'cobrador' => $partner['cobrador'],
            ];

            audit_change(
                $db,
                $auth,
                'cuotas',
                'INSERT',
                'pagos_inscripcion',
                $registrationId,
                sprintf('Se registró la inscripción de %s.', (string)$partner['nombre']),
                null,
                $item
            );

            return $item;
        });
    }

    protected static function eliminarInscripcionDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        self::validarEsquema($db);
        $registrationId = positive_id(
            $body['id_inscripcion'] ?? $body['id'] ?? null,
            'inscripción'
        );

        return transaction($db, static function () use (
            $db,
            $auth,
            $registrationId
        ): array {
            $statement = $db->prepare(
                'SELECT pi.id_inscripcion, pi.id_socio, pi.monto, pi.fecha_pago,
                        pi.id_medio_pago, pi.creado_en,
                        s.nombre AS socio, s.dni,
                        mp.nombre AS medio_pago
                 FROM pagos_inscripcion pi
                 INNER JOIN socios s ON s.id_socio = pi.id_socio
                 LEFT JOIN medios_pago mp ON mp.id_medio_pago = pi.id_medio_pago
                 WHERE pi.id_inscripcion = ?
                 LIMIT 1
                 FOR UPDATE'
            );
            $statement->execute([$registrationId]);
            $row = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                api_error(
                    'El pago de inscripción ya no existe.',
                    'INSCRIPCION_NO_ENCONTRADA',
                    404
                );
            }
            if (self::socioEliminado($db, (int)$row['id_socio'])) {
                api_error(
                    'La inscripción pertenece a un socio eliminado y se conserva como trazabilidad contable.',
                    'MOVIMIENTO_HISTORICO_PROTEGIDO',
                    409
                );
            }

            $delete = $db->prepare(
                'DELETE FROM pagos_inscripcion WHERE id_inscripcion = ?'
            );
            $delete->execute([$registrationId]);
            if ($delete->rowCount() !== 1) {
                api_error(
                    'No se pudo eliminar el pago de inscripción.',
                    'INSCRIPCION_NO_ELIMINADA',
                    409
                );
            }

            $item = [
                'id_inscripcion' => (int)$row['id_inscripcion'],
                'id_socio' => (int)$row['id_socio'],
                'socio' => (string)$row['socio'],
                'documento' => $row['dni'],
                'monto' => number_format((float)$row['monto'], 2, '.', ''),
                'fecha_pago' => (string)$row['fecha_pago'],
                'id_medio_pago' => $row['id_medio_pago'] === null
                    ? null
                    : (int)$row['id_medio_pago'],
                'medio_pago' => $row['medio_pago'],
                'creado_en' => $row['creado_en'],
            ];

            audit_change(
                $db,
                $auth,
                'cuotas',
                'ELIMINAR',
                'pagos_inscripcion',
                $registrationId,
                sprintf(
                    'Se eliminó el pago de inscripción de %s.',
                    (string)$row['socio']
                ),
                $item,
                null
            );

            return $item;
        });
    }

    protected static function condonarPagoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        self::validarEsquema($db);
        $date = self::fechaPago(
            $body['fecha_condonacion'] ?? $body['fecha_pago'] ?? date('Y-m-d'),
            'condonación'
        );
        $targets = [[
            'id_socio' => positive_id($body['id_socio'] ?? null, 'socio'),
            'anio' => self::validarAnio($body['anio'] ?? date('Y')),
            'id_periodo' => (int)self::periodo(
                $db,
                $body['mes'] ?? $body['id_periodo'] ?? null
            )['id_periodo'],
            'monto' => null,
        ]];
        $reason = optional_text($body['motivo'] ?? $body['motivo_condonacion'] ?? null, 500);
        return self::guardarObjetivos($auth, $targets, $date, null, true, $reason);
    }

    protected static function eliminarPagoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        self::validarEsquema($db);
        $paymentId = positive_id($body['id_pago'] ?? $body['id'] ?? null, 'pago');

        return transaction($db, static function () use ($db, $auth, $paymentId): array {
            $statement = $db->prepare(
                'SELECT p.*, s.nombre AS socio, s.dni, c.nombre AS categoria,
                        pe.nombre AS periodo, pe.meses AS periodo_meses,
                        mp.nombre AS medio_pago
                 FROM pagos p
                 INNER JOIN socios s ON s.id_socio = p.id_socio
                 INNER JOIN categoria c ON c.id_categoria = s.id_categoria
                 INNER JOIN periodo pe ON pe.id_periodo = p.id_periodo
                 LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
                 WHERE p.id_pago = ? FOR UPDATE'
            );
            $statement->execute([$paymentId]);
            $row = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$row) api_error('El pago ya no existe.', 'PAGO_NO_ENCONTRADO', 404);
            if (self::socioEliminado($db, (int)$row['id_socio'])) {
                api_error(
                    'El pago pertenece a un socio eliminado y se conserva como trazabilidad contable.',
                    'MOVIMIENTO_HISTORICO_PROTEGIDO',
                    409
                );
            }

            $delete = $db->prepare('DELETE FROM pagos WHERE id_pago = ?');
            $delete->execute([$paymentId]);
            if ($delete->rowCount() !== 1) api_error('No se pudo eliminar el pago.', 'PAGO_NO_ELIMINADO', 409);

            $item = self::pagoEliminado($row);
            audit_change(
                $db,
                $auth,
                'cuotas',
                'ELIMINAR',
                'pagos',
                $paymentId,
                sprintf(
                    'Se eliminó %s de %s (%s %d).',
                    (string)$row['estado'] === 'CONDONADO' ? 'la condonación' : 'el pago',
                    (string)$row['socio'],
                    (string)$row['periodo'],
                    (int)$row['anio_aplicado']
                ),
                $item,
                null
            );
            return $item;
        });
    }

    private static function normalizarObjetivos(PDO $db, array $body): array
    {
        $raw = [];
        if (is_array($body['pagos'] ?? null)) {
            $raw = $body['pagos'];
        } else {
            $partnerId = positive_id($body['id_socio'] ?? null, 'socio');
            $year = self::validarAnio($body['anio'] ?? date('Y'));
            $periodIds = is_array($body['meses'] ?? null)
                ? $body['meses']
                : [$body['mes'] ?? $body['id_periodo'] ?? null];
            if ($periodIds === []) api_error('Seleccioná al menos un período.', 'VALIDATION_ERROR');

            $applyFamily = filter_var($body['aplicar_familia'] ?? false, FILTER_VALIDATE_BOOL);

            // Compatibilidad con el endpoint legacy aplicar_familia=true. La
            // composición familiar se resuelve en la fecha histórica de CADA
            // período, no en la fecha en la que se está registrando el pago.
            // Así un pago retroactivo nunca agrega/quita integrantes por
            // cambios familiares ocurridos después del período adeudado.
            foreach ($periodIds as $periodId) {
                $period = self::periodo($db, $periodId);
                $resolvedPeriodId = (int)$period['id_periodo'];
                $partnerIds = [$partnerId];

                if ($applyFamily) {
                    $referenceDate = self::inicioPeriodo($year, $resolvedPeriodId);
                    $family = self::familiaDeSocio($db, $partnerId, $referenceDate);
                    if ($family) {
                        $partnerIds = self::integrantesFamilia(
                            $db,
                            (int)$family['id_familia'],
                            $referenceDate
                        );
                        if (!in_array($partnerId, $partnerIds, true)) $partnerIds[] = $partnerId;
                    }
                }

                foreach ($partnerIds as $targetPartnerId) {
                    $raw[] = [
                        'id_socio' => $targetPartnerId,
                        'anio' => $year,
                        'mes' => $resolvedPeriodId,
                        // El pago familiar calcula el monto histórico de cada socio.
                        'monto' => $applyFamily ? null : ($body['monto'] ?? null),
                    ];
                }
            }
        }

        if ($raw === [] || count($raw) > self::MAX_PAGOS_LOTE) {
            api_error(
                'Seleccioná entre 1 y ' . self::MAX_PAGOS_LOTE . ' cuotas.',
                'VALIDATION_ERROR'
            );
        }

        $normalized = [];
        foreach ($raw as $item) {
            if (!is_array($item)) api_error('Uno de los pagos no es válido.', 'VALIDATION_ERROR');
            $partnerId = positive_id($item['id_socio'] ?? null, 'socio');
            $year = self::validarAnio($item['anio'] ?? $body['anio'] ?? date('Y'));
            $period = self::periodo($db, $item['mes'] ?? $item['id_periodo'] ?? null);
            $periodId = (int)$period['id_periodo'];
            $amount = $item['monto'] ?? null;
            $amount = $amount === null || $amount === ''
                ? null
                : decimal_amount($amount, 'monto', 0.01, 9999999999.99);
            $key = $partnerId . '-' . $year . '-' . $periodId;
            $normalized[$key] = [
                'id_socio' => $partnerId,
                'anio' => $year,
                'id_periodo' => $periodId,
                'monto' => $amount,
            ];
        }
        $targets = array_values($normalized);
        self::validarModalidadesObjetivos($targets);
        return $targets;
    }

    /**
     * Contado Anual es una modalidad exclusiva: representa que la persona
     * abonó el año completo en una única operación. Nunca puede convivir en
     * el mismo lote con períodos bimestrales del mismo socio y año.
     */
    private static function validarModalidadesObjetivos(array $targets): void
    {
        $modalities = [];
        foreach ($targets as $target) {
            $key = (int)$target['id_socio'] . '-' . (int)$target['anio'];
            $modalities[$key][self::esAnual((int)$target['id_periodo']) ? 'anual' : 'bimestral'] = true;
        }

        foreach ($modalities as $modes) {
            if (isset($modes['anual'], $modes['bimestral'])) {
                api_error(
                    'Contado Anual no se puede combinar con otros períodos.',
                    'MODALIDAD_NO_DISPONIBLE',
                    409
                );
            }
        }
    }

    private static function guardarObjetivos(
        array $auth,
        array $targets,
        string $date,
        ?array $medium,
        bool $condoned,
        ?string $reason
    ): array {
        $db = $auth['db'];

        // Defensa de negocio además de la UI: un cliente directo tampoco puede
        // registrar/condonar Contado Anual cuando el año no está íntegramente
        // disponible. contextosPagoDatos() es la misma fuente usada por el modal.
        foreach ($targets as $target) {
            if (!self::esAnual((int)$target['id_periodo'])) continue;

            $annualContext = self::contextoPagoDatos(
                $db,
                (int)$target['id_socio'],
                (int)$target['anio'],
                7,
                $date
            );
            $annualPrincipal = $annualContext['principal'] ?? [];
            if (!($annualPrincipal['puede_pagar'] ?? false)) {
                api_error(
                    (string)($annualPrincipal['motivo_no_disponible']
                        ?? 'Contado Anual no está disponible para este socio y año.'),
                    'MODALIDAD_NO_DISPONIBLE',
                    409
                );
            }
        }

        $partnerIds = array_values(array_unique(array_map('intval', array_column($targets, 'id_socio'))));
        sort($partnerIds);

        try {
            return transaction($db, static function () use (
                $db,
                $auth,
                $targets,
                $date,
                $medium,
                $condoned,
                $reason,
                $partnerIds
            ): array {
            // El bloqueo por socio serializa pagos simultáneos incluso si una
            // instalación histórica aún no tiene un índice UNIQUE en pagos.
            $statement = $db->prepare(
                'SELECT s.id_socio, s.nombre, s.dni, s.domicilio, s.numero,
                        s.domicilio_cobro, s.telefono_fijo, s.telefono_movil,
                        s.fecha_ingreso, s.vigente, s.id_categoria,
                        c.nombre AS categoria, c.monto_mensual, c.monto_anual,
                        c.activo AS categoria_activa, co.nombre AS cobrador
                 FROM socios s
                 INNER JOIN categoria c ON c.id_categoria = s.id_categoria
                 LEFT JOIN cobrador co ON co.id_cobrador = s.id_cobrador
                 WHERE s.id_socio IN (' . implode(',', array_fill(0, count($partnerIds), '?')) . ')
                   AND ' . self::filtroSociosOperativos($db, 's') . '
                 ORDER BY s.id_socio ASC FOR UPDATE'
            );
            $statement->execute($partnerIds);
            $rowsById = [];
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $rowsById[(int)$row['id_socio']] = $row;
            }
            if (count($rowsById) !== count($partnerIds)) {
                api_error('Uno de los socios seleccionados no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            }

            $years = array_values(array_unique(array_map('intval', array_column($targets, 'anio'))));
            $paymentsByYear = [];
            foreach ($years as $year) {
                $paymentsByYear[$year] = self::pagosRegistrados($db, $partnerIds, $year);
            }

            $referenceGroups = [];
            foreach ($targets as $target) {
                $referenceDate = self::inicioPeriodo((int)$target['anio'], (int)$target['id_periodo']);
                $referenceGroups[$referenceDate][] = (int)$target['id_socio'];
            }
            $historicalCategoriesByDate = [];
            $categoriesByDate = [];
            $historiesByDate = [];
            $familiesByDate = [];
            $rulesByDate = [];
            foreach ($referenceGroups as $referenceDate => $idsAtDate) {
                $idsAtDate = array_values(array_unique($idsAtDate));
                $historicalCategoriesByDate[$referenceDate] = self::categoriasSociosEnFecha(
                    $db,
                    $idsAtDate,
                    $referenceDate
                );
                $categoryIds = array_values(array_unique(array_filter(array_map(
                    static fn(int $partnerId): int => (int)($historicalCategoriesByDate[$referenceDate][$partnerId] ?? 0),
                    $idsAtDate
                ))));
                $categoriesByDate[$referenceDate] = self::mapaCategorias($db, $categoryIds);
                $historiesByDate[$referenceDate] = self::historialesPrecios($db, $categoryIds);
                $familiesByDate[$referenceDate] = self::mapaFamiliasSocios($db, $idsAtDate, $referenceDate);
                $rulesByDate[$referenceDate] = self::reglasDescuento($db, $referenceDate);
            }

            $periodCache = [];
            $lines = [];
            $ids = [];
            $totalBase = 0.0;
            $total = 0.0;
            $state = $condoned ? 'CONDONADO' : 'PAGADO';
            $insert = $db->prepare(
                'INSERT INTO pagos
                 (id_socio, id_periodo, anio_aplicado, fecha_pago, estado, monto, id_medio_pago)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            );

            foreach ($targets as $target) {
                $partnerId = (int)$target['id_socio'];
                $year = (int)$target['anio'];
                $periodId = (int)$target['id_periodo'];
                $partner = $rowsById[$partnerId];
                $periodCache[$periodId] ??= self::periodo($db, $periodId);
                $period = $periodCache[$periodId];

                if (!(bool)$partner['vigente']) {
                    api_error('No se puede registrar una cuota a un socio dado de baja.', 'SOCIO_INACTIVO', 409);
                }
                $referenceDate = self::inicioPeriodo($year, $periodId);
                $historicalCategoryId = (int)(
                    $historicalCategoriesByDate[$referenceDate][$partnerId]
                    ?? $partner['id_categoria']
                );
                $historicalCategory = $categoriesByDate[$referenceDate][$historicalCategoryId] ?? null;
                $historicalPeriod = self::finPeriodo($year, $periodId) < date('Y-m-d');
                if (!$historicalCategory || (!(bool)$historicalCategory['activo'] && !$historicalPeriod)) {
                    api_error('La categoría correspondiente al período está inactiva o ya no existe.', 'CATEGORIA_INACTIVA', 409);
                }
                if ($partner['fecha_ingreso'] !== null
                    && (string)$partner['fecha_ingreso'] > self::finPeriodo($year, $periodId)) {
                    api_error('El período es anterior al ingreso de uno de los socios.', 'CUOTA_NO_CORRESPONDE', 409);
                }

                $payments = $paymentsByYear[$year];
                if (isset($payments[$partnerId . '-' . $periodId])) {
                    api_error('La cuota seleccionada ya está pagada o condonada.', 'CUOTA_YA_REGISTRADA', 409);
                }
                $conflict = self::conflictoModalidad($payments, $partnerId, $periodId);
                if ($conflict !== null) api_error($conflict, 'MODALIDAD_NO_DISPONIBLE', 409);

                $familyInfo = $familiesByDate[$referenceDate][$partnerId] ?? ['familia' => null, 'cantidad' => 0];
                $family = $familyInfo['familia'];
                $familyCount = (int)$familyInfo['cantidad'];
                $discount = $family
                    ? self::porcentajeDescuento($rulesByDate[$referenceDate] ?? [], $familyCount)
                    : 0.0;
                $history = $historiesByDate[$referenceDate][$historicalCategoryId][self::tipoPrecio($periodId)] ?? [];
                $base = self::montoCategoriaEnFecha(
                    $historicalCategory,
                    $periodId,
                    $history,
                    $referenceDate
                );
                if ($base <= 0) {
                    api_error('La categoría no tiene un monto configurado para ese período.', 'MONTO_NO_CONFIGURADO', 409);
                }
                $amount = $condoned
                    ? 0.0
                    : ($target['monto'] !== null
                        ? (float)$target['monto']
                        : self::aplicarDescuento($base, $discount));
                if (!$condoned && $amount <= 0) api_error('El monto debe ser mayor a cero.', 'MONTO_INVALIDO');

                $insert->execute([
                    $partnerId,
                    $periodId,
                    $year,
                    $date,
                    $state,
                    number_format($amount, 2, '.', ''),
                    $condoned ? null : $medium['id_medio_pago'],
                ]);
                $paymentId = (int)$db->lastInsertId();
                $ids[] = $paymentId;
                $totalBase += $base;
                $total += $amount;

                $line = [
                    'id' => $paymentId,
                    'id_pago' => $paymentId,
                    'id_socio' => $partnerId,
                    'socio' => (string)$partner['nombre'],
                    'denominacion' => (string)$partner['nombre'],
                    'documento' => $partner['dni'],
                    'id_categoria' => $historicalCategoryId,
                    'categoria' => (string)$historicalCategory['nombre'],
                    'anio' => $year,
                    'mes' => $periodId,
                    'id_periodo' => $periodId,
                    'codigo_barra' => self::codigoBarra($periodId, $year, $partnerId),
                    'periodo' => (string)$period['nombre'] . ' ' . $year,
                    'periodo_meses' => (string)$period['meses'],
                    'fecha_pago' => $date,
                    'estado' => $state,
                    'monto_base' => number_format($base, 2, '.', ''),
                    'porcentaje_descuento_familiar' => number_format($discount, 2, '.', ''),
                    'monto' => number_format($amount, 2, '.', ''),
                    'id_medio_pago' => $condoned ? null : (int)$medium['id_medio_pago'],
                    'medio_pago' => $condoned ? null : (string)$medium['nombre'],
                    'id_familia' => $family ? (int)$family['id_familia'] : null,
                    'familia' => $family['nombre'] ?? null,
                    'domicilio' => trim((string)$partner['domicilio'] . ' ' . (string)$partner['numero']),
                    'domicilio_cobro' => $partner['domicilio_cobro'],
                    'telefono_fijo' => $partner['telefono_fijo'],
                    'telefono_movil' => $partner['telefono_movil'],
                    'cobrador' => $partner['cobrador'],
                ];
                $lines[] = $line;
                $paymentsByYear[$year][$partnerId . '-' . $periodId] = [
                    'id_pago' => $paymentId,
                    'id_socio' => $partnerId,
                    'id_periodo' => $periodId,
                    'anio_aplicado' => $year,
                    'estado' => $state,
                ];

                audit_change(
                    $db,
                    $auth,
                    'cuotas',
                    $condoned ? 'CONDONAR' : 'PAGAR',
                    'pagos',
                    $paymentId,
                    sprintf(
                        '%s %s de %s (%s %d).',
                        $condoned ? 'Se condonó' : 'Se registró',
                        self::esAnual($periodId) ? 'la cuota anual' : 'la cuota',
                        (string)$partner['nombre'],
                        (string)$period['nombre'],
                        $year
                    ),
                    null,
                    $line + ($reason ? ['motivo' => $reason] : [])
                );
            }

            $code = self::codigoOperacion($condoned ? 'COND' : 'PAGO', $ids);
            $people = implode(' · ', array_values(array_unique(array_column($lines, 'socio'))));
            return [
                'items' => $lines,
                'comprobante' => [
                    'operacion' => [
                        'codigo_operacion' => $code,
                        'estado' => $state,
                        'fecha_pago' => $date,
                        'socios_label' => $people,
                        'modalidad_label' => count($lines) > 1
                            ? 'Pago múltiple de cuotas'
                            : (self::esAnual((int)$lines[0]['id_periodo'])
                                ? 'Contado anual'
                                : 'Pago de cuota'),
                        'medio_pago' => $condoned ? 'CONDONACIÓN' : (string)$medium['nombre'],
                        'monto_base' => number_format($totalBase, 2, '.', ''),
                        'monto' => number_format($total, 2, '.', ''),
                    ],
                    'lineas' => $lines,
                ],
            ];
            });
        } catch (Throwable $error) {
            // La restricción UNIQUE de la base es la última barrera ante
            // duplicados (scripts externos, importaciones o carreras).
            // Si se dispara, devolvemos el mismo conflicto funcional que la
            // validación normal en vez de transformar el caso en un 500.
            if (duplicate_key($error)) {
                api_error(
                    'La cuota seleccionada ya está pagada o condonada.',
                    'CUOTA_YA_REGISTRADA',
                    409
                );
            }
            throw $error;
        }
    }

    private static function pagoEliminado(array $row): array
    {
        return [
            'id_pago' => (int)$row['id_pago'],
            'id_socio' => (int)$row['id_socio'],
            'denominacion' => (string)$row['socio'],
            'documento' => $row['dni'],
            'categoria' => (string)$row['categoria'],
            'anio' => (int)$row['anio_aplicado'],
            'mes' => (int)$row['id_periodo'],
            'id_periodo' => (int)$row['id_periodo'],
            'periodo' => (string)$row['periodo'] . ' ' . (int)$row['anio_aplicado'],
            'periodo_meses' => (string)$row['periodo_meses'],
            'fecha_pago' => (string)$row['fecha_pago'],
            'estado' => (string)$row['estado'],
            'monto' => number_format((float)($row['monto'] ?? 0), 2, '.', ''),
            'id_medio_pago' => $row['id_medio_pago'] === null ? null : (int)$row['id_medio_pago'],
            'medio_pago' => $row['medio_pago'],
        ];
    }
}
