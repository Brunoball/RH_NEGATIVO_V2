<?php
declare(strict_types=1);
require_once __DIR__ . '/env.php';

$origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
$isProduction = strtolower((string)env_value('APP_ENV', 'production')) === 'production';
$defaultOrigins = $isProduction ? '' : 'http://localhost:3000';
$allowed = array_values(array_filter(array_map('trim', explode(',', (string)env_value('ALLOWED_ORIGINS', $defaultOrigins)))));

$isLoopbackOrigin = preg_match(
    '#^http://(?:localhost|127\.0\.0\.1|\[::1\]):\d+$#',
    $origin
) === 1;

// El frontend local normal de RH se desarrolla en :3000 y debe poder consumir
// la API real de Hostinger sin activar el modo E2E.
$isLocalFrontendOrigin = in_array(
    $origin,
    ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'],
    true
);

$isLocalDevelopmentOrigin = !$isProduction && $isLoopbackOrigin;

// Playwright conserva su permiso explícito para cualquier puerto loopback,
// porque el runner envía X-RH-E2E y el backend aplica además sus guardas E2E.
$requestedHeaders = strtolower((string)($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] ?? ''));
$isE2ERequest = strtoupper(trim((string)($_SERVER['HTTP_X_RH_E2E'] ?? ''))) === 'PLAYWRIGHT'
    || str_contains($requestedHeaders, 'x-rh-e2e');
$isPlaywrightLocalOrigin = $isProduction && $isLoopbackOrigin && $isE2ERequest;

$isAllowed = $origin !== '' && (
    $isLocalFrontendOrigin
    || $isLocalDevelopmentOrigin
    || $isPlaywrightLocalOrigin
    || in_array($origin, $allowed, true)
);

if (!headers_sent()) {
    if ($isAllowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
    }
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Accept, Content-Type, Authorization, X-Session, X-Session-Key, X-CSRF-Token, X-RH-E2E');
    header('Content-Type: application/json; charset=utf-8');
}

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
    http_response_code(204);
    exit;
}
