<?php
declare(strict_types=1);

final class TestingSafety
{
    private const TABLES = [
        'socios', 'socios_contactos', 'socios_cumpleanios_cierres',
        'socios_historial_estados', 'socios_eliminados', 'socios_fusiones',
        'familias', 'familias_socios', 'categoria', 'precios_historicos',
        'descuentos_familiares', 'cobrador', 'estado', 'grupo_sanguineo',
        'medios_pago', 'periodo', 'pagos', 'pagos_inscripcion',
        'contable_opciones', 'contable_ingresos', 'contable_egresos',
        'sis_usuarios', 'sis_sesiones', 'sis_login_auditoria', 'auditoria',
    ];

    public static function probe(): never
    {
        // Este handler NO debe ejecutarse nunca: e2e_scope_guard() debe frenar
        // la solicitud antes. Si llega acá, el setup aborta la corrida.
        api_error(
            'El guard E2E no interceptó la solicitud de prueba.',
            'E2E_GUARD_NOT_ACTIVE',
            500
        );
    }

    public static function residuos(): never
    {
        $auth = require_admin();
        self::requireE2EHeader();
        $sets = self::e2eSets($auth['db']);
        $counts = [];
        foreach ($sets as $key => $ids) $counts[$key] = count($ids);
        $counts['login_auditoria'] = self::scalarCount(
            $auth['db'],
            "SELECT COUNT(*) FROM sis_login_auditoria
             WHERE LOWER(usuario) LIKE 'pw_e2e_%'
                OR user_agent LIKE 'PW-RH-E2E-%'"
        );
        $total = array_sum(array_map('intval', $counts));
        api_success([
            'datos' => ['total' => $total, 'conteos' => $counts],
        ], $total === 0 ? 'No hay residuos E2E.' : 'Se detectaron residuos E2E.');
    }

    public static function integridad(): never
    {
        $auth = require_admin();
        self::requireE2EHeader();
        $db = $auth['db'];
        $sets = self::e2eSets($db);
        $tables = [];

        foreach (self::TABLES as $table) {
            if (!self::tableExists($db, $table)) continue;
            $rows = $db->query('SELECT * FROM `' . $table . '`')->fetchAll(PDO::FETCH_ASSOC);
            $realRows = [];
            foreach ($rows as $row) {
                if (self::isE2ERow($table, $row, $sets)) continue;
                if ($table === 'sis_sesiones') unset($row['ultimo_uso']);
                ksort($row);
                $realRows[] = $row;
            }

            usort($realRows, static function (array $a, array $b): int {
                return strcmp(
                    json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    json_encode($b, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                );
            });

            $encoded = json_encode($realRows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $tables[$table] = [
                'filas' => count($realRows),
                'sha256' => hash('sha256', $encoded === false ? '[]' : $encoded),
            ];
        }

        ksort($tables);
        api_success([
            'datos' => [
                'sha256' => hash(
                    'sha256',
                    json_encode($tables, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}'
                ),
                'tablas' => $tables,
            ],
        ], 'Huella de datos reales calculada.');
    }

    private static function requireE2EHeader(): void
    {
        if (!function_exists('e2e_request_header_active') || !e2e_request_header_active()) {
            api_error('Falta el header E2E.', 'E2E_HEADER_REQUIRED', 403);
        }
    }

    private static function e2eSets(PDO $db): array
    {
        $socios = self::ids(
            $db,
            "SELECT id_socio FROM socios
             WHERE nombre LIKE 'PW E2E SOCIO %'
                OR nombre LIKE 'PW EEE SOCIO %'
                OR nombre LIKE 'PW EEE DNI %'"
        );
        if (self::tableExists($db, 'socios_eliminados')) {
            $archived = self::ids(
                $db,
                "SELECT id_socio FROM socios_eliminados
                 WHERE nombre LIKE 'PW E2E SOCIO %'
                    OR nombre LIKE 'PW EEE SOCIO %'
                    OR nombre LIKE 'PW EEE DNI %'"
            );
            $socios = array_values(array_unique(array_merge($socios, $archived)));
        }

        return [
            'usuarios' => self::ids($db, "SELECT idUsuario FROM sis_usuarios WHERE LOWER(usuario) LIKE 'pw_e2e_%'"),
            'socios' => $socios,
            'familias' => self::ids($db, "SELECT id_familia FROM familias WHERE nombre_familia LIKE 'PW E2E FAM %' OR nombre_familia LIKE 'PW EEE FAM %' OR nombre_familia LIKE '__ELIMINADA__%::PW E2E FAM %' OR nombre_familia LIKE '__ELIMINADA__%::PW EEE FAM %'"),
            'categorias' => self::ids($db, "SELECT id_categoria FROM categoria WHERE nombre LIKE 'PW EE CAT %'"),
            'descuentos' => self::tableExists($db, 'descuentos_familiares') ? self::ids($db, "SELECT id_descuento_familiar FROM descuentos_familiares WHERE descripcion LIKE 'PW E2E DESC %' OR descripcion LIKE 'PW E2E RETROACTIVO %'") : [],
            'cobradores' => self::ids($db, "SELECT id_cobrador FROM cobrador WHERE nombre LIKE 'PW E2E COB %'"),
            'estados' => self::ids($db, "SELECT id_estado FROM estado WHERE nombre LIKE 'PW E2E EST %' OR nombre LIKE 'PW EE EST %'"),
            'grupos_sanguineos' => self::ids($db, "SELECT id_grupo_sanguineo FROM grupo_sanguineo WHERE nombre LIKE 'PWE2E-%' OR nombre LIKE 'PWE2E+%'"),
            'medios_pago' => self::ids($db, "SELECT id_medio_pago FROM medios_pago WHERE nombre LIKE 'PW E2E MED %'"),
            'periodos' => self::ids($db, "SELECT id_periodo FROM periodo WHERE id_periodo > 7 AND nombre LIKE 'PW E2E PER %'"),
            'contable_opciones' => self::tableExists($db, 'contable_opciones') ? self::ids($db, "SELECT id_opcion FROM contable_opciones WHERE nombre LIKE 'PW E2E CT %' OR nombre LIKE 'PW EEE CT %'") : [],
            'contable_ingresos' => self::tableExists($db, 'contable_ingresos') ? self::ids($db, "SELECT id_ingreso FROM contable_ingresos WHERE proveedor LIKE 'PW E2E CT %' OR proveedor LIKE 'PW EEE CT %' OR categoria LIKE 'PW E2E CT %' OR categoria LIKE 'PW EEE CT %' OR concepto LIKE 'PW E2E CT %' OR concepto LIKE 'PW EEE CT %' OR detalle LIKE 'PW E2E CONTABLE %'") : [],
            'contable_egresos' => self::tableExists($db, 'contable_egresos') ? self::ids($db, "SELECT id_egreso FROM contable_egresos WHERE proveedor LIKE 'PW E2E CT %' OR proveedor LIKE 'PW EEE CT %' OR categoria LIKE 'PW E2E CT %' OR categoria LIKE 'PW EEE CT %' OR concepto LIKE 'PW E2E CT %' OR concepto LIKE 'PW EEE CT %' OR detalle LIKE 'PW E2E CONTABLE %' OR numero_comprobante LIKE 'PW-E2E-%'") : [],
        ];
    }

    private static function isE2ERow(string $table, array $row, array $sets): bool
    {
        $in = static fn(string $set, mixed $value): bool => $value !== null && in_array((int)$value, $sets[$set] ?? [], true);
        $containsMarker = static function (array $row): bool {
            $text = strtoupper(json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
            foreach (['PW E2E', 'PW EEE', 'PW-E2E', 'PWE2E', 'PW_E2E_'] as $marker) {
                if (str_contains($text, $marker)) return true;
            }
            return false;
        };

        return match ($table) {
            'socios' => $in('socios', $row['id_socio'] ?? null),
            'socios_contactos', 'socios_cumpleanios_cierres', 'socios_historial_estados' => $in('socios', $row['id_socio'] ?? null),
            'socios_eliminados' => $in('socios', $row['id_socio'] ?? null) || $containsMarker($row),
            'socios_fusiones' => self::rowReferencesAnySocio($row, $sets['socios'] ?? []) || $containsMarker($row),
            'familias' => $in('familias', $row['id_familia'] ?? null),
            'familias_socios' => $in('familias', $row['id_familia'] ?? null) || $in('socios', $row['id_socio'] ?? null),
            'categoria' => $in('categorias', $row['id_categoria'] ?? null),
            'precios_historicos' => $in('categorias', $row['id_categoria'] ?? null),
            'descuentos_familiares' => $in('descuentos', $row['id_descuento_familiar'] ?? null),
            'cobrador' => $in('cobradores', $row['id_cobrador'] ?? null),
            'estado' => $in('estados', $row['id_estado'] ?? null),
            'grupo_sanguineo' => $in('grupos_sanguineos', $row['id_grupo_sanguineo'] ?? null),
            'medios_pago' => $in('medios_pago', $row['id_medio_pago'] ?? null),
            'periodo' => $in('periodos', $row['id_periodo'] ?? null),
            'pagos', 'pagos_inscripcion' => $in('socios', $row['id_socio'] ?? null),
            'contable_opciones' => $in('contable_opciones', $row['id_opcion'] ?? null),
            'contable_ingresos' => $in('contable_ingresos', $row['id_ingreso'] ?? null),
            'contable_egresos' => $in('contable_egresos', $row['id_egreso'] ?? null),
            'sis_usuarios' => $in('usuarios', $row['idUsuario'] ?? null),
            'sis_sesiones' => $in('usuarios', $row['idUsuario'] ?? null) || str_starts_with((string)($row['user_agent'] ?? ''), 'PW-RH-E2E-'),
            'sis_login_auditoria' => $in('usuarios', $row['idUsuario'] ?? null)
                || str_starts_with(strtolower((string)($row['usuario'] ?? '')), 'pw_e2e_')
                || str_starts_with((string)($row['user_agent'] ?? ''), 'PW-RH-E2E-'),
            'auditoria' => $in('usuarios', $row['id_usuario'] ?? null) || $containsMarker($row) || self::auditReferencesE2E($row, $sets),
            default => $containsMarker($row),
        };
    }

    private static function rowReferencesAnySocio(array $row, array $ids): bool
    {
        foreach ($row as $key => $value) {
            if (!str_contains(strtolower((string)$key), 'socio')) continue;
            if (is_numeric($value) && in_array((int)$value, $ids, true)) return true;
        }
        return false;
    }

    private static function auditReferencesE2E(array $row, array $sets): bool
    {
        $table = strtolower(trim((string)($row['tabla'] ?? '')));
        $id = isset($row['id_registro']) && is_numeric($row['id_registro']) ? (int)$row['id_registro'] : 0;
        $map = [
            'socios' => 'socios', 'familias' => 'familias', 'categoria' => 'categorias',
            'categorias' => 'categorias', 'descuentos_familiares' => 'descuentos',
            'cobrador' => 'cobradores', 'estado' => 'estados',
            'grupo_sanguineo' => 'grupos_sanguineos', 'medios_pago' => 'medios_pago',
            'periodo' => 'periodos', 'contable_opciones' => 'contable_opciones',
            'contable_ingresos' => 'contable_ingresos', 'contable_egresos' => 'contable_egresos',
            'sis_usuarios' => 'usuarios',
        ];
        return $id > 0 && isset($map[$table]) && in_array($id, $sets[$map[$table]] ?? [], true);
    }

    private static function ids(PDO $db, string $sql): array
    {
        try {
            return array_values(array_unique(array_map('intval', array_column(
                $db->query($sql)->fetchAll(PDO::FETCH_NUM), 0
            ))));
        } catch (Throwable $error) {
            error_log('[testing_safety][ids] ' . $error->getMessage());
            return [];
        }
    }

    private static function scalarCount(PDO $db, string $sql): int
    {
        try { return (int)$db->query($sql)->fetchColumn(); }
        catch (Throwable) { return 0; }
    }

    private static function tableExists(PDO $db, string $table): bool
    {
        $statement = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
        );
        $statement->execute([$table]);
        return (int)$statement->fetchColumn() > 0;
    }
}
