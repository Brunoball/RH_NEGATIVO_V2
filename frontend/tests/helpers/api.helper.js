const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadTestEnv } = require('./env.helper');

loadTestEnv();

const FRONTEND_ROOT = path.resolve(__dirname, '..', '..');
const AUTH_FILE = path.join(FRONTEND_ROOT, 'tests', '.auth', 'user.json');

function normalizedApiBase() {
  return String(process.env.PW_API_URL || 'http://localhost:3001/routes')
    .trim()
    .replace(/\/+$/, '');
}

function actionUrl(action, params = {}) {
  const base = normalizedApiBase();
  const apiUrl = /\/api\.php$/i.test(base) ? base : `${base}/api.php`;
  const url = new URL(apiUrl);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function readAuthSession() {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(`No existe la sesión de testing: ${AUTH_FILE}`);
  }
  return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new Error(
      `Respuesta no JSON (${response.status()}) desde ${response.url()}: ${text.slice(0, 300)}`,
    );
  }
}

async function apiResult(requestContext, action, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const hasSessionOverride = Object.prototype.hasOwnProperty.call(options, 'session');
  const session = hasSessionOverride ? options.session : readAuthSession();
  const headers = {
    Accept: 'application/json',
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    ...(options.headers || {}),
  };
  const requestOptions = {
    headers,
    failOnStatusCode: false,
  };
  if (options.data !== undefined) requestOptions.data = options.data;

  const response = await requestContext.fetch(
    actionUrl(action, options.params),
    { ...requestOptions, method },
  );
  const body = await parseResponse(response);
  return {
    ok: response.ok() && body?.exito !== false,
    status: response.status(),
    body,
    headers: response.headers(),
    url: response.url(),
  };
}

async function apiCall(requestContext, action, options = {}) {
  const result = await apiResult(requestContext, action, options);
  if (!result.ok) {
    const message = result.body?.mensaje ||
      `Falló ${String(options.method || 'GET').toUpperCase()} ${action} con HTTP ${result.status}`;
    const rawDetail = result.body?.detalle ?? result.body?.detalles;
    const detail = rawDetail && typeof rawDetail === 'object'
      ? JSON.stringify(rawDetail)
      : String(rawDetail || '').trim();
    const error = new Error(detail ? `${message}\nDetalle backend: ${detail}` : message);
    error.status = result.status;
    error.code = result.body?.codigo;
    error.body = result.body;
    throw error;
  }
  return result.body;
}

async function expectApiError(requestContext, action, options, expected = {}) {
  const result = await apiResult(requestContext, action, options);
  if (result.ok) {
    throw new Error(`Se esperaba error en ${action}, pero respondió HTTP ${result.status}.`);
  }
  if (expected.status !== undefined && result.status !== expected.status) {
    throw new Error(
      `Estado inesperado en ${action}: esperado ${expected.status}, recibido ${result.status}. ` +
        JSON.stringify(result.body),
    );
  }
  if (expected.code !== undefined && result.body?.codigo !== expected.code) {
    throw new Error(
      `Código inesperado en ${action}: esperado ${expected.code}, recibido ${result.body?.codigo}. ` +
        JSON.stringify(result.body),
    );
  }
  if (expected.message !== undefined) {
    const actual = String(result.body?.mensaje || '');
    const matches = expected.message instanceof RegExp
      ? expected.message.test(actual)
      : actual.includes(String(expected.message));
    if (!matches) {
      throw new Error(
        `Mensaje inesperado en ${action}: ${actual}. Esperado: ${String(expected.message)}`,
      );
    }
  }
  return result;
}

async function createApiSession(requestContext, { username, password }) {
  const result = await apiResult(requestContext, 'auth_login', {
    method: 'POST',
    data: { usuario: username, contrasena: password },
    session: null,
  });
  if (!result.ok || !result.body?.token) {
    throw new Error(
      result.body?.mensaje || `No se pudo iniciar sesión para ${username} (HTTP ${result.status}).`,
    );
  }
  return {
    token: result.body.token,
    expira_en: result.body.expira_en,
    usuario: result.body.usuario,
    organizacion: result.body.organizacion,
  };
}

async function closeApiSession(requestContext, session) {
  if (!session?.token) return;
  await apiResult(requestContext, 'auth_logout', {
    method: 'POST',
    data: {},
    session,
  });
}

async function findSocioByDocument(requestContext, { tipo, documento }) {
  for (const estado of ['ACTIVO', 'INACTIVO']) {
    const response = await apiCall(requestContext, 'socios_listar', {
      params: {
        tipo,
        estado,
        buscar: documento,
        pagina: 1,
        por_pagina: 100,
      },
    });
    const item = (response.items || []).find((row) =>
      String(tipo).toUpperCase() === 'EMPRESA'
        ? String(row.cuit || '') === String(documento)
        : String(row.dni || '') === String(documento),
    );
    if (item) return item;
  }
  return null;
}

async function cleanupSocioByDocument(requestContext, { tipo, documento }) {
  const item = await findSocioByDocument(requestContext, { tipo, documento });
  if (!item) return false;
  await apiCall(requestContext, 'socios_eliminar_definitivo', {
    method: 'POST',
    data: { id: item.id_socio, confirmacion: 'ELIMINAR' },
  });
  return true;
}

async function cleanupSocioById(requestContext, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return false;
  const result = await apiResult(requestContext, 'socios_eliminar_definitivo', {
    method: 'POST',
    data: { id: numericId, confirmacion: 'ELIMINAR' },
  });
  if (!result.ok && result.status !== 404) {
    const error = new Error(
      result.body?.mensaje || `No se pudo limpiar el socio ${numericId}.`,
    );
    error.status = result.status;
    error.code = result.body?.codigo;
    error.body = result.body;
    throw error;
  }
  return result.ok;
}

async function findUserByUsername(requestContext, username) {
  const response = await apiCall(requestContext, 'usuarios_listar');
  return (response.usuarios || []).find(
    (user) => String(user.usuario).toLowerCase() === String(username).toLowerCase(),
  ) || null;
}

async function cleanupUserByUsername(requestContext, username) {
  const user = await findUserByUsername(requestContext, username);
  if (!user || user.sesion_actual) return false;
  await apiCall(requestContext, 'usuarios_eliminar', {
    method: 'POST',
    data: { id: user.id },
  });
  return true;
}

async function cleanupCatalogByName(requestContext, listName, itemName) {
  const response = await apiCall(requestContext, 'configuracion_obtener');
  const definition = {
    medios_pago: 'id_medio_pago',
    condiciones_iva: 'id_condicion_iva',
  };
  const idField = definition[listName];
  if (!idField) throw new Error(`Catálogo no soportado: ${listName}`);
  const item = (response.listas?.[listName] || []).find(
    (row) => String(row.nombre).toUpperCase() === String(itemName).toUpperCase(),
  );
  if (!item) return false;
  await apiCall(requestContext, 'configuracion_lista_eliminar_definitivo', {
    method: 'POST',
    data: { lista: listName, id: item[idField] },
  });
  return true;
}

async function cleanupContableOptionByName(requestContext, type, itemName) {
  const response = await apiCall(requestContext, 'contable_opciones_configuracion');
  const item = (response.listas?.[type] || []).find(
    (row) => String(row.nombre).toUpperCase() === String(itemName).toUpperCase(),
  );
  if (!item) return false;
  await apiCall(requestContext, 'contable_opcion_eliminar', {
    method: 'POST',
    data: { id_opcion: item.id_opcion },
  });
  return true;
}


function runDbCleanup(operation, value) {
  const phpBinary = process.env.PW_PHP_BIN || 'php';
  const script = path.join(__dirname, 'db-cleanup.php');
  const result = spawnSync(phpBinary, [script, operation, value], {
    cwd: FRONTEND_ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `No se pudo completar la limpieza ${operation}.\n${result.stdout || ''}\n${result.stderr || ''}`,
    );
  }
  return String(result.stdout || '').trim();
}

function cleanupFamilyByPrefix(prefix) {
  const value = String(prefix);
  if (!value.startsWith('PW E2E FAM ') && !value.startsWith('PW EE FAM ')) {
    throw new Error('La limpieza de familias solo admite prefijos de Playwright controlados.');
  }
  return runDbCleanup('family-prefix', value);
}

function cleanupUsersByPrefix(prefix) {
  if (!String(prefix).startsWith('pw_e2e_')) {
    throw new Error('La limpieza de usuarios solo admite el prefijo pw_e2e_.');
  }
  return runDbCleanup('user-prefix', prefix);
}

function cleanupLoginAuditByPrefix(prefix) {
  if (!String(prefix).startsWith('pw_e2e_')) {
    throw new Error('La limpieza de auditoría solo admite el prefijo pw_e2e_.');
  }
  return runDbCleanup('login-prefix', prefix);
}

function cleanupCategoriesByPrefix(prefix) {
  const value = String(prefix);
  if (!value.startsWith('PW E2E CAT ') && !value.startsWith('PW EE CAT ')) {
    throw new Error('La limpieza de categorías solo admite prefijos de Playwright controlados.');
  }
  return runDbCleanup('category-prefix', value);
}

function cleanupDiscountsByThresholds(thresholds) {
  const values = Array.isArray(thresholds)
    ? [...new Set(thresholds.map(Number))].filter(
        (value) => Number.isInteger(value) && value >= 2 && value <= 50,
      )
    : [];
  if (values.length === 0) {
    throw new Error('La limpieza de descuentos requiere umbrales válidos entre 2 y 50.');
  }
  return runDbCleanup('discount-thresholds', values.join(','));
}

function readAuditActions(table, id) {
  if (!['categorias', 'descuentos_familiares'].includes(String(table))) {
    throw new Error('Tabla de auditoría no permitida.');
  }
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error('ID de auditoría inválido.');
  }
  const output = runDbCleanup('audit-actions', `${table}:${numericId}`);
  return output ? JSON.parse(output) : [];
}

module.exports = {
  AUTH_FILE,
  actionUrl,
  apiCall,
  apiResult,
  cleanupCatalogByName,
  cleanupContableOptionByName,
  cleanupCategoriesByPrefix,
  cleanupDiscountsByThresholds,
  cleanupFamilyByPrefix,
  cleanupLoginAuditByPrefix,
  cleanupSocioByDocument,
  cleanupSocioById,
  cleanupUserByUsername,
  cleanupUsersByPrefix,
  closeApiSession,
  createApiSession,
  expectApiError,
  findSocioByDocument,
  findUserByUsername,
  normalizedApiBase,
  readAuditActions,
  readAuthSession,
};
