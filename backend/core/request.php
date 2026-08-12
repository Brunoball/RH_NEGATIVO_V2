<?php
declare(strict_types=1);

function request_body(): array
{
    static $body = null;
    if (is_array($body)) return $body;
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return $body = $_POST ?: [];
    $decoded = json_decode($raw, true);
    return $body = is_array($decoded) ? $decoded : ($_POST ?: []);
}

function request_action(): string
{
    $body = request_body();
    return trim((string)($_GET['action'] ?? $_POST['action'] ?? $body['action'] ?? ''));
}
