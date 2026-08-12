<?php
declare(strict_types=1);

require_once __DIR__ . '/testing_cleanup.php';

function register_testing_cleanup_routes(Router $router): void
{
    $router->register('e2e_cleanup', 'POST', [TestingCleanup::class, 'run'], true);
}
