<?php
declare(strict_types=1);

require_once __DIR__ . '/socios_consultas.php';
require_once __DIR__ . '/socios_gestion.php';

final class Socios
{
    use SociosConsultas;
    use SociosGestion;

    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos($auth['db'], $_GET));
    }

    public static function obtener(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? null, 'socio');
        api_success(self::obtenerDatos($auth['db'], $id));
    }

    public static function historial(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? null, 'socio');
        api_success(self::historialDatos($auth['db'], $id));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        $result = self::guardarDatos($auth, request_body());
        $created = (bool)$result['creado'];
        unset($result['creado']);
        api_success(
            $result,
            $created ? 'Socio creado correctamente.' : 'Socio actualizado correctamente.'
        );
    }

    public static function darBaja(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_socio'] ?? null, 'socio');
        $date = valid_date($body['fecha_baja'] ?? date('Y-m-d'), 'baja');
        if ($date > date('Y-m-d')) api_error('La fecha de baja no puede ser futura.', 'VALIDATION_ERROR');
        $reason = required_text($body, 'motivo_baja', 'motivo de baja', 500);
        api_success(self::darBajaDatos($auth, $id, $date, $reason), 'Socio dado de baja correctamente.');
    }

    public static function reactivar(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_socio'] ?? null, 'socio');
        $date = valid_date($body['fecha_reactivacion'] ?? date('Y-m-d'), 'reactivación');
        if ($date > date('Y-m-d')) api_error('La fecha de reactivación no puede ser futura.', 'VALIDATION_ERROR');
        $reason = optional_text($body['motivo_reactivacion'] ?? null, 500);
        api_success(self::reactivarDatos($auth, $id, $date, $reason), 'Socio reactivado correctamente.');
    }

    public static function registrarContacto(): never
    {
        $auth = require_admin();
        api_success(
            self::registrarContactoDatos($auth, request_body()),
            'Gestión de contacto registrada correctamente.'
        );
    }

    public static function cerrarCumpleanios(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_socio'] ?? null, 'socio');
        api_success(
            self::cerrarCumpleaniosDatos($auth, $id),
            'Aviso marcado como gestionado para este año.'
        );
    }

    public static function eliminarDefinitivo(): never
    {
        require_admin();
        api_error(
            'No se permite eliminar físicamente un socio. Utilizá la baja lógica para conservar su historial.',
            'ELIMINACION_FISICA_NO_PERMITIDA',
            405
        );
    }
}
