<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/request.php';
require_once __DIR__ . '/../config/env.php';

function e2e_request_header_active(): bool
{
    return strtoupper(trim((string)($_SERVER['HTTP_X_RH_E2E'] ?? ''))) === 'PLAYWRIGHT';
}

function e2e_request_active(array $auth): bool
{
    $username = strtolower(trim((string)($auth['usuario'] ?? '')));
    return e2e_request_header_active() || str_starts_with($username, 'pw_e2e_');
}

function e2e_scope_error(string $action, string $detail): never
{
    api_error(
        'Playwright intentó salir del espacio de datos E2E.',
        'E2E_SCOPE_BLOCKED',
        409,
        ['action' => $action, 'detalle' => $detail]
    );
}

function e2e_is_local_environment(): bool
{
    return in_array(strtolower(trim((string)env_value('APP_ENV', 'production'))), [
        'local', 'dev', 'development', 'test', 'testing',
    ], true);
}

function e2e_marker(string $value, array $prefixes): bool
{
    $upper = strtoupper(trim($value));
    foreach ($prefixes as $prefix) {
        if (str_starts_with($upper, strtoupper($prefix))) return true;
    }
    return false;
}

function e2e_collect_ids(array $value, string $key): array
{
    $ids = [];
    $walk = static function (mixed $node) use (&$walk, &$ids, $key): void {
        if (!is_array($node)) return;
        foreach ($node as $field => $child) {
            if ((string)$field === $key && is_scalar($child) && preg_match('/^\d+$/', (string)$child)) {
                $id = (int)$child;
                if ($id > 0) $ids[] = $id;
            }
            if (is_array($child)) $walk($child);
        }
    };
    $walk($value);
    return array_values(array_unique($ids));
}

/** null = no existe; true = E2E; false = real */
function e2e_target_state(PDO $db, string $kind, int $id): ?bool
{
    if ($id <= 0) return null;
    $definitions = [
        'usuario' => ['sis_usuarios', 'idUsuario', "LOWER(usuario) LIKE 'pw_e2e_%'"],
        'socio' => ['socios', 'id_socio', "nombre LIKE 'PW E2E SOCIO %' OR nombre LIKE 'PW EEE SOCIO %' OR nombre LIKE 'PW EEE DNI %'"],
        'familia' => ['familias', 'id_familia', "nombre_familia LIKE 'PW E2E FAM %' OR nombre_familia LIKE 'PW EEE FAM %' OR nombre_familia LIKE '__ELIMINADA__%::PW E2E FAM %' OR nombre_familia LIKE '__ELIMINADA__%::PW EEE FAM %'"],
        'categoria' => ['categoria', 'id_categoria', "nombre LIKE 'PW EE CAT %'"],
        'descuento' => ['descuentos_familiares', 'id_descuento_familiar', "descripcion LIKE 'PW E2E DESC %'"],
        'cobrador' => ['cobrador', 'id_cobrador', "nombre LIKE 'PW E2E COB %'"],
        'estado' => ['estado', 'id_estado', "nombre LIKE 'PW E2E EST %' OR nombre LIKE 'PW EE EST %'"],
        'grupo_sanguineo' => ['grupo_sanguineo', 'id_grupo_sanguineo', "nombre LIKE 'PWE2E-%' OR nombre LIKE 'PWE2E+%'"],
        'medios_pago' => ['medios_pago', 'id_medio_pago', "nombre LIKE 'PW E2E MED %'"],
        'periodo' => ['periodo', 'id_periodo', "id_periodo > 7 AND nombre LIKE 'PW E2E PER %'"],
        'contable_opcion' => ['contable_opciones', 'id_opcion', "nombre LIKE 'PW E2E CT %' OR nombre LIKE 'PW EEE CT %'"],
        'contable_ingreso' => ['contable_ingresos', 'id_ingreso', "proveedor LIKE 'PW E2E CT %' OR proveedor LIKE 'PW EEE CT %' OR categoria LIKE 'PW E2E CT %' OR categoria LIKE 'PW EEE CT %' OR concepto LIKE 'PW E2E CT %' OR concepto LIKE 'PW EEE CT %' OR detalle LIKE 'PW E2E CONTABLE %'"],
        'contable_egreso' => ['contable_egresos', 'id_egreso', "proveedor LIKE 'PW E2E CT %' OR proveedor LIKE 'PW EEE CT %' OR categoria LIKE 'PW E2E CT %' OR categoria LIKE 'PW EEE CT %' OR concepto LIKE 'PW E2E CT %' OR concepto LIKE 'PW EEE CT %' OR detalle LIKE 'PW E2E CONTABLE %' OR numero_comprobante LIKE 'PW-E2E-%'"],
    ];
    if (!isset($definitions[$kind])) throw new RuntimeException("Tipo E2E desconocido: {$kind}");
    [$table, $column, $condition] = $definitions[$kind];
    try {
        $statement = $db->prepare("SELECT CASE WHEN ({$condition}) THEN 1 ELSE 0 END AS es_e2e FROM `{$table}` WHERE `{$column}` = ? LIMIT 1");
        $statement->execute([$id]);
        $value = $statement->fetchColumn();
        return $value === false ? null : ((int)$value === 1);
    } catch (Throwable $error) {
        // Fail-closed: si el guard no puede verificar el destino, nunca convierte
        // un problema de DB/esquema en permiso para tocar un registro potencialmente real.
        error_log('[e2e_guard][' . $kind . '] ' . $error->getMessage());
        throw new RuntimeException('No se pudo verificar el alcance E2E para ' . $kind . '.', 0, $error);
    }
}

function e2e_assert_target(PDO $db, string $action, string $kind, mixed $rawId): void
{
    if ($rawId === null || trim((string)$rawId) === '' || !preg_match('/^\d+$/', (string)$rawId)) return;
    $id = (int)$rawId;
    if ($id <= 0) return;
    $state = e2e_target_state($db, $kind, $id);
    if ($state === false) e2e_scope_error($action, "El {$kind} {$id} es un registro real.");
    // Si no existe, dejamos pasar para que el handler valide 404/422 sin riesgo.
}

function e2e_assert_socio_ids(PDO $db, string $action, array $body): void
{
    foreach (e2e_collect_ids($body, 'id_socio') as $id) {
        e2e_assert_target($db, $action, 'socio', $id);
    }
}

function e2e_table_exists(PDO $db, string $table): bool
{
    $statement = $db->prepare(
        'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
    );
    $statement->execute([$table]);
    return (int)$statement->fetchColumn() > 0;
}

function e2e_assert_payment(PDO $db, string $action, mixed $rawId, string $table, string $idColumn): void
{
    if ($rawId === null || !preg_match('/^\d+$/', (string)$rawId)) return;
    $id = (int)$rawId;
    if ($id <= 0) return;

    try {
        if (e2e_table_exists($db, 'socios_eliminados')) {
            $statement = $db->prepare(
                "SELECT p.id_socio, COALESCE(s.nombre, se.nombre) AS socio_nombre
                   FROM `{$table}` p
                   LEFT JOIN socios s ON s.id_socio = p.id_socio
                   LEFT JOIN socios_eliminados se ON se.id_socio = p.id_socio
                  WHERE p.`{$idColumn}` = ? LIMIT 1"
            );
        } else {
            $statement = $db->prepare(
                "SELECT p.id_socio, s.nombre AS socio_nombre
                   FROM `{$table}` p
                   LEFT JOIN socios s ON s.id_socio = p.id_socio
                  WHERE p.`{$idColumn}` = ? LIMIT 1"
            );
        }
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row === false) return; // ID inexistente: el handler conserva su 404/422.

        $name = trim((string)($row['socio_nombre'] ?? ''));
        if ($name === '') {
            e2e_scope_error($action, "No se pudo demostrar que el movimiento {$id} pertenezca a datos E2E.");
        }
        if (!e2e_marker($name, ['PW E2E SOCIO ', 'PW EEE SOCIO ', 'PW EEE DNI '])) {
            e2e_scope_error($action, "El movimiento {$id} pertenece a un socio real.");
        }
    } catch (Throwable $error) {
        if (($error instanceof Error) || ($error instanceof RuntimeException)) throw $error;
        error_log('[e2e_guard][movimiento] ' . $error->getMessage());
        throw new RuntimeException('No se pudo verificar el movimiento E2E.', 0, $error);
    }
}

function e2e_config_kind(string $list): ?string
{
    return [
        'categoria' => 'categoria',
        'cobrador' => 'cobrador',
        'estado' => 'estado',
        'grupo_sanguineo' => 'grupo_sanguineo',
        'medios_pago' => 'medios_pago',
        'periodo' => 'periodo',
    ][$list] ?? null;
}

function e2e_config_creation_marker(string $list, string $name): bool
{
    return match ($list) {
        'categoria' => e2e_marker($name, ['PW EE CAT ']),
        'cobrador' => e2e_marker($name, ['PW E2E COB ']),
        'estado' => e2e_marker($name, ['PW E2E EST ', 'PW EE EST ']),
        'grupo_sanguineo' => e2e_marker($name, ['PWE2E-', 'PWE2E+']),
        'medios_pago' => e2e_marker($name, ['PW E2E MED ']),
        'periodo' => e2e_marker($name, ['PW E2E PER ']),
        default => false,
    };
}

function e2e_scope_guard(string $action, array $auth): void
{
    if (!e2e_request_active($auth)) return;
    $db = $auth['db'];
    $body = request_body();

    if ($action === 'e2e_guard_probe') {
        e2e_scope_error($action, 'Probe correcto: el guard E2E está activo.');
    }

    // Infraestructura E2E: sus propios handlers vuelven a validar header/admin.
    if (in_array($action, ['e2e_cleanup', 'e2e_residuos', 'e2e_integridad'], true)) return;

    switch ($action) {
        case 'auth_logout':
            return;

        case 'usuarios_guardar':
            if (!empty($body['id'])) {
                e2e_assert_target($db, $action, 'usuario', $body['id']);
                return;
            }
            $username = trim((string)($body['usuario'] ?? ''));
            if ($username === '' || str_starts_with(strtolower($username), 'pw_e2e_')) return;
            e2e_scope_error($action, 'Un usuario creado por Playwright debe usar prefijo pw_e2e_.');

        case 'usuarios_cambiar_estado':
        case 'usuarios_eliminar':
            e2e_assert_target($db, $action, 'usuario', $body['id'] ?? null);
            return;

        case 'socios_guardar':
            if (!empty($body['id_socio'])) {
                e2e_assert_target($db, $action, 'socio', $body['id_socio']);
                return;
            }
            $name = trim((string)($body['nombre'] ?? ''));
            if (e2e_marker($name, ['PW E2E SOCIO ', 'PW EEE SOCIO ', 'PW EEE DNI '])) return;
            if ($name === '' && e2e_is_local_environment()) return;
            e2e_scope_error($action, 'Un socio creado por Playwright debe usar un nombre PW E2E/PW EEE.');

        case 'socios_eliminar':
        case 'socios_eliminar_definitivo':
        case 'socios_reactivar':
        case 'socios_contacto_guardar':
        case 'socios_cumpleanios_cerrar':
            e2e_assert_target($db, $action, 'socio', $body['id'] ?? $body['id_socio'] ?? null);
            return;

        case 'familias_guardar':
            if (!empty($body['id_familia'])) {
                e2e_assert_target($db, $action, 'familia', $body['id_familia']);
            } else {
                $name = trim((string)($body['nombre'] ?? ''));
                if ($name !== '' && !e2e_marker($name, ['PW E2E FAM ', 'PW EEE FAM '])) {
                    e2e_scope_error($action, 'Una familia creada por Playwright debe usar prefijo PW E2E/PW EEE.');
                }
            }
            e2e_assert_socio_ids($db, $action, $body);
            return;

        case 'familias_eliminar':
        case 'familias_eliminar_definitivo':
        case 'familias_reactivar':
            e2e_assert_target($db, $action, 'familia', $body['id'] ?? null);
            return;

        case 'categorias_guardar':
            if (!empty($body['id_categoria'])) {
                e2e_assert_target($db, $action, 'categoria', $body['id_categoria']);
                return;
            }
            $name = trim((string)($body['nombre'] ?? ''));
            if ($name === '' || e2e_marker($name, ['PW EE CAT '])) return;
            e2e_scope_error($action, 'Una categoría creada por Playwright debe usar prefijo PW EE CAT.');

        case 'categorias_eliminar':
        case 'categorias_reactivar':
            e2e_assert_target($db, $action, 'categoria', $body['id'] ?? null);
            return;

        case 'descuentos_familiares_guardar':
            if (!empty($body['id_descuento_familiar'])) {
                e2e_assert_target($db, $action, 'descuento', $body['id_descuento_familiar']);
                return;
            }
            $description = trim((string)($body['descripcion'] ?? ''));
            if ($description === '' || e2e_marker($description, ['PW E2E DESC ', 'PW E2E RETROACTIVO '])) return;
            e2e_scope_error($action, 'Un descuento creado por Playwright debe usar prefijo PW E2E.');

        case 'descuentos_familiares_eliminar':
            e2e_assert_target($db, $action, 'descuento', $body['id'] ?? null);
            return;

        case 'configuracion_lista_guardar':
        case 'configuracion_lista_eliminar':
        case 'configuracion_lista_baja':
        case 'configuracion_lista_reactivar':
        case 'configuracion_lista_eliminar_definitivo':
            $list = trim((string)($body['lista'] ?? ''));
            $kind = e2e_config_kind($list);
            if ($kind === null) {
                if (e2e_is_local_environment()) return;
                e2e_scope_error($action, 'La sublista de Configuración no está declarada como segura para E2E.');
            }
            $id = $body['id'] ?? null;
            if ($id !== null && trim((string)$id) !== '') {
                // En LOCAL conservamos los tests de invariantes estructurales sobre
                // la copia local. En Hostinger jamás se intenta tocar esos registros.
                if (e2e_is_local_environment() && $list === 'periodo' && (int)$id >= 1 && (int)$id <= 7) return;
                if (e2e_is_local_environment() && $list === 'estado' && $action === 'configuracion_lista_guardar') return;
                e2e_assert_target($db, $action, $kind, $id);
                return;
            }
            if ($action !== 'configuracion_lista_guardar') return;
            $name = trim((string)($body['nombre'] ?? ''));
            if (e2e_config_creation_marker($list, $name)) return;
            if ($name === '' && e2e_is_local_environment()) return;
            e2e_scope_error($action, "La opción {$list} no tiene marcador E2E.");

        case 'cuotas_registrar_inscripcion':
        case 'cuotas_registrar_pago':
        case 'cuotas_registrar_pagos':
        case 'cuotas_condonar_pago':
        case 'cuotas_registrar_cobro':
            e2e_assert_socio_ids($db, $action, $body);
            return;

        case 'cuotas_eliminar_inscripcion':
            e2e_assert_payment($db, $action, $body['id_inscripcion'] ?? $body['id'] ?? null, 'pagos_inscripcion', 'id_inscripcion');
            return;

        case 'cuotas_eliminar_pago':
        case 'cuotas_anular':
            e2e_assert_payment($db, $action, $body['id_pago'] ?? $body['id'] ?? null, 'pagos', 'id_pago');
            return;

        case 'contable_opcion_guardar':
            if (!empty($body['id_opcion'])) {
                e2e_assert_target($db, $action, 'contable_opcion', $body['id_opcion']);
                return;
            }
            $name = trim((string)($body['nombre'] ?? ''));
            if ($name === '' || e2e_marker($name, ['PW E2E CT ', 'PW EEE CT ', 'PW E2E INVALIDA'])) return;
            e2e_scope_error($action, 'Una opción contable E2E debe usar prefijo PW E2E/PW EEE CT.');

        case 'contable_opcion_cambiar_estado':
        case 'contable_opcion_eliminar':
            e2e_assert_target($db, $action, 'contable_opcion', $body['id_opcion'] ?? null);
            return;

        case 'contable_ingreso_guardar':
            if (!empty($body['id_ingreso'])) {
                e2e_assert_target($db, $action, 'contable_ingreso', $body['id_ingreso']);
                return;
            }
            foreach (['id_proveedor', 'id_categoria', 'id_concepto'] as $field) {
                e2e_assert_target($db, $action, 'contable_opcion', $body[$field] ?? null);
            }
            return;

        case 'contable_ingreso_eliminar':
            e2e_assert_target($db, $action, 'contable_ingreso', $body['id_ingreso'] ?? null);
            return;

        case 'contable_egreso_guardar':
            if (!empty($body['id_egreso'])) {
                e2e_assert_target($db, $action, 'contable_egreso', $body['id_egreso']);
                return;
            }
            foreach (['id_proveedor', 'id_categoria', 'id_concepto'] as $field) {
                e2e_assert_target($db, $action, 'contable_opcion', $body[$field] ?? null);
            }
            return;

        case 'contable_egreso_eliminar':
            e2e_assert_target($db, $action, 'contable_egreso', $body['id_egreso'] ?? null);
            return;

        default:
            e2e_scope_error(
                $action,
                'La acción de escritura todavía no está declarada como segura para Playwright.'
            );
    }
}
