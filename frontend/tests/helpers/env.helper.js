const fs = require('fs');
const path = require('path');

let loaded = false;

function parseEnv(text) {
  const result = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function activeEnvValues(text, key) {
  const values = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    if (line.slice(0, separator).trim() !== key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('\"') && value.endsWith('\"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.push(value);
  }
  return values;
}

function isLocalUrl(url) {
  const value = String(url || '').trim();
  if (!value) return true;

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch (_error) {
    return /(^|\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i.test(value);
  }
}

function isLocalApi(apiUrl) {
  return isLocalUrl(apiUrl);
}

function deriveRemoteFrontendUrl(apiUrl) {
  try {
    return new URL(apiUrl).origin.replace(/\/+$/, '');
  } catch (_error) {
    throw new Error(
      `REACT_APP_API_URL inválida en frontend/.env: ${String(apiUrl || '(vacía)')}`,
    );
  }
}

function resolveEnvironment() {
  // La API elegida viene SIEMPRE de frontend/.env -> REACT_APP_API_URL.
  // PW_API_URL se rellena desde ahí en loadTestEnv para que no exista una
  // segunda selección de entorno escondida en .env.test.
  const apiUrl = normalizeUrl(process.env.REACT_APP_API_URL || process.env.PW_API_URL);
  if (!apiUrl) {
    throw new Error(
      'Falta REACT_APP_API_URL en frontend/.env. Elegí LOCAL o HOSTINGER únicamente desde ese archivo.',
    );
  }

  const localApi = isLocalUrl(apiUrl);
  const baseUrl = localApi
    ? normalizeUrl(process.env.PW_LOCAL_BASE_URL || 'http://localhost:3000')
    : normalizeUrl(process.env.PW_HOSTINGER_BASE_URL || deriveRemoteFrontendUrl(apiUrl));
  const localFrontend = isLocalUrl(baseUrl);

  // Evita configuraciones mixtas accidentales. La selección es binaria y la
  // hace exclusivamente REACT_APP_API_URL en frontend/.env.
  if (localApi !== localFrontend) {
    throw new Error(
      `Configuración E2E incoherente: frontend=${baseUrl} / api=${apiUrl}. ` +
        'Revisá PW_LOCAL_BASE_URL/PW_HOSTINGER_BASE_URL en .env.test.',
    );
  }

  process.env.PW_BASE_URL = baseUrl;
  process.env.PW_API_URL = apiUrl;
  process.env.PW_ENVIRONMENT = localApi ? 'local' : 'hostinger';
  process.env.REACT_APP_API_URL = apiUrl;

  // El arranque de servidores también se deriva del entorno seleccionado.
  // Así no queda un PW_START_* viejo de otra terminal forzando un modo mixto.
  process.env.PW_START_FRONTEND = String(localFrontend);
  process.env.PW_START_BACKEND = String(localApi);

  if (localApi) {
    process.env.PW_USER = String(process.env.PW_LOCAL_USER || '').trim();
    process.env.PW_PASSWORD = String(process.env.PW_LOCAL_PASSWORD || '');
  } else {
    process.env.PW_USER = String(process.env.PW_HOSTINGER_USER || '').trim();
    process.env.PW_PASSWORD = String(process.env.PW_HOSTINGER_PASSWORD || '');

    // Nunca se permite una limpieza SQL directa al apuntar a una API remota.
    // La limpieza E2E válida pasa exclusivamente por e2e_cleanup y prefijos PW.
    process.env.PW_ALLOW_DB_CLEANUP = 'false';
  }

  return {
    apiUrl,
    baseUrl,
    environment: process.env.PW_ENVIRONMENT,
    isLocal: localFrontend && localApi,
    isLocalApi: localApi,
    isLocalFrontend: localFrontend,
  };
}

function loadEnvFile(filePath, { overwrite = false } = {}) {
  if (!fs.existsSync(filePath)) return {};
  const values = parseEnv(fs.readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (overwrite || process.env[key] === undefined) process.env[key] = value;
  }
  return values;
}

function loadTestEnv(rootDir = path.resolve(__dirname, '..', '..')) {
  if (loaded) return process.env;

  // .env.test conserva únicamente credenciales/comandos fijos.
  loadEnvFile(path.join(rootDir, '.env.test'));

  // frontend/.env es la ÚNICA fuente de verdad para LOCAL <-> HOSTINGER.
  // REACT_APP_API_URL se fuerza incluso si quedó un PW_API_URL viejo en la
  // terminal o en .env.test, evitando correr accidentalmente contra otro entorno.
  const appEnvPath = path.join(rootDir, '.env');
  if (!fs.existsSync(appEnvPath)) {
    throw new Error(
      `No existe ${appEnvPath}. El testing necesita frontend/.env para elegir LOCAL o HOSTINGER.`,
    );
  }
  const appEnvText = fs.readFileSync(appEnvPath, 'utf8');
  const activeApiValues = activeEnvValues(appEnvText, 'REACT_APP_API_URL');
  if (activeApiValues.length !== 1) {
    throw new Error(
      `frontend/.env debe tener exactamente una REACT_APP_API_URL activa; encontradas: ${activeApiValues.length}. ` +
        'Dejá LOCAL o HOSTINGER sin comentar, nunca ambas.',
    );
  }
  const selectedApiUrl = normalizeUrl(activeApiValues[0]);
  if (!selectedApiUrl) {
    throw new Error('REACT_APP_API_URL está vacía en frontend/.env.');
  }

  process.env.REACT_APP_API_URL = selectedApiUrl;
  process.env.PW_API_URL = selectedApiUrl;

  resolveEnvironment();
  loaded = true;
  return process.env;
}

function envBoolean(name, fallback = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(value);
}

module.exports = {
  activeEnvValues,
  deriveRemoteFrontendUrl,
  envBoolean,
  isLocalApi,
  isLocalUrl,
  loadTestEnv,
  normalizeUrl,
  parseEnv,
  resolveEnvironment,
};
