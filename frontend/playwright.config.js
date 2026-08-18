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

function isLocalUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
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

const webServer = [];

if (process.env.PW_START_BACKEND !== 'false' && isLocalUrl(apiURL)) {
  webServer.push({
    command: `php -S ${localServerAddress(apiURL, '3001')}`,
    cwd: path.resolve(__dirname, '..', 'backend'),
    url: actionUrl('health'),
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  });
}

if (process.env.PW_START_FRONTEND !== 'false' && isLocalUrl(baseURL)) {
  webServer.push({
    command: 'npm start',
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

  // Cada test conserva su límite individual, pero la suite completa NO se
  // corta por tiempo. La corrida RH actual tarda varios minutos por diseño.
  timeout: 60_000,
  globalTimeout: 0,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 0,

  globalSetup: require.resolve('./tests/auth.setup.js'),
  globalTeardown: require.resolve('./tests/auth.teardown.js'),

  outputDir: 'test-results-rh',
  reporter: [
    ['list'],
    ['./tests/reporters/check-reporter.js', {
      outputFolder: 'test-results-rh',
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

  webServer: webServer.length === 1 ? webServer[0] : webServer,
});
