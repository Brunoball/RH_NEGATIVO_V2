const fs = require('fs');
const path = require('path');

let loaded = false;

function parseEnv(text) {
  const result = {};
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
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
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1 || line.slice(0, separator).trim() !== key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.push(value);
  }
  return values;
}

function isLocalUrl(url) {
  try {
    const hostname = new URL(String(url || '')).hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch (_error) {
    return false;
  }
}

function validateSelectedApi(apiUrl) {
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch (_error) {
    throw new Error(`REACT_APP_API_URL inválida: ${apiUrl}`);
  }

  if (isLocalUrl(apiUrl)) {
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('La API local debe usar http:// o https://.');
    }
    return 'local';
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Hostinger debe probarse exclusivamente por HTTPS.');
  }
  if (parsed.hostname.toLowerCase() !== 'rhnegativo.3devsnet.com') {
    throw new Error(
      `Host remoto no autorizado para E2E RH: ${parsed.hostname}. ` +
        'Sólo se permite rhnegativo.3devsnet.com.',
    );
  }
  if (!/^\/api\/routes(?:\/api\.php)?\/?$/i.test(parsed.pathname)) {
    throw new Error(
      `Ruta remota no autorizada para E2E RH: ${parsed.pathname}. ` +
        'Debe ser /api/routes o /api/routes/api.php.',
    );
  }
  return 'hostinger';
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

  // .env.test contiene solamente credenciales/comandos fijos.
  loadEnvFile(path.join(rootDir, '.env.test'));

  // Igual que LALCEC: frontend/.env es la ÚNICA selección LOCAL <-> HOSTINGER.
  const appEnvPath = path.join(rootDir, '.env');
  if (!fs.existsSync(appEnvPath)) {
    throw new Error(`No existe ${appEnvPath}.`);
  }
  const appEnvText = fs.readFileSync(appEnvPath, 'utf8');
  const active = activeEnvValues(appEnvText, 'REACT_APP_API_URL');
  if (active.length !== 1) {
    throw new Error(
      `frontend/.env debe tener exactamente una REACT_APP_API_URL activa; encontradas: ${active.length}.`,
    );
  }

  const apiUrl = normalizeUrl(active[0]);
  if (!apiUrl) throw new Error('REACT_APP_API_URL está vacía en frontend/.env.');
  const environment = validateSelectedApi(apiUrl);

  // La SPA SIEMPRE se sirve localmente durante Playwright. Sólo cambia la API.
  const baseUrl = normalizeUrl(process.env.PW_LOCAL_BASE_URL || 'http://localhost:3000');
  if (!isLocalUrl(baseUrl)) {
    throw new Error('PW_LOCAL_BASE_URL debe ser localhost/127.0.0.1.');
  }

  process.env.PW_API_URL = apiUrl;
  process.env.PW_BASE_URL = baseUrl;
  process.env.PW_ENVIRONMENT = environment;
  process.env.PW_START_FRONTEND = 'true';
  process.env.PW_START_BACKEND = String(environment === 'local');
  process.env.REACT_APP_API_URL = apiUrl;
  process.env.REACT_APP_E2E = '1';

  if (environment === 'local') {
    process.env.PW_USER = String(process.env.PW_LOCAL_USER || '').trim();
    process.env.PW_PASSWORD = String(process.env.PW_LOCAL_PASSWORD || '');
  } else {
    process.env.PW_USER = String(process.env.PW_HOSTINGER_USER || '').trim();
    process.env.PW_PASSWORD = String(process.env.PW_HOSTINGER_PASSWORD || '');
    process.env.PW_ALLOW_DB_CLEANUP = 'false';
  }

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
  envBoolean,
  isLocalUrl,
  loadTestEnv,
  normalizeUrl,
  parseEnv,
  validateSelectedApi,
};
