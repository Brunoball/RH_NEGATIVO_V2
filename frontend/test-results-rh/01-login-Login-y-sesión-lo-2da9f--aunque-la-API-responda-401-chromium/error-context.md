# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-login.spec.js >> Login y sesión >> logout local es resiliente aunque la API responda 401
- Location: tests\01-login.spec.js:145:3

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
        - checkbox "Recordar cuenta y contraseña" [ref=e26] [cursor=pointer]
        - generic [ref=e27]: Recordar cuenta y contraseña
      - button "Ingresar" [ref=e28] [cursor=pointer]
```

# Test source

```ts
  1  | const { expect } = require('@playwright/test');
  2  | 
  3  | const SESSION_KEY = 'rh_negativo_session';
  4  | const REMEMBERED_ACCOUNT_KEY = 'rh_negativo_recordar_cuenta';
  5  | 
  6  | async function loginThroughUi(page, { username, password, remember = false }) {
  7  |   await page.goto('/');
  8  |   await page.getByPlaceholder('Usuario').fill(username);
  9  |   await page.getByPlaceholder('Contraseña').fill(password);
  10 |   const rememberCheckbox = page.getByRole('checkbox', { name: /Recordar cuenta/i });
  11 |   if ((await rememberCheckbox.isChecked()) !== remember) {
  12 |     await rememberCheckbox.setChecked(remember);
  13 |   }
  14 |   await Promise.all([
> 15 |     page.waitForURL(/\/panel(?:$|\?)/),
     |          ^ Error: page.waitForURL: Test timeout of 60000ms exceeded.
  16 |     page.getByRole('button', { name: /^Ingresar$/ }).click(),
  17 |   ]);
  18 | }
  19 | 
  20 | async function expectFeedback(page, message) {
  21 |   const feedback = page.locator('.module-feedback, .toast-message, .ini_mensaje-error')
  22 |     .filter({ hasText: message })
  23 |     .last();
  24 |   await expect(feedback).toBeVisible();
  25 |   return feedback;
  26 | }
  27 | 
  28 | async function sessionFromPage(page) {
  29 |   return page.evaluate((key) => {
  30 |     const raw = sessionStorage.getItem(key);
  31 |     return raw ? JSON.parse(raw) : null;
  32 |   }, SESSION_KEY);
  33 | }
  34 | 
  35 | module.exports = {
  36 |   REMEMBERED_ACCOUNT_KEY,
  37 |   SESSION_KEY,
  38 |   expectFeedback,
  39 |   loginThroughUi,
  40 |   sessionFromPage,
  41 | };
  42 | 
```