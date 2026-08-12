const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');
const { AUTH_FILE, actionUrl } = require('./helpers/api.helper');
const { loadTestEnv } = require('./helpers/env.helper');

module.exports = async function globalSetup() {
  loadTestEnv(path.resolve(__dirname, '..'));
  const username = process.env.PW_USER;
  const password = process.env.PW_PASSWORD;
  if (!username || !password) {
    throw new Error(
      `Faltan credenciales para ${process.env.PW_ENVIRONMENT || 'el entorno seleccionado'}. ` +
        'Completá PW_LOCAL_USER/PW_LOCAL_PASSWORD o PW_HOSTINGER_USER/PW_HOSTINGER_PASSWORD en .env.test.',
    );
  }

  const api = await request.newContext({ ignoreHTTPSErrors: true });
  const response = await api.post(actionUrl('auth_login'), {
    data: { usuario: username, contrasena: password },
    failOnStatusCode: false,
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new Error(`El login de preparación devolvió una respuesta no JSON: ${text.slice(0, 300)}`);
  } finally {
    await api.dispose();
  }

  if (!response.ok() || body?.exito === false || !body?.token) {
    const message = body?.mensaje ||
      `No se pudo iniciar la sesión E2E (HTTP ${response.status()}).`;
    const rawDetail = body?.detalle ?? body?.detalles;
    const detail = rawDetail && typeof rawDetail === 'object'
      ? JSON.stringify(rawDetail)
      : String(rawDetail || '').trim();
    throw new Error(detail ? `${message}\nDetalle backend: ${detail}` : message);
  }
  if (body.usuario?.rol !== 'admin') {
    throw new Error('PW_USER debe corresponder a un administrador para probar altas, edición y bajas.');
  }

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify(
      {
        token: body.token,
        expira_en: body.expira_en,
        usuario: body.usuario,
        organizacion: body.organizacion,
      },
      null,
      2,
    ),
    'utf8',
  );
};
