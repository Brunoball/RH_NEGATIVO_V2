<?php
declare(strict_types=1);
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/e2e_guard.php';

final class Router
{
    private array $routes = [];

    public function register(string $action, string $method, callable $handler, bool $protected = true): void
    {
        $this->routes[$action] = [
            'method' => strtoupper($method),
            'handler' => $handler,
            'protected' => $protected,
        ];
    }

    public function dispatch(string $action): never
    {
        if ($action === '' || !isset($this->routes[$action])) {
            json_response([
                'exito' => false,
                'mensaje' => $action === '' ? 'Falta el parámetro action.' : 'Acción no encontrada.',
            ], $action === '' ? 400 : 404);
        }

        $route = $this->routes[$action];
        $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($method !== $route['method']) {
            json_response(['exito' => false, 'mensaje' => 'Método HTTP no permitido.'], 405);
        }

        if ($route['protected']) {
            $auth = require_auth();
            if ($method !== 'GET' && $action !== 'auth_logout' && ($auth['rol'] ?? '') !== 'admin') {
                api_error('Tu usuario es de solo lectura.', 'FORBIDDEN_ROLE', 403);
            }
            if ($method !== 'GET' && ($auth['auth_source'] ?? '') === 'cookie') {
                api_error(
                    'Por seguridad, actualizá la página e iniciá sesión nuevamente antes de modificar información.',
                    'CSRF_PROTECTION',
                    403
                );
            }

            // Si la solicitud pertenece a Playwright, toda escritura queda
            // restringida al namespace E2E. Una acción nueva que no se declare
            // explícitamente segura se bloquea por defecto (fail-closed).
            if ($method !== 'GET') e2e_scope_guard($action, $auth);
        }

        ($route['handler'])();
        json_response(['exito' => true]);
    }
}
