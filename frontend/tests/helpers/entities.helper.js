const { apiCall } = require('./api.helper');
const { todayIso } = require('./data.helper');

function isActive(item) {
  return item?.activo === true || Number(item?.activo) === 1;
}

async function socioCatalogs(request) {
  const response = await apiCall(request, 'socios_listar', {
    params: { vigente: 'VIGENTE', pagina: 1 },
  });
  const catalogs = response.catalogos || {};
  const category = (catalogs.categorias || []).find(isActive);
  const collector = (catalogs.cobradores || []).find(isActive);
  if (!category || !collector) {
    throw new Error('Para probar Socios debe existir al menos una categoría y un cobrador activos reales.');
  }
  return { catalogs, category, collector };
}

async function createSocio(request, data, overrides = {}) {
  const { catalogs, category, collector } = await socioCatalogs(request);
  const state = (catalogs.estados || []).find(isActive);
  const blood = (catalogs.grupos_sanguineos || []).find(isActive);
  const response = await apiCall(request, 'socios_guardar', {
    method: 'POST',
    data: {
      nombre: data.nombre,
      dni: data.dni,
      fecha_nacimiento: '1999-05-15',
      id_grupo_sanguineo: blood?.id_grupo_sanguineo || null,
      domicilio: 'CALLE PLAYWRIGHT',
      numero: '123',
      telefono_movil: data.movil,
      telefono_fijo: data.fijo,
      domicilio_cobro: 'DOMICILIO DE COBRO PLAYWRIGHT',
      fecha_ingreso: todayIso(),
      id_estado: state?.id_estado || null,
      id_categoria: category.id_categoria,
      id_cobrador: collector.id_cobrador,
      observaciones: data.observaciones,
      ...overrides,
    },
  });
  return response.item;
}

module.exports = {
  createSocio,
  socioCatalogs,
};
