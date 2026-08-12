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

function isLocalApi(apiUrl) {
  const value = String(apiUrl || '').trim();
  if (!value) return true;

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch (_error) {
    return /(^|\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i.test(value);
  }
}

function resolveEnvironment() {
  const apiUrl = String(process.env.PW_API_URL || 'http://localhost:3001/routes')
    .trim()
    .replace(/\/+$/, '');
  const local = isLocalApi(apiUrl);

  process.env.PW_API_URL = apiUrl;
  process.env.PW_ENVIRONMENT = local ? 'local' : 'hostinger';

  // Una sola PW_API_URL controla también a qué API apunta el frontend React local.
  process.env.REACT_APP_API_URL = apiUrl;

  // El frontend siempre se ejecuta local. El backend PHP solo se levanta para API local.
  process.env.PW_START_FRONTEND = 'true';
  process.env.PW_START_BACKEND = local ? 'true' : 'false';

  if (local) {
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

    // Nunca permitir limpieza SQL directa al apuntar a producción.
    process.env.PW_ALLOW_DB_CLEANUP = 'false';
  }

  return {
    apiUrl,
    environment: process.env.PW_ENVIRONMENT,
    isLocal: local,
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
  loadTestEnv,
  parseEnv,
  resolveEnvironment,
};
