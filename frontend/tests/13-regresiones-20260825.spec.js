const { test, expect } = require('./fixtures/auth.fixture');

async function forceScrollableTable(page, table, { top = 220, left = 120, windowY = 320 } = {}) {
  const body = table.getByRole('rowgroup');
  await expect(body).toBeVisible();
  await page.addStyleTag({
    content: `
      .pw-e2e-scroll-surface { max-height: 170px !important; overflow: auto !important; }
      .pw-e2e-scroll-surface > .global-divTable__row { min-width: 1800px !important; }
      html, body { min-height: 2600px !important; }
    `,
  });
  await body.evaluate((element, position) => {
    element.classList.add('pw-e2e-scroll-surface');
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
  }, { top, left });
  await page.evaluate((y) => window.scrollTo({ left: 0, top: y, behavior: 'auto' }), windowY);

  const position = await body.evaluate((element) => ({
    top: element.scrollTop,
    left: element.scrollLeft,
    maxTop: Math.max(0, element.scrollHeight - element.clientHeight),
    maxLeft: Math.max(0, element.scrollWidth - element.clientWidth),
  }));
  const actualWindowY = await page.evaluate(() => window.scrollY);
  expect(position.maxTop, 'El fixture debe producir scroll vertical real en la tabla').toBeGreaterThan(0);
  expect(position.maxLeft, 'El fixture debe producir scroll horizontal real en la tabla').toBeGreaterThan(0);
  expect(position.top).toBeGreaterThan(0);
  expect(position.left).toBeGreaterThan(0);
  expect(actualWindowY, 'La página debe tener scroll de ventana real para probar su restauración').toBeGreaterThan(0);
  return { body, top: position.top, left: position.left, windowY: actualWindowY };
}

async function expectScrollRestored(page, body, expected, { horizontal = true } = {}) {
  await expect.poll(async () => body.evaluate((element) => element.scrollTop), {
    message: 'El scroll vertical de la tabla debe volver a la posición previa al refresh',
  }).toBeGreaterThanOrEqual(Math.max(1, expected.top - 3));

  const restoredTop = await body.evaluate((element) => element.scrollTop);
  expect(Math.abs(restoredTop - expected.top)).toBeLessThanOrEqual(3);

  if (horizontal) {
    await expect.poll(async () => body.evaluate((element) => element.scrollLeft), {
      message: 'El scroll horizontal de la tabla debe volver a la posición previa al refresh',
    }).toBeGreaterThanOrEqual(Math.max(1, expected.left - 3));
    const restoredLeft = await body.evaluate((element) => element.scrollLeft);
    expect(Math.abs(restoredLeft - expected.left)).toBeLessThanOrEqual(3);
  }

  await expect.poll(async () => page.evaluate(() => window.scrollY), {
    message: 'El scroll de la ventana debe volver a la posición previa al refresh',
  }).toBeGreaterThanOrEqual(Math.max(1, expected.windowY - 3));
  const restoredWindowY = await page.evaluate(() => window.scrollY);
  expect(Math.abs(restoredWindowY - expected.windowY)).toBeLessThanOrEqual(3);
}

test.describe('Regresiones 25/08/2026 · scroll inteligente y refresh de tablas', () => {
  test('useSmartScrollRefresh conserva scroll vertical, horizontal y de ventana al refrescar Categorías', async ({ page }) => {
    let seed = null;
    await page.route(/api\.php\?[^#]*action=categorias_listar/, async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      seed = seed || (payload.items || [])[0] || {
        id_categoria: 990001,
        nombre: 'PW E2E SCROLL CATEGORIA',
        monto_mensual: '1000.00',
        monto_anual: '6000.00',
        cantidad_socios: 0,
        updated_at: '2026-08-25',
        activo: true,
      };
      const items = Array.from({ length: 36 }, (_, index) => ({
        ...seed,
        id_categoria: 990100 + index,
        nombre: `PW E2E SCROLL CATEGORIA ${String(index + 1).padStart(2, '0')}`,
        activo: true,
      }));
      await route.fulfill({
        response,
        contentType: 'application/json',
        body: JSON.stringify({
          ...payload,
          exito: true,
          items,
          resumen: {
            ...(payload.resumen || {}),
            total: items.length,
            activas: items.length,
            inactivas: 0,
          },
        }),
      });
    });

    await page.route(/api\.php\?[^#]*action=categorias_eliminar/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: true,
          mensaje: 'PW E2E baja simulada para refresh con scroll',
          item: { ...(seed || {}), activo: false },
        }),
      });
    });

    await page.setViewportSize({ width: 980, height: 620 });
    await page.goto('/categorias');
    const table = page.getByRole('table', { name: 'Listado de categorías' });
    await expect(table.getByRole('rowgroup').getByRole('row')).toHaveCount(36);

    const targetRow = table.getByRole('row').nth(12);
    await targetRow.getByTitle('Dar de baja').click();
    const dialog = page.getByRole('dialog', { name: 'Dar de baja la categoría' });
    await expect(dialog).toBeVisible();

    const before = await forceScrollableTable(page, table, {
      top: 260,
      left: 145,
      windowY: 360,
    });

    const refreshResponse = page.waitForResponse((response) =>
      response.request().method() === 'GET'
      && response.url().includes('action=categorias_listar'),
    );
    await dialog.getByRole('button', { name: 'Dar de baja', exact: true }).click();
    await refreshResponse;
    await expect(dialog).toBeHidden();
    await expect(table.getByRole('rowgroup').getByRole('row')).toHaveCount(36);
    await expectScrollRestored(page, before.body, before, { horizontal: true });
  });

  test('Contabilidad conserva posición al eliminar y recargar Otros ingresos', async ({ page }) => {
    const fakeItems = Array.from({ length: 34 }, (_, index) => ({
      id_ingreso: 991000 + index,
      fecha: '2026-08-25',
      proveedor: `PW E2E PROVEEDOR SCROLL ${String(index + 1).padStart(2, '0')}`,
      categoria: 'PW E2E CATEGORIA SCROLL',
      medio: 'EFECTIVO',
      concepto: 'PW E2E CONCEPTO SCROLL',
      detalle: `PW E2E DETALLE SCROLL ${index + 1}`,
      importe: String(1000 + index),
    }));

    await page.route(/api\.php\?[^#]*action=contable_ingresos_listar/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: true,
          items: fakeItems,
          resumen: {
            registros: fakeItems.length,
            importe: fakeItems.reduce((sum, item) => sum + Number(item.importe), 0).toFixed(2),
          },
        }),
      });
    });
    await page.route(/api\.php\?[^#]*action=contable_ingreso_eliminar/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: true,
          mensaje: 'PW E2E movimiento eliminado de forma simulada',
        }),
      });
    });

    await page.setViewportSize({ width: 980, height: 620 });
    await page.goto('/contable/ingresos');
    await page.getByRole('tab', { name: 'Otros ingresos', exact: true }).click();
    const table = page.getByRole('table', { name: 'Listado de ingresos' });
    const visibleRows = table.getByRole('rowgroup').getByRole('row');
    // Contable pagina los movimientos manuales de a 10. Los 34 registros
    // deben existir en el estado/paginador, pero sólo 10 se renderizan a la vez.
    await expect(visibleRows).toHaveCount(10);
    const pagination = page.getByRole('navigation', { name: 'Paginación de ingresos' });
    await expect(pagination).toContainText('34');
    await expect(pagination.getByRole('button', { name: '4', exact: true })).toBeVisible();

    const targetRow = visibleRows.nth(7);
    await targetRow.getByTitle('Anular').click();
    const dialog = page.getByRole('dialog', { name: 'Eliminar ingreso' });
    await expect(dialog).toBeVisible();

    const before = await forceScrollableTable(page, table, {
      top: 245,
      left: 130,
      windowY: 340,
    });

    const refreshResponse = page.waitForResponse((response) =>
      response.request().method() === 'GET'
      && response.url().includes('action=contable_ingresos_listar'),
    );
    await dialog.getByRole('button', { name: 'Eliminar movimiento', exact: true }).click();
    await refreshResponse;
    await expect(dialog).toBeHidden();
    await expect(visibleRows).toHaveCount(10);
    await expect(pagination).toContainText('34');

    // Contable.jsx mantiene su restauración vertical propia y la posición de
    // la ventana. El hook compartido cubre además scrollLeft en el test previo.
    await expectScrollRestored(page, before.body, before, { horizontal: false });
  });
});
