<?php
declare(strict_types=1);

require_once __DIR__ . '/socios.php';
require_once __DIR__ . '/familias.php';

function register_socios_routes(Router $router): void
{
    $router->register('socios_listar', 'GET', [Socios::class, 'listar'], true);
    $router->register('socios_obtener', 'GET', [Socios::class, 'obtener'], true);
    $router->register('socios_historial', 'GET', [Socios::class, 'historial'], true);
    $router->register('socios_guardar', 'POST', [Socios::class, 'guardar'], true);
    $router->register('socios_eliminar', 'POST', [Socios::class, 'darBaja'], true);
    $router->register('socios_eliminar_definitivo', 'POST', [Socios::class, 'eliminarDefinitivo'], true);
    $router->register('socios_reactivar', 'POST', [Socios::class, 'reactivar'], true);

    $router->register('familias_listar', 'GET', [Familias::class, 'listar'], true);
    $router->register('familias_obtener', 'GET', [Familias::class, 'obtener'], true);
    $router->register('familias_guardar', 'POST', [Familias::class, 'guardar'], true);
    $router->register('familias_eliminar', 'POST', [Familias::class, 'darBaja'], true);
    $router->register('familias_eliminar_definitivo', 'POST', [Familias::class, 'eliminarDefinitivo'], true);
    $router->register('familias_reactivar', 'POST', [Familias::class, 'reactivar'], true);
}
