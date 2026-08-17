const fs = require('fs');
const path = require('path');
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

function readTestCredentials() {
  const saved = readAuthSession();
  const username = saved?._testing?.username;
  const password = saved?._testing?.password;
  if (!username || !password) {
    throw new Error('La sesión E2E no contiene las credenciales temporales del runner.');
  }
  return { username, password };
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

function authHeaders(session, extra = {}) {
  return {
    Accept: 'application/json',
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    ...extra,
  };
}

async function apiResult(requestContext, action, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const hasSessionOverride = Object.prototype.hasOwnProperty.call(options, 'session');
  const session = hasSessionOverride ? options.session : readAuthSession();
  const requestOptions = {
    headers: authHeaders(session, options.headers || {}),
    failOnStatusCode: false,
  };
  if (options.data !== undefined) requestOptions.data = options.data;
  if (options.form !== undefined) requestOptions.form = options.form;
  if (options.multipart !== undefined) requestOptions.multipart = options.multipart;

  const response = await requestContext.fetch(actionUrl(action, options.params), {
    ...requestOptions,
    method,
  });
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

async function apiMultipartCall(requestContext, action, multipart, options = {}) {
  return apiCall(requestContext, action, {
    ...options,
    method: options.method || 'POST',
    multipart,
  });
}

async function apiBinaryResult(requestContext, action, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const hasSessionOverride = Object.prototype.hasOwnProperty.call(options, 'session');
  const session = hasSessionOverride ? options.session : readAuthSession();
  const response = await requestContext.fetch(actionUrl(action, options.params), {
    method,
    headers: authHeaders(session, options.headers || {}),
    failOnStatusCode: false,
  });
  const buffer = await response.body();
  return {
    ok: response.ok(),
    status: response.status(),
    buffer,
    headers: response.headers(),
    url: response.url(),
  };
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
      throw new Error(`Mensaje inesperado en ${action}: ${actual}. Esperado: ${String(expected.message)}`);
    }
  }
  return result;
}

async function createApiSession(requestContext, { username, password, headers = {} }) {
  const result = await apiResult(requestContext, 'auth_login', {
    method: 'POST',
    data: { usuario: username, contrasena: password },
    session: null,
    headers,
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

module.exports = {
  AUTH_FILE,
  actionUrl,
  apiBinaryResult,
  apiCall,
  apiMultipartCall,
  apiResult,
  closeApiSession,
  createApiSession,
  expectApiError,
  normalizedApiBase,
  readAuthSession,
  readTestCredentials,
};
