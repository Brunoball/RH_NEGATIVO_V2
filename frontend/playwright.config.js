const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const { envBoolean, loadTestEnv } = require('./tests/helpers/env.helper');

loadTestEnv(__dirname);

const apiUrl = String(process.env.PW_API_URL || '').replace(/\/+$/, '');
const baseUrl = String(process.env.PW_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const backendHealth = `${/\/api\.php$/i.test(apiUrl) ? apiUrl : `${apiUrl}/api.php`}?action=health`;
const backendDir = path.resolve(__dirname, process.env.PW_BACKEND_DIR || '../backend');

const webServer = [];
if (envBoolean('PW_START_BACKEND', false)) {
  webServer.push({
    command: process.env.PW_PHP_COMMAND || 'php -S localhost:3001',
    cwd: backendDir,
    url: backendHealth,
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
    url: baseUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'ignore',
    env: {
      ...process.env,
      BROWSER: 'none',
      CI: 'true',
      REACT_APP_API_URL: apiUrl,
      REACT_APP_E2E: '1',
    },
  });
}

module.exports = defineConfig({
  testDir: './tests',
  testIgnore: ['**/auth.setup.js', '**/auth.teardown.js'],
  globalSetup: require.resolve('./tests/auth.setup.js'),
  globalTeardown: require.resolve('./tests/auth.teardown.js'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: baseUrl,
    ignoreHTTPSErrors: false,
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
  webServer,
});
