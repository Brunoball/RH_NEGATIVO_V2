<?php
declare(strict_types=1);

function fail(string $message, int $code = 1): never {
    fwrite(STDERR, $message . PHP_EOL);
    exit($code);
}

function parse_env_file(string $path): array {
    if (!is_file($path)) fail("No se encontró el .env del backend: {$path}");
    $values = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        if (strlen($value) >= 2 && (($value[0] === '"' && $value[-1] === '"') || ($value[0] === "'" && $value[-1] === "'"))) {
            $value = substr($value, 1, -1);
        }
        $values[$key] = $value;
    }
    return $values;
}

$operation = $argv[1] ?? '';
$value = $argv[2] ?? '';
$allowed = ['family-prefix', 'user-prefix', 'login-prefix', 'category-prefix', 'discount-thresholds', 'audit-actions'];
if (!in_array($operation, $allowed, true)) fail('Operación de limpieza no válida.');

if (
    $operation === 'family-prefix'
    && !str_starts_with($value, 'PW E2E FAM ')
    && !str_starts_with($value, 'PW EE FAM ')
) {
    fail('Prefijo de familias inválido.');
}
if (in_array($operation, ['user-prefix', 'login-prefix'], true) && !str_starts_with($value, 'pw_e2e_')) {
    fail('Prefijo de usuarios inválido.');
}
if (
    $operation === 'category-prefix'
    && !str_starts_with($value, 'PW E2E CAT ')
    && !str_starts_with($value, 'PW EE CAT ')
) {
    fail('Prefijo de categorías inválido.');
}
if ($operation === 'discount-thresholds') {
    $thresholds = array_values(array_unique(array_filter(
        array_map('intval', explode(',', $value)),
        static fn(int $item): bool => $item >= 2 && $item <= 50
    )));
    if ($thresholds === [] || count($thresholds) > 49) {
        fail('Umbrales de descuentos inválidos.');
    }
}
if ($operation === 'audit-actions' && !preg_match('/^(categorias|descuentos_familiares):([1-9][0-9]*)$/', $value, $auditMatch)) {
    fail('Consulta de auditoría inválida.');
}

$backendDir = getenv('PW_BACKEND_DIR') ?: realpath(__DIR__ . '/../../../backend');
if (!$backendDir || !is_dir($backendDir)) fail('No se pudo localizar la carpeta backend.');
$env = parse_env_file($backendDir . DIRECTORY_SEPARATOR . '.env');

$appEnv = strtolower((string)($env['APP_ENV'] ?? ''));
$allow = strtolower((string)(getenv('PW_ALLOW_DB_CLEANUP') ?: 'false'));
if ($appEnv !== 'local' && !in_array($allow, ['1', 'true', 'yes', 'si'], true)) {
    fail('Limpieza directa bloqueada: APP_ENV no es local.');
}

$host = $env['DB_HOST'] ?? 'localhost';
$port = (int)($env['DB_PORT'] ?? 3306);
$name = $env['DB_NAME'] ?? '';
$user = $env['DB_USER'] ?? '';
$pass = $env['DB_PASS'] ?? '';
if ($name === '') fail('DB_NAME no está configurado.');

$pdo = new PDO(
    "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4",
    $user,
    $pass,
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]
);

if ($operation === 'audit-actions') {
    [$auditTable, $auditId] = explode(':', $value, 2);
    $statement = $pdo->prepare(
        'SELECT accion, descripcion, creado_en
         FROM auditoria
         WHERE tabla_afectada = ? AND id_registro = ?
         ORDER BY id_auditoria ASC'
    );
    $statement->execute([$auditTable, $auditId]);
    echo json_encode($statement->fetchAll(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
    exit(0);
}

$pdo->beginTransaction();
try {
    if ($operation === 'category-prefix') {
        $find = $pdo->prepare('SELECT id_categoria FROM categorias WHERE nombre LIKE ? FOR UPDATE');
        $find->execute([$value . '%']);
        $ids = array_map('intval', array_column($find->fetchAll(), 'id_categoria'));
        if ($ids !== []) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $auditParams = array_merge(['categorias'], array_map('strval', $ids));
            $pdo->prepare(
                "DELETE FROM auditoria WHERE tabla_afectada = ? AND id_registro IN ({$placeholders})"
            )->execute($auditParams);
            $pdo->prepare(
                "DELETE FROM categorias_historial_precios WHERE id_categoria IN ({$placeholders})"
            )->execute($ids);
            $pdo->prepare("DELETE FROM categorias WHERE id_categoria IN ({$placeholders})")->execute($ids);
        }
        $pdo->commit();
        echo 'Categorías eliminadas: ' . count($ids) . PHP_EOL;
        exit(0);
    }

    if ($operation === 'discount-thresholds') {
        $placeholders = implode(',', array_fill(0, count($thresholds), '?'));
        $find = $pdo->prepare(
            "SELECT id_descuento_familiar FROM descuentos_familiares
             WHERE cantidad_integrantes_desde IN ({$placeholders})
               AND descripcion LIKE 'PW E2E DESCUENTO GLOBAL %'
             FOR UPDATE"
        );
        $find->execute($thresholds);
        $ids = array_map('intval', array_column($find->fetchAll(), 'id_descuento_familiar'));
        if ($ids !== []) {
            $idPlaceholders = implode(',', array_fill(0, count($ids), '?'));
            $auditParams = array_merge(['descuentos_familiares'], array_map('strval', $ids));
            $pdo->prepare(
                "DELETE FROM auditoria WHERE tabla_afectada = ? AND id_registro IN ({$idPlaceholders})"
            )->execute($auditParams);
        }
        $delete = $pdo->prepare(
            "DELETE FROM descuentos_familiares
             WHERE cantidad_integrantes_desde IN ({$placeholders})
               AND descripcion LIKE 'PW E2E DESCUENTO GLOBAL %'"
        );
        $delete->execute($thresholds);
        $count = $delete->rowCount();
        $pdo->commit();
        echo 'Descuentos eliminados: ' . $count . PHP_EOL;
        exit(0);
    }

    if ($operation === 'family-prefix') {
        $find = $pdo->prepare('SELECT id_familia FROM familias WHERE nombre LIKE ? FOR UPDATE');
        $find->execute([$value . '%']);
        $ids = array_map('intval', array_column($find->fetchAll(), 'id_familia'));
        if ($ids !== []) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $pdo->prepare("DELETE FROM familias_socios WHERE id_familia IN ({$placeholders})")->execute($ids);
            $pdo->prepare("DELETE FROM familias WHERE id_familia IN ({$placeholders})")->execute($ids);
        }
        $pdo->commit();
        echo 'Familias eliminadas: ' . count($ids) . PHP_EOL;
        exit(0);
    }

    if ($operation === 'login-prefix') {
        $delete = $pdo->prepare('DELETE FROM sis_login_auditoria WHERE usuario LIKE ?');
        $delete->execute([$value . '%']);
        $count = $delete->rowCount();
        $pdo->commit();
        echo 'Auditorías eliminadas: ' . $count . PHP_EOL;
        exit(0);
    }

    $find = $pdo->prepare('SELECT idUsuario FROM sis_usuarios WHERE usuario LIKE ? FOR UPDATE');
    $find->execute([$value . '%']);
    $ids = array_map('intval', array_column($find->fetchAll(), 'idUsuario'));
    if ($ids !== []) {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $pdo->prepare("DELETE FROM sis_sesiones WHERE idUsuario IN ({$placeholders})")->execute($ids);
        $pdo->prepare("DELETE FROM sis_login_auditoria WHERE idUsuario IN ({$placeholders})")->execute($ids);
        $pdo->prepare("DELETE FROM sis_usuarios WHERE idUsuario IN ({$placeholders})")->execute($ids);
    }
    // También se limpian intentos de usuarios inexistentes que compartan el prefijo.
    $pdo->prepare('DELETE FROM sis_login_auditoria WHERE usuario LIKE ?')->execute([$value . '%']);
    $pdo->commit();
    echo 'Usuarios eliminados: ' . count($ids) . PHP_EOL;
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fail($error->getMessage());
}
