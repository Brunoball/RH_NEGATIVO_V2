# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-login.spec.js >> Login y sesión >> validación explícita, mostrar contraseña, error, recordar, cancelar y confirmar logout
- Location: tests\01-login.spec.js:79:3

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.waitForURL: Test timeout of 60000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- main "Acceso a Círculo RH Negativo" [ref=e4]:
  - generic [ref=e7]:
    - img "Círculo RH Negativo"
    - generic [ref=e8]:
      - heading "Administración simple y centralizada" [level=2] [ref=e9]
      - paragraph [ref=e10]: Accedé a Círculo RH Negativo con una sesión segura y control de accesos centralizado.
  - generic [ref=e12]:
    - generic [ref=e13]:
      - heading "Iniciar sesión" [level=1] [ref=e14]
      - paragraph [ref=e15]: Ingresá tus credenciales para continuar al panel.
    - generic [ref=e16]:
      - textbox "Usuario" [ref=e18]: pw_e2e_runner_mtbk1r1t_860fa6
      - generic [ref=e19]:
        - textbox "Contraseña" [ref=e20]: PwE2E!d9bd5ae89332eb6bA9
        - button "Mostrar contraseña" [ref=e21] [cursor=pointer]
      - generic [ref=e25]:
        - checkbox "Recordar cuenta y contraseña" [checked] [ref=e26] [cursor=pointer]
        - generic [ref=e27]: Recordar cuenta y contraseña
      - button "Ingresar" [ref=e28] [cursor=pointer]
```

# Test source

```ts
  10  |   SESSION_KEY,
  11  |   loginThroughUi,
  12  |   sessionFromPage,
  13  | } = require('./helpers/auth.helper');
  14  | const { uniqueSuffix } = require('./helpers/data.helper');
  15  | 
  16  | const privateRoutes = [
  17  |   '/panel',
  18  |   '/socios',
  19  |   '/socios/personas',
  20  |   '/socios/familias',
  21  |   '/categorias',
  22  |   '/categorias/descuentos',
  23  |   '/cuotas',
  24  |   '/contable',
  25  |   '/contable/ingresos',
  26  |   '/contable/egresos',
  27  |   '/contable/resumen',
  28  |   '/configuracion',
  29  |   '/configuracion/usuarios',
  30  |   '/configuracion/catalogos',
  31  |   '/configuracion/contable',
  32  |   '/ruta-inexistente',
  33  | ];
  34  | 
  35  | test.describe('Login y sesión', () => {
  36  |   test('protege todas las rutas que se prueban en esta etapa', async ({ page }) => {
  37  |     for (const route of privateRoutes) {
  38  |       await page.goto(route);
  39  |       await expect(page).toHaveURL(/\/$/);
  40  |       await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  41  |     }
  42  |   });
  43  | 
  44  |   test('respeta atributos, compatibilidad de storage y cuenta recordada', async ({ page }) => {
  45  |     const { username } = readTestCredentials();
  46  |     await page.addInitScript(
  47  |       ({ rememberedKey, currentSessionKey, account }) => {
  48  |         localStorage.setItem(
  49  |           rememberedKey,
  50  |           JSON.stringify({ usuario: account, contrasena: 'PW-RECORDADA' }),
  51  |         );
  52  |         localStorage.setItem(currentSessionKey, JSON.stringify({ token: 'LEGACY' }));
  53  |         localStorage.setItem('gestion_socios_session', JSON.stringify({ token: 'LEGACY-2' }));
  54  |       },
  55  |       { rememberedKey: REMEMBERED_ACCOUNT_KEY, currentSessionKey: SESSION_KEY, account: username },
  56  |     );
  57  | 
  58  |     await page.goto('/');
  59  |     const user = page.getByPlaceholder('Usuario');
  60  |     const password = page.getByPlaceholder('Contraseña');
  61  |     await expect(user).not.toHaveAttribute('required', '');
  62  |     await expect(user).toHaveAttribute('maxlength', '100');
  63  |     await expect(user).toHaveAttribute('autocomplete', 'username');
  64  |     await expect(password).not.toHaveAttribute('required', '');
  65  |     await expect(password).toHaveAttribute('maxlength', '255');
  66  |     await expect(password).toHaveAttribute('autocomplete', 'current-password');
  67  |     await expect(user).toHaveValue(username);
  68  |     await expect(password).toHaveValue('PW-RECORDADA');
  69  |     await expect(page.getByRole('checkbox', { name: /Recordar cuenta/i })).toBeChecked();
  70  | 
  71  |     const legacy = await page.evaluate((key) => ({
  72  |       current: localStorage.getItem(key),
  73  |       old: localStorage.getItem('gestion_socios_session'),
  74  |     }), SESSION_KEY);
  75  |     expect(legacy.current).toBeNull();
  76  |     expect(legacy.old).toBeNull();
  77  |   });
  78  | 
  79  |   test('validación explícita, mostrar contraseña, error, recordar, cancelar y confirmar logout', async ({ page }) => {
  80  |     const { username, password } = readTestCredentials();
  81  |     const invalidUsername = `pw_e2e_invalido_${uniqueSuffix().toLowerCase()}`;
  82  | 
  83  |     await page.goto('/');
  84  |     const user = page.getByPlaceholder('Usuario');
  85  |     const pass = page.getByPlaceholder('Contraseña');
  86  |     const enter = page.getByRole('button', { name: /^Ingresar$/ });
  87  |     await enter.click();
  88  |     await expect(page.getByRole('status')).toContainText('Ingresá tu usuario.');
  89  |     await user.fill('x');
  90  |     await enter.click();
  91  |     await expect(page.getByRole('status')).toContainText('Ingresá tu contraseña.');
  92  | 
  93  |     await user.fill(invalidUsername);
  94  |     await pass.fill('INCORRECTA');
  95  |     const toggle = page.getByRole('button', { name: /^(Mostrar|Ocultar) contraseña$/ });
  96  |     await toggle.click();
  97  |     await expect(pass).toHaveAttribute('type', 'text');
  98  |     await toggle.click();
  99  |     await expect(pass).toHaveAttribute('type', 'password');
  100 | 
  101 |     await Promise.all([
  102 |       page.waitForResponse((r) => r.url().includes('action=auth_login') && r.status() === 401),
  103 |       enter.click(),
  104 |     ]);
  105 |     await expect(page.getByRole('status')).toContainText('Usuario o contraseña incorrectos.');
  106 | 
  107 |     await user.fill(username);
  108 |     await pass.fill(password);
  109 |     await page.getByRole('checkbox', { name: /Recordar cuenta/i }).check();
> 110 |     await Promise.all([page.waitForURL(/\/panel$/), enter.click()]);
      |                             ^ Error: page.waitForURL: Test timeout of 60000ms exceeded.
  111 |     await expect(page.getByRole('heading', { name: 'Panel de gestión' })).toBeVisible();
  112 |     const session = await sessionFromPage(page);
  113 |     expect(session?.token).toBeTruthy();
  114 |     expect(session?.usuario?.rol).toBe('admin');
  115 | 
  116 |     const remembered = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), REMEMBERED_ACCOUNT_KEY);
  117 |     expect(remembered).toEqual({ usuario: username, contrasena: password });
  118 | 
  119 |     await page.getByTitle('Cerrar sesión').click();
  120 |     let dialog = page.getByRole('dialog').filter({ hasText: 'Confirmar cierre de sesión' });
  121 |     await dialog.getByRole('button', { name: 'Cancelar' }).click();
  122 |     await expect(page).toHaveURL(/\/panel$/);
  123 | 
  124 |     await page.getByTitle('Cerrar sesión').click();
  125 |     dialog = page.getByRole('dialog').filter({ hasText: 'Confirmar cierre de sesión' });
  126 |     await page.keyboard.press('Escape');
  127 |     await expect(dialog).toBeHidden();
  128 | 
  129 |     await page.getByTitle('Cerrar sesión').click();
  130 |     dialog = page.getByRole('dialog').filter({ hasText: 'Confirmar cierre de sesión' });
  131 |     await Promise.all([
  132 |       page.waitForURL(/\/$/),
  133 |       dialog.getByRole('button', { name: 'Confirmar', exact: true }).click(),
  134 |     ]);
  135 |     await expect(page.getByPlaceholder('Usuario')).toHaveValue(username);
  136 |     await expect(page.getByPlaceholder('Contraseña')).toHaveValue(password);
  137 |     expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  138 | 
  139 |     await page.getByRole('checkbox', { name: /Recordar cuenta/i }).uncheck();
  140 |     await page.reload();
  141 |     await expect(page.getByPlaceholder('Usuario')).toHaveValue('');
  142 |     await expect(page.getByPlaceholder('Contraseña')).toHaveValue('');
  143 |   });
  144 | 
  145 |   test('logout local es resiliente aunque la API responda 401', async ({ page }) => {
  146 |     const { username, password } = readTestCredentials();
  147 |     await loginThroughUi(page, { username, password });
  148 |     await page.route(/api\.php\?action=auth_logout(?:&|$)/, (route) =>
  149 |       route.fulfill({
  150 |         status: 401,
  151 |         contentType: 'application/json',
  152 |         body: JSON.stringify({ exito: false, mensaje: 'Sesión vencida' }),
  153 |       }),
  154 |     );
  155 |     await page.getByTitle('Cerrar sesión').click();
  156 |     await Promise.all([
  157 |       page.waitForURL(/\/$/),
  158 |       page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click(),
  159 |     ]);
  160 |     await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  161 |   });
  162 | 
  163 |   test('descarta sesión corrupta o vencida', async ({ page }) => {
  164 |     await page.goto('/');
  165 |     for (const stored of [
  166 |       '{no-json',
  167 |       JSON.stringify({ token: 'TOKEN', expira_en: '2000-01-01T00:00:00-03:00', usuario: { rol: 'admin' } }),
  168 |     ]) {
  169 |       await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
  170 |         key: SESSION_KEY,
  171 |         value: stored,
  172 |       });
  173 |       await page.goto('/socios/personas');
  174 |       await expect(page).toHaveURL(/\/$/);
  175 |       await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  176 |     }
  177 |   });
  178 | 
  179 |   test('API valida la sesión actual del runner autenticado y logout invalida una sesión independiente', async ({ request }) => {
  180 |     const result = await apiResult(request, 'auth_usuario_actual');
  181 |     expect(result.status).toBe(200);
  182 |     expect(result.body?.usuario?.rol).toBe('admin');
  183 |     expect(result.body?.usuario?.id).toBeTruthy();
  184 |     expect(result.body?.organizacion).toBeTruthy();
  185 | 
  186 |     const { username, password } = readTestCredentials();
  187 |     const login = await apiResult(request, 'auth_login', {
  188 |       method: 'POST',
  189 |       data: { usuario: username, contrasena: password },
  190 |       session: null,
  191 |     });
  192 |     expect(login.status).toBe(200);
  193 |     const secondarySession = {
  194 |       token: login.body.token,
  195 |       expira_en: login.body.expira_en,
  196 |       usuario: login.body.usuario,
  197 |       organizacion: login.body.organizacion,
  198 |     };
  199 | 
  200 |     const logout = await apiResult(request, 'auth_logout', {
  201 |       method: 'POST', data: {}, session: secondarySession,
  202 |     });
  203 |     expect(logout.status).toBe(200);
  204 |     const expired = await apiResult(request, 'auth_usuario_actual', { session: secondarySession });
  205 |     expect(expired.status).toBe(401);
  206 |   });
  207 | 
  208 |   test('API valida campos, credenciales largas y bloqueo por 5 intentos', async () => {
  209 |     const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
  210 |     try {
```