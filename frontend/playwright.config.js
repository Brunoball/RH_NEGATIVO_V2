const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const { loadTestEnv } = require('./tests/helpers/env.helper');
const { actionUrl } = require('./tests/helpers/api.helper');

loadTestEnv(__dirname);

const baseURL = String(process.env.PW_BASE_URL || 'http://localhost:3000')
  .trim()
  .replace(/\/+$/, '');
const apiURL = String(process.env.PW_API_URL || 'http://localhost:3001/routes')
  .trim()
  .replace(/\/+$/, '');

// Se mantiene local al config para que Playwright no dependa de que una
// versión vieja de env.helper.js exporte isLocalUrl.
function isLocalUrl(value) {
  try {
    const host = new URL(String(value || '').trim()).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch (_error) {
    return false;
  }
}

function localServerAddress(value, fallbackPort) {
  const parsed = new URL(value);
  const host = parsed.hostname === '::1' ? '[::1]' : parsed.hostname;
  const port = parsed.port || fallbackPort;
  return `${host}:${port}`;
}

const backendDir = path.resolve(__dirname, process.env.PW_BACKEND_DIR || '../backend');
const frontendCommand = String(process.env.PW_FRONTEND_COMMAND || 'npm start').trim();
const phpCommand = String(
  process.env.PW_PHP_COMMAND || `php -S ${localServerAddress(apiURL, '3001')}`,
).trim();
const webServer = [];

if (process.env.PW_START_BACKEND !== 'false' && isLocalUrl(apiURL)) {
  webServer.push({
    command: phpCommand,
    cwd: backendDir,
    url: actionUrl('health'),
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  });
}

if (process.env.PW_START_FRONTEND !== 'false' && isLocalUrl(baseURL)) {
  webServer.push({
    command: frontendCommand,
    cwd: __dirname,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'ignore',
    env: {
      ...process.env,
      BROWSER: 'none',
      REACT_APP_API_URL: apiURL,
    },
  });
}

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js$/,
  timeout: 60_000,
  globalTimeout: 0,
  expect: { timeout: 10_000 },

  // La suite modifica datos E2E temporales y los limpia por prefijo. Mantener
  // un único worker evita carreras entre altas/bajas y hace reproducible el
  // mismo flujo tanto en local como en Hostinger.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 0,

  globalSetup: require.resolve('./tests/auth.setup.js'),
  globalTeardown: require.resolve('./tests/auth.teardown.js'),

  // Se usa el nombre estándar para no mantener test-results y test-results-rh.
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['./tests/reporters/check-reporter.js', {
      outputFolder: 'test-results',
      outputFile: 'resultado.txt',
      quiet: true,
    }],
  ],

  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: webServer.length === 0
    ? undefined
    : (webServer.length === 1 ? webServer[0] : webServer),
});
