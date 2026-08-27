# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-navegacion.spec.js >> Shell · navegación de módulos incluidos >> sidebar navega Dashboard, Socios/Familias, Cuotas, Categorías y Contabilidad completa
- Location: tests\01-navegacion.spec.js:15:3

# Error details

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: 'Socios', exact: true })
    - locator resolved to <button type="button" class="pp-nav__item " aria-expanded="false" title="Un clic para desplegar; doble clic para ingresar">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is not stable
  - retrying click action
    - waiting for element to be visible, enabled and stable
  - element was detached from the DOM, retrying

```

```
Error: apiRequestContext._wrapApiCall: Target page, context or browser has been closed
```