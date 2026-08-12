<?php
declare(strict_types=1);

require_once __DIR__ . '/categorias.php';

function register_categorias_routes(Router $router): void
{
    $router->register('categorias_listar', 'GET', [Categorias::class, 'listar'], true);
    $router->register('categorias_obtener', 'GET', [Categorias::class, 'obtener'], true);
    $router->register('categorias_guardar', 'POST', [Categorias::class, 'guardar'], true);
    $router->register('categorias_eliminar', 'POST', [Categorias::class, 'darBaja'], true);
    $router->register('categorias_reactivar', 'POST', [Categorias::class, 'reactivar'], true);
    $router->register('categorias_historial', 'GET', [Categorias::class, 'historial'], true);
    $router->register('descuentos_familiares_listar', 'GET', [Categorias::class, 'listarDescuentos'], true);
    $router->register('descuentos_familiares_guardar', 'POST', [Categorias::class, 'guardarDescuento'], true);
    $router->register('descuentos_familiares_eliminar', 'POST', [Categorias::class, 'eliminarDescuento'], true);
}
