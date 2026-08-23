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

    public static function proximoId(): never
    {
        $auth = auth_context();
        api_success(['id_socio' => self::proximoIdSocio($auth['db'])]);
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
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_socio'] ?? null, 'socio');

        try {
            $result = self::eliminarDefinitivoDatos($auth, $id);
        } catch (PDOException $error) {
            $driverCode = (int)($error->errorInfo[1] ?? 0);
            error_log('[socios_eliminar_definitivo][PDO][' . $driverCode . '] ' . $error->__toString());

            if ($driverCode === 1451 || $driverCode === 1452) {
                $message = 'No se pudo completar la eliminación porque todavía existe una relación de base de datos que referencia al socio.';
                if (env_bool('APP_DEBUG', false)) {
                    $message .= ' MySQL: ' . $error->getMessage();
                }
                api_error($message, 'SOCIO_DELETE_RELACION_BLOQUEANTE', 409);
            }

            $message = 'No se pudo eliminar definitivamente el socio por un error de base de datos.';
            if (env_bool('APP_DEBUG', false)) {
                $message .= ' MySQL ' . ($driverCode ?: 'N/D') . ': ' . $error->getMessage();
            }
            api_error($message, 'SOCIO_DELETE_DB_ERROR', 500);
        } catch (Throwable $error) {
            error_log('[socios_eliminar_definitivo][ERROR] ' . $error->__toString());
            $message = 'No se pudo eliminar definitivamente el socio.';
            if (env_bool('APP_DEBUG', false)) {
                $message .= ' Detalle: ' . $error->getMessage();
            }
            api_error($message, 'SOCIO_DELETE_ERROR', 500);
        }

        api_success(
            $result,
            'Socio eliminado del padrón. Pagos, inscripciones e historial preservados para trazabilidad.'
        );
    }
}
