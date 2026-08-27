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

const SETUP_UA = 'PW-RH-E2E-SETUP/2.0';
const RUNNER_UA = 'PW-RH-E2E-RUNNER/2.0';
const BASELINE_FILE = path.join(__dirname, '.auth', 'baseline.json');

function skippedCleanup(body) {
  return body?.datos?.omitidos_por_seguridad || body?.omitidos_por_seguridad || {};
}

module.exports = async function globalSetup() {
  loadTestEnv(path.resolve(__dirname, '..'));
  const realUsername = process.env.PW_USER;
  const realPassword = process.env.PW_PASSWORD;
  if (!realUsername || !realPassword) {
    throw new Error(
      `Faltan credenciales para ${process.env.PW_ENVIRONMENT || 'el entorno seleccionado'} en .env.test.`,
    );
  }

  fs.rmSync(AUTH_FILE, { force: true });
  fs.rmSync(BASELINE_FILE, { force: true });

  const api = await request.newContext({
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: { 'User-Agent': SETUP_UA },
  });
  let realSession = null;

  try {
    const health = await apiResult(api, 'health', { session: null });
    if (!health.ok || health.body?.servicio !== 'rh-negativo-api') {
      throw new Error(
        `La API configurada no se identificó como RH Negativo (${process.env.PW_API_URL}).`,
      );
    }

    realSession = await createApiSession(api, {
      username: realUsername,
      password: realPassword,
      headers: { 'User-Agent': SETUP_UA },
    });
    if (realSession.usuario?.rol !== 'admin') {
      throw new Error('El usuario configurado para preparar E2E debe ser administrador.');
    }

    // Probe obligatorio: si el router no está ejecutando el guard fail-closed,
    // el handler devolverá 500 y la corrida se detiene antes de tocar datos.
    const probe = await apiResult(api, 'e2e_guard_probe', {
      method: 'POST',
      data: {},
      session: realSession,
      headers: { 'User-Agent': SETUP_UA },
    });
    if (probe.status !== 409 || probe.body?.codigo !== 'E2E_SCOPE_BLOCKED') {
      const extra = probe.status === 404
        ? ' En Hostinger faltan los archivos/rutas de testing_safety o no se desplegaron.'
        : '';
      throw new Error(
        `El guard E2E no está activo: HTTP ${probe.status}, código=${probe.body?.codigo || 'sin código'}.${extra}`,
      );
    }

    const staleCleanup = await apiResult(api, 'e2e_cleanup', {
      method: 'POST',
      data: { confirmacion: 'LIMPIAR_PLAYWRIGHT' },
      session: realSession,
      headers: { 'User-Agent': SETUP_UA },
    });
    if (!staleCleanup.ok) {
      throw new Error(
        `No se pudo ejecutar la limpieza E2E preventiva: ${staleCleanup.body?.mensaje || staleCleanup.status}`,
      );
    }
    if (Object.keys(skippedCleanup(staleCleanup.body)).length) {
      throw new Error(
        `La limpieza preventiva omitió elementos por seguridad: ${JSON.stringify(skippedCleanup(staleCleanup.body))}`,
      );
    }

    const residue = await apiCall(api, 'e2e_residuos', {
      session: realSession,
      headers: { 'User-Agent': SETUP_UA },
    });
    if (Number(residue.datos?.total || 0) !== 0) {
      throw new Error(`Quedaron residuos E2E antes de empezar: ${JSON.stringify(residue.datos?.conteos || {})}`);
    }

    // Baseline de datos NO-E2E. La huella ignora únicamente el namespace de
    // Playwright y el heartbeat ultimo_uso de sesiones.
    const fingerprint = await apiCall(api, 'e2e_integridad', {
      session: realSession,
      headers: { 'User-Agent': SETUP_UA },
    });
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(fingerprint.datos, null, 2), 'utf8');

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

    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify({
        ...runnerSession,
        _testing: { username: runnerUsername, password: runnerPassword },
      }, null, 2),
      'utf8',
    );

    await closeApiSession(api, realSession);
    realSession = null;
    console.log(
      `[Playwright safety] Entorno=${process.env.PW_ENVIRONMENT}; API=${process.env.PW_API_URL}; ` +
        'cleanup inicial OK; baseline de datos reales guardado.',
    );
  } catch (error) {
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
    fs.rmSync(BASELINE_FILE, { force: true });
    throw error;
  } finally {
    if (realSession) {
      try { await closeApiSession(api, realSession); } catch (_error) {}
    }
    await api.dispose();
  }
};

module.exports.BASELINE_FILE = BASELINE_FILE;
