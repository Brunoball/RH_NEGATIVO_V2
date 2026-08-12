<?php
declare(strict_types=1);

require_once __DIR__ . '/contable.php';

function register_contable_routes(Router $router): void
{
    $router->register('contable_resumen', 'GET', [Contable::class, 'resumen'], true);
    $router->register('contable_catalogos', 'GET', [Contable::class, 'catalogos'], true);
    $router->register('contable_opciones_configuracion', 'GET', [Contable::class, 'opcionesConfiguracion'], true);
    $router->register('contable_ingresos_socios', 'GET', [Contable::class, 'listarIngresosSocios'], true);
    $router->register('contable_ingresos_listar', 'GET', [Contable::class, 'listarIngresos'], true);
    $router->register('contable_egresos_listar', 'GET', [Contable::class, 'listarEgresos'], true);
    $router->register('contable_opcion_guardar', 'POST', [Contable::class, 'guardarOpcion'], true);
    $router->register('contable_opcion_cambiar_estado', 'POST', [Contable::class, 'cambiarEstadoOpcion'], true);
    $router->register('contable_opcion_eliminar', 'POST', [Contable::class, 'eliminarOpcion'], true);
    $router->register('contable_ingreso_guardar', 'POST', [Contable::class, 'guardarIngreso'], true);
    $router->register('contable_ingreso_eliminar', 'POST', [Contable::class, 'eliminarIngreso'], true);
    $router->register('contable_egreso_guardar', 'POST', [Contable::class, 'guardarEgreso'], true);
    $router->register('contable_egreso_eliminar', 'POST', [Contable::class, 'eliminarEgreso'], true);
    $router->register('contable_egreso_archivo', 'GET', [Contable::class, 'archivoEgreso'], true);
}
