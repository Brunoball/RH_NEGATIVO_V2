const fs = require('fs');
const { request } = require('@playwright/test');
const { AUTH_FILE, apiResult } = require('./helpers/api.helper');
const { envBoolean, loadTestEnv } = require('./helpers/env.helper');

loadTestEnv();

function cleanupSummary(body) {
  const deleted = body?.datos?.eliminados || body?.eliminados || {};
  const skipped = body?.datos?.omitidos_por_seguridad || body?.omitidos_por_seguridad || {};
  return {
    totalDeleted: Object.values(deleted).reduce((sum, value) => sum + (Number(value) || 0), 0),
    deleted,
    skipped,
  };
}

module.exports = async function globalTeardown() {
  if (!fs.existsSync(AUTH_FILE)) return;

  const session = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  const api = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'User-Agent': 'PW-RH-E2E-TEARDOWN/1.0' },
  });
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
        const autoIncrement = cleanup.body?.datos?.auto_increment || cleanup.body?.auto_increment;
        if (autoIncrement?.verificado !== true) {
          cleanupError = new Error(
            'La limpieza final E2E eliminó los registros, pero no confirmó el reinicio de AUTO_INCREMENT.',
          );
        }
        console.log(`[Playwright cleanup] ${summary.totalDeleted} registro(s) E2E eliminados.`);
        if (autoIncrement?.verificado === true) {
          console.log(
            `[Playwright cleanup] AUTO_INCREMENT verificado en ${Number(autoIncrement.tablas_detectadas) || 0} tabla(s); ` +
              `${Number(autoIncrement.tablas_reiniciadas) || 0} contador(es) corregido(s).`,
          );
        }
        if (Object.keys(summary.skipped).length) {
          console.warn('[Playwright cleanup] Omitidos por seguridad:', summary.skipped);
        }
      }
    }
  } catch (error) {
    cleanupError = error;
  } finally {
    await api.dispose();
    fs.rmSync(AUTH_FILE, { force: true });
  }

  if (cleanupError) throw cleanupError;
};
