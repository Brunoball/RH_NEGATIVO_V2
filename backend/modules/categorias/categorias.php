<?php
declare(strict_types=1);

require_once __DIR__ . '/categorias_schema.php';
require_once __DIR__ . '/categorias_consultas.php';
require_once __DIR__ . '/categorias_gestion.php';
require_once __DIR__ . '/descuentos_familiares.php';

final class Categorias
{
    use CategoriasConsultas;
    use CategoriasGestion;
    use DescuentosFamiliaresGestion;

    private static function db(array $auth): PDO
    {
        $db = $auth['db'];
        ensure_categorias_schema($db);
        return $db;
    }

    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos(self::db($auth), $_GET));
    }

    public static function obtener(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? null, 'categoría');
        api_success(self::obtenerDatos(self::db($auth), $id));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        self::db($auth);
        $result = self::guardarDatos($auth, request_body());
        $created = (bool)$result['creada'];
        unset($result['creada']);
        api_success($result, $created ? 'Categoría creada correctamente.' : 'Categoría actualizada correctamente.');
    }

    public static function darBaja(): never
    {
        $auth = require_admin();
        self::db($auth);
        $id = positive_id(request_body()['id'] ?? null, 'categoría');
        api_success(self::cambiarEstadoDatos($auth, $id, false), 'Categoría dada de baja correctamente.');
    }

    public static function reactivar(): never
    {
        $auth = require_admin();
        self::db($auth);
        $id = positive_id(request_body()['id'] ?? null, 'categoría');
        api_success(self::cambiarEstadoDatos($auth, $id, true), 'Categoría reactivada correctamente.');
    }

    public static function historial(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? null, 'categoría');
        api_success(self::historialDatos(self::db($auth), $id));
    }

    public static function listarDescuentos(): never
    {
        $auth = auth_context();
        api_success(['items' => self::listarDescuentosDatos(self::db($auth), $_GET)]);
    }

    public static function guardarDescuento(): never
    {
        $auth = require_admin();
        self::db($auth);
        $result = self::guardarDescuentoDatos($auth, request_body());
        $created = (bool)$result['creado'];
        unset($result['creado']);
        api_success($result, $created ? 'Descuento familiar creado correctamente.' : 'Descuento familiar actualizado correctamente.');
    }

    public static function eliminarDescuento(): never
    {
        $auth = require_admin();
        self::db($auth);
        $id = positive_id(request_body()['id'] ?? null, 'descuento familiar');
        self::eliminarDescuentoDatos($auth, $id);
        api_success([], 'Descuento familiar enviado al historial correctamente.');
    }
}
