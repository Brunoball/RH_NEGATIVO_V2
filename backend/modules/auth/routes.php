<?php
declare(strict_types=1);

// Dependencias explícitas: además de asegurar la carga directa del módulo,
// permiten que los analizadores de VS Code resuelvan correctamente los helpers.
require_once __DIR__ . '/../../core/auth.php';
require_once __DIR__ . '/../../core/domain.php';
require_once __DIR__ . '/../../core/request.php';
require_once __DIR__ . '/../../core/router.php';

function auth_login_audit(PDO $db, ?array $candidate, string $usuario, bool $success): void
{
    try {
        $statement = $db->prepare(
            'INSERT INTO sis_login_auditoria (idUsuario, usuario, ip, user_agent, exito)
             VALUES (:id_usuario, :usuario, :ip, :agente, :exito)'
        );
        $statement->execute([
            'id_usuario' => $candidate['idUsuario'] ?? null,
            'usuario' => substr($usuario, 0, 100),
            'ip' => client_ip(),
            'agente' => client_user_agent(),
            'exito' => $success ? 1 : 0,
        ]);
    } catch (Throwable $error) {
        error_log('No se pudo registrar login_auditoria: ' . $error->getMessage());
    }
}

function auth_login_lock_status(PDO $db, string $usuario): array
{
    try {
        $statement = $db->prepare(
            "SELECT
                idLog,
                GREATEST(
                    0,
                    TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(creado_en, INTERVAL 15 MINUTE))
                ) AS reintentar_en_segundos
             FROM sis_login_auditoria
             WHERE usuario = :usuario_fallos
               AND exito = 0
               AND idLog > COALESCE((
                   SELECT MAX(exitoso.idLog)
                   FROM sis_login_auditoria exitoso
                   WHERE exitoso.usuario = :usuario_exitos
                     AND exitoso.exito = 1
               ), 0)
               AND creado_en > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
             ORDER BY idLog DESC
             LIMIT 5"
        );
        $statement->execute([
            'usuario_fallos' => $usuario,
            'usuario_exitos' => $usuario,
        ]);
        $attempts = $statement->fetchAll();

        if (count($attempts) < 5) {
            return [
                'bloqueado' => false,
                'intentos_fallidos' => count($attempts),
                'reintentar_en_segundos' => 0,
            ];
        }

        $retryAfter = max(0, (int)($attempts[0]['reintentar_en_segundos'] ?? 0));
        return [
            'bloqueado' => $retryAfter > 0,
            'intentos_fallidos' => count($attempts),
            'reintentar_en_segundos' => $retryAfter,
        ];
    } catch (Throwable $error) {
        // El login no queda inutilizable si todavía falta aplicar el SQL.
        error_log('No se pudo verificar el bloqueo de login: ' . $error->getMessage());
        return [
            'bloqueado' => false,
            'intentos_fallidos' => 0,
            'reintentar_en_segundos' => 0,
        ];
    }
}

function auth_reject_locked_login(array $lock): never
{
    $seconds = max(1, (int)($lock['reintentar_en_segundos'] ?? 900));
    $minutes = max(1, (int)ceil($seconds / 60));
    header('Retry-After: ' . $seconds);
    api_error(
        "Demasiados intentos fallidos. Este usuario está bloqueado. Intentá nuevamente en {$minutes} minuto" . ($minutes === 1 ? '.' : 's.'),
        'LOGIN_LOCKED',
        429,
        ['reintentar_en_segundos' => $seconds]
    );
}

function auth_cookie(string $token, int $expires): void
{
    $secure = env_bool('SESSION_COOKIE_SECURE', (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'));
    setcookie((string)env_value('SESSION_COOKIE_NAME', 'rh_negativo_session'), $token, [
        'expires' => $expires,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => $secure ? 'None' : 'Lax',
    ]);
}

function auth_normalize_legacy_hash(string $stored): string
{
    // PHP utiliza el prefijo $2y$ para bcrypt. Algunos registros históricos
    // fueron generados por Node y poseen $2a$/$2b$; son el mismo formato.
    if (str_starts_with($stored, '$2a$') || str_starts_with($stored, '$2b$')) {
        return '$2y$' . substr($stored, 4);
    }
    return $stored;
}

function auth_password_matches(string $password, string $stored): bool
{
    $normalized = auth_normalize_legacy_hash($stored);
    $info = password_get_info($normalized);
    $isPasswordHash = ($info['algoName'] ?? 'unknown') !== 'unknown';

    return $isPasswordHash
        ? password_verify($password, $normalized)
        : hash_equals($stored, $password);
}

function auth_upgrade_password_if_needed(PDO $db, array $user, string $password): void
{
    $stored = (string)$user['hash_contrasena'];
    $normalized = auth_normalize_legacy_hash($stored);
    $info = password_get_info($normalized);
    $isPasswordHash = ($info['algoName'] ?? 'unknown') !== 'unknown';
    $legacyPrefix = $normalized !== $stored;

    if (!$isPasswordHash || $legacyPrefix || password_needs_rehash($normalized, PASSWORD_DEFAULT)) {
        $db->prepare('UPDATE sis_usuarios SET hash_contrasena = ? WHERE idUsuario = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), (int)$user['idUsuario']]);
    }
}

function auth_login(): never
{
    $body = request_body();
    $usuario = clean_text($body['usuario'] ?? '', 100, false);
    $password = (string)($body['contrasena'] ?? '');
    if ($usuario === '' || $password === '') api_error('Ingresá usuario y contraseña.', 'VALIDATION_ERROR');
    if (strlen($password) > 255) api_error('Las credenciales no son válidas.', 'INVALID_CREDENTIALS', 401);

    $db = app_db();
    $lock = auth_login_lock_status($db, $usuario);
    if ($lock['bloqueado']) auth_reject_locked_login($lock);

    $statement = $db->prepare(
        'SELECT idUsuario, usuario, hash_contrasena, rol, activo AS usuario_activo
         FROM sis_usuarios
         WHERE usuario = :usuario
         LIMIT 1'
    );
    $statement->execute(['usuario' => $usuario]);
    $user = $statement->fetch();

    if (!$user || !auth_password_matches($password, (string)$user['hash_contrasena'])) {
        auth_login_audit($db, $user ?: null, $usuario, false);
        $lock = auth_login_lock_status($db, $usuario);
        if ($lock['bloqueado']) auth_reject_locked_login($lock);
        api_error('Usuario o contraseña incorrectos.', 'INVALID_CREDENTIALS', 401);
    }

    if (!(bool)$user['usuario_activo']) {
        auth_login_audit($db, $user, $usuario, false);
        api_error('El usuario se encuentra deshabilitado.', 'USER_DISABLED', 403);
    }

    auth_upgrade_password_if_needed($db, $user, $password);

    $hours = max(1, min(168, (int)env_value('SESSION_HOURS', '12')));
    $expiresAt = (new DateTimeImmutable())->modify("+{$hours} hours");
    $token = bin2hex(random_bytes(32));
    $insert = $db->prepare(
        'INSERT INTO sis_sesiones (session_key, idUsuario, expira_en, ultimo_uso, ip, user_agent, activo)
         VALUES (:token, :usuario, :expira, NOW(), :ip, :agente, 1)'
    );
    $insert->execute([
        'token' => $token,
        'usuario' => (int)$user['idUsuario'],
        'expira' => $expiresAt->format('Y-m-d H:i:s'),
        'ip' => client_ip(),
        'agente' => client_user_agent(),
    ]);

    // Se utiliza el token Bearer por pestaña; se elimina cualquier cookie vieja.
    auth_cookie('', time() - 3600);
    auth_login_audit($db, $user, $usuario, true);

    api_success([
        'token' => $token,
        'expira_en' => $expiresAt->format(DATE_ATOM),
        'usuario' => [
            'id' => (int)$user['idUsuario'],
            'nombre' => (string)$user['usuario'],
            'rol' => (string)$user['rol'],
        ],
        'organizacion' => application_profile(),
    ], 'Sesión iniciada correctamente.');
}

function auth_current(): never
{
    api_success(public_auth_profile(auth_context()));
}

function auth_logout(): never
{
    $auth = auth_context();
    app_db()->prepare('UPDATE sis_sesiones SET activo = 0 WHERE idSesion = ?')->execute([$auth['id_sesion']]);
    auth_cookie('', time() - 3600);
    api_success([], 'Sesión cerrada correctamente.');
}

function register_auth_routes(Router $router): void
{
    $router->register('auth_login', 'POST', 'auth_login', false);
    $router->register('auth_usuario_actual', 'GET', 'auth_current', true);
    $router->register('auth_logout', 'POST', 'auth_logout', true);
}
