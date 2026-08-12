<?php
declare(strict_types=1);

require_once __DIR__ . '/../../core/auth.php';
require_once __DIR__ . '/../../core/domain.php';
require_once __DIR__ . '/../../core/request.php';
require_once __DIR__ . '/configuracion_soporte.php';
require_once __DIR__ . '/configuracion_consultas.php';
require_once __DIR__ . '/configuracion_gestion.php';

final class Configuracion
{
    use ConfiguracionConsultas;
    use ConfiguracionGestion;

    public static function obtener(): never
    {
        $auth = auth_context();
        api_success(self::obtenerDatos($auth['db']));
    }

    public static function guardarItem(): never
    {
        $auth = require_admin();
        $result = self::guardarItemDatos($auth, request_body());
        api_success(
            $result,
            $result['creado']
                ? 'La opción se agregó correctamente.'
                : 'La opción se modificó correctamente.'
        );
    }

    public static function eliminarItem(): never
    {
        $auth = require_admin();
        $result = self::eliminarDefinitivoItemDatos($auth, request_body());
        api_success($result, 'La opción se eliminó definitivamente.');
    }

    public static function darBajaItem(): never
    {
        $auth = require_admin();
        $result = self::establecerEstadoItemDatos($auth, request_body(), false);
        api_success($result, 'La opción se dio de baja correctamente.');
    }

    public static function eliminarDefinitivoItem(): never
    {
        $auth = require_admin();
        $result = self::eliminarDefinitivoItemDatos($auth, request_body());
        api_success($result, 'La opción se eliminó definitivamente.');
    }

    public static function reactivarItem(): never
    {
        $auth = require_admin();
        $result = self::cambiarEstadoItemDatos($auth, request_body(), true);
        api_success($result, 'La opción se reactivó correctamente.');
    }
}
