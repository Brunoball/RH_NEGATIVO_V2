<?php
declare(strict_types=1);
require_once __DIR__ . '/env.php';

$origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
$isProduction = strtolower((string)env_value('APP_ENV', 'production')) === 'production';
$defaultOrigins = $isProduction ? '' : 'http://localhost:3000';
$allowed = array_values(array_filter(array_map('trim', explode(',', (string)env_value('ALLOWED_ORIGINS', $defaultOrigins)))));
$isLocal = !$isProduction && preg_match('#^http://(localhost|127\.0\.0\.1):\d+$#', $origin) === 1;
$isAllowed = $origin !== '' && ($isLocal || in_array($origin, $allowed, true));

if (!headers_sent()) {
    if ($isAllowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
    }
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Accept, Content-Type, Authorization, X-Session, X-Session-Key, X-CSRF-Token');
    header('Content-Type: application/json; charset=utf-8');
}

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
    http_response_code(204);
    exit;
}
