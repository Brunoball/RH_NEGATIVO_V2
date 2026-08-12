<?php
declare(strict_types=1);

final class TestingCleanup
{
    private const CONFIRMATION = 'LIMPIAR_PLAYWRIGHT';

    public static function run(): never
    {
        $auth = require_admin();
        $body = request_body();
        $confirmation = strtoupper(trim((string)($body['confirmacion'] ?? '')));
        if ($confirmation !== self::CONFIRMATION) {
            api_error(
                'Confirmación de limpieza E2E inválida.',
                'E2E_CLEANUP_CONFIRMACION_INVALIDA',
                422
            );
        }

        $result = self::cleanup($auth['db']);
        api_success($result, 'Limpieza final de Playwright completada.');
    }

    private static function cleanup(PDO $db): array
    {
        $filesToDelete = [];
        $counts = [
            'contable_ingresos' => 0,
            'contable_egresos' => 0,
            'contable_opciones' => 0,
            'familias' => 0,
            'socios' => 0,
            'pagos' => 0,
            'categorias' => 0,
            'descuentos_familiares' => 0,
            'medios_pago' => 0,
            'condiciones_iva' => 0,
            'usuarios' => 0,
            'login_auditoria' => 0,
            'auditoria' => 0,
            'archivos' => 0,
        ];
        $skipped = [];

        $db->beginTransaction();
        try {
            $testSocios = self::ids($db,
                "SELECT DISTINCT s.id_socio
                 FROM socios s
                 LEFT JOIN socios_personas p ON p.id_socio = s.id_socio
                 LEFT JOIN socios_empresas e ON e.id_socio = s.id_socio
                 WHERE p.apellido LIKE 'PW EE APELLIDO %'
                    OR p.email LIKE 'pw.socio.%@example.test'
                    OR e.razon_social LIKE 'PW E2E EMPRESA %'
                    OR e.email LIKE 'pw.empresa.%@example.test'"
            );
            $testFamilies = self::ids($db,
                "SELECT id_familia FROM familias
                 WHERE nombre LIKE 'PW E2E FAM %' OR nombre LIKE 'PW EE FAM %'"
            );
            $testCategories = self::ids($db,
                "SELECT id_categoria FROM categorias
                 WHERE nombre LIKE 'PW E2E CAT %' OR nombre LIKE 'PW EE CAT %'"
            );
            $testDiscounts = self::ids($db,
                "SELECT id_descuento_familiar FROM descuentos_familiares
                 WHERE descripcion LIKE 'PW E2E %' OR descripcion LIKE 'PW EE %'"
            );
            $testUsers = self::ids($db,
                "SELECT idUsuario FROM sis_usuarios WHERE usuario LIKE 'pw_e2e_%'"
            );
            $testMeans = self::ids($db,
                "SELECT id_medio_pago FROM medios_pago
                 WHERE nombre LIKE 'PW E2E %' OR nombre LIKE 'PW EE %'"
            );
            $testIva = self::ids($db,
                "SELECT id_condicion_iva FROM condiciones_iva
                 WHERE nombre LIKE 'PW E2E %' OR nombre LIKE 'PW EE %'"
            );
            $testOptions = self::ids($db,
                "SELECT id_opcion FROM contable_opciones
                 WHERE nombre LIKE 'PW E2E %' OR nombre LIKE 'PW EE %'"
            );

            $testIncomeIds = self::ids($db,
                "SELECT id_ingreso FROM contable_ingresos
                 WHERE detalle LIKE 'PW E2E %' OR detalle LIKE 'PW EE %'
                    OR proveedor LIKE 'PW E2E %' OR proveedor LIKE 'PW EE %'
                    OR categoria LIKE 'PW E2E %' OR categoria LIKE 'PW EE %'
                    OR concepto LIKE 'PW E2E %' OR concepto LIKE 'PW EE %'"
            );
            $testExpenseIds = self::ids($db,
                "SELECT id_egreso FROM contable_egresos
                 WHERE detalle LIKE 'PW E2E %' OR detalle LIKE 'PW EE %'
                    OR proveedor LIKE 'PW E2E %' OR proveedor LIKE 'PW EE %'
                    OR categoria LIKE 'PW E2E %' OR categoria LIKE 'PW EE %'
                    OR concepto LIKE 'PW E2E %' OR concepto LIKE 'PW EE %'
                    OR numero_comprobante LIKE 'E2E-%'"
            );

            if ($testExpenseIds !== []) {
                $filesToDelete = self::columnForIds($db, 'contable_egresos', 'id_egreso', 'archivo_path', $testExpenseIds);
            }

            $testPaymentIds = $testSocios === []
                ? []
                : self::columnForIds($db, 'pagos', 'id_socio', 'id_pago', $testSocios);

            $counts['contable_ingresos'] += self::deleteByIds($db, 'contable_ingresos', 'id_ingreso', $testIncomeIds);
            $counts['contable_egresos'] += self::deleteByIds($db, 'contable_egresos', 'id_egreso', $testExpenseIds);

            if ($testFamilies !== []) {
                self::deleteByIds($db, 'familias_socios', 'id_familia', $testFamilies);
            }
            if ($testSocios !== []) {
                self::deleteByIds($db, 'familias_socios', 'id_socio', $testSocios);
                $counts['pagos'] += self::deleteByIds($db, 'pagos', 'id_socio', $testSocios);
                self::deleteByIds($db, 'socios_historial_estados', 'id_socio', $testSocios);
                $counts['socios'] += self::deleteByIds($db, 'socios', 'id_socio', $testSocios);
            }
            $counts['familias'] += self::deleteByIds($db, 'familias', 'id_familia', $testFamilies);

            $counts['contable_opciones'] += self::deleteByIds($db, 'contable_opciones', 'id_opcion', $testOptions);

            if ($testCategories !== []) {
                $blocked = self::ids($db,
                    'SELECT DISTINCT id_categoria FROM socios WHERE id_categoria IN ('
                    . self::placeholders(count($testCategories)) . ')',
                    $testCategories
                );
                $safeCategories = array_values(array_diff($testCategories, $blocked));
                if ($blocked !== []) $skipped['categorias_en_uso'] = $blocked;
                self::deleteByIds($db, 'categorias_historial_precios', 'id_categoria', $safeCategories);
                $counts['categorias'] += self::deleteByIds($db, 'categorias', 'id_categoria', $safeCategories);
            }

            $counts['descuentos_familiares'] += self::deleteByIds(
                $db,
                'descuentos_familiares',
                'id_descuento_familiar',
                $testDiscounts
            );

            if ($testMeans !== []) {
                $safeMeans = [];
                foreach ($testMeans as $id) {
                    $uses = self::scalar($db,
                        'SELECT (SELECT COUNT(*) FROM pagos WHERE id_medio_pago = ?)'
                        . ' + (SELECT COUNT(*) FROM socios WHERE id_medio_pago = ?)'
                        . ' + (SELECT COUNT(*) FROM contable_ingresos WHERE id_medio_pago = ?)'
                        . ' + (SELECT COUNT(*) FROM contable_egresos WHERE id_medio_pago = ?)',
                        [$id, $id, $id, $id]
                    );
                    if ($uses === 0) $safeMeans[] = $id;
                    else $skipped['medios_pago_en_uso'][] = $id;
                }
                $counts['medios_pago'] += self::deleteByIds($db, 'medios_pago', 'id_medio_pago', $safeMeans);
            }

            if ($testIva !== []) {
                $safeIva = [];
                foreach ($testIva as $id) {
                    $uses = self::scalar($db, 'SELECT COUNT(*) FROM socios_empresas WHERE id_condicion_iva = ?', [$id]);
                    if ($uses === 0) $safeIva[] = $id;
                    else $skipped['condiciones_iva_en_uso'][] = $id;
                }
                $counts['condiciones_iva'] += self::deleteByIds($db, 'condiciones_iva', 'id_condicion_iva', $safeIva);
            }

            if ($testUsers !== []) {
                self::deleteByIds($db, 'sis_sesiones', 'idUsuario', $testUsers);
                $counts['login_auditoria'] += self::deleteByIds($db, 'sis_login_auditoria', 'idUsuario', $testUsers);
            }
            $statement = $db->prepare("DELETE FROM sis_login_auditoria WHERE usuario LIKE 'pw_e2e_%'");
            $statement->execute();
            $counts['login_auditoria'] += $statement->rowCount();
            $counts['usuarios'] += self::deleteByIds($db, 'sis_usuarios', 'idUsuario', $testUsers);

            $auditReferences = [
                'socios' => $testSocios,
                'familias' => $testFamilies,
                'categorias' => $testCategories,
                'descuentos_familiares' => $testDiscounts,
                'pagos' => $testPaymentIds,
                'contable_ingresos' => $testIncomeIds,
                'contable_egresos' => $testExpenseIds,
                'contable_opciones' => $testOptions,
                'medios_pago' => $testMeans,
                'condiciones_iva' => $testIva,
                'sis_usuarios' => $testUsers,
            ];
            foreach ($auditReferences as $table => $ids) {
                if ($ids === []) continue;
                $params = array_merge([$table], array_map('strval', $ids));
                $statement = $db->prepare(
                    'DELETE FROM auditoria WHERE tabla_afectada = ? AND id_registro IN ('
                    . self::placeholders(count($ids)) . ')'
                );
                $statement->execute($params);
                $counts['auditoria'] += $statement->rowCount();
            }

            $statement = $db->prepare(
                "DELETE FROM auditoria
                 WHERE descripcion LIKE '%PW E2E%'
                    OR descripcion LIKE '%PW EE%'
                    OR datos_anteriores LIKE '%PW E2E%'
                    OR datos_anteriores LIKE '%PW EE%'
                    OR datos_anteriores LIKE '%pw_e2e_%'
                    OR datos_nuevos LIKE '%PW E2E%'
                    OR datos_nuevos LIKE '%PW EE%'
                    OR datos_nuevos LIKE '%pw_e2e_%'
                    OR datos_anteriores LIKE '%@example.test%'
                    OR datos_nuevos LIKE '%@example.test%'"
            );
            $statement->execute();
            $counts['auditoria'] += $statement->rowCount();

            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }

        foreach ($filesToDelete as $relativePath) {
            if (self::deleteContableFile((string)$relativePath)) {
                $counts['archivos']++;
            }
        }

        return [
            'eliminados' => $counts,
            'omitidos_por_seguridad' => $skipped,
        ];
    }

    private static function ids(PDO $db, string $sql, array $params = []): array
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        $ids = [];
        while (($value = $statement->fetchColumn()) !== false) {
            $id = (int)$value;
            if ($id > 0) $ids[$id] = $id;
        }
        return array_values($ids);
    }

    private static function scalar(PDO $db, string $sql, array $params = []): int
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        return (int)$statement->fetchColumn();
    }

    private static function placeholders(int $count): string
    {
        return implode(',', array_fill(0, max(1, $count), '?'));
    }

    private static function deleteByIds(PDO $db, string $table, string $column, array $ids): int
    {
        if ($ids === []) return 0;
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table) || !preg_match('/^[a-zA-Z0-9_]+$/', $column)) {
            throw new RuntimeException('Nombre de tabla o columna inválido en limpieza E2E.');
        }
        $statement = $db->prepare(
            "DELETE FROM `{$table}` WHERE `{$column}` IN (" . self::placeholders(count($ids)) . ')'
        );
        $statement->execute(array_values($ids));
        return $statement->rowCount();
    }

    private static function columnForIds(
        PDO $db,
        string $table,
        string $idColumn,
        string $valueColumn,
        array $ids
    ): array {
        if ($ids === []) return [];
        foreach ([$table, $idColumn, $valueColumn] as $identifier) {
            if (!preg_match('/^[a-zA-Z0-9_]+$/', $identifier)) {
                throw new RuntimeException('Identificador inválido en limpieza E2E.');
            }
        }
        $statement = $db->prepare(
            "SELECT `{$valueColumn}` FROM `{$table}` WHERE `{$idColumn}` IN ("
            . self::placeholders(count($ids)) . ')'
        );
        $statement->execute(array_values($ids));
        return array_values(array_filter(
            array_column($statement->fetchAll(), $valueColumn),
            static fn(mixed $value): bool => $value !== null && $value !== ''
        ));
    }

    private static function deleteContableFile(string $relativePath): bool
    {
        $path = trim($relativePath);
        if ($path === '' || !preg_match('#^egresos/[A-Za-z0-9._-]+$#', $path)) return false;

        $root = dirname(__DIR__, 2) . '/uploads/contable';
        $candidate = $root . '/' . ltrim($path, '/\\');
        $realRoot = realpath($root);
        $realFile = realpath($candidate);
        if (!$realRoot || !$realFile) return false;
        if (!str_starts_with($realFile, $realRoot . DIRECTORY_SEPARATOR) || !is_file($realFile)) return false;
        return @unlink($realFile);
    }
}
