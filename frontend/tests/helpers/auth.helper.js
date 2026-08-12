const { expect } = require('@playwright/test');

const SESSION_KEY = 'rh_negativo_session';
const REMEMBERED_ACCOUNT_KEY = 'rh_negativo_recordar_cuenta';

async function loginThroughUi(page, { username, password, remember = false }) {
  await page.goto('/');
  await page.getByPlaceholder('Usuario').fill(username);
  await page.getByPlaceholder('Contraseña').fill(password);
  const rememberCheckbox = page.getByRole('checkbox', { name: /Recordar cuenta/i });
  if ((await rememberCheckbox.isChecked()) !== remember) {
    await rememberCheckbox.setChecked(remember);
  }
  await Promise.all([
    page.waitForURL(/\/panel(?:$|\?)/),
    page.getByRole('button', { name: /^Ingresar$/ }).click(),
  ]);
}

async function expectFeedback(page, message) {
  const feedback = page.locator('.module-feedback, .toast-message, .ini_mensaje-error')
    .filter({ hasText: message })
    .last();
  await expect(feedback).toBeVisible();
  return feedback;
}

async function sessionFromPage(page) {
  return page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SESSION_KEY);
}

module.exports = {
  REMEMBERED_ACCOUNT_KEY,
  SESSION_KEY,
  expectFeedback,
  loginThroughUi,
  sessionFromPage,
};
