const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { apiResult, expectApiError } = require('./helpers/api.helper');

const protectedActions = [
  ['auth_usuario_actual', 'GET'],
  ['auth_logout', 'POST'],
  ['dashboard_resumen', 'GET'],
  ['socios_listar', 'GET'], ['socios_obtener', 'GET'], ['socios_historial', 'GET'],
  ['socios_guardar', 'POST'], ['socios_eliminar', 'POST'], ['socios_eliminar_definitivo', 'POST'],
  ['socios_reactivar', 'POST'], ['socios_contacto_guardar', 'POST'], ['socios_cumpleanios_cerrar', 'POST'],
  ['familias_listar', 'GET'], ['familias_obtener', 'GET'], ['familias_guardar', 'POST'],
  ['familias_eliminar', 'POST'], ['familias_eliminar_definitivo', 'POST'], ['familias_reactivar', 'POST'],
  ['categorias_listar', 'GET'], ['categorias_obtener', 'GET'], ['categorias_guardar', 'POST'],
  ['categorias_eliminar', 'POST'], ['categorias_reactivar', 'POST'], ['categorias_historial', 'GET'],
  ['descuentos_familiares_listar', 'GET'], ['descuentos_familiares_guardar', 'POST'], ['descuentos_familiares_eliminar', 'POST'],
  ['cuotas_listar', 'GET'], ['cuotas_catalogos', 'GET'], ['cuotas_contexto_pago', 'GET'], ['cuotas_contextos_pago', 'GET'],
  ['cuotas_registrar_pago', 'POST'], ['cuotas_registrar_pagos', 'POST'], ['cuotas_condonar_pago', 'POST'], ['cuotas_eliminar_pago', 'POST'],
  ['cuotas_registrar_cobro', 'POST'], ['cuotas_anular', 'POST'],
  ['configuracion_obtener', 'GET'], ['configuracion_lista_guardar', 'POST'], ['configuracion_lista_eliminar', 'POST'],
  ['configuracion_lista_baja', 'POST'], ['configuracion_lista_reactivar', 'POST'], ['configuracion_lista_eliminar_definitivo', 'POST'],
  ['usuarios_listar', 'GET'], ['usuarios_guardar', 'POST'], ['usuarios_cambiar_estado', 'POST'], ['usuarios_eliminar', 'POST'],
  ['contable_resumen', 'GET'], ['contable_catalogos', 'GET'], ['contable_opciones_configuracion', 'GET'],
  ['contable_ingresos_socios', 'GET'], ['contable_balance', 'GET'], ['contable_ingresos_listar', 'GET'], ['contable_egresos_listar', 'GET'],
  ['contable_opcion_guardar', 'POST'], ['contable_opcion_cambiar_estado', 'POST'], ['contable_opcion_eliminar', 'POST'],
  ['contable_ingreso_guardar', 'POST'], ['contable_ingreso_eliminar', 'POST'],
  ['contable_egreso_guardar', 'POST'], ['contable_egreso_eliminar', 'POST'], ['contable_egreso_archivo', 'GET'],
  ['e2e_cleanup', 'POST'],
];

test.describe('Contratos, routing y seguridad transversal', () => {
  test('health responde y auth_login conserva su contrato público', async () => {
    const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const health = await apiResult(api, 'health', { session: null });
      expect(health.status).toBe(200);
      expect(health.body?.exito).not.toBe(false);

      await expectApiError(api, 'auth_login', {
        method: 'POST', data: {}, session: null,
      }, { status: 422, code: 'VALIDATION_ERROR' });
    } finally {
      await api.dispose();
    }
  });

  test('todas las acciones privadas rechazan una petición sin sesión antes de ejecutar lógica de negocio', async () => {
    const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      for (const [action, method] of protectedActions) {
        const result = await apiResult(api, action, {
          method,
          session: null,
          ...(method === 'POST' ? { data: {} } : {}),
        });
        expect(result.status, `${action} debe exigir sesión`).toBe(401);
        expect(result.body?.exito, action).toBe(false);
      }
    } finally {
      await api.dispose();
    }
  });

  test('router rechaza métodos HTTP incorrectos en todas las acciones funcionales', async () => {
    const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const routes = [['health', 'GET'], ['auth_login', 'POST'], ...protectedActions];
      for (const [action, expectedMethod] of routes) {
        const wrongMethod = expectedMethod === 'GET' ? 'POST' : 'GET';
        const result = await apiResult(api, action, {
          method: wrongMethod,
          session: null,
          ...(wrongMethod === 'POST' ? { data: {} } : {}),
        });
        expect(result.status, `${action} debe ser ${expectedMethod}`).toBe(405);
      }
    } finally {
      await api.dispose();
    }
  });
});
