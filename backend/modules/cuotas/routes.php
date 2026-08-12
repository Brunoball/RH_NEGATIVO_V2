<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas.php';

function register_cuotas_routes(Router $router): void
{
    $router->register('cuotas_listar', 'GET', [Cuotas::class, 'listar'], true);
    $router->register('cuotas_catalogos', 'GET', [Cuotas::class, 'catalogos'], true);
    $router->register('cuotas_contexto_pago', 'GET', [Cuotas::class, 'contextoPago'], true);
    $router->register('cuotas_contextos_pago', 'GET', [Cuotas::class, 'contextosPago'], true);
    $router->register('cuotas_registrar_pago', 'POST', [Cuotas::class, 'registrarPago'], true);
    $router->register('cuotas_registrar_pagos', 'POST', [Cuotas::class, 'registrarPagos'], true);
    $router->register('cuotas_condonar_pago', 'POST', [Cuotas::class, 'condonarPago'], true);
    $router->register('cuotas_eliminar_pago', 'POST', [Cuotas::class, 'eliminarPago'], true);

    // Compatibilidad con versiones previas del módulo.
    $router->register('cuotas_registrar_cobro', 'POST', [Cuotas::class, 'registrarCobro'], true);
    $router->register('cuotas_anular', 'POST', [Cuotas::class, 'anular'], true);
}
