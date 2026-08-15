const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, expectApiError } = require('./helpers/api.helper');
const { createSocio } = require('./helpers/entities.helper');
const { todayIso } = require('./helpers/data.helper');
const { familyData, socioData } = require('./fixtures/socios.fixture');
const { createQuotaCategory, createQuotaSocio, currentYear, paymentPayload, quotaCatalogs } = require('./helpers/cuotas.helper');

test.describe('Socios y familias · contratos API complementarios', () => {
  test('obtener, historial, contacto y ciclo baja/reactivación mantienen persistencia', async ({ request }) => {
    const data = socioData('API COMPLEMENTO');
    const created = await createSocio(request, data);

    const detail = await apiCall(request, 'socios_obtener', { params: { id: created.id_socio } });
    expect(detail.item.id_socio).toBe(created.id_socio);
    expect(detail.item.nombre).toBe(data.nombre);

    let history = await apiCall(request, 'socios_historial', { params: { id: created.id_socio } });
    expect(Array.isArray(history.historial_estados)).toBe(true);

    const contact = await apiCall(request, 'socios_contacto_guardar', {
      method: 'POST',
      data: {
        id_socio: created.id_socio,
        fecha_contacto: todayIso(),
        estado_contacto: 'PENDIENTE',
        detalle_contacto: 'PW E2E CONTACTO API',
      },
    });
    expect(contact.contacto.estado_contacto).toBe('PENDIENTE');

    await expectApiError(request, 'socios_contacto_guardar', {
      method: 'POST', data: { id_socio: created.id_socio, estado_contacto: 'INVALIDO' },
    }, { status: 422, code: 'VALIDATION_ERROR' });

    await apiCall(request, 'socios_eliminar', {
      method: 'POST', data: { id: created.id_socio, fecha_baja: todayIso(), motivo_baja: 'PW E2E BAJA API' },
    });
    await apiCall(request, 'socios_reactivar', {
      method: 'POST', data: { id: created.id_socio, fecha_reactivacion: todayIso(), motivo_reactivacion: 'PW E2E REACTIVACION API' },
    });

    history = await apiCall(request, 'socios_historial', { params: { id: created.id_socio } });
    const rows = history.historial_estados || [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  test('listar y obtener rechazan filtros/IDs inválidos sin tocar datos', async ({ request }) => {
    await expectApiError(request, 'socios_obtener', { params: { id: 0 } }, { status: 422 });
    await expectApiError(request, 'socios_listar', { params: { pagina: -1 } }, { status: 422 });
  });

  test.describe('Familias API', () => {
    // En Windows se observó una salida nativa aislada del worker antes de ejecutar
    // el test (0 ms). Un único retry permite distinguir ese crash del sistema de
    // una falla funcional real: si la API está mal, el segundo intento también falla.
    test.describe.configure({ retries: process.platform === 'win32' ? 1 : 0 });

    test('familias: guardar/obtener/baja/reactivar y validaciones directas', async ({ request }) => {
    const a = await createSocio(request, socioData('FAM API A'));
    const b = await createSocio(request, socioData('FAM API B'));
    const family = familyData();

    const saved = await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [
          { id_socio: a.id_socio, desde: todayIso() },
          { id_socio: b.id_socio, desde: todayIso() },
        ],
      },
    });
    const id = saved.item.id_familia;

    let detail = await apiCall(request, 'familias_obtener', { params: { id } });
    expect(detail.item.id_familia).toBe(id);
    expect(detail.item.integrantes).toHaveLength(2);

    await expectApiError(request, 'familias_guardar', {
      method: 'POST', data: { nombre: family.nombre, integrantes: [{ id_socio: a.id_socio }] },
    }, { status: 409, code: 'FAMILIA_DUPLICADA' });

    await apiCall(request, 'familias_eliminar', {
      method: 'POST', data: { id, fecha_baja: todayIso(), motivo_baja: 'PW E2E BAJA FAMILIA API' },
    });
    await apiCall(request, 'familias_reactivar', { method: 'POST', data: { id } });
    detail = await apiCall(request, 'familias_obtener', { params: { id } });
    expect(detail.item.activo).toBe(true);

    await apiCall(request, 'familias_eliminar_definitivo', {
      method: 'POST', data: { id, confirmacion: 'ELIMINAR' },
    });
    await expectApiError(request, 'familias_obtener', { params: { id } }, { status: 404 });
    });
  });

  test('eliminación definitiva borra también pagos relacionados sin dejar residuos de cuotas', async ({ request }) => {
    const category = await createQuotaCategory(request);
    const socio = await createQuotaSocio(request, 'DELETE CASCADE', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);

    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: socio.item.id_socio,
        periodId,
        mediumId: catalogs.medium.id_medio_pago,
      }),
    });
    expect(paid.items).toHaveLength(1);

    const deleted = await apiCall(request, 'socios_eliminar_definitivo', {
      method: 'POST', data: { id: socio.item.id_socio },
    });
    expect(deleted.id_socio).toBe(socio.item.id_socio);
    expect(Number(deleted.eliminados?.pagos || deleted.impacto?.pagos || 0)).toBeGreaterThanOrEqual(1);

    await expectApiError(request, 'socios_obtener', { params: { id: socio.item.id_socio } }, {
      status: 404, code: 'SOCIO_NO_ENCONTRADO',
    });
    const paidList = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'PAGADOS', anio: currentYear(), mes: periodId, buscar: socio.data.dni },
    });
    expect((paidList.items || []).some((item) => item.id_socio === socio.item.id_socio)).toBe(false);
  });

});
