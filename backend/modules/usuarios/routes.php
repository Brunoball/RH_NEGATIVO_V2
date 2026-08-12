<?php
declare(strict_types=1);

require_once __DIR__ . '/usuarios.php';

function register_usuarios_routes(Router $router): void
{
    $router->register('usuarios_listar', 'GET', [Usuarios::class, 'listar'], true);
    $router->register('usuarios_guardar', 'POST', [Usuarios::class, 'guardar'], true);
    $router->register('usuarios_cambiar_estado', 'POST', [Usuarios::class, 'cambiarEstado'], true);
    $router->register('usuarios_eliminar', 'POST', [Usuarios::class, 'eliminar'], true);
}
