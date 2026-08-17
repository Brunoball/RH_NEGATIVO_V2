const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');
const {
  AUTH_FILE,
  apiCall,
  apiResult,
  closeApiSession,
  createApiSession,
} = require('./helpers/api.helper');
const { loadTestEnv } = require('./helpers/env.helper');

const SETUP_UA = 'PW-RH-E2E-SETUP/1.0';
const RUNNER_UA = 'PW-RH-E2E-RUNNER/1.0';

module.exports = async function globalSetup() {
  loadTestEnv(path.resolve(__dirname, '..'));
  const realUsername = process.env.PW_USER;
  const realPassword = process.env.PW_PASSWORD;
  if (!realUsername || !realPassword) {
    throw new Error(
      `Faltan credenciales para ${process.env.PW_ENVIRONMENT || 'el entorno seleccionado'}. ` +
        'Completá PW_LOCAL_USER/PW_LOCAL_PASSWORD o PW_HOSTINGER_USER/PW_HOSTINGER_PASSWORD en .env.test.',
    );
  }

  const api = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'User-Agent': SETUP_UA },
  });
  let realSession = null;

  try {
    // Antes de crear o limpiar cualquier dato verificamos que la URL realmente
    // sea la API de RH Negativo. Esto evita ejecutar la suite por accidente
    // contra otro sistema al cambiar PW_API_URL (especialmente en Hostinger).
    const health = await apiResult(api, 'health', { session: null });
    if (!health.ok || health.body?.servicio !== 'rh-negativo-api') {
      throw new Error(
        `La API configurada no se identificó como RH Negativo (${process.env.PW_API_URL}). ` +
          `health respondió servicio=${String(health.body?.servicio || 'desconocido')}.`,
      );
    }

    realSession = await createApiSession(api, {
      username: realUsername,
      password: realPassword,
      headers: { 'User-Agent': SETUP_UA },
    });
    if (realSession.usuario?.rol !== 'admin') {
      throw new Error('El usuario real configurado para preparar E2E debe ser administrador.');
    }

    // Limpia exclusivamente residuos marcados de una corrida E2E anterior interrumpida.
    const staleCleanup = await apiResult(api, 'e2e_cleanup', {
      method: 'POST',
      data: { confirmacion: 'LIMPIAR_PLAYWRIGHT' },
      session: realSession,
      headers: { 'User-Agent': SETUP_UA },
    });
    if (!staleCleanup.ok) {
      const rawDetail = staleCleanup.body?.detalle ?? staleCleanup.body?.detalles;
      const detail = rawDetail && typeof rawDetail === 'object'
        ? JSON.stringify(rawDetail)
        : String(rawDetail || '').trim();
      throw new Error(
        `No se pudo ejecutar la limpieza E2E preventiva: ${staleCleanup.body?.mensaje || staleCleanup.status}` +
          `${detail ? `\nDetalle backend: ${detail}` : ''}`,
      );
    }

    const suffix = `${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`.toLowerCase();
    const runnerUsername = `pw_e2e_runner_${suffix}`;
    const runnerPassword = `PwE2E!${crypto.randomBytes(8).toString('hex')}A9`;

    await apiCall(api, 'usuarios_guardar', {
      method: 'POST',
      data: {
        usuario: runnerUsername,
        email: `${runnerUsername}@example.test`,
        rol: 'admin',
        contrasena: runnerPassword,
        confirmar_contrasena: runnerPassword,
      },
      session: realSession,
      headers: { 'User-Agent': SETUP_UA },
    });

    const runnerSession = await createApiSession(api, {
      username: runnerUsername,
      password: runnerPassword,
      headers: { 'User-Agent': RUNNER_UA },
    });
    if (runnerSession.usuario?.rol !== 'admin') {
      throw new Error('El runner E2E temporal no quedó con rol administrador.');
    }

    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify(
        {
          ...runnerSession,
          _testing: {
            username: runnerUsername,
            password: runnerPassword,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    // Recién cuando el runner temporal quedó guardado se cierra la sesión real.
    await closeApiSession(api, realSession);
    realSession = null;
  } catch (error) {
    // Si falla el setup después de crear algo, la misma sesión admin real
    // elimina inmediatamente cualquier residuo E2E marcado.
    if (realSession) {
      try {
        await apiResult(api, 'e2e_cleanup', {
          method: 'POST',
          data: { confirmacion: 'LIMPIAR_PLAYWRIGHT' },
          session: realSession,
          headers: { 'User-Agent': SETUP_UA },
        });
      } catch (_cleanupError) {}
    }
    fs.rmSync(AUTH_FILE, { force: true });
    throw error;
  } finally {
    if (realSession) {
      try { await closeApiSession(api, realSession); } catch (_error) {}
    }
    await api.dispose();
  }
};
