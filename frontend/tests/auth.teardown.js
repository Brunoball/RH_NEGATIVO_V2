const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');
const { AUTH_FILE, apiCall, apiResult } = require('./helpers/api.helper');
const { envBoolean, loadTestEnv } = require('./helpers/env.helper');

loadTestEnv();
const BASELINE_FILE = path.join(__dirname, '.auth', 'baseline.json');

function cleanupSummary(body) {
  const deleted = body?.datos?.eliminados || body?.eliminados || {};
  const skipped = body?.datos?.omitidos_por_seguridad || body?.omitidos_por_seguridad || {};
  return {
    totalDeleted: Object.values(deleted).reduce((sum, value) => sum + (Number(value) || 0), 0),
    skipped,
  };
}

module.exports = async function globalTeardown() {
  if (!fs.existsSync(AUTH_FILE)) return;

  const session = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  const api = await request.newContext({
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: { 'User-Agent': 'PW-RH-E2E-TEARDOWN/2.0' },
  });
  const failures = [];

  try {
    // Primero comparamos la integridad mientras la sesión E2E todavía existe.
    // Las filas E2E se excluyen de la huella, así que cualquier diferencia es
    // un cambio real fuera del namespace de Playwright.
    if (fs.existsSync(BASELINE_FILE)) {
      try {
        const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
        const current = await apiCall(api, 'e2e_integridad', { session });
        if (baseline.sha256 !== current.datos?.sha256) {
          const changed = [];
          const tables = new Set([
            ...Object.keys(baseline.tablas || {}),
            ...Object.keys(current.datos?.tablas || {}),
          ]);
          for (const table of [...tables].sort()) {
            const before = baseline.tablas?.[table];
            const after = current.datos?.tablas?.[table];
            if (JSON.stringify(before) !== JSON.stringify(after)) changed.push({ table, before, after });
          }
          failures.push(
            new Error(`La huella de datos reales cambió durante el testing: ${JSON.stringify(changed)}`),
          );
        } else {
          console.log('[Playwright safety] Integridad OK: ningún registro NO E2E cambió durante la corrida.');
        }
      } catch (error) {
        failures.push(error);
      }
    } else {
      failures.push(new Error('No existe baseline de integridad E2E.'));
    }

    if (envBoolean('PW_FINAL_CLEANUP', true)) {
      try {
        const cleanup = await apiResult(api, 'e2e_cleanup', {
          method: 'POST',
          data: { confirmacion: 'LIMPIAR_PLAYWRIGHT' },
          session,
        });
        if (!cleanup.ok) {
          failures.push(new Error(
            `Falló la limpieza final E2E (HTTP ${cleanup.status}): ${cleanup.body?.mensaje || 'respuesta inválida'}`,
          ));
        } else {
          const summary = cleanupSummary(cleanup.body);
          console.log(`[Playwright cleanup] ${summary.totalDeleted} registro(s)/archivo(s) E2E eliminados.`);
          if (Object.keys(summary.skipped).length) {
            failures.push(new Error(
              `La limpieza final omitió elementos por seguridad: ${JSON.stringify(summary.skipped)}`,
            ));
          }
        }
      } catch (error) {
        failures.push(error);
      }
    }
  } finally {
    await api.dispose();
    fs.rmSync(AUTH_FILE, { force: true });
    fs.rmSync(BASELINE_FILE, { force: true });
  }

  if (failures.length) {
    throw new Error(failures.map((error) => error?.message || String(error)).join('\n'));
  }
};
