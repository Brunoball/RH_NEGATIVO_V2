<?php
declare(strict_types=1);

require_once __DIR__ . '/env.php';

function pdo_connection(string $host, int $port, string $database, string $user, string $password): PDO
{
    if ($database === '') {
        throw new RuntimeException('La variable DB_NAME no puede estar vacía.');
    }

    $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";
    return new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

/**
 * Única conexión de la aplicación.
 *
 * El proyecto dejó de resolver organizaciones mediante una base maestra: autenticación,
 * sesiones, auditoría y módulos funcionales trabajan sobre la misma base.
 */
function app_db(): PDO
{
    static $connection = null;
    if ($connection instanceof PDO) return $connection;

    $connection = pdo_connection(
        (string)env_value('DB_HOST', 'localhost'),
        (int)env_value('DB_PORT', '3306'),
        (string)env_value('DB_NAME', 'rh_neg_v2'),
        (string)env_value('DB_USER', 'root'),
        (string)env_value('DB_PASS', '')
    );

    return $connection;
}
