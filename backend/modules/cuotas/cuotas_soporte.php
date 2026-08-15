<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_schema.php';

abstract class CuotasSoporte
{
    protected const MAX_PAGOS_LOTE = 200;

    protected static function validarEsquema(PDO $db): void
    {
        ensure_cuotas_schema($db);
    }

    protected static function validarAnio(mixed $value): int
    {
        $year = filter_var($value, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 2000, 'max_range' => (int)date('Y') + 1],
        ]);
        if ($year === false) api_error('El año seleccionado no es válido.', 'PERIODO_INVALIDO');
        return (int)$year;
    }

    protected static function idOpcional(mixed $value, string $label): ?int
    {
        if ($value === null || trim((string)$value) === '') return null;
        return positive_id($value, $label);
    }

    protected static function periodo(PDO $db, mixed $value, bool $soloActivo = true): array
    {
        $id = positive_id($value, 'período');
        // Cuotas trabaja con una estructura fija: seis períodos bimestrales
        // (1..6) y Contado Anual (7). Configuración puede conservar opciones
        // auxiliares/históricas, pero nunca deben entrar al circuito de cobro.
        if ($id < 1 || $id > 7) {
            api_error('El período seleccionado no existe o no pertenece al módulo de cuotas.', 'PERIODO_INVALIDO');
        }
        $sql = 'SELECT id_periodo, nombre, meses, activo FROM periodo WHERE id_periodo = ?';
        if ($soloActivo) $sql .= ' AND activo = 1';
        $sql .= ' LIMIT 1';
        $statement = $db->prepare($sql);
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) api_error('El período seleccionado no existe o está inactivo.', 'PERIODO_INVALIDO');
        $row['id_periodo'] = (int)$row['id_periodo'];
        $row['activo'] = (bool)$row['activo'];
        return $row;
    }

    protected static function periodos(PDO $db, bool $soloActivos = true): array
    {
        $conditions = ['id_periodo BETWEEN 1 AND 7'];
        if ($soloActivos) $conditions[] = 'activo = 1';
        $sql = 'SELECT id_periodo, nombre, meses, activo FROM periodo'
            . ' WHERE ' . implode(' AND ', $conditions)
            . ' ORDER BY id_periodo ASC';
        $rows = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        return array_map(static fn(array $row): array => [
            'id_periodo' => (int)$row['id_periodo'],
            // Alias que consume el frontend base de Cuotas.
            'id_mes' => (int)$row['id_periodo'],
            'nombre' => (string)$row['nombre'],
            'meses' => (string)$row['meses'],
            'tipo' => (int)$row['id_periodo'] === 7 ? 'ANUAL' : 'MENSUAL',
            'activo' => (bool)$row['activo'],
        ], $rows);
    }

    protected static function esAnual(int $periodId): bool
    {
        return $periodId === 7;
    }

    protected static function tipoPrecio(int $periodId): string
    {
        return self::esAnual($periodId) ? 'anual' : 'mensual';
    }

    protected static function finPeriodo(int $year, int $periodId): string
    {
        if (self::esAnual($periodId)) return sprintf('%04d-12-31', $year);
        $month = min(12, max(1, $periodId * 2));
        return (new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month)))
            ->modify('last day of this month')
            ->format('Y-m-d');
    }

    protected static function inicioPeriodo(int $year, int $periodId): string
    {
        if (self::esAnual($periodId)) return sprintf('%04d-01-01', $year);
        $month = min(12, max(1, $periodId * 2 - 1));
        return sprintf('%04d-%02d-01', $year, $month);
    }

    protected static function medioPago(PDO $db, mixed $value): array
    {
        $id = positive_id($value, 'medio de pago');
        $statement = $db->prepare(
            'SELECT id_medio_pago, nombre FROM medios_pago
             WHERE id_medio_pago = ? AND activo = 1 LIMIT 1'
        );
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) api_error('El medio de pago seleccionado no existe o está inactivo.', 'MEDIO_PAGO_INVALIDO');
        return ['id_medio_pago' => (int)$row['id_medio_pago'], 'nombre' => (string)$row['nombre']];
    }

    protected static function mapaCategorias(PDO $db, array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if ($ids === []) return [];
        $statement = $db->prepare(
            'SELECT id_categoria, nombre, monto_mensual, monto_anual, activo
             FROM categoria WHERE id_categoria IN (' . implode(',', array_fill(0, count($ids), '?')) . ')'
        );
        $statement->execute($ids);
        $map = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $map[(int)$row['id_categoria']] = $row;
        }
        return $map;
    }

    protected static function historialesPrecios(PDO $db, array $categoryIds): array
    {
        $categoryIds = array_values(array_unique(array_map('intval', $categoryIds)));
        if ($categoryIds === []) return [];
        $statement = $db->prepare(
            'SELECT id_historial, id_categoria, tipo, precio_viejo, precio_nuevo, fecha_cambio
             FROM precios_historicos
             WHERE id_categoria IN (' . implode(',', array_fill(0, count($categoryIds), '?')) . ')
             ORDER BY id_categoria ASC, tipo ASC, fecha_cambio ASC, id_historial ASC'
        );
        $statement->execute($categoryIds);
        $map = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $map[(int)$row['id_categoria']][(string)$row['tipo']][] = $row;
        }
        return $map;
    }

    protected static function montoActual(array $category, int $periodId): float
    {
        return round((float)(self::esAnual($periodId)
            ? $category['monto_anual']
            : $category['monto_mensual']), 2);
    }

    protected static function opcionesMonto(
        array $category,
        int $periodId,
        array $history,
        float $discount = 0.0
    ): array {
        $current = self::montoActual($category, $periodId);
        $options = [[
            'id' => 'actual',
            'actual' => true,
            'monto_base' => number_format($current, 2, '.', ''),
            'monto' => number_format(self::aplicarDescuento($current, $discount), 2, '.', ''),
            // Sin rango: el frontend selecciona primero el valor actual.
            'vigente_desde' => null,
            'vigente_hasta' => null,
        ]];

        if ($history === []) return $options;

        $segments = [];
        $first = $history[0];
        $segments[] = [
            'id' => 'inicial-' . (int)$first['id_historial'],
            'amount' => (float)$first['precio_viejo'],
            'from' => null,
            'to' => (new DateTimeImmutable((string)$first['fecha_cambio']))
                ->modify('-1 day')->format('Y-m-d'),
        ];
        foreach ($history as $index => $change) {
            $next = $history[$index + 1] ?? null;
            $segments[] = [
                'id' => 'hist-' . (int)$change['id_historial'],
                'amount' => (float)$change['precio_nuevo'],
                'from' => (string)$change['fecha_cambio'],
                'to' => $next
                    ? (new DateTimeImmutable((string)$next['fecha_cambio']))->modify('-1 day')->format('Y-m-d')
                    : null,
            ];
        }

        $seen = [];
        foreach (array_reverse($segments) as $segment) {
            $amount = round((float)$segment['amount'], 2);
            if ($amount <= 0 || abs($amount - $current) < 0.005) continue;
            $key = number_format($amount, 2, '.', '') . '|' . ($segment['to'] ?? '');
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $options[] = [
                'id' => $segment['id'],
                'actual' => false,
                'monto_base' => number_format($amount, 2, '.', ''),
                'monto' => number_format(self::aplicarDescuento($amount, $discount), 2, '.', ''),
                'vigente_desde' => $segment['from'],
                'vigente_hasta' => $segment['to'],
            ];
        }
        return $options;
    }

    protected static function reglasDescuento(PDO $db, string $date): array
    {
        $statement = $db->prepare(
            'SELECT cantidad_integrantes_desde, cantidad_integrantes_hasta, porcentaje_descuento
             FROM descuentos_familiares
             WHERE activo = 1 AND vigencia_desde <= ?
               AND (vigencia_hasta IS NULL OR vigencia_hasta >= ?)
             ORDER BY cantidad_integrantes_desde DESC, id_descuento_familiar DESC'
        );
        $statement->execute([$date, $date]);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    protected static function porcentajeDescuento(array $rules, int $count): float
    {
        foreach ($rules as $rule) {
            $from = (int)$rule['cantidad_integrantes_desde'];
            $to = $rule['cantidad_integrantes_hasta'] === null ? null : (int)$rule['cantidad_integrantes_hasta'];
            if ($count >= $from && ($to === null || $count <= $to)) {
                return max(0.0, min(100.0, (float)$rule['porcentaje_descuento']));
            }
        }
        return 0.0;
    }

    protected static function aplicarDescuento(float $amount, float $percentage): float
    {
        return round($amount * (1 - max(0.0, min(100.0, $percentage)) / 100), 2);
    }

    protected static function familiaDeSocio(PDO $db, int $partnerId, string $date): ?array
    {
        $statement = $db->prepare(
            'SELECT f.id_familia, f.nombre_familia
             FROM familias_socios fs
             INNER JOIN familias f ON f.id_familia = fs.id_familia AND f.activo = 1
             WHERE fs.id_socio = ? AND fs.activo = 1
               AND (fs.desde IS NULL OR fs.desde <= ?)
               AND (fs.hasta IS NULL OR fs.hasta >= ?)
             ORDER BY fs.id_familia_socio DESC LIMIT 1'
        );
        $statement->execute([$partnerId, $date, $date]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row ? ['id_familia' => (int)$row['id_familia'], 'nombre' => (string)$row['nombre_familia']] : null;
    }

    protected static function integrantesFamilia(PDO $db, int $familyId, string $date): array
    {
        $statement = $db->prepare(
            'SELECT s.id_socio
             FROM familias_socios fs
             INNER JOIN socios s ON s.id_socio = fs.id_socio
             WHERE fs.id_familia = ? AND fs.activo = 1
               AND (fs.desde IS NULL OR fs.desde <= ?)
               AND (fs.hasta IS NULL OR fs.hasta >= ?)
               AND s.vigente = 1
             ORDER BY s.nombre ASC, s.id_socio ASC'
        );
        $statement->execute([$familyId, $date, $date]);
        return array_map('intval', array_column($statement->fetchAll(PDO::FETCH_ASSOC), 'id_socio'));
    }

    protected static function pagosRegistrados(PDO $db, array $partnerIds, int $year): array
    {
        $partnerIds = array_values(array_unique(array_map('intval', $partnerIds)));
        if ($partnerIds === []) return [];
        $statement = $db->prepare(
            'SELECT p.*, mp.nombre AS medio_pago
             FROM pagos p LEFT JOIN medios_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.id_socio IN (' . implode(',', array_fill(0, count($partnerIds), '?')) . ')
               AND p.anio_aplicado = ? ORDER BY p.id_pago DESC'
        );
        $statement->execute(array_merge($partnerIds, [$year]));
        $map = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $key = (int)$row['id_socio'] . '-' . (int)$row['id_periodo'];
            if (!isset($map[$key])) $map[$key] = $row;
        }
        return $map;
    }

    protected static function conflictoModalidad(array $payments, int $partnerId, int $periodId): ?string
    {
        if (self::esAnual($periodId)) {
            for ($id = 1; $id <= 6; $id++) {
                if (isset($payments[$partnerId . '-' . $id])) {
                    return 'El pago anual no está disponible porque el socio ya posee períodos registrados en ese año.';
                }
            }
            return null;
        }
        return isset($payments[$partnerId . '-7']) ? 'El período ya está cubierto por un pago anual.' : null;
    }

    protected static function codigoOperacion(string $prefix, array $ids): string
    {
        if (count($ids) === 1) return $prefix . '-' . $ids[0];
        return $prefix . '-' . date('YmdHis') . '-' . strtoupper(bin2hex(random_bytes(3)));
    }

    protected static function codigoBarra(int $periodId, int $year, int $partnerId): string
    {
        if ($periodId < 1 || $periodId > 7 || $year < 2000 || $year > 2099 || $partnerId <= 0) {
            api_error(
                'No se pudo generar el código de barras del comprobante.',
                'CODIGO_BARRA_INVALIDO',
                500
            );
        }

        return sprintf('%d%02d-%d', $periodId, $year % 100, $partnerId);
    }

    protected static function fechaPago(mixed $value, string $label = 'pago'): string
    {
        $date = valid_date($value ?? date('Y-m-d'), $label);
        if ($date > date('Y-m-d')) api_error('La fecha de pago no puede ser futura.', 'FECHA_PAGO_FUTURA');
        return $date;
    }
}
