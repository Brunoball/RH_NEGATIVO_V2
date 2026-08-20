<?php
declare(strict_types=1);

trait SociosConsultas
{
    /**
     * Listado principal del módulo Socios de RH Negativo V2.
     *
     * Importante: este módulo trabaja contra la estructura real de db_rh_v2:
     * socios, categoria, cobrador, estado, grupo_sanguineo, pagos,
     * socios_contactos y socios_cumpleanios_cierres.
     */
    private static function listarDatos(PDO $db, array $filters): array
    {
        $where = [];
        $params = [];

        $vigente = strtoupper(trim((string)($filters['vigente'] ?? 'VIGENTE')));
        if (!in_array($vigente, ['', 'VIGENTE', 'BAJA'], true)) {
            api_error('El filtro de vigencia no es válido.', 'FILTRO_INVALIDO');
        }
        if ($vigente === 'VIGENTE') {
            $where[] = 'q.vigente = 1';
        } elseif ($vigente === 'BAJA') {
            $where[] = 'q.vigente = 0';
        }

        $search = trim((string)($filters['buscar'] ?? ''));
        if ($search !== '') {
            $searchLength = function_exists('mb_strlen') ? mb_strlen($search, 'UTF-8') : strlen($search);
            if ($searchLength > 150) {
                api_error('La búsqueda es demasiado larga.', 'FILTRO_INVALIDO');
            }
            $terms = preg_split('/\s+/u', $search, -1, PREG_SPLIT_NO_EMPTY) ?: [];
            foreach (array_slice($terms, 0, 8) as $index => $term) {
                $key = "buscar_{$index}";
                $where[] = "CONCAT_WS(' ', q.nombre, q.dni, q.domicilio, q.numero, q.telefono_movil,
                            q.telefono_fijo, q.domicilio_cobro, q.categoria, q.cobrador,
                            q.estado, q.grupo_sanguineo) LIKE :{$key}";
                $params[$key] = '%' . $term . '%';
            }
        }

        $letter = strtoupper(trim((string)($filters['letra'] ?? '')));
        if ($letter !== '') {
            if (!preg_match('/^[A-ZÑ]$/u', $letter)) {
                api_error('La letra seleccionada no es válida.', 'FILTRO_INVALIDO');
            }
            $where[] = 'UPPER(LEFT(TRIM(q.nombre), 1)) = :letra';
            $params['letra'] = $letter;
        }

        self::appendPositiveIdFilter($where, $params, $filters, 'id_socio', 'q.id_socio');
        self::appendPositiveIdFilter($where, $params, $filters, 'grupo_sanguineo', 'q.id_grupo_sanguineo');
        self::appendPositiveIdFilter($where, $params, $filters, 'estado', 'q.id_estado');
        self::appendPositiveIdFilter($where, $params, $filters, 'categoria', 'q.id_categoria');
        self::appendPositiveIdFilter($where, $params, $filters, 'cobrador', 'q.id_cobrador');

        $debt = strtoupper(trim((string)($filters['deuda'] ?? '')));
        if (!in_array($debt, ['', 'AL_DIA', 'DEBE_1_2', 'DEBE_3_MAS'], true)) {
            api_error('El filtro de deudas no es válido.', 'FILTRO_INVALIDO');
        }
        if ($debt === 'AL_DIA') {
            $where[] = 'q.meses_adeudados = 0';
        } elseif ($debt === 'DEBE_1_2') {
            $where[] = 'q.meses_adeudados BETWEEN 1 AND 2';
        } elseif ($debt === 'DEBE_3_MAS') {
            $where[] = 'q.meses_adeudados >= 3';
        }

        $contact = strtoupper(trim((string)($filters['ultimo_contacto'] ?? '')));
        if (!in_array($contact, ['', 'CONTACTADO', 'PENDIENTE', 'NO_CONTACTADO', 'SIN_GESTION'], true)) {
            api_error('El filtro de último contacto no es válido.', 'FILTRO_INVALIDO');
        }
        if ($contact === 'SIN_GESTION') {
            $where[] = 'q.ultimo_contacto_estado IS NULL';
        } elseif ($contact !== '') {
            $where[] = 'q.ultimo_contacto_estado = :ultimo_contacto';
            $params['ultimo_contacto'] = $contact;
        }

        $from = trim((string)($filters['ingreso_desde'] ?? ''));
        $to = trim((string)($filters['ingreso_hasta'] ?? ''));
        if ($from !== '') {
            $where[] = 'q.fecha_ingreso >= :ingreso_desde';
            $params['ingreso_desde'] = valid_date($from, 'ingreso desde');
        }
        if ($to !== '') {
            $where[] = 'q.fecha_ingreso <= :ingreso_hasta';
            $params['ingreso_hasta'] = valid_date($to, 'ingreso hasta');
        }
        if ($from !== '' && $to !== '' && $from > $to) {
            api_error('La fecha desde no puede ser posterior a la fecha hasta.', 'FILTRO_INVALIDO');
        }

        $page = filter_var($filters['pagina'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($page === false) {
            api_error('La página solicitada no es válida.', 'PAGINA_INVALIDA');
        }
        $perPage = 100;
        $page = (int)$page;

        $sqlWhere = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);
        $dataset = self::baseDatasetSql();

        $count = $db->prepare("SELECT COUNT(*) FROM ({$dataset}) q {$sqlWhere}");
        $count->execute($params);
        $total = (int)$count->fetchColumn();
        $totalPages = $total > 0 ? (int)ceil($total / $perPage) : 0;
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        $offset = ($page - 1) * $perPage;

        $statement = $db->prepare(
            "SELECT q.*
             FROM ({$dataset}) q
             {$sqlWhere}
             ORDER BY q.vigente DESC, q.nombre ASC, q.id_socio ASC
             LIMIT {$perPage} OFFSET {$offset}"
        );
        $statement->execute($params);
        $items = array_map(static fn(array $row): array => self::castSocio($row), $statement->fetchAll());

        return [
            'items' => $items,
            'paginacion' => [
                'pagina' => $page,
                'por_pagina' => $perPage,
                'total' => $total,
                'total_paginas' => $totalPages,
                'desde' => $total === 0 || $offset >= $total ? 0 : $offset + 1,
                'hasta' => $total === 0 || $offset >= $total ? 0 : min($offset + $perPage, $total),
                'tiene_anterior' => $page > 1,
                'tiene_siguiente' => $page < $totalPages,
            ],
            'resumen' => self::resumen($db),
            'catalogos' => self::catalogos($db),
            'avisos_cumpleanios' => self::avisosCumpleanios($db),
        ];
    }

    private static function appendPositiveIdFilter(
        array &$where,
        array &$params,
        array $filters,
        string $filterKey,
        string $column
    ): void {
        $raw = trim((string)($filters[$filterKey] ?? ''));
        if ($raw === '') return;
        $id = filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) api_error('Uno de los filtros seleccionados no es válido.', 'FILTRO_INVALIDO');
        $where[] = "{$column} = :{$filterKey}";
        $params[$filterKey] = (int)$id;
    }

    private static function obtenerDatos(PDO $db, int $id): array
    {
        $item = self::detalle($db, $id);
        if (!$item) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

        return [
            'item' => $item,
            'catalogos' => self::catalogos($db),
        ];
    }

    private static function historialDatos(PDO $db, int $id): array
    {
        $item = self::detalle($db, $id);
        if (!$item) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

        $states = $db->prepare(
            'SELECT h.id_historial, h.tipo_evento, h.id_estado_anterior, h.id_estado_nuevo,
                    ea.nombre AS estado_anterior, en.nombre AS estado_nuevo,
                    h.vigente_anterior, h.vigente_nuevo, h.fecha_evento, h.motivo,
                    h.observacion, h.origen, h.creado_en, u.usuario
             FROM socios_historial_estados h
             LEFT JOIN estado ea ON ea.id_estado = h.id_estado_anterior
             LEFT JOIN estado en ON en.id_estado = h.id_estado_nuevo
             LEFT JOIN sis_usuarios u ON u.idUsuario = h.id_usuario
             WHERE h.id_socio = ?
             ORDER BY COALESCE(h.fecha_evento, h.creado_en) DESC, h.id_historial DESC'
        );
        $states->execute([$id]);
        $stateRows = $states->fetchAll();
        foreach ($stateRows as &$row) {
            $row['id_historial'] = (int)$row['id_historial'];
            $row['id_estado_anterior'] = $row['id_estado_anterior'] === null ? null : (int)$row['id_estado_anterior'];
            $row['id_estado_nuevo'] = $row['id_estado_nuevo'] === null ? null : (int)$row['id_estado_nuevo'];
            $row['vigente_anterior'] = $row['vigente_anterior'] === null ? null : (bool)$row['vigente_anterior'];
            $row['vigente_nuevo'] = $row['vigente_nuevo'] === null ? null : (bool)$row['vigente_nuevo'];
        }
        unset($row);

        $payments = $db->prepare(
            'SELECT p.id_pago, p.id_periodo, per.nombre AS periodo, per.meses,
                    p.anio_aplicado, p.fecha_pago, p.estado, p.monto,
                    p.id_medio_pago, mp.nombre AS medio_pago, p.creado_en
             FROM pagos p
             INNER JOIN periodo per ON per.id_periodo = p.id_periodo
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.id_socio = ?
             ORDER BY p.anio_aplicado DESC, p.id_periodo DESC, p.fecha_pago DESC, p.id_pago DESC'
        );
        $payments->execute([$id]);
        $paymentRows = $payments->fetchAll();
        foreach ($paymentRows as &$row) {
            $row['id_pago'] = (int)$row['id_pago'];
            $row['id_periodo'] = (int)$row['id_periodo'];
            $row['anio_aplicado'] = (int)$row['anio_aplicado'];
            $row['id_medio_pago'] = $row['id_medio_pago'] === null ? null : (int)$row['id_medio_pago'];
            $row['monto'] = $row['monto'] === null ? null : (float)$row['monto'];
        }
        unset($row);

        $registrationPayments = $db->prepare(
            'SELECT pi.id_inscripcion, pi.monto, pi.fecha_pago, pi.id_medio_pago,
                    mp.nombre AS medio_pago, pi.creado_en
             FROM pagos_inscripcion pi
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = pi.id_medio_pago
             WHERE pi.id_socio = ?
             ORDER BY pi.fecha_pago DESC, pi.id_inscripcion DESC'
        );
        $registrationPayments->execute([$id]);
        $registrationRows = $registrationPayments->fetchAll();
        foreach ($registrationRows as &$row) {
            $row['id_inscripcion'] = (int)$row['id_inscripcion'];
            $row['monto'] = (float)$row['monto'];
            $row['id_medio_pago'] = $row['id_medio_pago'] === null ? null : (int)$row['id_medio_pago'];
        }
        unset($row);

        $contacts = $db->prepare(
            'SELECT sc.id_contacto, sc.fecha_contacto, sc.estado_contacto,
                    sc.detalle_contacto, sc.id_usuario, sc.creado_en, sc.actualizado_en,
                    u.usuario
             FROM socios_contactos sc
             LEFT JOIN sis_usuarios u ON u.idUsuario = sc.id_usuario
             WHERE sc.id_socio = ?
             ORDER BY sc.fecha_contacto DESC, sc.id_contacto DESC'
        );
        $contacts->execute([$id]);
        $contactRows = $contacts->fetchAll();
        foreach ($contactRows as &$row) {
            $row['id_contacto'] = (int)$row['id_contacto'];
            $row['id_usuario'] = $row['id_usuario'] === null ? null : (int)$row['id_usuario'];
        }
        unset($row);

        return [
            'item' => $item,
            'historial_estados' => $stateRows,
            'pagos' => $paymentRows,
            'pagos_inscripcion' => $registrationRows,
            'contactos' => $contactRows,
            'impacto_eliminacion' => self::impactoEliminacion($db, $id),
        ];
    }

    private static function impactoEliminacion(PDO $db, int $id): array
    {
        $queries = [
            'pagos' => ['SELECT COUNT(*) FROM pagos WHERE id_socio = ?', [$id]],
            'pagos_inscripcion' => ['SELECT COUNT(*) FROM pagos_inscripcion WHERE id_socio = ?', [$id]],
            'contactos' => ['SELECT COUNT(*) FROM socios_contactos WHERE id_socio = ?', [$id]],
            'cumpleanios_cierres' => ['SELECT COUNT(*) FROM socios_cumpleanios_cierres WHERE id_socio = ?', [$id]],
            'historial_estados' => ['SELECT COUNT(*) FROM socios_historial_estados WHERE id_socio = ?', [$id]],
            'vinculos_familiares' => ['SELECT COUNT(*) FROM familias_socios WHERE id_socio = ?', [$id]],
            'fusiones' => ['SELECT COUNT(*) FROM socios_fusiones WHERE id_socio_origen = ? OR id_socio_destino = ?', [$id, $id]],
        ];

        $impact = [];
        foreach ($queries as $key => [$sql, $params]) {
            try {
                $statement = $db->prepare($sql);
                $statement->execute($params);
                $impact[$key] = (int)$statement->fetchColumn();
            } catch (PDOException $error) {
                // El contador es informativo: nunca debe impedir una baja o
                // eliminación. El borrado definitivo valida las FK reales por
                // separado antes de tocar el registro principal.
                error_log('[socios_impacto_eliminacion][' . $key . '] ' . $error->getMessage());
                $impact[$key] = 0;
            }
        }
        $impact['total_relaciones'] = array_sum($impact);
        return $impact;
    }

    private static function catalogos(PDO $db): array
    {
        $categories = $db->query(
            'SELECT id_categoria, nombre, monto_mensual, monto_anual, activo
             FROM categoria
             ORDER BY activo DESC, nombre ASC'
        )->fetchAll();
        foreach ($categories as &$row) {
            $row['id_categoria'] = (int)$row['id_categoria'];
            $row['monto_mensual'] = (float)$row['monto_mensual'];
            $row['monto_anual'] = (float)$row['monto_anual'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        $collectors = $db->query(
            'SELECT id_cobrador, nombre, activo
             FROM cobrador
             ORDER BY activo DESC, nombre ASC'
        )->fetchAll();
        foreach ($collectors as &$row) {
            $row['id_cobrador'] = (int)$row['id_cobrador'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        $states = $db->query(
            'SELECT id_estado, nombre, activo
             FROM estado
             ORDER BY activo DESC, id_estado ASC'
        )->fetchAll();
        foreach ($states as &$row) {
            $row['id_estado'] = (int)$row['id_estado'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        $bloodGroups = $db->query(
            'SELECT id_grupo_sanguineo, nombre, activo
             FROM grupo_sanguineo
             ORDER BY activo DESC, id_grupo_sanguineo ASC'
        )->fetchAll();
        foreach ($bloodGroups as &$row) {
            $row['id_grupo_sanguineo'] = (int)$row['id_grupo_sanguineo'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        $paymentMethods = $db->query(
            'SELECT id_medio_pago, nombre, activo
             FROM medios_pago
             ORDER BY activo DESC, nombre ASC'
        )->fetchAll();
        foreach ($paymentMethods as &$row) {
            $row['id_medio_pago'] = (int)$row['id_medio_pago'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        return [
            'categorias' => $categories,
            'cobradores' => $collectors,
            'estados' => $states,
            'grupos_sanguineos' => $bloodGroups,
            'medios_pago' => $paymentMethods,
        ];
    }

    private static function resumen(PDO $db): array
    {
        $row = $db->query(
            'SELECT COUNT(*) AS total,
                    COALESCE(SUM(vigente = 1), 0) AS vigentes,
                    COALESCE(SUM(vigente = 0), 0) AS bajas,
                    COALESCE(SUM(vigente = 1 AND fecha_ingreso >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0) AS ingresos_recientes,
                    COALESCE(SUM(vigente = 1 AND id_grupo_sanguineo IS NULL), 0) AS sin_grupo_sanguineo
             FROM socios'
        )->fetch() ?: [];

        return [
            'total' => (int)($row['total'] ?? 0),
            'vigentes' => (int)($row['vigentes'] ?? 0),
            'bajas' => (int)($row['bajas'] ?? 0),
            'ingresos_recientes' => (int)($row['ingresos_recientes'] ?? 0),
            'sin_grupo_sanguineo' => (int)($row['sin_grupo_sanguineo'] ?? 0),
        ];
    }

    private static function avisosCumpleanios(PDO $db): array
    {
        $statement = $db->query(
            "SELECT s.id_socio, s.nombre, s.dni, s.fecha_nacimiento,
                    TIMESTAMPDIFF(YEAR, s.fecha_nacimiento, CURDATE()) AS edad,
                    s.telefono_movil, gs.nombre AS grupo_sanguineo
             FROM socios s
             LEFT JOIN grupo_sanguineo gs ON gs.id_grupo_sanguineo = s.id_grupo_sanguineo
             WHERE s.vigente = 1
               AND s.fecha_nacimiento IS NOT NULL
               AND TIMESTAMPDIFF(YEAR, s.fecha_nacimiento, CURDATE()) BETWEEN 18 AND 23
               AND NOT EXISTS (
                    SELECT 1
                    FROM socios_cumpleanios_cierres cc
                    WHERE cc.id_socio = s.id_socio
                      AND cc.anio = YEAR(CURDATE())
                      AND cc.rango = '18-23'
               )
             ORDER BY TIMESTAMPDIFF(YEAR, s.fecha_nacimiento, CURDATE()) ASC,
                      DATE_FORMAT(s.fecha_nacimiento, '%m-%d') ASC,
                      s.nombre ASC,
                      s.id_socio ASC
             LIMIT 100"
        );
        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            $row['id_socio'] = (int)$row['id_socio'];
            $row['edad'] = (int)$row['edad'];
        }
        unset($row);
        return $rows;
    }

    private static function baseDatasetSql(): string
    {
        $debtExpression = self::debtMonthsExpression();
        return "SELECT
                    s.id_socio, s.nombre, s.id_cobrador, s.id_grupo_sanguineo,
                    s.id_categoria, s.domicilio, s.numero, s.telefono_movil,
                    s.telefono_fijo, s.observaciones, s.fecha_nacimiento,
                    s.id_estado, s.domicilio_cobro, s.dni, s.fecha_ingreso,
                    s.vigente, s.creado_en, s.actualizado_en,
                    cob.nombre AS cobrador,
                    gs.nombre AS grupo_sanguineo,
                    cat.nombre AS categoria,
                    cat.monto_mensual AS categoria_monto_mensual,
                    cat.monto_anual AS categoria_monto_anual,
                    est.nombre AS estado,
                    TIMESTAMPDIFF(YEAR, s.fecha_nacimiento, CURDATE()) AS edad,
                    uc.id_contacto AS ultimo_contacto_id,
                    uc.fecha_contacto AS ultimo_contacto_fecha,
                    uc.estado_contacto AS ultimo_contacto_estado,
                    uc.detalle_contacto AS ultimo_contacto_detalle,
                    hb.fecha_evento AS fecha_baja,
                    hb.motivo AS motivo_baja,
                    {$debtExpression} AS meses_adeudados
                FROM socios s
                INNER JOIN cobrador cob ON cob.id_cobrador = s.id_cobrador
                INNER JOIN categoria cat ON cat.id_categoria = s.id_categoria
                LEFT JOIN grupo_sanguineo gs ON gs.id_grupo_sanguineo = s.id_grupo_sanguineo
                LEFT JOIN estado est ON est.id_estado = s.id_estado
                LEFT JOIN socios_contactos uc
                  ON uc.id_contacto = (
                      SELECT sc2.id_contacto
                      FROM socios_contactos sc2
                      WHERE sc2.id_socio = s.id_socio
                      ORDER BY sc2.fecha_contacto DESC, sc2.id_contacto DESC
                      LIMIT 1
                  )
                LEFT JOIN socios_historial_estados hb
                  ON hb.id_historial = (
                      SELECT h2.id_historial
                      FROM socios_historial_estados h2
                      WHERE h2.id_socio = s.id_socio
                        AND h2.tipo_evento = 'BAJA'
                      ORDER BY CASE
                                   WHEN NULLIF(TRIM(h2.motivo), '') IS NULL THEN 1
                                   ELSE 0
                               END ASC,
                               COALESCE(h2.fecha_evento, h2.creado_en) DESC,
                               h2.id_historial DESC
                      LIMIT 1
                  )";
    }

    private static function debtMonthsExpression(): string
    {
        return "CASE
                    WHEN s.fecha_ingreso IS NOT NULL AND s.fecha_ingreso > CURDATE() THEN 0
                    ELSE (
                        SELECT COUNT(*)
                        FROM (
                            SELECT 1 AS mes UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
                            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
                            UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
                        ) meses
                        WHERE meses.mes <= MONTH(CURDATE())
                          AND (
                              s.fecha_ingreso IS NULL
                              OR YEAR(s.fecha_ingreso) < YEAR(CURDATE())
                              OR (YEAR(s.fecha_ingreso) = YEAR(CURDATE()) AND meses.mes >= MONTH(s.fecha_ingreso))
                          )
                          AND NOT EXISTS (
                              SELECT 1
                              FROM pagos pa
                              WHERE pa.id_socio = s.id_socio
                                AND pa.anio_aplicado = YEAR(CURDATE())
                                AND pa.id_periodo = 7
                                AND pa.estado IN ('PAGADO', 'CONDONADO')
                          )
                          AND NOT EXISTS (
                              SELECT 1
                              FROM pagos pp
                              WHERE pp.id_socio = s.id_socio
                                AND pp.anio_aplicado = YEAR(CURDATE())
                                AND pp.id_periodo = CEIL(meses.mes / 2)
                                AND pp.estado IN ('PAGADO', 'CONDONADO')
                          )
                    )
                END";
    }

    private static function detalle(PDO $db, int $id): ?array
    {
        $dataset = self::baseDatasetSql();
        $statement = $db->prepare("SELECT q.* FROM ({$dataset}) q WHERE q.id_socio = ? LIMIT 1");
        $statement->execute([$id]);
        $row = $statement->fetch();
        return $row ? self::castSocio($row) : null;
    }

    private static function castSocio(array $row): array
    {
        foreach (['id_socio', 'id_cobrador', 'id_categoria'] as $field) {
            $row[$field] = (int)$row[$field];
        }
        foreach (['id_grupo_sanguineo', 'id_estado', 'ultimo_contacto_id'] as $field) {
            $row[$field] = $row[$field] === null ? null : (int)$row[$field];
        }
        $row['vigente'] = (bool)$row['vigente'];
        $row['activo'] = $row['vigente'];
        $row['edad'] = $row['edad'] === null ? null : (int)$row['edad'];
        $row['meses_adeudados'] = (int)($row['meses_adeudados'] ?? 0);
        $row['categoria_monto_mensual'] = (float)$row['categoria_monto_mensual'];
        $row['categoria_monto_anual'] = (float)$row['categoria_monto_anual'];
        $fechaBaja = trim((string)($row['fecha_baja'] ?? ''));
        $row['fecha_baja'] = $fechaBaja !== '' ? substr($fechaBaja, 0, 10) : null;
        $motivoBaja = trim((string)($row['motivo_baja'] ?? ''));
        $row['motivo_baja'] = $motivoBaja !== '' ? $motivoBaja : null;
        $row['denominacion'] = (string)$row['nombre'];
        return $row;
    }
}
