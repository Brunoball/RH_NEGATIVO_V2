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

function explicitBoolean(name) {
  if (process.env[name] === undefined) return null;
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return null;
  if (['1', 'true', 'yes', 'si', 'sí', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return null;
}

function resolveEnvironment() {
  const baseUrl = String(process.env.PW_BASE_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
  const apiUrl = String(process.env.PW_API_URL || 'http://localhost:3001/routes')
    .trim()
    .replace(/\/+$/, '');
  const localFrontend = isLocalUrl(baseUrl);
  const localApi = isLocalUrl(apiUrl);

  process.env.PW_BASE_URL = baseUrl;
  process.env.PW_API_URL = apiUrl;
  process.env.PW_ENVIRONMENT = localFrontend && localApi
    ? 'local'
    : (!localFrontend && !localApi ? 'hostinger' : 'mixto');

  // Si el frontend se ejecuta local, React debe apuntar exactamente a la API
  // elegida (local o Hostinger). En un frontend ya desplegado esta variable no
  // cambia el bundle remoto y por eso queda sólo como referencia del runner.
  process.env.REACT_APP_API_URL = apiUrl;

  const requestedFrontendStart = explicitBoolean('PW_START_FRONTEND');
  const requestedBackendStart = explicitBoolean('PW_START_BACKEND');
  process.env.PW_START_FRONTEND = String(
    requestedFrontendStart === null ? localFrontend : requestedFrontendStart,
  );
  process.env.PW_START_BACKEND = String(
    requestedBackendStart === null ? localApi : requestedBackendStart,
  );

  if (localApi) {
    process.env.PW_USER = String(process.env.PW_LOCAL_USER || process.env.PW_USER || '').trim();
    process.env.PW_PASSWORD = String(
      process.env.PW_LOCAL_PASSWORD || process.env.PW_PASSWORD || '',
    );
  } else {
    process.env.PW_USER = String(
      process.env.PW_HOSTINGER_USER || process.env.PW_USER || '',
    ).trim();
    process.env.PW_PASSWORD = String(
      process.env.PW_HOSTINGER_PASSWORD || process.env.PW_PASSWORD || '',
    );

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

function loadTestEnv(rootDir = path.resolve(__dirname, '..', '..')) {
  if (loaded) return process.env;
  const envPath = path.join(rootDir, '.env.test');
  if (fs.existsSync(envPath)) {
    const values = parseEnv(fs.readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
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
  envBoolean,
  isLocalApi,
  isLocalUrl,
  loadTestEnv,
  parseEnv,
  resolveEnvironment,
};
