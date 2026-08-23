const { apiCall } = require('./api.helper');
const { todayIso } = require('./data.helper');
const { createSocio } = require('./entities.helper');
const { cuotaCategoryData, cuotaSocioData } = require('../fixtures/cuotas.fixture');

function currentYear() {
  return Number(todayIso().slice(0, 4));
}

async function createQuotaCategory(request) {
  const data = cuotaCategoryData();
  const response = await apiCall(request, 'categorias_guardar', {
    method: 'POST',
    data: {
      nombre: data.nombre,
      monto_mensual: data.mensual,
      monto_anual: data.anual,
      // Los tests ejercitan cualquier período del año actual. La categoría E2E
      // debe tener precio histórico desde el inicio del año, no sólo desde hoy.
      vigente_desde: `${currentYear()}-01-01`,
    },
  });
  return { ...data, item: response.item };
}

async function quotaCatalogs(request, year = currentYear()) {
  const data = await apiCall(request, 'cuotas_catalogos', { params: { anio: year, mes: 1 } });
  const catalogos = data.catalogos || data;
  const periods = catalogos.periodos || catalogos.meses || [];
  const bimonthly = periods.filter((p) => Number(p.id_periodo ?? p.id_mes) >= 1 && Number(p.id_periodo ?? p.id_mes) <= 6 && p.activo !== false);
  const annual = periods.find((p) => Number(p.id_periodo ?? p.id_mes) === 7 && p.activo !== false);
  const medium = (catalogos.medios_pago || []).find((m) => m.activo !== false);
  if (bimonthly.length < 2 || !annual || !medium) {
    throw new Error('Cuotas E2E requiere al menos dos períodos bimestrales, Contado Anual y un medio de pago activos.');
  }
  return { data, catalogos, periods, bimonthly, annual, medium };
}

async function createQuotaSocio(request, label, categoryId, options = {}) {
  const data = cuotaSocioData(label);
  const item = await createSocio(request, data, {
    id_categoria: categoryId,
    fecha_ingreso: `${currentYear()}-01-01`,
    ...options,
  });
  return { data, item };
}

function paymentPayload({ socioId, periodId, mediumId, year = currentYear(), amount = null, date = todayIso(), extra = {} }) {
  return {
    id_socio: socioId,
    anio: year,
    mes: periodId,
    fecha_pago: date,
    id_medio_pago: mediumId,
    ...(amount == null ? {} : { monto: amount }),
    ...extra,
  };
}

async function deletePayment(request, id, action = 'cuotas_eliminar_pago') {
  if (!id) return;
  await apiCall(request, action, { method: 'POST', data: { id_pago: id } });
}

module.exports = {
  createQuotaCategory,
  createQuotaSocio,
  currentYear,
  deletePayment,
  paymentPayload,
  quotaCatalogs,
};
