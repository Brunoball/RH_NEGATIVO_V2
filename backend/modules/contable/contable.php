<?php
declare(strict_types=1);

require_once __DIR__ . '/contable_schema.php';
require_once __DIR__ . '/contable_soporte.php';
require_once __DIR__ . '/contable_consultas.php';
require_once __DIR__ . '/contable_gestion.php';

final class Contable
{
    use ContableSoporte;
    use ContableConsultas;
    use ContableGestion;

    public static function resumen(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        $year = self::filtroAnio($_GET['anio'] ?? null);
        $month = self::filtroMes($_GET['mes'] ?? date('n'));
        api_success(['resumen' => self::resumenDatos($auth['db'], $year, $month)]);
    }

    public static function catalogos(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::catalogosBase($auth['db']));
    }

    public static function opcionesConfiguracion(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::opcionesConfiguracionDatos($auth['db']));
    }

    public static function listarIngresosSocios(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::listarIngresosSociosDatos($auth['db'], $_GET));
    }

    public static function listarIngresos(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::listarIngresosDatos($auth['db'], $_GET));
    }

    public static function listarEgresos(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::listarEgresosDatos($auth['db'], $_GET));
    }

    public static function guardarOpcion(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        $result = self::guardarOpcionDatos($auth, request_body());
        api_success(
            $result,
            !empty($result['creado'])
                ? 'La opción se agregó correctamente.'
                : 'La opción se modificó correctamente.'
        );
    }

    public static function cambiarEstadoOpcion(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        $result = self::cambiarEstadoOpcionDatos($auth, request_body());
        api_success(
            $result,
            !empty($result['activo'])
                ? 'La opción se reactivó correctamente.'
                : 'La opción se dio de baja correctamente.'
        );
    }

    public static function eliminarOpcion(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(
            self::eliminarOpcionDatos($auth, request_body()),
            'La opción se eliminó correctamente.'
        );
    }

    public static function guardarIngreso(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::guardarIngresoDatos($auth, request_body()), 'El ingreso se guardó correctamente.');
    }

    public static function eliminarIngreso(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::eliminarIngresoDatos($auth, request_body()), 'El ingreso se eliminó correctamente.');
    }

    public static function guardarEgreso(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::guardarEgresoDatos($auth, request_body()), 'El egreso se guardó correctamente.');
    }

    public static function eliminarEgreso(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::eliminarEgresoDatos($auth, request_body()), 'El egreso se eliminó correctamente.');
    }

    public static function archivoEgreso(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        $id = positive_id($_GET['id'] ?? null, 'egreso');
        $statement = $auth['db']->prepare(
            'SELECT archivo_path FROM contable_egresos WHERE id_egreso = ? LIMIT 1'
        );
        $statement->execute([$id]);
        $row = $statement->fetch();
        if (!$row || empty($row['archivo_path'])) {
            api_error('El egreso no tiene un comprobante adjunto.', 'ARCHIVO_NO_ENCONTRADO', 404);
        }

        $cleanPath = ltrim((string)$row['archivo_path'], '/\\');
        if (!self::validUploadPath($cleanPath)) {
            api_error('La ruta del comprobante no es válida.', 'ARCHIVO_FORBIDDEN', 403);
        }
        $root = dirname(__DIR__, 2) . '/uploads/contable';
        $candidate = $root . '/' . $cleanPath;
        $realRoot = realpath($root);
        $realFile = realpath($candidate);
        if (!$realRoot || !$realFile || !str_starts_with($realFile, $realRoot . DIRECTORY_SEPARATOR) || !is_file($realFile)) {
            api_error('El comprobante ya no se encuentra en el servidor.', 'ARCHIVO_NO_ENCONTRADO', 404);
        }

        $filename = basename(str_replace('\\', '/', $cleanPath));
        $mime = self::mimeArchivoEgreso($realFile);
        header('Content-Type: ' . ($mime !== '' ? $mime : 'application/octet-stream'));
        header('Content-Length: ' . filesize($realFile));
        header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($filename));
        header('X-Content-Type-Options: nosniff');
        readfile($realFile);
        exit;
    }
}
