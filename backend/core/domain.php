<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';

function client_ip(): string
{
    return substr(trim((string)($_SERVER['REMOTE_ADDR'] ?? '')), 0, 64);
}

function client_user_agent(): string
{
    return substr(trim((string)($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 255);
}

function clean_text(mixed $value, int $maxLength = 255, bool $uppercase = true): string
{
    $text = preg_replace('/\s+/u', ' ', trim((string)$value)) ?? '';
    if ($uppercase) $text = function_exists('mb_strtoupper') ? mb_strtoupper($text, 'UTF-8') : strtoupper($text);
    return function_exists('mb_substr') ? mb_substr($text, 0, $maxLength, 'UTF-8') : substr($text, 0, $maxLength);
}

/**
 * Convierte una búsqueda libre en términos comparables. Los signos y la
 * puntuación actúan como separadores, por lo que "ACEBAL, EDITH" produce los
 * términos "ACEBAL" y "EDITH". Se eliminan duplicados sin alterar el orden.
 */
function search_terms(mixed $value, int $maxLength = 160, int $maxTerms = 12): array
{
    $text = clean_text($value, max(1, $maxLength), false);
    $text = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $text) ?? '';
    $text = clean_text($text, max(1, $maxLength), false);
    if ($text === '') return [];

    $parts = preg_split('/\s+/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $terms = [];
    $seen = [];
    $limit = max(1, $maxTerms);

    foreach ($parts as $part) {
        $key = function_exists('mb_strtolower')
            ? mb_strtolower($part, 'UTF-8')
            : strtolower($part);
        if (isset($seen[$key])) continue;

        $seen[$key] = true;
        $terms[] = $part;
        if (count($terms) >= $limit) break;
    }

    return $terms;
}

/**
 * Genera un filtro de búsqueda reutilizable.
 *
 * Cada plantilla debe contener {param}. Las plantillas se unen con OR para
 * cada término y los términos se unen con AND. Con prefijo se generan
 * parámetros PDO nombrados; con null se generan parámetros posicionales.
 * Las plantillas son SQL definido por el servidor y nunca deben provenir del
 * usuario.
 *
 * @return array{sql: string, params: array, terms: array}
 */
function build_search_filter(
    mixed $value,
    array $conditionTemplates,
    int $maxLength = 160,
    ?string $parameterPrefix = 'buscar',
    int $maxTerms = 12
): array {
    $terms = search_terms($value, $maxLength, $maxTerms);
    if ($terms === []) return ['sql' => '', 'params' => [], 'terms' => []];

    $templates = [];
    foreach ($conditionTemplates as $template) {
        $template = trim((string)$template);
        if ($template === '') continue;
        if (!str_contains($template, '{param}')) {
            throw new InvalidArgumentException('La plantilla de búsqueda debe incluir {param}.');
        }
        $templates[] = $template;
    }
    if ($templates === []) return ['sql' => '', 'params' => [], 'terms' => $terms];

    $named = $parameterPrefix !== null;
    $prefix = $named
        ? (preg_replace('/[^A-Za-z0-9_]/', '_', $parameterPrefix) ?: 'buscar')
        : '';
    $termClauses = [];
    $params = [];

    foreach ($terms as $termIndex => $term) {
        $alternatives = [];
        foreach ($templates as $templateIndex => $template) {
            if ($named) {
                $key = "{$prefix}_{$termIndex}_{$templateIndex}";
                $alternatives[] = str_replace('{param}', ':' . $key, $template);
                $params[$key] = '%' . $term . '%';
            } else {
                $alternatives[] = str_replace('{param}', '?', $template);
                $params[] = '%' . $term . '%';
            }
        }
        $termClauses[] = '(' . implode(' OR ', $alternatives) . ')';
    }

    return [
        'sql' => '(' . implode(' AND ', $termClauses) . ')',
        'params' => $params,
        'terms' => $terms,
    ];
}

function optional_text(mixed $value, int $maxLength = 255, bool $uppercase = true): ?string
{
    $text = clean_text($value, $maxLength, $uppercase);
    return $text === '' ? null : $text;
}

function required_text(array $body, string $field, string $label, int $maxLength = 255, bool $uppercase = true): string
{
    $text = clean_text($body[$field] ?? '', $maxLength, $uppercase);
    if ($text === '') api_error("El campo {$label} es obligatorio.", 'VALIDATION_ERROR', 422, ['campo' => $field]);
    return $text;
}

function positive_id(mixed $value, string $label = 'registro'): int
{
    $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) api_error("El identificador de {$label} no es válido.", 'VALIDATION_ERROR');
    return (int)$id;
}

function id_list(mixed $value): array
{
    if (!is_array($value)) return [];
    $ids = [];
    foreach ($value as $item) {
        $candidate = is_array($item) ? ($item['id'] ?? $item['id_categoria'] ?? $item['id_modalidad_pago'] ?? null) : $item;
        $id = filter_var($candidate, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id !== false) $ids[(int)$id] = (int)$id;
    }
    return array_values($ids);
}

function valid_date(mixed $value, string $label, bool $required = true): ?string
{
    $text = trim((string)$value);
    if ($text === '' && !$required) return null;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $text);
    $errors = DateTimeImmutable::getLastErrors();
    if (!$date || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) || $date->format('Y-m-d') !== $text) {
        api_error("La fecha de {$label} no es válida.", 'VALIDATION_ERROR');
    }
    return $text;
}

function decimal_amount(mixed $value, string $label, float $min = 0, float $max = 9999999999.99): string
{
    if ($value === '' || $value === null || !is_numeric($value)) api_error("El campo {$label} debe ser un importe válido.", 'VALIDATION_ERROR');
    $number = (float)$value;
    if ($number < $min || $number > $max) api_error("El campo {$label} está fuera del rango permitido.", 'VALIDATION_ERROR');
    return number_format($number, 2, '.', '');
}

function transaction(PDO $db, callable $callback): mixed
{
    $db->beginTransaction();
    try {
        $result = $callback();
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function audit_change(PDO $db, array $auth, string $module, string $action, string $table, int|string|null $id, string $description, mixed $before, mixed $after): void
{
    $statement = $db->prepare(
        'INSERT INTO auditoria
         (id_usuario_master, modulo, accion, tabla_afectada, id_registro, descripcion, datos_anteriores, datos_nuevos, ip, user_agent)
         VALUES (:usuario, :modulo, :accion, :tabla, :registro, :descripcion, :antes, :despues, :ip, :agente)'
    );
    $encode = static function (mixed $data): ?string {
        if ($data === null) return null;

        // La auditoría nunca debe tirar abajo la operación principal por un
        // texto histórico con bytes UTF-8 inválidos, NAN/INF u otro valor no
        // serializable de forma estricta. JSON_PARTIAL_OUTPUT_ON_ERROR conserva
        // el resto del contenido y JSON_INVALID_UTF8_SUBSTITUTE reemplaza solo
        // los bytes dañados.
        $json = json_encode(
            $data,
            JSON_UNESCAPED_UNICODE
                | JSON_UNESCAPED_SLASHES
                | JSON_INVALID_UTF8_SUBSTITUTE
                | JSON_PARTIAL_OUTPUT_ON_ERROR
                | JSON_PRESERVE_ZERO_FRACTION
        );

        return is_string($json)
            ? $json
            : '{"error":"No se pudo serializar el detalle de auditoría."}';
    };
    $statement->execute([
        'usuario' => $auth['id_usuario_master'],
        'modulo' => $module,
        'accion' => $action,
        'tabla' => $table,
        'registro' => $id === null ? null : (string)$id,
        'descripcion' => $description,
        'antes' => $encode($before),
        'despues' => $encode($after),
        'ip' => client_ip(),
        'agente' => client_user_agent(),
    ]);
}

function duplicate_key(Throwable $error): bool
{
    if (!$error instanceof PDOException) return false;

    // SQLSTATE 23000 significa "violación de integridad" en general y no
    // necesariamente una clave duplicada. Por ejemplo, también puede ser una
    // FK u otra restricción. Para mostrar mensajes de "ya registrado" solo
    // aceptamos el código nativo 1062 de MySQL/MariaDB (Duplicate entry).
    $errorInfo = $error->errorInfo ?? null;
    if (is_array($errorInfo) && isset($errorInfo[1])) {
        return (int)$errorInfo[1] === 1062;
    }

    // Fallback defensivo para drivers/configuraciones que no expongan
    // errorInfo pero sí incluyan el código nativo en el mensaje.
    return preg_match('/(?:^|\D)1062(?:\D|$).*duplicate\s+entry/i', $error->getMessage()) === 1;
}
