<?php
declare(strict_types=1);

require_once __DIR__ . '/env.php';

function pdo_connection(string $host, int $port, string $database, string $user, string $password): PDO
{
    if ($database === '') {
        throw new RuntimeException('La variable DB_NAME no puede estar vacía.');
    }

    $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";
    $attempts = 3;
    $lastError = null;

    for ($attempt = 1; $attempt <= $attempts; $attempt++) {
        try {
            $connection = new PDO($dsn, $user, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_TIMEOUT => 5,
            ]);

            // PHP y MySQL/MariaDB mantienen zonas horarias independientes.
            // En Hostinger la sesión SQL puede quedar en UTC aunque PHP use
            // America/Argentina/Cordoba, haciendo que CURDATE()/NOW() salten
            // al día siguiente entre las 21:00 y las 00:00 de Argentina.
            // Sincronizamos cada conexión con APP_TIMEZONE usando un offset
            // numérico para no depender de que el servidor tenga cargadas las
            // tablas de zonas horarias de MySQL/MariaDB.
            $appTimezoneName = (string)env_value('APP_TIMEZONE', 'America/Argentina/Cordoba');
            try {
                $appTimezone = new DateTimeZone($appTimezoneName);
            } catch (Throwable $error) {
                throw new RuntimeException(
                    'La variable APP_TIMEZONE no contiene una zona horaria válida.',
                    0,
                    $error
                );
            }
            $dbTimezoneOffset = (new DateTimeImmutable('now', $appTimezone))->format('P');
            $connection->exec('SET SESSION time_zone = ' . $connection->quote($dbTimezoneOffset));

            return $connection;
        } catch (PDOException $error) {
            $lastError = $error;
            $message = strtolower($error->getMessage());
            $transient = str_contains($message, '[2002]')
                || str_contains($message, 'connection refused')
                || str_contains($message, 'operation not permitted')
                || str_contains($message, 'too many connections')
                || str_contains($message, 'connection timed out')
                || str_contains($message, 'server has gone away');

            if (!$transient || $attempt >= $attempts) throw $error;
            usleep(150000 * $attempt);
        }
    }

    throw $lastError ?? new RuntimeException('No se pudo abrir la conexión a MySQL.');
}

/**
 * Única conexión de la aplicación.
 *
 * Es un sistema personalizado con una única base: autenticación, sesiones,
 * auditoría y módulos funcionales trabajan sobre rh_neg_v2.
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
