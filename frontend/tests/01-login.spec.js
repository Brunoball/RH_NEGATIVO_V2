const { test, expect, request: playwrightRequest } = require('@playwright/test');
const {
  actionUrl,
  apiResult,
  expectApiError,
  readTestCredentials,
} = require('./helpers/api.helper');
const {
  REMEMBERED_ACCOUNT_KEY,
  SESSION_KEY,
  loginThroughUi,
  sessionFromPage,
} = require('./helpers/auth.helper');
const { uniqueSuffix } = require('./helpers/data.helper');

const privateRoutes = [
  '/panel',
  '/socios',
  '/socios/personas',
  '/socios/familias',
  '/categorias',
  '/categorias/descuentos',
  '/cuotas',
  '/contable',
  '/contable/ingresos',
  '/contable/egresos',
  '/contable/resumen',
  '/configuracion',
  '/configuracion/usuarios',
  '/configuracion/catalogos',
  '/configuracion/contable',
  '/ruta-inexistente',
];

test.describe('Login y sesión', () => {
  test.beforeEach(async ({ page }) => {
    // Los tests de login no usan auth.fixture porque necesitan empezar sin sesión.
    // Igual deben identificarse como E2E aunque Playwright reutilice un frontend
    // que haya sido levantado normalmente sin REACT_APP_E2E=1.
    await page.route(/\/(?:api\/)?routes\/api\.php(?:\?|$)/, async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          'x-rh-e2e': 'PLAYWRIGHT',
        },
      });
    });
  });

  test('protege todas las rutas que se prueban en esta etapa', async ({ page }) => {
    for (const route of privateRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    }
  });

  test('respeta atributos, compatibilidad de storage y cuenta recordada', async ({ page }) => {
    const { username } = readTestCredentials();
    await page.addInitScript(
      ({ rememberedKey, currentSessionKey, account }) => {
        localStorage.setItem(
          rememberedKey,
          JSON.stringify({ usuario: account, contrasena: 'PW-RECORDADA' }),
        );
        localStorage.setItem(currentSessionKey, JSON.stringify({ token: 'LEGACY' }));
        localStorage.setItem('gestion_socios_session', JSON.stringify({ token: 'LEGACY-2' }));
      },
      { rememberedKey: REMEMBERED_ACCOUNT_KEY, currentSessionKey: SESSION_KEY, account: username },
    );

    await page.goto('/');
    const user = page.getByPlaceholder('Usuario');
    const password = page.getByPlaceholder('Contraseña');
    await expect(user).not.toHaveAttribute('required', '');
    await expect(user).toHaveAttribute('maxlength', '100');
    await expect(user).toHaveAttribute('autocomplete', 'username');
    await expect(password).not.toHaveAttribute('required', '');
    await expect(password).toHaveAttribute('maxlength', '255');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(user).toHaveValue(username);
    await expect(password).toHaveValue('PW-RECORDADA');
    await expect(page.getByRole('checkbox', { name: /Recordar cuenta/i })).toBeChecked();

    const legacy = await page.evaluate((key) => ({
      current: localStorage.getItem(key),
      old: localStorage.getItem('gestion_socios_session'),
    }), SESSION_KEY);
    expect(legacy.current).toBeNull();
    expect(legacy.old).toBeNull();
  });

  test('validación explícita, mostrar contraseña, error, recordar, cancelar y confirmar logout', async ({ page }) => {
    const { username, password } = readTestCredentials();
    const invalidUsername = `pw_e2e_invalido_${uniqueSuffix().toLowerCase()}`;

    await page.goto('/');
    const user = page.getByPlaceholder('Usuario');
    const pass = page.getByPlaceholder('Contraseña');
    const enter = page.getByRole('button', { name: /^Ingresar$/ });
    await enter.click();
    await expect(page.getByRole('status')).toContainText('Ingresá tu usuario.');
    await user.fill('x');
    await enter.click();
    await expect(page.getByRole('status')).toContainText('Ingresá tu contraseña.');

    await user.fill(invalidUsername);
    await pass.fill('INCORRECTA');
    const toggle = page.getByRole('button', { name: /^(Mostrar|Ocultar) contraseña$/ });
    await toggle.click();
    await expect(pass).toHaveAttribute('type', 'text');
    await toggle.click();
    await expect(pass).toHaveAttribute('type', 'password');

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('action=auth_login') && r.status() === 401),
      enter.click(),
    ]);
    await expect(page.getByRole('status')).toContainText('Usuario o contraseña incorrectos.');

    await user.fill(username);
    await pass.fill(password);
    await page.getByRole('checkbox', { name: /Recordar cuenta/i }).check();
    await Promise.all([page.waitForURL(/\/panel$/), enter.click()]);
    await expect(page.getByRole('heading', { name: 'Panel de gestión' })).toBeVisible();
    const session = await sessionFromPage(page);
    expect(session?.token).toBeTruthy();
    expect(session?.usuario?.rol).toBe('admin');

    const remembered = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), REMEMBERED_ACCOUNT_KEY);
    expect(remembered).toEqual({ usuario: username, contrasena: password });

    await page.getByTitle('Cerrar sesión').click();
    let dialog = page.getByRole('dialog').filter({ hasText: 'Confirmar cierre de sesión' });
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(/\/panel$/);

    await page.getByTitle('Cerrar sesión').click();
    dialog = page.getByRole('dialog').filter({ hasText: 'Confirmar cierre de sesión' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByTitle('Cerrar sesión').click();
    dialog = page.getByRole('dialog').filter({ hasText: 'Confirmar cierre de sesión' });
    await Promise.all([
      page.waitForURL(/\/$/),
      dialog.getByRole('button', { name: 'Confirmar', exact: true }).click(),
    ]);
    await expect(page.getByPlaceholder('Usuario')).toHaveValue(username);
    await expect(page.getByPlaceholder('Contraseña')).toHaveValue(password);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();

    await page.getByRole('checkbox', { name: /Recordar cuenta/i }).uncheck();
    await page.reload();
    await expect(page.getByPlaceholder('Usuario')).toHaveValue('');
    await expect(page.getByPlaceholder('Contraseña')).toHaveValue('');
  });

  test('logout local es resiliente aunque la API responda 401', async ({ page }) => {
    const { username, password } = readTestCredentials();
    await loginThroughUi(page, { username, password });
    await page.route(/api\.php\?action=auth_logout(?:&|$)/, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ exito: false, mensaje: 'Sesión vencida' }),
      }),
    );
    await page.getByTitle('Cerrar sesión').click();
    await Promise.all([
      page.waitForURL(/\/$/),
      page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click(),
    ]);
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  });

  test('descarta sesión corrupta o vencida', async ({ page }) => {
    await page.goto('/');
    for (const stored of [
      '{no-json',
      JSON.stringify({ token: 'TOKEN', expira_en: '2000-01-01T00:00:00-03:00', usuario: { rol: 'admin' } }),
    ]) {
      await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
        key: SESSION_KEY,
        value: stored,
      });
      await page.goto('/socios/personas');
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    }
  });

  test('API valida la sesión actual del runner autenticado y logout invalida una sesión independiente', async ({ request }) => {
    const result = await apiResult(request, 'auth_usuario_actual');
    expect(result.status).toBe(200);
    expect(result.body?.usuario?.rol).toBe('admin');
    expect(result.body?.usuario?.id).toBeTruthy();
    expect(result.body?.organizacion).toBeTruthy();

    const { username, password } = readTestCredentials();
    const login = await apiResult(request, 'auth_login', {
      method: 'POST',
      data: { usuario: username, contrasena: password },
      session: null,
    });
    expect(login.status).toBe(200);
    const secondarySession = {
      token: login.body.token,
      expira_en: login.body.expira_en,
      usuario: login.body.usuario,
      organizacion: login.body.organizacion,
    };

    const logout = await apiResult(request, 'auth_logout', {
      method: 'POST', data: {}, session: secondarySession,
    });
    expect(logout.status).toBe(200);
    const expired = await apiResult(request, 'auth_usuario_actual', { session: secondarySession });
    expect(expired.status).toBe(401);
  });

  test('API valida campos, credenciales largas y bloqueo por 5 intentos', async () => {
    const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: false });
    try {
      await expectApiError(api, 'auth_login', {
        method: 'POST', data: { usuario: '', contrasena: '' }, session: null,
      }, { code: 'VALIDATION_ERROR' });

      await expectApiError(api, 'auth_login', {
        method: 'POST', data: { usuario: `pw_e2e_largo_${uniqueSuffix()}`, contrasena: 'x'.repeat(256) }, session: null,
      }, { status: 401, code: 'INVALID_CREDENTIALS' });

      const lockedUser = `pw_e2e_lock_${uniqueSuffix().toLowerCase()}`;
      let last;
      for (let index = 0; index < 5; index += 1) {
        last = await apiResult(api, 'auth_login', {
          method: 'POST', data: { usuario: lockedUser, contrasena: 'incorrecta' }, session: null,
        });
      }
      expect(last.status).toBe(429);
      expect(last.body?.codigo).toBe('LOGIN_LOCKED');
      expect(Number(last.headers['retry-after'] || 0)).toBeGreaterThan(0);
    } finally {
      await api.dispose();
    }
  });
});
