const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const { envBoolean, loadTestEnv } = require('./tests/helpers/env.helper');

loadTestEnv(__dirname);

const baseURL = process.env.PW_BASE_URL || 'http://localhost:3000';
const apiBase = String(
  process.env.PW_API_URL || 'http://localhost:3001/routes',
).replace(/\/+$/, '');
const backendHealthUrl =
  process.env.PW_BACKEND_HEALTH_URL ||
  `${/\/api\.php$/i.test(apiBase) ? apiBase : `${apiBase}/api.php`}?action=dashboard_resumen`;

const webServer = [];
if (envBoolean('PW_START_BACKEND', true)) {
  webServer.push({
    command:
      process.env.PW_PHP_COMMAND ||
      'php -S localhost:3001',
    cwd: path.resolve(__dirname, process.env.PW_BACKEND_DIR || '../backend'),
    url: backendHealthUrl,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  });
}
if (envBoolean('PW_START_FRONTEND', true)) {
  webServer.push({
    command: process.env.PW_FRONTEND_COMMAND || 'npm start',
    cwd: __dirname,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'ignore',
    env: {
      ...process.env,
      BROWSER: 'none',
    },
  });
}

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  globalSetup: require.resolve('./tests/auth.setup.js'),
  globalTeardown: require.resolve('./tests/auth.teardown.js'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: webServer.length ? webServer : undefined,
});
