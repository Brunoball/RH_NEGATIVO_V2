<?php
declare(strict_types=1);

trait SociosConsultas
{
    private static function listarDatos(PDO $db, array $filters): array
    {
        $where = [];
        $params = [];

        $type = strtoupper(trim((string)($filters['tipo'] ?? '')));
        if (!in_array($type, ['', 'PERSONA', 'EMPRESA'], true)) {
            api_error('El tipo de socio solicitado no es válido.', 'FILTRO_INVALIDO');
        }
        if ($type !== '') {
            $where[] = 's.tipo_socio = :tipo';
            $params['tipo'] = $type;
        }

        $status = strtoupper(trim((string)($filters['estado'] ?? 'ACTIVO')));
        if (!in_array($status, ['', 'ACTIVO', 'INACTIVO'], true)) {
            api_error('El estado solicitado no es válido.', 'FILTRO_INVALIDO');
        }
        if ($status !== '') {
            $where[] = 's.estado = :estado';
            $params['estado'] = $status;
        }

        $searchFilter = build_search_filter(
            $filters['buscar'] ?? '',
            ["CONCAT_WS(' ',
                p.apellido, p.nombre, p.dni, p.domicilio, p.numero_domicilio,
                p.localidad, p.telefono, p.email,
                e.razon_social, e.cuit, e.domicilio, e.telefono, e.email,
                c.nombre, mp.nombre, f.nombre
            ) LIKE {param}"],
            150,
            'buscar_socio'
        );
        if ($searchFilter['sql'] !== '') {
            $where[] = $searchFilter['sql'];
            $params = array_merge($params, $searchFilter['params']);
        }

        $category = filter_var($filters['categoria'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($category !== false && $category !== null) {
            $where[] = 's.id_categoria = :categoria';
            $params['categoria'] = (int)$category;
        }

        $paymentMethod = filter_var($filters['medio_pago'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($paymentMethod !== false && $paymentMethod !== null) {
            $where[] = 's.id_medio_pago = :medio_pago';
            $params['medio_pago'] = (int)$paymentMethod;
        }

        $familyFilter = trim((string)($filters['familia'] ?? ''));
        if ($familyFilter === 'sin_familia') {
            $where[] = 's.tipo_socio = \'PERSONA\' AND f.id_familia IS NULL';
        } elseif ($familyFilter !== '') {
            $familyId = filter_var($familyFilter, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($familyId === false) api_error('La familia solicitada no es válida.', 'FILTRO_INVALIDO');
            $where[] = 'f.id_familia = :familia';
            $params['familia'] = (int)$familyId;
        }

        $from = trim((string)($filters['alta_desde'] ?? ''));
        $to = trim((string)($filters['alta_hasta'] ?? ''));
        if ($from !== '') {
            $where[] = 's.fecha_alta >= :alta_desde';
            $params['alta_desde'] = valid_date($from, 'alta desde');
        }
        if ($to !== '') {
            $where[] = 's.fecha_alta <= :alta_hasta';
            $params['alta_hasta'] = valid_date($to, 'alta hasta');
        }
        if ($from !== '' && $to !== '' && $from > $to) {
            api_error('La fecha desde no puede ser posterior a la fecha hasta.', 'FILTRO_INVALIDO');
        }

        $pageRaw = $filters['pagina'] ?? 1;
        $page = filter_var($pageRaw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($page === false) {
            api_error('La página solicitada no es válida.', 'PAGINA_INVALIDA');
        }

        // El módulo carga siempre como máximo 100 socios. Los filtros y la
        // búsqueda se aplican en SQL antes del LIMIT, por lo que contemplan
        // la totalidad de la base y no solamente los registros visibles.
        $perPage = 100;
        $sqlWhere = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);

        $countStatement = $db->prepare(
            'SELECT COUNT(DISTINCT s.id_socio) ' . self::baseFrom($sqlWhere)
        );
        $countStatement->execute($params);
        $total = (int)$countStatement->fetchColumn();
        $totalPages = $total > 0 ? (int)ceil($total / $perPage) : 0;
        $page = (int)$page;
        $offset = ($page - 1) * $perPage;

        $statement = $db->prepare(
            self::baseQuery($sqlWhere)
            . " ORDER BY (s.estado = 'ACTIVO') DESC,
                       COALESCE(p.apellido, e.razon_social) ASC,
                       p.nombre ASC,
                       s.id_socio ASC
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
            'resumen' => self::resumen($db, $type),
            'catalogos' => self::catalogos($db),
        ];
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
            'SELECT h.id_historial_estado, h.tipo_evento, h.estado_anterior, h.estado_nuevo,
                    h.fecha_efectiva, h.motivo, h.observaciones, h.creado_en,
                    u.usuario
             FROM socios_historial_estados h
             LEFT JOIN sis_usuarios u ON u.idUsuario = h.id_usuario
             WHERE h.id_socio = ?
             ORDER BY COALESCE(h.fecha_efectiva, DATE(h.creado_en)) DESC, h.creado_en DESC, h.id_historial_estado DESC'
        );
        $states->execute([$id]);
        $stateRows = $states->fetchAll();
        foreach ($stateRows as &$row) $row['id_historial_estado'] = (int)$row['id_historial_estado'];
        unset($row);

        $payments = $db->prepare(
            'SELECT p.id_pago, p.mes, p.anio, p.fecha_pago, p.monto, p.estado, p.creado_en,
                    mp.nombre AS medio_pago
             FROM pagos p
             LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.id_socio = ?
             ORDER BY p.anio DESC, p.mes DESC, p.id_pago DESC'
        );
        $payments->execute([$id]);
        $paymentRows = $payments->fetchAll();
        foreach ($paymentRows as &$row) {
            $row['id_pago'] = (int)$row['id_pago'];
            $row['mes'] = (int)$row['mes'];
            $row['anio'] = (int)$row['anio'];
            $row['monto'] = $row['monto'] === null ? null : (float)$row['monto'];
            $row['estado'] = (string)($row['estado'] ?? 'PAGADO');
        }
        unset($row);

        $familyRows = [];
        if ($item['tipo_socio'] === 'PERSONA') {
            $families = $db->prepare(
                'SELECT fs.id_familia_socio, fs.id_familia, f.nombre AS familia,
                        fs.parentesco, fs.es_titular, fs.observaciones,
                        fs.fecha_incorporacion, fs.fecha_desvinculacion, fs.motivo_desvinculacion
                 FROM familias_socios fs
                 INNER JOIN familias f ON f.id_familia = fs.id_familia
                 WHERE fs.id_socio = ?
                 ORDER BY fs.fecha_incorporacion DESC, fs.id_familia_socio DESC'
            );
            $families->execute([$id]);
            $familyRows = $families->fetchAll();
            foreach ($familyRows as &$row) {
                $row['id_familia_socio'] = (int)$row['id_familia_socio'];
                $row['id_familia'] = (int)$row['id_familia'];
                $row['es_titular'] = (bool)$row['es_titular'];
                $row['activo'] = $row['fecha_desvinculacion'] === null;
            }
            unset($row);
        }

        return [
            'item' => $item,
            'historial_estados' => $stateRows,
            'pagos' => $paymentRows,
            'familias' => $familyRows,
            'impacto_eliminacion' => self::impactoEliminacion($db, $id),
        ];
    }

    private static function impactoEliminacion(PDO $db, int $id): array
    {
        $payments = $db->prepare('SELECT COUNT(*) FROM pagos WHERE id_socio = ?');
        $payments->execute([$id]);

        $states = $db->prepare('SELECT COUNT(*) FROM socios_historial_estados WHERE id_socio = ?');
        $states->execute([$id]);

        $families = $db->prepare('SELECT COUNT(*) FROM familias_socios WHERE id_socio = ?');
        $families->execute([$id]);

        $paymentCount = (int)$payments->fetchColumn();
        $stateCount = (int)$states->fetchColumn();
        $familyCount = (int)$families->fetchColumn();

        return [
            'pagos' => $paymentCount,
            'historial_estados' => $stateCount,
            'vinculos_familiares' => $familyCount,
            'total_relaciones' => $paymentCount + $stateCount + $familyCount,
        ];
    }

    private static function catalogos(PDO $db): array
    {
        $categories = $db->query(
            'SELECT id_categoria, nombre, descripcion, monto_cuota, activo
             FROM categorias
             ORDER BY activo DESC, nombre ASC'
        )->fetchAll();
        foreach ($categories as &$row) {
            $row['id_categoria'] = (int)$row['id_categoria'];
            $row['monto_cuota'] = (float)$row['monto_cuota'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        $methods = $db->query(
            'SELECT id_medio_pago, nombre, activo
             FROM medios_pago
             ORDER BY activo DESC, nombre ASC'
        )->fetchAll();
        foreach ($methods as &$row) {
            $row['id_medio_pago'] = (int)$row['id_medio_pago'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        $taxConditions = $db->query(
            'SELECT id_condicion_iva, nombre, activo
             FROM condiciones_iva
             ORDER BY activo DESC, nombre ASC'
        )->fetchAll();
        foreach ($taxConditions as &$row) {
            $row['id_condicion_iva'] = (int)$row['id_condicion_iva'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        $families = $db->query(
            'SELECT id_familia, nombre, activo
             FROM familias
             ORDER BY activo DESC, nombre ASC'
        )->fetchAll();
        foreach ($families as &$row) {
            $row['id_familia'] = (int)$row['id_familia'];
            $row['activo'] = (bool)$row['activo'];
        }
        unset($row);

        return [
            'categorias' => $categories,
            'medios_pago' => $methods,
            'condiciones_iva' => $taxConditions,
            'familias' => $families,
        ];
    }

    private static function resumen(PDO $db, string $type): array
    {
        $params = [];
        $typeWhere = '';
        if ($type !== '') {
            $typeWhere = 'WHERE s.tipo_socio = :tipo';
            $params['tipo'] = $type;
        }

        $statement = $db->prepare(
            "SELECT COUNT(*) AS total,
                    COALESCE(SUM(s.estado = 'ACTIVO'), 0) AS activos,
                    COALESCE(SUM(s.estado = 'INACTIVO'), 0) AS inactivos,
                    COALESCE(SUM(s.estado = 'ACTIVO' AND s.fecha_alta >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0) AS altas_recientes,
                    COALESCE(SUM(s.estado = 'ACTIVO' AND s.id_categoria IS NULL), 0) AS sin_categoria,
                    COALESCE(SUM(s.tipo_socio = 'PERSONA' AND s.estado = 'ACTIVO' AND NOT EXISTS (
                        SELECT 1
                        FROM familias_socios fs
                        INNER JOIN familias f ON f.id_familia = fs.id_familia AND f.activo = 1
                        WHERE fs.id_socio = s.id_socio AND fs.fecha_desvinculacion IS NULL
                    )), 0) AS sin_familia
             FROM socios s
             {$typeWhere}"
        );
        $statement->execute($params);
        $row = $statement->fetch() ?: [];

        return [
            'total' => (int)($row['total'] ?? 0),
            'activos' => (int)($row['activos'] ?? 0),
            'inactivos' => (int)($row['inactivos'] ?? 0),
            'altas_recientes' => (int)($row['altas_recientes'] ?? 0),
            'sin_categoria' => (int)($row['sin_categoria'] ?? 0),
            'sin_familia' => (int)($row['sin_familia'] ?? 0),
        ];
    }

    private static function baseQuery(string $extraWhere = ''): string
    {
        return "SELECT
                    s.id_socio, s.tipo_socio, s.observaciones, s.motivo_baja, s.fecha_baja,
                    s.fecha_alta, s.estado, s.id_categoria, s.id_medio_pago,
                    s.enviar_recordatorio, s.creado_en, s.actualizado_en,
                    c.nombre AS categoria, c.monto_cuota,
                    mp.nombre AS medio_pago,
                    p.apellido, p.nombre, p.dni, p.domicilio AS persona_domicilio,
                    p.numero_domicilio, p.localidad, p.telefono AS persona_telefono,
                    p.email AS persona_email, p.domicilio_alternativo AS persona_domicilio_alternativo,
                    e.razon_social, e.cuit,
                    e.domicilio AS empresa_domicilio, e.telefono AS empresa_telefono,
                    e.email AS empresa_email, e.domicilio_alternativo AS empresa_domicilio_alternativo,
                    e.id_condicion_iva, ci.nombre AS condicion_iva,
                    f.id_familia, f.nombre AS familia,
                    fs.parentesco, fs.es_titular "
                . self::baseFrom($extraWhere);
    }

    private static function baseFrom(string $extraWhere = ''): string
    {
        return "FROM socios s
                LEFT JOIN socios_personas p ON p.id_socio = s.id_socio
                LEFT JOIN socios_empresas e ON e.id_socio = s.id_socio
                LEFT JOIN categorias c ON c.id_categoria = s.id_categoria
                LEFT JOIN medios_pago mp ON mp.id_medio_pago = s.id_medio_pago
                LEFT JOIN condiciones_iva ci ON ci.id_condicion_iva = e.id_condicion_iva
                LEFT JOIN familias_socios fs
                    ON fs.id_socio = s.id_socio AND fs.fecha_desvinculacion IS NULL
                LEFT JOIN familias f
                    ON f.id_familia = fs.id_familia AND f.activo = 1
                {$extraWhere}";
    }

    private static function detalle(PDO $db, int $id): ?array
    {
        $statement = $db->prepare(self::baseQuery('WHERE s.id_socio = :id') . ' LIMIT 1');
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        return $row ? self::castSocio($row) : null;
    }

    private static function castSocio(array $row): array
    {
        $row['id_socio'] = (int)$row['id_socio'];
        foreach (['id_categoria', 'id_medio_pago', 'id_condicion_iva', 'id_familia'] as $field) {
            $row[$field] = $row[$field] === null ? null : (int)$row[$field];
        }
        $row['enviar_recordatorio'] = (bool)$row['enviar_recordatorio'];
        $row['es_titular'] = $row['es_titular'] === null ? false : (bool)$row['es_titular'];
        $row['activo'] = $row['estado'] === 'ACTIVO';
        $row['monto_cuota'] = $row['monto_cuota'] === null ? null : (float)$row['monto_cuota'];

        if ($row['tipo_socio'] === 'PERSONA') {
            $row['domicilio'] = $row['persona_domicilio'];
            $row['telefono'] = $row['persona_telefono'];
            $row['email'] = $row['persona_email'];
            $row['domicilio_alternativo'] = $row['persona_domicilio_alternativo'];
            $row['denominacion'] = trim((string)$row['apellido'] . ', ' . (string)$row['nombre'], ', ');
        } else {
            $row['domicilio'] = $row['empresa_domicilio'];
            $row['telefono'] = $row['empresa_telefono'];
            $row['email'] = $row['empresa_email'];
            $row['domicilio_alternativo'] = $row['empresa_domicilio_alternativo'];
            $row['denominacion'] = (string)$row['razon_social'];
        }

        unset(
            $row['persona_domicilio'],
            $row['persona_telefono'],
            $row['persona_email'],
            $row['persona_domicilio_alternativo'],
            $row['empresa_domicilio'],
            $row['empresa_telefono'],
            $row['empresa_email'],
            $row['empresa_domicilio_alternativo']
        );

        return $row;
    }
}
