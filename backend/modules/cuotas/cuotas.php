<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_registros.php';

final class Cuotas extends CuotasRegistros
{
    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos($auth['db'], $_GET));
    }

    public static function catalogos(): never
    {
        $auth = auth_context();
        $year = isset($_GET['anio']) && $_GET['anio'] !== ''
            ? self::validarAnio($_GET['anio'])
            : (int)date('Y');
        $periodId = isset($_GET['mes']) && $_GET['mes'] !== ''
            ? (int)self::periodo($auth['db'], $_GET['mes'])['id_periodo']
            : 1;
        api_success(self::catalogosDatos($auth['db'], $year, $periodId));
    }

    public static function contextoPago(): never
    {
        $auth = auth_context();
        $partnerId = positive_id($_GET['id_socio'] ?? null, 'socio');
        $year = self::validarAnio($_GET['anio'] ?? date('Y'));
        $periodId = (int)self::periodo(
            $auth['db'],
            $_GET['mes'] ?? $_GET['id_periodo'] ?? null
        )['id_periodo'];
        $date = self::fechaPago($_GET['fecha_pago'] ?? date('Y-m-d'));
        api_success(self::contextoPagoDatos($auth['db'], $partnerId, $year, $periodId, $date));
    }

    public static function contextosPago(): never
    {
        $auth = auth_context();
        $partnerId = positive_id($_GET['id_socio'] ?? null, 'socio');
        $year = self::validarAnio($_GET['anio'] ?? date('Y'));
        $date = self::fechaPago($_GET['fecha_pago'] ?? date('Y-m-d'));
        api_success([
            'anio' => $year,
            'fecha_pago' => $date,
            'periodos' => self::contextosPagoDatos($auth['db'], $partnerId, $year, $date),
        ]);
    }

    public static function registrarPago(): never
    {
        $auth = require_admin();
        $result = self::registrarPagosDatos($auth, request_body());
        api_success(
            $result,
            count($result['items']) > 1
                ? 'Pagos registrados correctamente.'
                : 'Pago registrado correctamente.'
        );
    }

    public static function registrarPagos(): never
    {
        self::registrarPago();
    }

    public static function condonarPago(): never
    {
        $auth = require_admin();
        $result = self::condonarPagoDatos($auth, request_body());
        api_success(
            [
                'item' => $result['items'][0],
                'comprobante' => $result['comprobante'],
            ],
            'Cuota condonada correctamente. El período ya no figura como deuda.'
        );
    }

    public static function eliminarPago(): never
    {
        $auth = require_admin();
        $item = self::eliminarPagoDatos($auth, request_body());
        api_success(
            ['item' => $item],
            $item['estado'] === 'CONDONADO'
                ? 'Condonación eliminada correctamente. El período volvió a quedar como deuda.'
                : 'Pago eliminado correctamente. El período volvió a quedar como deuda.'
        );
    }

    /** Alias conservados para clientes anteriores. */
    public static function registrarCobro(): never
    {
        self::registrarPago();
    }

    public static function anular(): never
    {
        self::eliminarPago();
    }
}
