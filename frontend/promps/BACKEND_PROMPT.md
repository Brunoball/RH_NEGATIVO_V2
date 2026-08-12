# PROMPT OFICIAL BACKEND — Mesas de Examen 3Devs

Necesito que desarrolles un módulo backend PHP para mi sistema Mesas de Examen 3Devs
respetando EXACTAMENTE esta arquitectura.

---

## Stack

- PHP puro (sin frameworks).
- MySQL.
- PDO con prepared statements siempre.
- Router central: `backend/routes/api.php`.
- Conexión central: `backend/config/db.php` (singleton, función `db()`).
- Helpers globales en `backend/core/`.
- Configuración mediante `backend/.env` cargado por `backend/config/env.php`.

---

## Archivos base del sistema (ya existen, no recrear)

### `backend/config/env.php`
Carga el archivo `.env` al inicio del ciclo de request. Lee cada línea
y la pone en `$_ENV`. Ignorar líneas vacías y comentarios `#`.

### `backend/config/db.php`
Implementa la función `db(): PDO` como singleton.
Obtiene credenciales desde `$_ENV['DB_HOST']`, `DB_NAME`, `DB_USER`, `DB_PASS`.
Configura PDO con:
- `PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION`
- `PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC`
- `PDO::ATTR_EMULATE_PREPARES => false`
- charset utf8mb4

Nunca usar `global $pdo`. Siempre llamar `db()`.

### `backend/config/cors.php`
Envía los headers CORS correctos según el origen permitido definido en `.env`
(`ALLOWED_ORIGIN`). Nunca usar `*` si hay credenciales.
Maneja el preflight `OPTIONS` respondiendo 204 y terminando la ejecución.

### `backend/core/helpers.php`

```php
// Respuesta JSON con HTTP status code correcto
function json_response(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// Log de error en servidor (nunca exponer getMessage() al cliente)
function log_error(Throwable $e, string $contexto = ''): void {
    $linea = date('Y-m-d H:i:s') . " [$contexto] " . $e->getMessage()
           . " en " . $e->getFile() . ":" . $e->getLine() . PHP_EOL;
    error_log($linea, 3, __DIR__ . '/../logs/app.log');
}

// Obtener body JSON del request
function request_body(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?? [];
}

// Obtener parámetro de paginación con valor por defecto
function paginacion(): array {
    $pagina    = max(1, (int)($_GET['pagina'] ?? 1));
    $porPagina = min(100, max(1, (int)($_GET['por_pagina'] ?? 20)));
    $offset    = ($pagina - 1) * $porPagina;
    return ['pagina' => $pagina, 'por_pagina' => $porPagina, 'offset' => $offset];
}
```

### `backend/core/auth.php`

```php
// Verifica que el request tenga sesión activa o JWT válido.
// Si no, responde 401 y termina.
function require_auth(): void {
    // Adaptar según el sistema de sesión elegido (session_start / JWT).
    // Ejemplo con sesión PHP:
    session_start();
    if (empty($_SESSION['usuario_id'])) {
        json_response(['exito' => false, 'mensaje' => 'No autorizado.'], 401);
    }
}

// Devuelve el ID del usuario autenticado
function usuario_id(): int {
    return (int)($_SESSION['usuario_id'] ?? 0);
}
```

### `backend/core/csrf.php`

```php
// Genera y guarda token CSRF en sesión
function csrf_token(): string {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

// Valida el token CSRF enviado en header X-CSRF-Token
function validar_csrf(): void {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!hash_equals($_SESSION['csrf_token'] ?? '', $token)) {
        json_response(['exito' => false, 'mensaje' => 'Token CSRF inválido.'], 403);
    }
}
```

### `backend/routes/api.php`
El router central recibe el parámetro `action` del request.
**Antes de routear cualquier módulo privado, llama a `require_auth()`.**
**En requests POST/PUT/DELETE privados, llama a `validar_csrf()`.**
Incluye cada `route.php` de módulo y llama a su función `route_*`.
Si ningún módulo atiende la acción, responde 404.

```php
<?php
require_once __DIR__ . '/../config/env.php';
require_once __DIR__ . '/../config/cors.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../core/helpers.php';
require_once __DIR__ . '/../core/auth.php';
require_once __DIR__ . '/../core/csrf.php';

$action = trim($_REQUEST['action'] ?? '');

// Acciones públicas (sin auth)
$acciones_publicas = ['auth_login', 'auth_csrf_token'];

if (!in_array($action, $acciones_publicas, true)) {
    require_auth();
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        validar_csrf();
    }
}

// Incluir y routear módulos
require_once __DIR__ . '/../modules/auth/route.php';
require_once __DIR__ . '/../modules/NOMBRE_MODULO/route.php';
// ... más módulos

if (route_auth($action))          exit;
if (route_nombre_modulo($action)) exit;
// ... más módulos

json_response(['exito' => false, 'mensaje' => 'Acción no encontrada.'], 404);
```

---

## Estructura obligatoria del módulo

Para un módulo llamado `NOMBRE_MODULO`, crear:

```txt
backend/modules/NOMBRE_MODULO/
  route.php
  NOMBRE_MODULO_controller.php
```

Si el módulo es grande, separar en controladores específicos:

```txt
backend/modules/NOMBRE_MODULO/
  route.php
  principal_controller.php
  filtros_controller.php
  reportes_controller.php
```

---

## Reglas obligatorias

### 1. Prefijo de módulo en cada acción

Ejemplo para módulo `docentes`:
- `docentes_listar`
- `docentes_obtener`
- `docentes_guardar`
- `docentes_eliminar`
- `docentes_cambiar_estado`
- `docentes_catalogos`

### 2. Función de routing

```php
function route_nombre_modulo(string $action): bool {
    switch ($action) {
        case 'nombre_modulo_listar':
            nombre_modulo_listar();
            return true;
        // ...
    }
    return false;
}
```

### 3. Respuestas JSON con HTTP status code correcto

Éxito:
```php
json_response([
    'exito'   => true,
    'mensaje' => 'Operación realizada.',
    'data'    => []
], 200);
```

Error de validación (input incorrecto):
```php
json_response([
    'exito'   => false,
    'mensaje' => 'El campo nombre es obligatorio.'
], 422);
```

Error de servidor (NUNCA exponer getMessage() al cliente):
```php
} catch (Throwable $e) {
    log_error($e, 'nombre_modulo_guardar');
    json_response([
        'exito'   => false,
        'mensaje' => 'Error interno. Intente nuevamente.'
    ], 500);
}
```

### 4. Usar siempre `db()`, nunca `global $pdo`

```php
$pdo = db();
$stmt = $pdo->prepare("SELECT * FROM tabla WHERE id = ?");
$stmt->execute([$id]);
```

### 5. Paginación obligatoria en `listar`

```php
function nombre_modulo_listar(): void {
    ['offset' => $offset, 'por_pagina' => $porPagina, 'pagina' => $pagina] = paginacion();
    $pdo = db();

    $total = (int)$pdo->query("SELECT COUNT(*) FROM nombre_tabla")->fetchColumn();

    $stmt = $pdo->prepare("SELECT * FROM nombre_tabla ORDER BY id DESC LIMIT ? OFFSET ?");
    $stmt->execute([$porPagina, $offset]);
    $datos = $stmt->fetchAll();

    json_response([
        'exito' => true,
        'data'  => $datos,
        'paginacion' => [
            'total'      => $total,
            'pagina'     => $pagina,
            'por_pagina' => $porPagina,
            'paginas'    => (int)ceil($total / $porPagina),
        ]
    ]);
}
```

### 6. Transacciones para operaciones múltiples

```php
$pdo = db();
$pdo->beginTransaction();
try {
    // operaciones
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    log_error($e, 'nombre_modulo_guardar');
    json_response(['exito' => false, 'mensaje' => 'Error interno. Intente nuevamente.'], 500);
}
```

### 7. Validación de entrada

```php
$body  = request_body();
$nombre = trim($body['nombre'] ?? '');
$id     = (int)($body['id'] ?? 0);

if ($nombre === '') {
    json_response(['exito' => false, 'mensaje' => 'El nombre es obligatorio.'], 422);
}
```

### 8. Nunca concatenar input en SQL

```php
// ❌ MAL
$stmt = $pdo->query("SELECT * FROM tabla WHERE nombre = '$nombre'");

// ✅ BIEN
$stmt = $pdo->prepare("SELECT * FROM tabla WHERE nombre = ?");
$stmt->execute([$nombre]);
```

---

## Endpoints mínimos para un CRUD

Implementar siempre:

| Acción | Método esperado | Descripción |
|--------|----------------|-------------|
| `modulo_listar` | GET | Lista paginada |
| `modulo_obtener` | GET | Un registro por ID |
| `modulo_guardar` | POST | Insert o update (si viene `id` > 0, es update) |
| `modulo_eliminar` | POST | Baja lógica o física |
| `modulo_cambiar_estado` | POST | Activo/inactivo |
| `modulo_catalogos` | GET | Datos para selects (cacheables) |

---

## Seguridad — checklist por módulo

- [ ] Nunca concatenar valores del usuario en SQL.
- [ ] Usar prepared statements en toda consulta.
- [ ] Convertir IDs con `(int)`.
- [ ] Normalizar strings con `trim()`.
- [ ] Nunca exponer `getMessage()` al cliente.
- [ ] Loguear errores con `log_error()`.
- [ ] Responder con HTTP status code correcto.
- [ ] No crear conexiones nuevas (usar `db()`).
- [ ] No imprimir HTML ni texto plano.

---

## `.env.example` (incluir en el proyecto)

```ini
APP_ENV=development
APP_DEBUG=false
ALLOWED_ORIGIN=http://localhost:3000

DB_HOST=127.0.0.1
DB_NAME=mesas_examen
DB_USER=root
DB_PASS=

SESSION_NAME=mesas_session
SESSION_LIFETIME=7200
```

---

## Entrega esperada

Dame el código completo de todos los archivos del módulo, listo para pegar,
manteniendo el mismo estilo del sistema. Incluir el SQL de la tabla con sus índices.
