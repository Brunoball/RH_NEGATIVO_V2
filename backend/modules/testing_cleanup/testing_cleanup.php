<?php
declare(strict_types=1);

/**
 * Limpieza EXCLUSIVA de registros creados por Playwright.
 *
 * Reglas de aislamiento usadas por los tests actuales:
 * - usuarios:              pw_e2e_*
 * - socios:                PW E2E SOCIO *
 * - familias:              PW E2E FAM *
 * - categorias:            PW EE CAT * (el formulario de categorías elimina dígitos)
 * - descuentos familiares: descripcion PW E2E DESC *
 * - logins inválidos:      usuario pw_e2e_*
 * - login de preparación:  User-Agent PW-RH-E2E-SETUP/*
 *
 * Nunca borra por fechas, IDs altos, dominios genéricos ni coincidencias amplias.
 */
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

        self::assertSocioDeleteGuardSupportsE2E($auth['db']);
        api_success(self::cleanup($auth['db']), 'Limpieza final de Playwright completada.');
    }

    private static function assertSocioDeleteGuardSupportsE2E(PDO $db): void
    {
        $statement = $db->prepare(
            "SELECT TRIGGER_NAME, ACTION_STATEMENT
             FROM information_schema.TRIGGERS
             WHERE TRIGGER_SCHEMA = DATABASE()
               AND EVENT_OBJECT_TABLE = 'socios'
               AND EVENT_MANIPULATION = 'DELETE'
               AND ACTION_TIMING = 'BEFORE'"
        );
        $statement->execute();
        $triggers = $statement->fetchAll(PDO::FETCH_ASSOC);

        foreach ($triggers as $trigger) {
            $definition = strtoupper((string)($trigger['ACTION_STATEMENT'] ?? ''));
            if (str_contains($definition, 'PW E2E SOCIO')) {
                return;
            }
        }

        api_error(
            'La protección de DELETE de socios todavía no permite la limpieza aislada de Playwright.',
            'E2E_GUARD_SOCIOS_DESACTUALIZADO',
            409,
            [
                'accion' => 'Ejecutá una sola vez backend/modules/testing_cleanup/001_trg_socios_e2e_cleanup.sql en la base usada por los tests.',
                'seguridad' => 'El cambio mantiene bloqueado el DELETE de socios reales y habilita únicamente nombres PW E2E SOCIO %.',
            ]
        );
    }

    private static function cleanup(PDO $db): array
    {
        $counts = [
            'familias_socios' => 0,
            'familias' => 0,
            'pagos' => 0,
            'pagos_inscripcion' => 0,
            'socios_contactos' => 0,
            'socios_cumpleanios_cierres' => 0,
            'socios_fusiones' => 0,
            'socios_historial_estados' => 0,
            'socios' => 0,
            'precios_historicos' => 0,
            'categorias' => 0,
            'descuentos_familiares' => 0,
            'sesiones' => 0,
            'login_auditoria' => 0,
            'auditoria' => 0,
            'usuarios' => 0,
        ];
        $skipped = [];

        $db->beginTransaction();
        try {
            $testUsers = self::ids(
                $db,
                "SELECT idUsuario FROM sis_usuarios WHERE LEFT(usuario, 7) = 'pw_e2e_'"
            );
            $testSocios = self::ids(
                $db,
                "SELECT id_socio FROM socios
                 WHERE nombre LIKE 'PW E2E SOCIO %'"
            );
            $testFamilies = self::ids(
                $db,
                "SELECT id_familia FROM familias
                 WHERE nombre_familia LIKE 'PW E2E FAM %'"
            );
            $testCategories = self::ids(
                $db,
                "SELECT id_categoria FROM categoria
                 WHERE nombre LIKE 'PW EE CAT %'"
            );
            $testDiscounts = self::tableExists($db, 'descuentos_familiares')
                ? self::ids(
                    $db,
                    "SELECT id_descuento_familiar FROM descuentos_familiares
                     WHERE descripcion LIKE 'PW E2E DESC %'"
                )
                : [];

            // Guardamos las referencias de auditoría ANTES de borrar las entidades.
            // También se elimina toda auditoría generada por el usuario temporal E2E,
            // lo que cubre incluso entidades que el propio test ya eliminó definitivamente.
            $auditReferences = [
                'socios' => $testSocios,
                'familias' => $testFamilies,
                'categoria' => $testCategories,
                'categorias' => $testCategories, // compatibilidad con auditorías antiguas
                'descuentos_familiares' => $testDiscounts,
                'sis_usuarios' => $testUsers,
            ];

            $auditTableColumn = self::columnExists($db, 'auditoria', 'tabla_afectada')
                ? 'tabla_afectada'
                : (self::columnExists($db, 'auditoria', 'tabla') ? 'tabla' : null);
            $auditUserColumn = self::columnExists($db, 'auditoria', 'id_usuario_master')
                ? 'id_usuario_master'
                : (self::columnExists($db, 'auditoria', 'id_usuario') ? 'id_usuario' : null);

            if ($auditTableColumn !== null && self::columnExists($db, 'auditoria', 'id_registro')) {
                foreach ($auditReferences as $table => $ids) {
                    if ($ids === []) continue;
                    $statement = $db->prepare(
                        "DELETE FROM auditoria WHERE `{$auditTableColumn}` = ? AND id_registro IN ("
                        . self::placeholders(count($ids)) . ')'
                    );
                    $statement->execute(array_merge([$table], $ids));
                    $counts['auditoria'] += $statement->rowCount();
                }
            }
            if ($auditUserColumn !== null) {
                $counts['auditoria'] += self::deleteByIds(
                    $db,
                    'auditoria',
                    $auditUserColumn,
                    $testUsers
                );
            }

            // 1) Familias y vínculos. Se eliminan también vínculos hacia socios E2E
            // por si una corrida anterior quedó interrumpida a mitad del flujo.
            $counts['familias_socios'] += self::deleteByIds(
                $db,
                'familias_socios',
                'id_familia',
                $testFamilies
            );
            $counts['familias_socios'] += self::deleteByIds(
                $db,
                'familias_socios',
                'id_socio',
                $testSocios
            );

            // 2) Dependencias de socios. No se toca ningún socio que no tenga prefijo E2E.
            $counts['pagos'] += self::deleteByIds($db, 'pagos', 'id_socio', $testSocios);
            $counts['pagos_inscripcion'] += self::deleteByIds(
                $db,
                'pagos_inscripcion',
                'id_socio',
                $testSocios
            );
            $counts['socios_contactos'] += self::deleteByIds(
                $db,
                'socios_contactos',
                'id_socio',
                $testSocios
            );
            $counts['socios_cumpleanios_cierres'] += self::deleteByIds(
                $db,
                'socios_cumpleanios_cierres',
                'id_socio',
                $testSocios
            );
            if ($testSocios !== []) {
                $statement = $db->prepare(
                    'DELETE FROM socios_fusiones
                     WHERE id_socio_origen IN (' . self::placeholders(count($testSocios)) . ')
                        OR id_socio_destino IN (' . self::placeholders(count($testSocios)) . ')'
                );
                $statement->execute(array_merge($testSocios, $testSocios));
                $counts['socios_fusiones'] += $statement->rowCount();
            }
            $counts['socios_historial_estados'] += self::deleteByIds(
                $db,
                'socios_historial_estados',
                'id_socio',
                $testSocios
            );
            $counts['socios'] += self::deleteByIds($db, 'socios', 'id_socio', $testSocios);
            $counts['familias'] += self::deleteByIds($db, 'familias', 'id_familia', $testFamilies);

            // 3) Categorías. Solo se borran si, después de retirar los socios E2E,
            // ninguna información real las referencia.
            $safeCategories = $testCategories;
            if ($testCategories !== []) {
                $blocked = self::ids(
                    $db,
                    'SELECT DISTINCT id_categoria FROM socios WHERE id_categoria IN ('
                    . self::placeholders(count($testCategories)) . ')',
                    $testCategories
                );
                if ($blocked !== []) {
                    $skipped['categorias_en_uso_por_socios_no_e2e'] = $blocked;
                    $safeCategories = array_values(array_diff($testCategories, $blocked));
                }
            }
            $counts['precios_historicos'] += self::deleteByIds(
                $db,
                'precios_historicos',
                'id_categoria',
                $safeCategories
            );
            $counts['categorias'] += self::deleteByIds(
                $db,
                'categoria',
                'id_categoria',
                $safeCategories
            );

            // 4) Descuentos familiares creados por los tests.
            if (self::tableExists($db, 'descuentos_familiares')) {
                $counts['descuentos_familiares'] += self::deleteByIds(
                    $db,
                    'descuentos_familiares',
                    'id_descuento_familiar',
                    $testDiscounts
                );
            }

            // 5) Sesiones, auditoría de login y usuario administrador temporal.
            // Se borra al final para que el request de cleanup ya haya sido autenticado.
            $counts['sesiones'] += self::deleteByIds($db, 'sis_sesiones', 'idUsuario', $testUsers);
            $counts['login_auditoria'] += self::deleteByIds(
                $db,
                'sis_login_auditoria',
                'idUsuario',
                $testUsers
            );

            $statement = $db->prepare(
                "DELETE FROM sis_login_auditoria
                 WHERE LEFT(usuario, 7) = 'pw_e2e_'
                    OR user_agent LIKE 'PW-RH-E2E-SETUP/%'"
            );
            $statement->execute();
            $counts['login_auditoria'] += $statement->rowCount();

            $counts['usuarios'] += self::deleteByIds($db, 'sis_usuarios', 'idUsuario', $testUsers);

            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }

        return [
            'eliminados' => $counts,
            'omitidos_por_seguridad' => $skipped,
            'criterio' => [
                'usuarios' => 'pw_e2e_*',
                'socios' => 'PW E2E SOCIO *',
                'familias' => 'PW E2E FAM *',
                'categorias' => 'PW EE CAT *',
                'descuentos' => 'PW E2E DESC *',
            ],
        ];
    }

    private static function ids(PDO $db, string $sql, array $params = []): array
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        return array_values(array_unique(array_map(
            'intval',
            array_filter(
                array_column($statement->fetchAll(PDO::FETCH_NUM), 0),
                static fn(mixed $value): bool => $value !== null && $value !== ''
            )
        )));
    }

    private static function placeholders(int $count): string
    {
        return implode(',', array_fill(0, $count, '?'));
    }

    private static function deleteByIds(
        PDO $db,
        string $table,
        string $column,
        array $ids
    ): int {
        if ($ids === []) return 0;
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)
            || !preg_match('/^[a-zA-Z0-9_]+$/', $column)) {
            throw new RuntimeException('Nombre de tabla o columna inválido en limpieza E2E.');
        }

        $statement = $db->prepare(
            "DELETE FROM `{$table}` WHERE `{$column}` IN ("
            . self::placeholders(count($ids)) . ')'
        );
        $statement->execute(array_values($ids));
        return $statement->rowCount();
    }

    private static function columnExists(PDO $db, string $table, string $column): bool
    {
        $statement = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.columns '
            . 'WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
        );
        $statement->execute([$table, $column]);
        return (int)$statement->fetchColumn() > 0;
    }

    private static function tableExists(PDO $db, string $table): bool
    {
        $statement = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.tables '
            . 'WHERE table_schema = DATABASE() AND table_name = ?'
        );
        $statement->execute([$table]);
        return (int)$statement->fetchColumn() > 0;
    }
}
