<?php
declare(strict_types=1);

require_once __DIR__ . '/dashboard.php';

function register_dashboard_routes(Router $router): void
{
    $router->register('dashboard_resumen', 'GET', [Dashboard::class, 'resumen'], true);
}
