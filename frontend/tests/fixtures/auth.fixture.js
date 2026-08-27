const base = require('@playwright/test');
const {
  normalizedApiBase,
  readAuthSession,
} = require('../helpers/api.helper');
const { SESSION_KEY } = require('../helpers/auth.helper');

function browserSession(saved) {
  return {
    token: saved.token,
    expira_en: saved.expira_en,
    usuario: saved.usuario,
    organizacion: saved.organizacion,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHostinger() {
  return String(process.env.PW_ENVIRONMENT || '').toLowerCase() === 'hostinger';
}

const test = base.test.extend({
  page: async ({ page }, use, testInfo) => {
    // Una sola sesión temporal por corrida, creada por auth.setup.js.
    // No abrimos/cerramos sesiones por spec: en Hostinger eso agregaba logins
    // innecesarios y terminó generando 500 adicionales durante la suite larga.
    const saved = readAuthSession();
    const session = browserSession(saved);
    const appOrigin = new URL(process.env.PW_BASE_URL || 'http://localhost:3000').origin;

    await page.addInitScript(
      ({ origin, key, value }) => {
        try {
          if (window.location.origin === origin) {
            window.sessionStorage.setItem(key, JSON.stringify(value));
          }
        } catch (_error) {
          // about:blank puede bloquear sessionStorage antes de navegar.
        }
      },
      { origin: appOrigin, key: SESSION_KEY, value: session },
    );

    // El hosting compartido no necesita retries: necesita evitar que Playwright
    // dispare una ráfaga artificial de varias requests de la SPA en el mismo
    // milisegundo. Espaciamos sólo el INICIO de requests reales a la API remota.
    // La respuesta no se altera: cualquier HTTP 500 sigue llegando y falla.
    if (isHostinger()) {
      const configured = Number(process.env.PW_HOSTINGER_BROWSER_API_GAP_MS || 120);
      const gapMs = Number.isFinite(configured) ? Math.max(0, Math.min(1000, configured)) : 120;
      let nextSlotAt = 0;

      await page.route(/\/api\/routes\/api\.php(?:\?|$)/, async (route) => {
        if (gapMs > 0) {
          const now = Date.now();
          const scheduled = Math.max(now, nextSlotAt);
          nextSlotAt = scheduled + gapMs;
          const delay = scheduled - now;
          if (delay > 0) await sleep(delay);
        }
        await route.continue();
      });

      // También dejamos un margen pequeño entre casos para que el shared hosting
      // libere PHP/MySQL antes de iniciar el siguiente flujo E2E.
      const testGapConfigured = Number(process.env.PW_HOSTINGER_TEST_GAP_MS || 220);
      const testGapMs = Number.isFinite(testGapConfigured)
        ? Math.max(0, Math.min(1500, testGapConfigured))
        : 220;
      if (testGapMs) await sleep(testGapMs);
    }

    const technicalFailures = [];
    page.on('pageerror', (error) => technicalFailures.push(`Error JavaScript: ${error.message}`));
    page.on('response', (response) => {
      const url = response.url();
      if (url.startsWith(normalizedApiBase()) && response.status() >= 500) {
        technicalFailures.push(`HTTP ${response.status()} en ${url}`);
      }
    });

    await use(page);

    if (technicalFailures.length) {
      await testInfo.attach('fallos-tecnicos.txt', {
        body: Buffer.from([...new Set(technicalFailures)].join('\n'), 'utf8'),
        contentType: 'text/plain',
      });
      if (!testInfo.errors.length) throw new Error([...new Set(technicalFailures)].join('\n'));
    }
  },
});

module.exports = { expect: base.expect, test };
