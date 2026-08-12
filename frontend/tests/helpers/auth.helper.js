const { expect } = require('@playwright/test');

const SESSION_KEY = 'gestion_socios_session';
const REMEMBERED_ACCOUNT_KEY = 'gestion_socios_recordar_cuenta';

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

async function expectToast(page, message) {
  const toast = page.locator('.toast-message').filter({ hasText: message }).last();
  await expect(toast).toBeVisible();
  return toast;
}

async function dismissPersistentToast(page) {
  const close = page.getByRole('button', { name: 'Cerrar notificación' }).last();
  if (!(await close.isVisible().catch(() => false))) return;

  const toast = page.locator('.toast-container').filter({ has: close }).last();
  await close.click();
  await expect(toast).toBeHidden();
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
  dismissPersistentToast,
  expectToast,
  loginThroughUi,
  sessionFromPage,
};
