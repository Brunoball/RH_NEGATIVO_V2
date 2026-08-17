<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/env.php';
require_once __DIR__ . '/../config/cors.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../core/http.php';
require_once __DIR__ . '/../core/request.php';
require_once __DIR__ . '/../core/auth.php';
require_once __DIR__ . '/../core/router.php';
require_once __DIR__ . '/../core/domain.php';

// Base reutilizada para RH Negativo. El login, las sesiones y la gestión de
// usuarios ya trabajan sobre rh_neg_v2; los módulos funcionales se conservan
// para ser adaptados a la nueva estructura de datos en las próximas etapas.
require_once __DIR__ . '/../modules/auth/routes.php';
require_once __DIR__ . '/../modules/dashboard/routes.php';
require_once __DIR__ . '/../modules/socios/routes.php';
require_once __DIR__ . '/../modules/cuotas/routes.php';
require_once __DIR__ . '/../modules/categorias/routes.php';
require_once __DIR__ . '/../modules/configuracion/routes.php';
require_once __DIR__ . '/../modules/usuarios/routes.php';
require_once __DIR__ . '/../modules/contable/routes.php';

$appEnv = strtolower(trim((string)env_value('APP_ENV', 'production')));
$e2eCleanupEnabled = in_array($appEnv, ['local', 'dev', 'development', 'test', 'testing'], true)
    || env_bool('ENABLE_E2E_CLEANUP', false);

if ($e2eCleanupEnabled) {
    require_once __DIR__ . '/../modules/testing_cleanup/routes.php';
}

date_default_timezone_set((string)env_value('APP_TIMEZONE', 'America/Argentina/Cordoba'));
ini_set('display_errors', env_bool('APP_DEBUG', false) ? '1' : '0');

$router = new Router();
$router->register('health', 'GET', static function () {
    json_response([
        'exito' => true,
        'servicio' => 'rh-negativo-api',
        'estado' => 'ok',
        'fecha' => date(DATE_ATOM),
    ]);
}, false);

register_auth_routes($router);
register_dashboard_routes($router);
register_socios_routes($router);
register_cuotas_routes($router);
register_categorias_routes($router);
register_configuracion_routes($router);
register_usuarios_routes($router);
register_contable_routes($router);

if ($e2eCleanupEnabled) {
    register_testing_cleanup_routes($router);
}

try {
    $router->dispatch(request_action());
} catch (Throwable $error) {
    error_log($error->__toString());
    $payload = ['exito' => false, 'mensaje' => 'Error interno del servidor.'];
    if (env_bool('APP_DEBUG', false)) $payload['detalle'] = $error->getMessage();
    json_response($payload, 500);
}
