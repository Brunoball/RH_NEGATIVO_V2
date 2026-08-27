<?php
declare(strict_types=1);

require_once __DIR__ . '/testing_safety.php';

function register_testing_safety_routes(Router $router): void
{
    $router->register('e2e_guard_probe', 'POST', [TestingSafety::class, 'probe'], true);
    $router->register('e2e_residuos', 'GET', [TestingSafety::class, 'residuos'], true);
    $router->register('e2e_integridad', 'GET', [TestingSafety::class, 'integridad'], true);
}
