<?php
declare(strict_types=1);

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function api_success(array $payload = [], string $message = 'Operación completada.', int $status = 200): never
{
    json_response(['ok' => true, 'exito' => true, 'mensaje' => $message] + $payload, $status);
}

function api_error(string $message, string $code = 'VALIDATION_ERROR', int $status = 422, array $details = []): never
{
    $payload = [
        'ok' => false,
        'exito' => false,
        'codigo' => $code,
        'mensaje' => $message,
    ];
    if ($details !== []) $payload['detalles'] = $details;
    json_response($payload, $status);
}

function not_implemented(string $module): never
{
    json_response([
        'exito' => false,
        'mensaje' => "El módulo {$module} todavía no tiene lógica de negocio implementada.",
        'codigo' => 'NOT_IMPLEMENTED',
    ], 501);
}
