const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, expectApiError } = require('./helpers/api.helper');
const { todayIso } = require('./helpers/data.helper');
const { categoryData } = require('./fixtures/categorias.fixture');

test.describe('Categorías · contratos API complementarios', () => {
  test('obtener, historial y baja/reactivación directa conservan valores históricos', async ({ request }) => {
    const data = categoryData();
    const created = await apiCall(request, 'categorias_guardar', {
      method: 'POST',
      data: {
        nombre: data.nombre,
        monto_mensual: data.mensual,
        monto_anual: data.anual,
        vigente_desde: todayIso(),
      },
    });
    const id = created.item.id_categoria;

    const detail = await apiCall(request, 'categorias_obtener', { params: { id } });
    expect(detail.item.id_categoria).toBe(id);
    expect(detail.item.nombre).toBe(data.nombre);

    const history = await apiCall(request, 'categorias_historial', { params: { id } });
    const rows = history.items || history.historial || [];
    expect(rows.some((row) => String(row.tipo).toUpperCase() === 'MENSUAL')).toBe(true);
    expect(rows.some((row) => String(row.tipo).toUpperCase() === 'ANUAL')).toBe(true);

    await apiCall(request, 'categorias_eliminar', { method: 'POST', data: { id } });
    await apiCall(request, 'categorias_reactivar', { method: 'POST', data: { id } });

    const after = await apiCall(request, 'categorias_obtener', { params: { id } });
    expect(after.item.activo).toBe(true);
  });

  test('filtros e IDs inválidos fallan con contrato controlado', async ({ request }) => {
    await expectApiError(request, 'categorias_obtener', { params: { id: 0 } }, { status: 422 });
    await expectApiError(request, 'categorias_listar', { params: { estado: 'INEXISTENTE' } }, { code: 'FILTRO_INVALIDO' });
    await expectApiError(request, 'descuentos_familiares_listar', { params: { estado: 'INEXISTENTE' } }, { code: 'FILTRO_INVALIDO' });
  });
});
