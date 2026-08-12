const fs = require('fs');
const { request } = require('@playwright/test');
const {
  AUTH_FILE,
  apiResult,
  closeApiSession,
} = require('./helpers/api.helper');
const { envBoolean, loadTestEnv } = require('./helpers/env.helper');

loadTestEnv();

function cleanupSummary(body) {
  const deleted = body?.datos?.eliminados || body?.eliminados || {};
  const skipped = body?.datos?.omitidos_por_seguridad || body?.omitidos_por_seguridad || {};

  const totalDeleted = Object.values(deleted).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );

  return {
    totalDeleted,
    deleted,
    skipped,
  };
}

module.exports = async function globalTeardown() {
  if (!fs.existsSync(AUTH_FILE)) return;

  const session = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  const api = await request.newContext({ ignoreHTTPSErrors: true });
  let cleanupError = null;

  try {
    if (envBoolean('PW_FINAL_CLEANUP', true)) {
      const cleanup = await apiResult(api, 'e2e_cleanup', {
        method: 'POST',
        data: { confirmacion: 'LIMPIAR_PLAYWRIGHT' },
        session,
      });

      if (!cleanup.ok) {
        const detail = cleanup.body?.detalle || cleanup.body?.detalles || '';
        cleanupError = new Error(
          `Falló la limpieza final E2E (HTTP ${cleanup.status}): ` +
            `${cleanup.body?.mensaje || 'respuesta inválida del backend'}` +
            `${detail ? `\nDetalle backend: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}` : ''}`,
        );
      } else {
        const summary = cleanupSummary(cleanup.body);
        console.log(
          `[Playwright cleanup] ${summary.totalDeleted} registro(s)/archivo(s) E2E eliminados.`,
        );
        if (Object.keys(summary.skipped).length > 0) {
          console.warn(
            '[Playwright cleanup] Elementos omitidos por seguridad:',
            summary.skipped,
          );
        }
      }
    }
  } catch (error) {
    cleanupError = error;
  } finally {
    try {
      await closeApiSession(api, session);
    } catch (logoutError) {
      console.warn(
        '[Playwright teardown] No se pudo cerrar la sesión de testing:',
        logoutError?.message || logoutError,
      );
    }

    await api.dispose();
    fs.rmSync(AUTH_FILE, { force: true });
  }

  if (cleanupError) throw cleanupError;
};
