<?php
declare(strict_types=1);

require_once __DIR__ . '/familias_consultas.php';
require_once __DIR__ . '/familias_gestion.php';

final class Familias
{
    use FamiliasConsultas;
    use FamiliasGestion;

    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos($auth['db'], $_GET));
    }

    public static function obtener(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? null, 'familia');
        api_success(self::obtenerDatos($auth['db'], $id));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        $result = self::guardarDatos($auth, request_body());
        $created = (bool)$result['creada'];
        unset($result['creada']);
        api_success($result, $created ? 'Familia creada correctamente.' : 'Familia actualizada correctamente.');
    }

    public static function darBaja(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? null, 'familia');
        $date = valid_date($body['fecha_baja'] ?? date('Y-m-d'), 'baja');
        $reason = optional_text($body['motivo_baja'] ?? null, 500);
        api_success(
            self::cambiarEstadoDatos($auth, $id, false, $date, $reason),
            'Familia dada de baja correctamente.'
        );
    }

    public static function reactivar(): never
    {
        $auth = require_admin();
        $id = positive_id(request_body()['id'] ?? null, 'familia');
        api_success(self::cambiarEstadoDatos($auth, $id, true), 'Familia reactivada correctamente.');
    }

    public static function eliminarDefinitivo(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? null, 'familia');
        $confirmation = strtoupper(trim((string)($body['confirmacion'] ?? '')));
        if ($confirmation !== 'ELIMINAR') {
            api_error(
                'Escribí ELIMINAR para confirmar la eliminación definitiva.',
                'CONFIRMACION_ELIMINACION_INVALIDA',
                422
            );
        }
        api_success(
            self::eliminarDefinitivoDatos($auth, $id),
            'La familia fue eliminada definitivamente. Sus socios quedaron sin familia.'
        );
    }
}
