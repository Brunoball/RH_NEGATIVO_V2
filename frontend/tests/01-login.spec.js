const { test, expect } = require('@playwright/test');
const {
  REMEMBERED_ACCOUNT_KEY,
  SESSION_KEY,
  loginThroughUi,
  sessionFromPage,
} = require('./helpers/auth.helper');
const { cleanupLoginAuditByPrefix, expectApiError } = require('./helpers/api.helper');
const { loadTestEnv } = require('./helpers/env.helper');
const { uniqueSuffix } = require('./helpers/data.helper');

loadTestEnv();

const privateRoutes = [
  '/panel',
  '/socios',
  '/socios/personas',
  '/socios/empresas',
  '/socios/familias',
  '/cuotas',
  '/categorias',
  '/categorias/descuentos',
  '/contable',
  '/contable/ingresos',
  '/contable/egresos',
  '/contable/resumen',
  '/configuracion',
  '/configuracion/catalogos',
  '/configuracion/usuarios',
  '/configuracion/contable',
  '/ruta-inexistente',
];

test.describe('Login y sesión', () => {
  test.afterEach(() => {
    for (const prefix of ['pw_e2e_invalido_', 'pw_e2e_largo', 'pw_e2e_lock_']) {
      try {
        cleanupLoginAuditByPrefix(prefix);
      } catch (_error) {
        // La limpieza directa solo se habilita en el entorno local de testing.
      }
    }
  });
  test('protege todas las rutas privadas cuando no existe una sesión', async ({ page }) => {
    for (const route of privateRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    }
    await expect(page.getByPlaceholder('Usuario')).toBeVisible();
    await expect(page.getByPlaceholder('Contraseña')).toHaveAttribute('type', 'password');
  });

  test('aplica atributos del formulario y restaura todas las credenciales recordadas', async ({ page }) => {
    const username = process.env.PW_USER;
    await page.addInitScript(
      ({ rememberedKey, sessionKey, account }) => {
        localStorage.setItem(rememberedKey, JSON.stringify({ usuario: account, contrasena: 'NO_GUARDAR' }));
        localStorage.setItem(sessionKey, JSON.stringify({ token: 'LEGACY_TOKEN' }));
      },
      { rememberedKey: REMEMBERED_ACCOUNT_KEY, sessionKey: SESSION_KEY, account: username },
    );

    await page.goto('/');
    const userInput = page.getByPlaceholder('Usuario');
    const passwordInput = page.getByPlaceholder('Contraseña');

    await expect(userInput).toHaveAttribute('required', '');
    await expect(userInput).toHaveAttribute('maxlength', '100');
    await expect(userInput).toHaveAttribute('autocomplete', 'username');
    await expect(passwordInput).toHaveAttribute('required', '');
    await expect(passwordInput).toHaveAttribute('maxlength', '255');
    await expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
    await expect(userInput).toHaveValue(username);
    await expect(passwordInput).toHaveValue('NO_GUARDAR');
    await expect(page.getByRole('checkbox', { name: /Recordar cuenta/i })).toBeChecked();

    const storage = await page.evaluate(
      ({ rememberedKey, sessionKey }) => ({
        remembered: JSON.parse(localStorage.getItem(rememberedKey) || 'null'),
        legacySession: localStorage.getItem(sessionKey),
      }),
      { rememberedKey: REMEMBERED_ACCOUNT_KEY, sessionKey: SESSION_KEY },
    );
    expect(storage.remembered).toEqual({ usuario: username, contrasena: 'NO_GUARDAR' });
    expect(storage.legacySession).toBeNull();
    expect(storage.remembered.contrasena).toBe('NO_GUARDAR');
  });

  test('la validación nativa impide enviar campos vacíos', async ({ page }) => {
    await page.goto('/');
    const userInput = page.getByPlaceholder('Usuario');
    const passwordInput = page.getByPlaceholder('Contraseña');
    await page.getByRole('button', { name: /^Ingresar$/ }).click();
    expect(await userInput.evaluate((element) => element.validity.valueMissing)).toBe(true);

    await userInput.fill('usuario');
    await page.getByRole('button', { name: /^Ingresar$/ }).click();
    expect(await passwordInput.evaluate((element) => element.validity.valueMissing)).toBe(true);
  });

  test('valida credenciales, muestra la contraseña, recuerda la cuenta y cierra sesión', async ({ page }) => {
    const username = process.env.PW_USER;
    const password = process.env.PW_PASSWORD;
    const invalidUsername = `pw_e2e_invalido_${uniqueSuffix().toLowerCase()}`;

    await page.goto('/');
    const userInput = page.getByPlaceholder('Usuario');
    const passwordInput = page.getByPlaceholder('Contraseña');
    const toggle = page.getByRole('button', { name: /^(Mostrar|Ocultar) contraseña$/ });
    const remember = page.getByRole('checkbox', { name: /Recordar cuenta/i });

    await userInput.fill(invalidUsername);
    await passwordInput.fill('credencial-incorrecta');
    await toggle.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await toggle.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');

    const invalidResponse = page.waitForResponse(
      (response) => response.url().includes('action=auth_login') && response.status() === 401,
    );
    await page.getByRole('button', { name: /^Ingresar$/ }).click();
    await invalidResponse;
    await expect(page.locator('.ini_mensaje-error')).toContainText(
      'Usuario o contraseña incorrectos.',
    );
    await expect(page).toHaveURL(/\/$/);

    await userInput.fill(username);
    await passwordInput.fill(password);
    await remember.setChecked(true);
    await Promise.all([
      page.waitForURL(/\/panel$/),
      page.getByRole('button', { name: /^Ingresar$/ }).click(),
    ]);

    await expect(page.getByRole('heading', { name: 'Panel de gestión' })).toBeVisible();
    const session = await sessionFromPage(page);
    expect(session?.token).toBeTruthy();
    expect(session?.usuario?.rol).toBe('admin');

    const remembered = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, REMEMBERED_ACCOUNT_KEY);
    expect(remembered).toEqual({ usuario: username, contrasena: password });
    expect(remembered.contrasena).toBe(password);

    await page.getByTitle('Cerrar sesión').click();
    const logoutDialog = page
      .getByRole('dialog')
      .filter({ hasText: 'Confirmar cierre de sesión' });
    await expect(logoutDialog).toBeVisible();
    await logoutDialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(/\/panel$/);

    await page.getByTitle('Cerrar sesión').click();
    await Promise.all([
      page.waitForURL(/\/$/),
      page
        .getByRole('dialog')
        .filter({ hasText: 'Confirmar cierre de sesión' })
        .getByRole('button', { name: 'Confirmar', exact: true })
        .click(),
    ]);

    await expect(page.getByPlaceholder('Usuario')).toHaveValue(username);
    await expect(page.getByPlaceholder('Contraseña')).toHaveValue(password);
    await expect(page.getByRole('checkbox', { name: /Recordar cuenta/i })).toBeChecked();
    const storedSession = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
    expect(storedSession).toBeNull();

    await page.getByRole('checkbox', { name: /Recordar cuenta/i }).uncheck();
    await page.reload();
    await expect(page.getByPlaceholder('Usuario')).toHaveValue('');
    await expect(page.getByPlaceholder('Contraseña')).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: /Recordar cuenta/i })).not.toBeChecked();
  });

  test('el cierre sigue mostrando el login aunque el servidor responda 401 en paralelo', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginThroughUi(page, {
      username: process.env.PW_USER,
      password: process.env.PW_PASSWORD,
    });

    await page.route(/api\.php\?action=auth_logout(?:&|$)/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: false,
          codigo: 'UNAUTHORIZED',
          mensaje: 'La sesión ya no es válida.',
        }),
      });
    });

    await page.getByTitle('Cerrar sesión').click();
    await page
      .getByRole('dialog')
      .filter({ hasText: 'Confirmar cierre de sesión' })
      .getByRole('button', { name: 'Confirmar', exact: true })
      .click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.waitForTimeout(400);
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test('el modal de cierre responde a Escape sin cerrar la sesión', async ({ page }) => {
    await loginThroughUi(page, {
      username: process.env.PW_USER,
      password: process.env.PW_PASSWORD,
    });
    await page.getByTitle('Cerrar sesión').click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Confirmar cierre de sesión' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/panel$/);
    expect((await sessionFromPage(page))?.token).toBeTruthy();
  });

  test('una sesión vencida o corrupta se elimina y redirige al login', async ({ page }) => {
    await page.addInitScript(
      ({ key }) => {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            token: 'TOKEN_VENCIDO',
            expira_en: '2000-01-01T00:00:00-03:00',
            usuario: { nombre: 'vencido', rol: 'admin' },
          }),
        );
      },
      { key: SESSION_KEY },
    );
    await page.goto('/socios/personas');
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  });

  test('el backend rechaza login incompleto y contraseñas fuera del límite', async ({ request }) => {
    await expectApiError(
      request,
      'auth_login',
      { method: 'POST', data: { usuario: '', contrasena: '' }, session: null },
      { status: 422, code: 'VALIDATION_ERROR', message: 'Ingresá usuario y contraseña.' },
    );
    await expectApiError(
      request,
      'auth_login',
      {
        method: 'POST',
        data: { usuario: 'pw_e2e_largo', contrasena: 'x'.repeat(256) },
        session: null,
      },
      { status: 401, code: 'INVALID_CREDENTIALS' },
    );
  });

  test('bloquea temporalmente una cuenta tras cinco intentos fallidos consecutivos', async ({ request }) => {
    const username = `pw_e2e_lock_${uniqueSuffix().toLowerCase()}`;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expectApiError(
        request,
        'auth_login',
        {
          method: 'POST',
          data: { usuario: username, contrasena: 'incorrecta' },
          session: null,
        },
        { status: 401, code: 'INVALID_CREDENTIALS' },
      );
    }

    const locked = await expectApiError(
      request,
      'auth_login',
      {
        method: 'POST',
        data: { usuario: username, contrasena: 'incorrecta' },
        session: null,
      },
      { status: 429, code: 'LOGIN_LOCKED', message: /bloqueado/i },
    );
    expect(Number(locked.headers['retry-after'] || 0)).toBeGreaterThan(0);
    expect(Number(locked.body?.detalles?.reintentar_en_segundos || 0))
      .toBeGreaterThan(0);
  });

});
