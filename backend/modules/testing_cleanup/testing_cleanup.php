<?php
declare(strict_types=1);

/**
 * Limpieza EXCLUSIVA de registros creados por Playwright.
 *
 * Reglas de aislamiento usadas por los tests actuales:
 * - usuarios:              pw_e2e_*
 * - socios:                PW E2E SOCIO * / PW EEE SOCIO *
 * - familias:              PW E2E FAM * / PW EEE FAM *
 * - categorias:            PW EE CAT * (el formulario de categorías elimina dígitos)
 * - descuentos familiares: descripcion PW E2E DESC *
 * - logins inválidos:      usuario pw_e2e_*
 * - login de preparación:  User-Agent PW-RH-E2E-SETUP/*
 * - contabilidad opciones:   PW E2E CT * / PW EEE CT *
 * - contabilidad movimientos: detalle PW E2E CONTABLE * / comprobante PW-E2E-*
 *
 * Nunca borra por fechas, IDs altos, dominios genéricos ni coincidencias amplias.
 */
final class TestingCleanup
{
    private const CONFIRMATION = 'LIMPIAR_PLAYWRIGHT';

    public static function run(): never
    {
        $auth = require_admin();
        if (!function_exists('e2e_request_header_active') || !e2e_request_header_active()) {
            api_error('Falta el header E2E.', 'E2E_HEADER_REQUIRED', 403);
        }
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

    /**
     * Compatibilidad con instalaciones antiguas que todavía tengan un trigger
     * BEFORE DELETE sobre socios.
     *
     * El esquema actual permite la eliminación definitiva desde el backend y
     * no necesita ningún trigger especial para Playwright. Por eso la ausencia
     * de trigger es el estado normal y NO debe bloquear la suite.
     *
     * Si queda instalado un trigger antiguo que usa SIGNAL para impedir DELETE
     * y no contiene la excepción explícita para los socios E2E, detenemos la
     * limpieza antes de abrir la transacción para no dejar una corrida a medias.
     */
    private static function assertSocioDeleteGuardSupportsE2E(PDO $db): void
    {
        try {
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
        } catch (Throwable $schemaError) {
            // La limpieza ya está aislada por IDs obtenidos únicamente desde
            // prefijos PW E2E. No hacemos depender los tests de permisos sobre
            // information_schema si la base no expone los triggers.
            error_log('[e2e_cleanup][triggers] ' . $schemaError->getMessage());
            return;
        }

        // Sin BEFORE DELETE: esquema RH Negativo V2 actual. Continuar.
        if ($triggers === []) return;

        $blocking = [];
        foreach ($triggers as $trigger) {
            $definition = strtoupper((string)($trigger['ACTION_STATEMENT'] ?? ''));
            $name = (string)($trigger['TRIGGER_NAME'] ?? 'trigger_sin_nombre');

            // Un trigger que no hace SIGNAL no es, por sí solo, una protección
            // que impida la limpieza. Si hace SIGNAL, debe contemplar ambos
            // marcadores de socios E2E que usa la suite actual/legacy.
            if (!str_contains($definition, 'SIGNAL')
                || (str_contains($definition, 'PW E2E SOCIO') && str_contains($definition, 'PW EEE SOCIO'))) {
                continue;
            }
            $blocking[] = $name;
        }

        if ($blocking === []) return;

        api_error(
            'Existe una protección antigua de DELETE de socios incompatible con la limpieza E2E.',
            'E2E_GUARD_SOCIOS_DESACTUALIZADO',
            409,
            [
                'triggers_bloqueantes' => $blocking,
                'accion' => 'Quitá o actualizá únicamente el trigger antiguo que bloquea DELETE. El esquema actual de RH Negativo V2 no requiere un trigger especial para Playwright.',
                'seguridad' => 'e2e_cleanup selecciona y elimina exclusivamente registros identificados por prefijos Playwright explícitos definidos por la suite.',
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
            'socios_eliminados' => 0,
            'socios' => 0,
            'precios_historicos' => 0,
            'categorias' => 0,
            'descuentos_familiares' => 0,
            'cobradores' => 0,
            'estados' => 0,
            'grupos_sanguineos' => 0,
            'medios_pago' => 0,
            'periodos' => 0,
            'contable_ingresos' => 0,
            'contable_egresos' => 0,
            'contable_opciones' => 0,
            'contable_archivos' => 0,
            'sesiones' => 0,
            'login_auditoria' => 0,
            'auditoria' => 0,
            'usuarios' => 0,
        ];
        $skipped = [];
        $contableFiles = [];
        $autoIncrement = null;

        $db->beginTransaction();
        try {
            $testUsers = self::ids(
                $db,
                "SELECT idUsuario FROM sis_usuarios WHERE LEFT(usuario, 7) = 'pw_e2e_'"
            );
            $testSocios = self::ids(
                $db,
                "SELECT id_socio FROM socios
                 WHERE nombre LIKE 'PW E2E SOCIO %'
                    OR nombre LIKE 'PW EEE SOCIO %'
                    OR nombre LIKE 'PW EEE DNI %'"
            );
            // Un test puede ejecutar eliminación definitiva y conservar pagos/
            // inscripción como historia contable. En ese punto el socio ya no
            // existe en `socios`, así que recuperamos su ID desde el archivo para
            // poder limpiar también todas sus dependencias E2E al finalizar.
            if (self::tableExists($db, 'socios_eliminados')) {
                $archivedTestSocios = self::ids(
                    $db,
                    "SELECT id_socio FROM socios_eliminados
                     WHERE nombre LIKE 'PW E2E SOCIO %'
                        OR nombre LIKE 'PW EEE SOCIO %'
                        OR nombre LIKE 'PW EEE DNI %'"
                );
                $testSocios = array_values(array_unique(array_merge($testSocios, $archivedTestSocios)));
            }
            $testFamilies = self::ids(
                $db,
                "SELECT id_familia FROM familias
                 WHERE nombre_familia LIKE 'PW E2E FAM %'
                    OR nombre_familia LIKE 'PW EEE FAM %'
                    OR (
                        LEFT(nombre_familia, 13) = '__ELIMINADA__'
                        AND LOCATE('::', nombre_familia) > 13
                        AND (
                            SUBSTRING(nombre_familia, LOCATE('::', nombre_familia) + 2) LIKE 'PW E2E FAM %'
                            OR SUBSTRING(nombre_familia, LOCATE('::', nombre_familia) + 2) LIKE 'PW EEE FAM %'
                        )
                    )"
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
                     WHERE descripcion LIKE 'PW E2E DESC %' OR descripcion LIKE 'PW E2E RETROACTIVO %'"
                )
                : [];

            $testCollectors = self::ids(
                $db,
                "SELECT id_cobrador FROM cobrador WHERE nombre LIKE 'PW E2E COB %'"
            );
            $testStates = self::ids(
                $db,
                "SELECT id_estado FROM estado
                 WHERE nombre LIKE 'PW E2E EST %'
                    OR nombre LIKE 'PW EE EST %'"
            );
            $testBloodGroups = self::ids(
                $db,
                "SELECT id_grupo_sanguineo FROM grupo_sanguineo
                 WHERE nombre LIKE 'PWE2E-%' OR nombre LIKE 'PWE2E+%'"
            );
            $testPaymentMethods = self::ids(
                $db,
                "SELECT id_medio_pago FROM medios_pago WHERE nombre LIKE 'PW E2E MED %'"
            );
            $testPeriods = self::ids(
                $db,
                "SELECT id_periodo FROM periodo
                 WHERE id_periodo > 7 AND nombre LIKE 'PW E2E PER %'"
            );

            // Contabilidad usa marcadores todavía más específicos para que la
            // limpieza pueda ejecutarse también contra Hostinger sin tocar datos reales.
            $testContableOptions = self::tableExists($db, 'contable_opciones')
                ? self::ids(
                    $db,
                    "SELECT id_opcion FROM contable_opciones WHERE nombre LIKE 'PW E2E CT %' OR nombre LIKE 'PW EEE CT %'"
                )
                : [];
            $testContableIncome = self::tableExists($db, 'contable_ingresos')
                ? self::ids(
                    $db,
                    "SELECT id_ingreso FROM contable_ingresos
                     WHERE proveedor LIKE 'PW E2E CT %' OR proveedor LIKE 'PW EEE CT %'
                        OR categoria LIKE 'PW E2E CT %' OR categoria LIKE 'PW EEE CT %'
                        OR concepto LIKE 'PW E2E CT %' OR concepto LIKE 'PW EEE CT %'
                        OR detalle LIKE 'PW E2E CONTABLE %'"
                )
                : [];
            $testContableExpenses = [];
            if (self::tableExists($db, 'contable_egresos')) {
                $statement = $db->prepare(
                    "SELECT id_egreso, archivo_path FROM contable_egresos
                     WHERE proveedor LIKE 'PW E2E CT %' OR proveedor LIKE 'PW EEE CT %'
                        OR categoria LIKE 'PW E2E CT %' OR categoria LIKE 'PW EEE CT %'
                        OR concepto LIKE 'PW E2E CT %' OR concepto LIKE 'PW EEE CT %'
                        OR detalle LIKE 'PW E2E CONTABLE %'
                        OR numero_comprobante LIKE 'PW-E2E-%'"
                );
                $statement->execute();
                foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                    $id = (int)($row['id_egreso'] ?? 0);
                    if ($id > 0) $testContableExpenses[] = $id;
                    $file = trim((string)($row['archivo_path'] ?? ''));
                    if ($file !== '') $contableFiles[] = $file;
                }
                $testContableExpenses = array_values(array_unique($testContableExpenses));
                $contableFiles = array_values(array_unique($contableFiles));
            }

            // Guardamos las referencias de auditoría ANTES de borrar las entidades.
            // También se elimina toda auditoría generada por el usuario temporal E2E,
            // lo que cubre incluso entidades que el propio test ya eliminó definitivamente.
            $auditReferences = [
                'socios' => $testSocios,
                'familias' => $testFamilies,
                'categoria' => $testCategories,
                'categorias' => $testCategories, // compatibilidad con auditorías antiguas
                'descuentos_familiares' => $testDiscounts,
                'cobrador' => $testCollectors,
                'estado' => $testStates,
                'grupo_sanguineo' => $testBloodGroups,
                'medios_pago' => $testPaymentMethods,
                'periodo' => $testPeriods,
                'contable_opciones' => $testContableOptions,
                'contable_ingresos' => $testContableIncome,
                'contable_egresos' => $testContableExpenses,
                'sis_usuarios' => $testUsers,
            ];

            $auditTableColumn = self::columnExists($db, 'auditoria', 'tabla')
                ? 'tabla'
                : null;
            $auditUserColumn = self::columnExists($db, 'auditoria', 'id_usuario')
                ? 'id_usuario'
                : null;

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
            if (self::tableExists($db, 'socios_eliminados')) {
                $counts['socios_eliminados'] += self::deleteByIds(
                    $db,
                    'socios_eliminados',
                    'id_socio',
                    $testSocios
                );
            }
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

            // 5) Movimientos y opciones contables E2E. Los movimientos se
            // eliminan primero; las opciones guardan nombres históricos por texto y
            // no se usa ningún patrón amplio ni fecha para decidir qué borrar.
            if (self::tableExists($db, 'contable_ingresos')) {
                $counts['contable_ingresos'] += self::deleteByIds(
                    $db,
                    'contable_ingresos',
                    'id_ingreso',
                    $testContableIncome
                );
            }
            if (self::tableExists($db, 'contable_egresos')) {
                $counts['contable_egresos'] += self::deleteByIds(
                    $db,
                    'contable_egresos',
                    'id_egreso',
                    $testContableExpenses
                );
            }
            if (self::tableExists($db, 'contable_opciones')) {
                $counts['contable_opciones'] += self::deleteByIds(
                    $db,
                    'contable_opciones',
                    'id_opcion',
                    $testContableOptions
                );
            }

            // 6) Catálogos auxiliares creados por Configuración E2E. Una corrida
            // interrumpida no debe dejar opciones activas que contaminen Cuotas o
            // futuros tests. Solo se borran IDs con prefijo Playwright y sin usos.
            $safeCollectors = self::withoutReferences($db, $testCollectors, [
                ['socios', 'id_cobrador'],
            ]);
            $safeStates = self::withoutReferences($db, $testStates, [
                ['socios', 'id_estado'],
                ['socios_historial_estados', 'id_estado_anterior'],
                ['socios_historial_estados', 'id_estado_nuevo'],
            ]);
            $safeBloodGroups = self::withoutReferences($db, $testBloodGroups, [
                ['socios', 'id_grupo_sanguineo'],
            ]);
            $safePaymentMethods = self::withoutReferences($db, $testPaymentMethods, [
                ['pagos', 'id_medio_pago'],
                ['pagos_inscripcion', 'id_medio_pago'],
                ['contable_ingresos', 'id_medio_pago'],
                ['contable_egresos', 'id_medio_pago'],
            ]);
            $safePeriods = self::withoutReferences($db, $testPeriods, [
                ['pagos', 'id_periodo'],
            ]);

            $counts['cobradores'] += self::deleteByIds($db, 'cobrador', 'id_cobrador', $safeCollectors);
            $counts['estados'] += self::deleteByIds($db, 'estado', 'id_estado', $safeStates);
            $counts['grupos_sanguineos'] += self::deleteByIds($db, 'grupo_sanguineo', 'id_grupo_sanguineo', $safeBloodGroups);
            $counts['medios_pago'] += self::deleteByIds($db, 'medios_pago', 'id_medio_pago', $safePaymentMethods);
            $counts['periodos'] += self::deleteByIds($db, 'periodo', 'id_periodo', $safePeriods);

            foreach ([
                'cobradores' => array_values(array_diff($testCollectors, $safeCollectors)),
                'estados' => array_values(array_diff($testStates, $safeStates)),
                'grupos_sanguineos' => array_values(array_diff($testBloodGroups, $safeBloodGroups)),
                'medios_pago' => array_values(array_diff($testPaymentMethods, $safePaymentMethods)),
                'periodos' => array_values(array_diff($testPeriods, $safePeriods)),
            ] as $key => $blockedIds) {
                if ($blockedIds !== []) $skipped[$key . '_en_uso'] = $blockedIds;
            }

            // 7) Sesiones, auditoría de login y usuario administrador temporal.
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

            // LOCAL puede restaurar AUTO_INCREMENT porque trabaja sobre una
            // copia de desarrollo. En producción/Hostinger NO ejecutamos ALTER
            // TABLE: el aislamiento se basa en namespace E2E + huella de datos
            // reales, evitando bloqueos o cambios de metadatos en producción.
            if (in_array(strtolower(trim((string)env_value('APP_ENV', 'production'))), ['local', 'dev', 'development', 'test', 'testing'], true)) {
                $autoIncrement = self::resetAutoIncrementCounters($db);
            } else {
                $autoIncrement = [
                    'verificado' => true,
                    'omitido' => true,
                    'motivo' => 'produccion',
                    'tablas_detectadas' => 0,
                    'tablas_reiniciadas' => 0,
                    'tablas' => [],
                ];
            }
            $counts['contable_archivos'] += self::deleteContableFiles($contableFiles);
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }

        return [
            'eliminados' => $counts,
            'omitidos_por_seguridad' => $skipped,
            'auto_increment' => $autoIncrement ?? [
                'verificado' => false,
                'tablas_detectadas' => 0,
                'tablas_reiniciadas' => 0,
                'tablas' => [],
            ],
            'criterio' => [
                'usuarios' => 'pw_e2e_*',
                'socios' => 'PW E2E SOCIO * / PW EEE SOCIO *',
                'familias' => 'PW E2E FAM * / PW EEE FAM *',
                'categorias' => 'PW EE CAT *',
                'descuentos' => 'PW E2E DESC *',
                'cobradores' => 'PW E2E COB *',
                'estados' => 'PW E2E EST * / PW EE EST *',
                'grupos_sanguineos' => 'PWE2E-* / PWE2E+*',
                'medios_pago' => 'PW E2E MED *',
                'periodos' => 'id > 7 y PW E2E PER *',
                'contable_opciones' => 'PW E2E CT * / PW EEE CT *',
                'contable_movimientos' => 'PW E2E CT * / PW EEE CT * / PW E2E CONTABLE * / PW-E2E-*',
            ],
        ];
    }

    /**
     * Restaura los contadores AUTO_INCREMENT consumidos por Playwright.
     *
     * Importante:
     * - NO renumera filas.
     * - NO reutiliza huecos internos. Para IDs técnicos usa MAX(pk) + 1;
     *   para socios conserva además el mayor número REAL histórico auditado.
     * - Descubre las tablas de forma dinámica para cubrir también tablas
     *   creadas por módulos (por ejemplo Contabilidad).
     * - Verifica después de cada ALTER que el contador coincida con el máximo
     *   real que existe en ese momento.
     */
    private static function resetAutoIncrementCounters(PDO $db): array
    {
        // En MySQL 8, information_schema.TABLES.AUTO_INCREMENT es una estadística
        // dinámica y puede quedar cacheada (por defecto hasta 24 h). Si se lee
        // inmediatamente después de ALTER TABLE puede devolver el contador viejo
        // y producir un falso negativo en la limpieza E2E. Desactivamos esa caché
        // sólo para esta conexión. En MariaDB/servidores que no soporten la
        // variable, el fallback de SHOW CREATE TABLE de tableAutoIncrement() sigue
        // permitiendo verificar el valor real sin bloquear la suite.
        self::disableInformationSchemaStatsCache($db);

        $columns = self::autoIncrementColumns($db);
        $tables = [];
        $resetCount = 0;

        foreach ($columns as $definition) {
            $table = (string)($definition['table'] ?? '');
            $column = (string)($definition['column'] ?? '');
            self::assertIdentifier($table);
            self::assertIdentifier($column);

            $nextBefore = self::maxNextId($db, $table, $column);
            $autoBefore = self::tableAutoIncrement($db, $table);
            $reset = $autoBefore === null || $autoBefore !== $nextBefore;

            if ($reset) {
                // MySQL no permite parametrizar identificadores ni el valor de
                // AUTO_INCREMENT en ALTER TABLE. Los identificadores vienen de
                // metadata de la propia DB y se validan estrictamente arriba.
                $db->exec("ALTER TABLE `{$table}` AUTO_INCREMENT = {$nextBefore}");
                $resetCount++;
            }

            // Recalculamos tras el ALTER para tolerar de forma segura una alta
            // real concurrente que haya ocurrido mientras esperaba el lock DDL.
            $nextAfter = self::maxNextId($db, $table, $column);
            $autoAfter = self::tableAutoIncrement($db, $table);

            if ($autoAfter === null || $autoAfter !== $nextAfter) {
                throw new RuntimeException(
                    "No se pudo verificar AUTO_INCREMENT de {$table}: "
                    . "esperado {$nextAfter}, obtenido " . ($autoAfter ?? 'NULL') . '.'
                );
            }

            $tables[$table] = [
                'columna' => $column,
                'max_id' => max(0, $nextAfter - 1),
                'proximo_id' => $autoAfter,
                'anterior' => $autoBefore,
                'reiniciado' => $reset,
            ];
        }

        ksort($tables);
        return [
            'verificado' => true,
            'tablas_detectadas' => count($tables),
            'tablas_reiniciadas' => $resetCount,
            'tablas' => $tables,
        ];
    }

    private static function autoIncrementColumns(PDO $db): array
    {
        try {
            $statement = $db->query(
                "SELECT TABLE_NAME, COLUMN_NAME
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND EXTRA LIKE '%auto_increment%'
                 ORDER BY TABLE_NAME"
            );
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
            if ($rows !== []) {
                return array_map(
                    static fn(array $row): array => [
                        'table' => (string)$row['TABLE_NAME'],
                        'column' => (string)$row['COLUMN_NAME'],
                    ],
                    $rows
                );
            }
        } catch (Throwable $schemaError) {
            error_log('[e2e_cleanup][auto_increment_metadata] ' . $schemaError->getMessage());
        }

        // Fallback para hostings con acceso parcial a information_schema.
        $result = [];
        $tables = $db->query('SHOW TABLES')->fetchAll(PDO::FETCH_NUM);
        foreach ($tables as $row) {
            $table = (string)($row[0] ?? '');
            self::assertIdentifier($table);
            $columns = $db->query("SHOW COLUMNS FROM `{$table}`")->fetchAll(PDO::FETCH_ASSOC);
            foreach ($columns as $column) {
                if (!str_contains(strtolower((string)($column['Extra'] ?? '')), 'auto_increment')) continue;
                $name = (string)($column['Field'] ?? '');
                self::assertIdentifier($name);
                $result[] = ['table' => $table, 'column' => $name];
            }
        }

        if ($result === []) {
            throw new RuntimeException('No se pudieron detectar columnas AUTO_INCREMENT para verificar la limpieza E2E.');
        }
        return $result;
    }

    private static function maxNextId(PDO $db, string $table, string $column): int
    {
        self::assertIdentifier($table);
        self::assertIdentifier($column);

        // id_socio no es un ID técnico cualquiera: es el número de socio.
        // Nunca debe reutilizarse un número real que ya existió aunque ese socio
        // haya sido eliminado definitivamente. La auditoría conserva esa marca
        // histórica y los IDs PW E2E se excluyen para que Playwright no consuma
        // numeración real del padrón.
        if ($table === 'socios' && $column === 'id_socio') {
            return self::nextSocioBusinessId($db);
        }

        $value = (int)$db->query(
            "SELECT COALESCE(MAX(`{$column}`), 0) + 1 FROM `{$table}`"
        )->fetchColumn();
        return max(1, $value);
    }

    private static function nextSocioBusinessId(PDO $db): int
    {
        $maxCurrent = (int)$db->query(
            'SELECT COALESCE(MAX(id_socio), 0) FROM socios'
        )->fetchColumn();

        try {
            $statement = $db->query(
                "SELECT COALESCE(MAX(id_registro), 0)
"
                . "FROM auditoria
"
                . "WHERE tabla = 'socios'
"
                . "  AND (datos_anteriores IS NULL OR (
"
                . "       UPPER(CAST(datos_anteriores AS CHAR)) NOT LIKE '%PW E2E SOCIO%'
"
                . "   AND UPPER(CAST(datos_anteriores AS CHAR)) NOT LIKE '%PW EEE SOCIO%'
"
                . "  ))
"
                . "  AND (datos_nuevos IS NULL OR (
"
                . "       UPPER(CAST(datos_nuevos AS CHAR)) NOT LIKE '%PW E2E SOCIO%'
"
                . "   AND UPPER(CAST(datos_nuevos AS CHAR)) NOT LIKE '%PW EEE SOCIO%'
"
                . "  ))"
            );
            $maxHistoricalReal = max(0, (int)$statement->fetchColumn());
            return max(1, $maxCurrent, $maxHistoricalReal) + 1;
        } catch (Throwable $auditError) {
            error_log('[e2e_cleanup][socios_historico] ' . $auditError->getMessage());
        }

        // Fallback para instalaciones antiguas sin auditoría utilizable: no
        // hacemos retroceder socios por debajo del AUTO_INCREMENT efectivo.
        $autoIncrement = self::tableAutoIncrement($db, 'socios');
        return max(1, $maxCurrent + 1, $autoIncrement ?? 1);
    }

    /**
     * Devuelve el próximo AUTO_INCREMENT evitando depender de estadísticas
     * cacheadas de information_schema. SHOW CREATE TABLE lee la definición
     * efectiva de la tabla y expone AUTO_INCREMENT=N cuando el contador es > 1.
     */
    private static function tableAutoIncrement(PDO $db, string $table): ?int
    {
        self::assertIdentifier($table);

        try {
            $statement = $db->query("SHOW CREATE TABLE `{$table}`");
            $row = $statement->fetch(PDO::FETCH_NUM);
            $createSql = (string)($row[1] ?? '');
            if ($createSql !== '') {
                if (preg_match('/\bAUTO_INCREMENT=(\d+)\b/i', $createSql, $match)) {
                    return (int)$match[1];
                }

                // Si la tabla tiene columna AUTO_INCREMENT pero SHOW CREATE no
                // imprime la opción, el contador está en su valor inicial (1).
                if (stripos($createSql, 'AUTO_INCREMENT') !== false) return 1;
            }
        } catch (Throwable $showCreateError) {
            error_log('[e2e_cleanup][auto_increment_show_create] ' . $showCreateError->getMessage());
        }

        try {
            $statement = $db->prepare(
                'SELECT AUTO_INCREMENT
                 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ?
                 LIMIT 1'
            );
            $statement->execute([$table]);
            $value = $statement->fetchColumn();
            if ($value !== false && $value !== null) return (int)$value;
        } catch (Throwable $schemaError) {
            error_log('[e2e_cleanup][auto_increment_table] ' . $schemaError->getMessage());
        }

        $statement = $db->query('SHOW TABLE STATUS LIKE ' . $db->quote($table));
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        $value = $row['Auto_increment'] ?? null;
        return $value === null ? null : (int)$value;
    }

    /**
     * MySQL 8 cachea columnas estadísticas de information_schema.TABLES, entre
     * ellas AUTO_INCREMENT. La variable es de sesión, así que no afecta al resto
     * de la aplicación. MariaDB/versiones antiguas pueden no conocerla: en ese
     * caso continuamos y verificamos mediante SHOW CREATE TABLE.
     */
    private static function disableInformationSchemaStatsCache(PDO $db): void
    {
        try {
            $db->exec('SET SESSION information_schema_stats_expiry = 0');
        } catch (Throwable $unsupported) {
            error_log('[e2e_cleanup][information_schema_stats_expiry] ' . $unsupported->getMessage());
        }
    }

    private static function assertIdentifier(string $value): void
    {
        if ($value === '' || !preg_match('/^[a-zA-Z0-9_]+$/', $value)) {
            throw new RuntimeException('Identificador inválido al verificar AUTO_INCREMENT E2E.');
        }
    }

    private static function deleteContableFiles(array $paths): int
    {
        if ($paths === []) return 0;

        $root = dirname(__DIR__, 2) . '/uploads/contable';
        $rootReal = realpath($root);
        if ($rootReal === false) return 0;

        $deleted = 0;
        foreach (array_values(array_unique($paths)) as $path) {
            $clean = str_replace('\\', '/', trim((string)$path));
            $clean = ltrim($clean, '/');
            if ($clean === '' || str_contains($clean, '..')) continue;

            $candidate = $rootReal . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $clean);
            $fileReal = realpath($candidate);
            if ($fileReal === false || !is_file($fileReal)) continue;

            $prefix = rtrim($rootReal, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
            if (!str_starts_with($fileReal, $prefix)) continue;
            if (@unlink($fileReal)) $deleted++;
        }
        return $deleted;
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

    private static function withoutReferences(PDO $db, array $ids, array $relations): array
    {
        $safe = array_values(array_unique(array_map('intval', $ids)));
        if ($safe === []) return [];

        $blocked = [];
        foreach ($relations as [$table, $column]) {
            if (!self::tableExists($db, $table) || !self::columnExists($db, $table, $column)) continue;
            $statement = $db->prepare(
                "SELECT DISTINCT `{$column}` FROM `{$table}` WHERE `{$column}` IN ("
                . self::placeholders(count($safe)) . ')'
            );
            $statement->execute($safe);
            foreach ($statement->fetchAll(PDO::FETCH_NUM) as $row) {
                if ($row[0] !== null) $blocked[] = (int)$row[0];
            }
        }

        return array_values(array_diff($safe, array_values(array_unique($blocked))));
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
