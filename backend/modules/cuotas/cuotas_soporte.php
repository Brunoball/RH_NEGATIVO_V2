<?php
declare(strict_types=1);

abstract class CuotasSoporte
{
    protected const ESTADOS_REGISTRADOS = ['PAGADO', 'CONDONADO'];
    protected const MODALIDADES_CUOTAS = ['MENSUAL', 'PRIMERA_MITAD', 'SEGUNDA_MITAD', 'CONTADO_ANUAL'];
    protected const MODALIDADES_PAQUETE = ['PRIMERA_MITAD', 'SEGUNDA_MITAD', 'CONTADO_ANUAL'];

    /**
     * Permite cobrar cuotas e inscripciones del año actual y del siguiente.
     * La regla queda centralizada para que modal, filtros y validaciones usen
     * exactamente el mismo límite.
     */
    protected static function maximumEnabledYear(): int
    {
        return (int)date('Y') + 1;
    }

    /**
     * Convierte una fecha de fin de vigencia en el último mes realmente
     * exigible. Si la baja ocurrió antes del último día del mes, ese mes ya no
     * genera deuda. Esto también corrige historiales viejos cerrados a mitad de
     * mes por versiones anteriores del sistema.
     */
    protected static function lastChargeableMonth(?string $endDate): ?DateTimeImmutable
    {
        $endDate = trim((string)$endDate);
        if ($endDate === '' || $endDate === '9999-12-31') return null;

        $date = new DateTimeImmutable($endDate);
        $monthStart = $date->modify('first day of this month');
        $monthEnd = $date->modify('last day of this month');

        return $date < $monthEnd
            ? $monthStart->modify('-1 month')
            : $monthStart;
    }

    protected static function allowedRecipients(PDO $db, int $principalId, bool $applyFamily): array
    {
        $statement = $db->prepare('SELECT id_socio, activo FROM socios WHERE id_socio = ?');
        $statement->execute([$principalId]);
        $principal = $statement->fetch();
        if (!$principal) api_error('El socio no existe.', 'SOCIO_NO_DISPONIBLE', 404);
        if (!$applyFamily || !(bool)$principal['activo']) return [$principalId];

        $familyStatement = $db->prepare(
            'SELECT f.id_familia FROM familia_socios fs INNER JOIN familias f ON f.id_familia = fs.id_familia
             WHERE fs.id_socio = ? AND f.activo = 1 LIMIT 1'
        );
        $familyStatement->execute([$principalId]);
        $familyId = $familyStatement->fetchColumn();
        if (!$familyId) return [$principalId];
        $members = $db->prepare(
            'SELECT s.id_socio FROM familia_socios fs INNER JOIN socios s ON s.id_socio = fs.id_socio
             WHERE fs.id_familia = ? AND s.activo = 1 ORDER BY s.id_socio'
        );
        $members->execute([(int)$familyId]);
        return array_map('intval', array_column($members->fetchAll(), 'id_socio'));
    }

    protected static function recipientsWithCategory(PDO $db, array $partnerIds, int $categoryId, int $year): array
    {
        if ($partnerIds === []) return [];
        $placeholders = implode(',', array_fill(0, count($partnerIds), '?'));
        $start = $year . '-01-01';
        $end = $year . '-12-31';
        $statement = $db->prepare(
            "SELECT DISTINCT sc.id_socio
             FROM socio_categorias sc
             WHERE sc.id_socio IN ({$placeholders}) AND sc.id_categoria = ?
               AND sc.fecha_desde <= ? AND (sc.fecha_hasta IS NULL OR sc.fecha_hasta >= ?)"
             . " AND EXISTS (
                    SELECT 1 FROM socios_periodos_activos spa
                    WHERE spa.id_socio = sc.id_socio
                      AND spa.vigente_desde <= ? AND (spa.vigente_hasta IS NULL OR spa.vigente_hasta >= ?)
                 )
                 AND EXISTS (
                    SELECT 1 FROM categorias_periodos_activos cpa
                    WHERE cpa.id_categoria = sc.id_categoria
                      AND cpa.vigente_desde <= ? AND (cpa.vigente_hasta IS NULL OR cpa.vigente_hasta >= ?)
                 )"
        );
        $statement->execute([...$partnerIds, $categoryId, $end, $start, $end, $start, $end, $start]);
        return array_map('intval', array_column($statement->fetchAll(), 'id_socio'));
    }

    protected static function hasAssignmentForPeriod(PDO $db, int $partnerId, int $categoryId, int $year, int $month): bool
    {
        $start = sprintf('%04d-%02d-01', $year, $month);
        $end = (new DateTimeImmutable($start))->modify('last day of this month')->format('Y-m-d');
        $statement = $db->prepare(
            'SELECT sc.id_socio_categoria
             FROM socio_categorias sc
             WHERE sc.id_socio = ? AND sc.id_categoria = ?
               AND sc.fecha_desde <= ?
               AND (sc.fecha_hasta IS NULL OR sc.fecha_hasta >= ?)
               AND EXISTS (
                    SELECT 1 FROM socios_periodos_activos spa
                    WHERE spa.id_socio = sc.id_socio
                      AND spa.vigente_desde <= ? AND (spa.vigente_hasta IS NULL OR spa.vigente_hasta >= ?)
               )
               AND EXISTS (
                    SELECT 1 FROM categorias_periodos_activos cpa
                    WHERE cpa.id_categoria = sc.id_categoria
                      AND cpa.vigente_desde <= ? AND (cpa.vigente_hasta IS NULL OR cpa.vigente_hasta >= ?)
               )
             LIMIT 1'
        );
        $statement->execute([$partnerId, $categoryId, $end, $end, $end, $end, $end, $end]);
        return (bool)$statement->fetchColumn();
    }

    protected static function hasRegisteredPeriod(PDO $db, int $partnerId, int $categoryId, int $year, int $month): bool
    {
        $statement = $db->prepare(
            "SELECT 1 FROM pagos
             WHERE id_socio = ? AND id_categoria = ? AND anio = ? AND id_mes = ?
               AND estado IN ('PAGADO','CONDONADO')
             LIMIT 1"
        );
        $statement->execute([$partnerId, $categoryId, $year, $month]);
        return (bool)$statement->fetchColumn();
    }

    protected static function hasRegisteredYear(PDO $db, int $partnerId, int $categoryId, int $year): bool
    {
        $statement = $db->prepare(
            "SELECT 1 FROM pagos
             WHERE id_socio = ? AND id_categoria = ? AND anio = ?
               AND estado IN ('PAGADO','CONDONADO')
             LIMIT 1"
        );
        $statement->execute([$partnerId, $categoryId, $year]);
        return (bool)$statement->fetchColumn();
    }

    protected static function validateAssignmentForPeriod(PDO $db, int $partnerId, int $categoryId, int $year, int $month): void
    {
        if (!self::hasAssignmentForPeriod($db, $partnerId, $categoryId, $year, $month)) {
            api_error('Una cuota no corresponde a la fecha de ingreso o categoría del socio.', 'CUOTA_NO_CORRESPONDE');
        }
    }

    protected static function discountContextForPartner(PDO $db, int $partnerId, array $rules, array &$cache): array
    {
        if (isset($cache[$partnerId])) return $cache[$partnerId];
        $statement = $db->prepare(
            'SELECT f.id_familia,
                    COUNT(CASE WHEN sm.activo = 1 THEN 1 END) AS cantidad_integrantes
             FROM socios s
             LEFT JOIN familia_socios fs ON fs.id_socio = s.id_socio
             LEFT JOIN familias f ON f.id_familia = fs.id_familia AND f.activo = 1
             LEFT JOIN familia_socios fsm ON fsm.id_familia = f.id_familia
             LEFT JOIN socios sm ON sm.id_socio = fsm.id_socio
             WHERE s.id_socio = ?
             GROUP BY s.id_socio, f.id_familia'
        );
        $statement->execute([$partnerId]);
        $row = $statement->fetch() ?: ['id_familia' => null, 'cantidad_integrantes' => 0];
        $familyId = $row['id_familia'] === null ? null : (int)$row['id_familia'];
        $count = $familyId === null ? 0 : (int)$row['cantidad_integrantes'];
        return $cache[$partnerId] = [
            'id_familia' => $familyId,
            'cantidad_integrantes' => $count,
            'porcentaje' => $familyId === null ? 0.0 : self::discountForCount($rules, $count),
        ];
    }

    protected static function normalPaymentMediumId(PDO $db, mixed $value): int
    {
        $id = positive_id($value, 'medio de pago');
        $statement = $db->prepare("SELECT id_medio_pago, nombre FROM medios_pago WHERE id_medio_pago = ? AND activo = 1 LIMIT 1");
        $statement->execute([$id]);
        $row = $statement->fetch();
        if (!$row || self::upper((string)$row['nombre']) === 'CONDONACIÓN') api_error('El medio de pago seleccionado no es válido.', 'MEDIO_PAGO_INVALIDO');
        return $id;
    }

    protected static function condonationMediumId(PDO $db): int
    {
        $statement = $db->prepare("SELECT id_medio_pago FROM medios_pago WHERE nombre = 'CONDONACIÓN' AND activo = 1 LIMIT 1");
        $statement->execute();
        $id = $statement->fetchColumn();
        if (!$id) api_error('Ejecutá primero la migración SQL del módulo Cuotas.', 'MIGRACION_CUOTAS_REQUERIDA', 500);
        return (int)$id;
    }

    protected static function modalitiesMap(PDO $db): array
    {
        $rows = $db->query(
            "SELECT id_modalidad_pago, codigo, nombre, mes_desde, mes_hasta, cantidad_meses
             FROM modalidades_pago
             WHERE activo = 1
             ORDER BY id_modalidad_pago"
        )->fetchAll();
        $map = [];
        foreach ($rows as $row) {
            $code = self::upper((string)$row['codigo']);
            $map[$code] = [
                'id_modalidad_pago' => (int)$row['id_modalidad_pago'],
                'codigo' => $code,
                'nombre' => (string)$row['nombre'],
                'mes_desde' => $row['mes_desde'] === null ? null : (int)$row['mes_desde'],
                'mes_hasta' => $row['mes_hasta'] === null ? null : (int)$row['mes_hasta'],
                'cantidad_meses' => (int)$row['cantidad_meses'],
            ];
        }
        return $map;
    }

    protected static function paymentModality(PDO $db, mixed $value): array
    {
        $code = self::upper(clean_text($value ?? 'MENSUAL', 40, false));
        if (!in_array($code, self::MODALIDADES_CUOTAS, true)) {
            api_error('La modalidad de pago seleccionada no es válida.', 'MODALIDAD_INVALIDA');
        }
        $modalities = self::modalitiesMap($db);
        if (!isset($modalities[$code])) {
            api_error('Falta configurar la modalidad ' . $code . '.', 'MODALIDAD_NO_CONFIGURADA', 500);
        }
        return $modalities[$code];
    }

    protected static function modalityMonths(string $code): array
    {
        return match ($code) {
            'PRIMERA_MITAD' => range(1, 6),
            'SEGUNDA_MITAD' => range(7, 12),
            'CONTADO_ANUAL' => range(1, 12),
            default => [],
        };
    }

    protected static function isPackageModality(string $code): bool
    {
        return in_array($code, self::MODALIDADES_PAQUETE, true);
    }

    protected static function modalityLabel(string $code): string
    {
        return match ($code) {
            'PRIMERA_MITAD' => 'PRIMERA MITAD',
            'SEGUNDA_MITAD' => 'SEGUNDA MITAD',
            'CONTADO_ANUAL' => 'CONTADO ANUAL',
            'INSCRIPCION' => 'INSCRIPCIÓN',
            default => 'CUOTAS MENSUALES',
        };
    }

    protected static function categoryMap(PDO $db, array $categoryIds): array
    {
        if ($categoryIds === []) return [];
        $placeholders = implode(',', array_fill(0, count($categoryIds), '?'));
        $statement = $db->prepare("SELECT id_categoria, nombre, monto_actual FROM categorias WHERE id_categoria IN ({$placeholders})");
        $statement->execute($categoryIds);
        $map = [];
        foreach ($statement->fetchAll() as $row) $map[(int)$row['id_categoria']] = $row;
        return $map;
    }

    protected static function partnerSnapshot(PDO $db, int $partnerId): array
    {
        $statement = $db->prepare('SELECT CONCAT(apellido, ", ", nombre) AS socio, dni FROM socios WHERE id_socio = ?');
        $statement->execute([$partnerId]);
        $row = $statement->fetch();
        if (!$row) api_error('Uno de los socios seleccionados ya no existe.', 'SOCIO_NO_DISPONIBLE', 404);
        return ['socio' => (string)$row['socio'], 'dni' => (string)$row['dni']];
    }

    protected static function paymentMediumName(PDO $db, int $mediumId): string
    {
        $statement = $db->prepare('SELECT nombre FROM medios_pago WHERE id_medio_pago = ?');
        $statement->execute([$mediumId]);
        $name = $statement->fetchColumn();
        if ($name === false) api_error('El medio de pago seleccionado no existe.', 'MEDIO_PAGO_INVALIDO');
        return (string)$name;
    }

    protected static function registrationAmount(PDO $db): string
    {
        $statement = $db->query("SELECT monto_fijo FROM modalidades_pago WHERE codigo = 'INSCRIPCION' AND activo = 1 LIMIT 1");
        $amount = $statement->fetchColumn();
        return number_format((float)($amount === false ? 0 : $amount), 2, '.', '');
    }

    protected static function priceHistory(PDO $db, array $categoryIds): array
    {
        if ($categoryIds === []) return [];
        $placeholders = implode(',', array_fill(0, count($categoryIds), '?'));
        $statement = $db->prepare(
            "SELECT id_categoria, monto_anterior, monto_nuevo, fecha_cambio
             FROM categorias_historial_precios
             WHERE id_categoria IN ({$placeholders})
             ORDER BY id_categoria, fecha_cambio DESC, id_historial_precio DESC"
        );
        $statement->execute($categoryIds);
        $map = [];
        foreach ($statement->fetchAll() as $row) $map[(int)$row['id_categoria']][] = $row;
        return $map;
    }

    protected static function priceForPeriod(array $history, float $fallback, int $year, int $month): float
    {
        $start = sprintf('%04d-%02d-01', $year, $month);
        $end = (new DateTimeImmutable($start))->modify('last day of this month')->format('Y-m-d');

        // El historial original guarda cambios puntuales, no intervalos. Para el
        // período pedido se toma el último monto nuevo cuyo cambio ya ocurrió.
        foreach ($history as $row) {
            if (substr((string)$row['fecha_cambio'], 0, 10) <= $end) {
                return (float)$row['monto_nuevo'];
            }
        }

        // Si el período es anterior al primer cambio registrado, el monto
        // anterior de la fila más antigua representa el valor vigente entonces.
        if ($history !== []) {
            $oldest = $history[count($history) - 1];
            return (float)$oldest['monto_anterior'];
        }

        return $fallback;
    }

    protected static function discountRules(PDO $db): array
    {
        $statement = $db->prepare(
            'SELECT cantidad_integrantes_desde,
                    cantidad_integrantes_hasta,
                    porcentaje_descuento
             FROM descuentos_familiares
             WHERE activo = 1
               AND vigencia_desde <= CURDATE()
               AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURDATE())
             ORDER BY cantidad_integrantes_desde ASC,
                      COALESCE(cantidad_integrantes_hasta, 65535) ASC'
        );
        $statement->execute();

        return array_map(static fn(array $row): array => [
            'desde' => (int)$row['cantidad_integrantes_desde'],
            'hasta' => $row['cantidad_integrantes_hasta'] === null
                ? null
                : (int)$row['cantidad_integrantes_hasta'],
            'porcentaje' => (float)$row['porcentaje_descuento'],
        ], $statement->fetchAll());
    }

    protected static function discountForCount(array $rules, int $count): float
    {
        foreach ($rules as $rule) {
            $from = (int)$rule['desde'];
            $to = $rule['hasta'] === null ? null : (int)$rule['hasta'];
            if ($count >= $from && ($to === null || $count <= $to)) {
                return (float)$rule['porcentaje'];
            }
        }
        return 0.0;
    }

    protected static function amountWithFamilyDiscount(float $baseAmount, float $familyPercentage): float
    {
        // La misma regla se usa para cuotas mensuales, paquetes semestrales,
        // contado anual e inscripciones. La modalidad nunca debe saltear el
        // descuento familiar vigente del socio.
        $percentage = max(0.0, min(100.0, $familyPercentage));
        return round($baseAmount * (1 - $percentage / 100), 2);
    }

    protected static function familyCounts(PDO $db): array
    {
        $rows = $db->query(
            'SELECT f.id_familia, COUNT(CASE WHEN s.activo = 1 THEN 1 END) AS cantidad
             FROM familias f
             LEFT JOIN familia_socios fs ON fs.id_familia = f.id_familia
             LEFT JOIN socios s ON s.id_socio = fs.id_socio
             WHERE f.activo = 1 GROUP BY f.id_familia'
        )->fetchAll();
        $map = [];
        foreach ($rows as $row) $map[(int)$row['id_familia']] = (int)$row['cantidad'];
        return $map;
    }

    protected static function periodKey(int $partnerId, int $categoryId, int $year, int $month): string
    {
        return $partnerId . '-' . $categoryId . '-' . $year . '-' . $month;
    }

    protected static function operationCode(string $prefix): string
    {
        return $prefix . '-' . date('YmdHis') . '-' . strtoupper(bin2hex(random_bytes(4)));
    }

    protected static function monthName(int $month): string
    {
        return [1 => 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'][$month] ?? '';
    }

    protected static function lower(string $value): string
    {
        return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
    }

    protected static function upper(string $value): string
    {
        return function_exists('mb_strtoupper') ? mb_strtoupper($value, 'UTF-8') : strtoupper($value);
    }
}
