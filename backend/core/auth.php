<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/../config/db.php';

$GLOBALS['GESTION_SOCIOS_AUTH'] = null;

function application_profile(): array
{
    return [
        'nombre' => (string)env_value('APP_NAME', 'RH Negativo'),
        'slug' => (string)env_value('APP_SLUG', 'rh-negativo'),
        'logo_url' => env_value('APP_LOGO_URL', ''),
        'logo_icono_url' => env_value('APP_LOGO_ICON_URL', ''),
    ];
}

function request_auth_credentials(): array
{
    $authorization = trim((string)($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
    if (stripos($authorization, 'Bearer ') === 0) {
        return ['token' => trim(substr($authorization, 7)), 'source' => 'bearer'];
    }

    $headerToken = trim((string)($_SERVER['HTTP_X_SESSION'] ?? $_SERVER['HTTP_X_SESSION_KEY'] ?? ''));
    if ($headerToken !== '') return ['token' => $headerToken, 'source' => 'header'];

    // La SPA conserva el token únicamente por pestaña y lo envía como Bearer.
    return ['token' => '', 'source' => 'none'];
}

function require_auth(): array
{
    if (is_array($GLOBALS['GESTION_SOCIOS_AUTH'])) return $GLOBALS['GESTION_SOCIOS_AUTH'];

    $credentials = request_auth_credentials();
    $token = $credentials['token'];
    if ($token === '' || strlen($token) > 128) api_error('Sesión requerida.', 'SESSION_REQUIRED', 401);

    $db = app_db();
    $statement = $db->prepare(
        'SELECT
            s.idSesion, s.idUsuario, s.expira_en,
            u.usuario, u.rol, u.activo AS usuario_activo
         FROM sis_sesiones s
         INNER JOIN sis_usuarios u ON u.idUsuario = s.idUsuario
         WHERE s.session_key = :session_key AND s.activo = 1
         LIMIT 1'
    );
    $statement->execute(['session_key' => $token]);
    $row = $statement->fetch();

    if (!$row) api_error('La sesión no existe o fue cerrada.', 'SESSION_REQUIRED', 401);

    if (strtotime((string)$row['expira_en']) <= time()) {
        $db->prepare('UPDATE sis_sesiones SET activo = 0 WHERE idSesion = ?')->execute([(int)$row['idSesion']]);
        api_error('La sesión venció. Iniciá sesión nuevamente.', 'SESSION_EXPIRED', 401);
    }

    if (!(bool)$row['usuario_activo']) {
        $db->prepare('UPDATE sis_sesiones SET activo = 0 WHERE idUsuario = ?')->execute([(int)$row['idUsuario']]);
        api_error('El usuario se encuentra deshabilitado.', 'USER_DISABLED', 403);
    }

    $db->prepare(
        'UPDATE sis_sesiones
         SET ultimo_uso = NOW()
         WHERE idSesion = ?
           AND (ultimo_uso IS NULL OR ultimo_uso < DATE_SUB(NOW(), INTERVAL 1 MINUTE))'
    )->execute([(int)$row['idSesion']]);

    $organization = application_profile();
    $userId = (int)$row['idUsuario'];
    $context = [
        'id_sesion' => (int)$row['idSesion'],
        'session_key' => $token,
        'auth_source' => $credentials['source'],
        'id_usuario' => $userId,

        // Alias conservado porque varias tablas funcionales ya poseen columnas
        // id_usuario_master. Ahora representa al usuario de esta única base.
        'id_usuario_master' => $userId,
        'usuario' => (string)$row['usuario'],
        'rol' => (string)$row['rol'],
        'organizacion' => $organization,
        'db' => $db,
    ];

    $GLOBALS['GESTION_SOCIOS_AUTH'] = $context;
    return $context;
}

function auth_context(): array
{
    return require_auth();
}

function require_admin(): array
{
    $auth = require_auth();
    if ($auth['rol'] !== 'admin') api_error('Tu usuario es de solo lectura.', 'FORBIDDEN_ROLE', 403);
    return $auth;
}

function public_auth_profile(array $auth): array
{
    return [
        'usuario' => [
            'id' => $auth['id_usuario'],
            'nombre' => $auth['usuario'],
            'rol' => $auth['rol'],
        ],
        'organizacion' => $auth['organizacion'],
    ];
}
