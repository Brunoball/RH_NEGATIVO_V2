const path = require('path');
const base = require('@playwright/test');
const { readAuthSession, normalizedApiBase } = require('../helpers/api.helper');
const { SESSION_KEY } = require('../helpers/auth.helper');
const { normalizedBotApiBase } = require('../helpers/bot.helper');

const test = base.test.extend({
  page: async ({ page }, use, testInfo) => {
    const session = readAuthSession();
    const appOrigin = new URL(process.env.PW_BASE_URL || 'http://localhost:3000').origin;
    const isBotSpec = path.basename(testInfo.file || '') === '14-panel-bot.spec.js';
    await page.addInitScript(
      ({ origin, key, value }) => {
        try {
          if (window.location.origin === origin) {
            window.sessionStorage.setItem(key, JSON.stringify(value));
          }
        } catch (_error) {
          // about:blank puede bloquear sessionStorage antes de la primera navegación.
        }
      },
      { origin: appOrigin, key: SESSION_KEY, value: session },
    );

    const technicalFailures = [];
    page.on('pageerror', (error) => {
      technicalFailures.push(`Error JavaScript: ${error.message}`);
    });
    page.on('response', (response) => {
      const url = response.url();
      let isLocalBotProxy = false;
      try {
        isLocalBotProxy = new URL(url).searchParams.get('action') === 'bot_panel_proxy';
      } catch (_error) {
        // Una URL no válida seguirá tratándose como cualquier otra respuesta.
      }
      const monitoredApi =
        url.startsWith(normalizedApiBase()) || url.startsWith(normalizedBotApiBase());

      // Principal consulta el Panel Bot en segundo plano para mostrar su badge.
      // Cuando Hostinger o el certificado local no están disponibles, esa función
      // opcional no debe hacer fallar pruebas de Dashboard, Socios, Cuotas, etc.
      // El spec del Panel Bot sí conserva el monitoreo estricto del proxy.
      const optionalBotFailure = isLocalBotProxy && !isBotSpec;
      if (monitoredApi && response.status() >= 500 && !optionalBotFailure) {
        technicalFailures.push(`HTTP ${response.status()} en ${url}`);
      }
    });

    await use(page);

    if (technicalFailures.length) {
      await testInfo.attach('fallos-tecnicos.txt', {
        body: Buffer.from(technicalFailures.join('\n'), 'utf8'),
        contentType: 'text/plain',
      });
      if (!testInfo.errors.length) {
        throw new Error(technicalFailures.join('\n'));
      }
    }
  },
});

module.exports = { expect: base.expect, test };
