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

require_once __DIR__ . '/../modules/auth/routes.php';
require_once __DIR__ . '/../modules/dashboard/routes.php';
require_once __DIR__ . '/../modules/socios/routes.php';
require_once __DIR__ . '/../modules/cuotas/routes.php';
require_once __DIR__ . '/../modules/categorias/routes.php';
require_once __DIR__ . '/../modules/configuracion/routes.php';
require_once __DIR__ . '/../modules/usuarios/routes.php';
require_once __DIR__ . '/../modules/contable/routes.php';

// Infraestructura E2E siempre registrada, también en producción. No queda
// abierta al uso normal: exige admin + X-RH-E2E: PLAYWRIGHT + confirmación y
// sólo opera sobre el namespace Playwright. Así LOCAL/HOSTINGER usan el mismo
// backend sin flags secretos ni despliegues especiales.
require_once __DIR__ . '/../modules/testing_cleanup/routes.php';
require_once __DIR__ . '/../modules/testing_safety/routes.php';

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
register_testing_cleanup_routes($router);
register_testing_safety_routes($router);

try {
    $router->dispatch(request_action());
} catch (Throwable $error) {
    error_log($error->__toString());
    $payload = ['exito' => false, 'mensaje' => 'Error interno del servidor.'];
    if (env_bool('APP_DEBUG', false)) $payload['detalle'] = $error->getMessage();
    json_response($payload, 500);
}
