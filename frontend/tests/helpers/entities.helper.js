const { apiCall } = require('./api.helper');
const { todayIso } = require('./data.helper');

async function createPerson(request, data, overrides = {}) {
  const response = await apiCall(request, 'socios_guardar', {
    method: 'POST',
    data: {
      tipo_socio: 'PERSONA',
      apellido: data.apellido,
      nombre: data.nombre,
      dni: data.dni,
      fecha_alta: todayIso(),
      domicilio: 'CALLE PLAYWRIGHT',
      numero_domicilio: '123',
      localidad: 'SAN FRANCISCO',
      telefono: data.telefono || null,
      email: data.email || null,
      domicilio_alternativo: 'DOMICILIO ALTERNATIVO E2E',
      id_categoria: null,
      id_medio_pago: null,
      enviar_recordatorio: true,
      observaciones: 'REGISTRO CREADO POR PLAYWRIGHT',
      ...overrides,
    },
  });
  return response.item;
}

async function createCompany(request, data, overrides = {}) {
  const response = await apiCall(request, 'socios_guardar', {
    method: 'POST',
    data: {
      tipo_socio: 'EMPRESA',
      razon_social: data.razonSocial,
      cuit: data.cuit,
      fecha_alta: todayIso(),
      domicilio: 'AVENIDA PLAYWRIGHT 456',
      telefono: data.telefono || null,
      email: data.email || null,
      domicilio_alternativo: 'SEDE ALTERNATIVA E2E',
      id_condicion_iva: null,
      id_categoria: null,
      id_medio_pago: null,
      enviar_recordatorio: true,
      observaciones: 'EMPRESA CREADA POR PLAYWRIGHT',
      ...overrides,
    },
  });
  return response.item;
}

async function createFamily(request, data, members, overrides = {}) {
  const response = await apiCall(request, 'familias_guardar', {
    method: 'POST',
    data: {
      nombre: data.nombre,
      descripcion: data.descripcion || 'FAMILIA CREADA POR PLAYWRIGHT',
      integrantes: members.map((member, index) => ({
        id_socio: member.id_socio,
        parentesco: index === 0 ? 'TITULAR' : 'INTEGRANTE',
        es_titular: index === 0,
        observaciones: `INTEGRANTE ${index + 1}`,
        fecha_incorporacion: todayIso(),
      })),
      ...overrides,
    },
  });
  return response.item;
}

async function createCatalog(request, list, name) {
  const response = await apiCall(request, 'configuracion_lista_guardar', {
    method: 'POST',
    data: { lista: list, nombre: name },
  });
  return response.item;
}

async function findCatalogByName(request, list, name) {
  const response = await apiCall(request, 'configuracion_obtener');
  return (response.listas?.[list] || []).find(
    (item) => String(item.nombre).toUpperCase() === String(name).toUpperCase(),
  ) || null;
}

async function createUser(request, data, overrides = {}) {
  const response = await apiCall(request, 'usuarios_guardar', {
    method: 'POST',
    data: {
      usuario: data.username,
      email: data.email,
      rol: 'vista',
      contrasena: data.password,
      confirmar_contrasena: data.password,
      ...overrides,
    },
  });
  return response.usuario;
}

module.exports = {
  createCatalog,
  createCompany,
  createFamily,
  createPerson,
  createUser,
  findCatalogByName,
};
