<?php
declare(strict_types=1);

function load_env_file(?string $path = null): void
{
    static $loaded = false;
    if ($loaded) return;
    $loaded = true;
    $path ??= dirname(__DIR__) . '/.env';
    if (!is_file($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$key, $value] = array_map('trim', explode('=', $line, 2));
        $value = trim($value, "\"' 	");
        if ($key !== '' && getenv($key) === false) putenv($key . '=' . $value);
    }
}

function env_value(string $key, ?string $default = null): ?string
{
    load_env_file();
    $value = getenv($key);
    return $value === false ? $default : $value;
}

function env_bool(string $key, bool $default = false): bool
{
    $value = env_value($key);
    if ($value === null) return $default;
    return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
}
