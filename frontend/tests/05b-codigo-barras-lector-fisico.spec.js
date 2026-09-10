const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, readAuthSession } = require('./helpers/api.helper');
const { SESSION_KEY } = require('./helpers/auth.helper');
const {
  createQuotaCategory,
  createQuotaSocio,
  currentYear,
  quotaCatalogs,
} = require('./helpers/cuotas.helper');

async function setupQuotaPartner(request, label) {
  const category = await createQuotaCategory(request);
  const socio = await createQuotaSocio(request, label, category.item.id_categoria);
  const catalogs = await quotaCatalogs(request);
  return { category, socio, catalogs };
}

async function openBarcodeReader(page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/cuotas');
  await expect(page).toHaveURL(/\/cuotas(?:$|\?)/);
  await expect(page.getByRole('heading', { name: 'Cuotas' })).toBeVisible();

  let role = await page.evaluate((key) => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || 'null')?.usuario?.rol || null;
    } catch (_error) {
      return null;
    }
  }, SESSION_KEY);

  if (role !== 'admin') {
    const saved = readAuthSession();
    const browserSession = {
      token: saved.token,
      expira_en: saved.expira_en,
      usuario: saved.usuario,
      organizacion: saved.organizacion,
    };
    await page.evaluate(({ key, value }) => {
      sessionStorage.setItem(key, JSON.stringify(value));
    }, { key: SESSION_KEY, value: browserSession });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Cuotas' })).toBeVisible();
    role = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) || 'null')?.usuario?.rol || null,
      SESSION_KEY,
    );
  }

  expect(role).toBe('admin');
  const barcodeButton = page.getByRole('button', { name: 'Cód. barras', exact: true });
  await expect(barcodeButton).toBeVisible();
  await barcodeButton.click();

  const dialog = page.getByRole('dialog', { name: 'Registro por código de barras' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Cuotas · lector físico de código de barras', () => {
  test('scanner USB escribe carácter a carácter, no muestra error fugaz y Enter no envía el formulario', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'BARCODE SCANNER USB');
    const periodId = Number(
      catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes,
    );
    const context = await apiCall(request, 'cuotas_contexto_pago', {
      params: {
        id_socio: socio.item.id_socio,
        anio: currentYear(),
        mes: periodId,
      },
    });

    const barcode = String(context.principal.codigo_barra || '');
    expect(barcode).toMatch(/^\d{3}-\d+$/);

    const dialog = await openBarcodeReader(page);
    const codeInput = dialog.getByLabel('Código de barras');
    const alert = dialog.getByRole('alert');
    await expect(codeInput).toBeFocused();

    // Regresión 1: los primeros caracteres que manda la pistola no deben
    // disparar el viejo error rojo instantáneo. El error de un código realmente
    // incompleto sólo aparece después del debounce del lector (280 ms).
    await codeInput.pressSequentially('1', { delay: 10 });
    await page.waitForTimeout(120);
    await expect(alert).toHaveCount(0);
    await page.waitForTimeout(220);
    await expect(alert).toBeVisible();

    await codeInput.fill('');
    await expect(alert).toHaveCount(0);

    // Regresión 2: un lector USB/HID termina el escaneo enviando Enter. Antes
    // ese Enter podía hacer submit nativo del <form> de CrudModal y recargar la
    // pantalla antes de que finalizara cuotas_contexto_pago.
    const mainFrameNavigations = [];
    const onFrameNavigated = (frame) => {
      if (frame === page.mainFrame()) mainFrameNavigations.push(frame.url());
    };
    page.on('framenavigated', onFrameNavigated);

    let contextRequests = 0;
    const onRequest = (req) => {
      if (req.url().includes('action=cuotas_contexto_pago')) contextRequests += 1;
    };
    page.on('request', onRequest);

    await codeInput.pressSequentially(barcode, { delay: 12 });
    await codeInput.press('Enter');

    // El Enter de la pistola no debe cerrar, recargar ni navegar el modal.
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/cuotas(?:$|\?)/);
    await expect(codeInput).toHaveValue(barcode);
    expect(mainFrameNavigations).toHaveLength(0);

    // Se consulta una sola vez el código completo y se muestra la información
    // real del socio. El Enter no debe provocar una segunda lectura.
    await expect(dialog.getByText(socio.data.nombre, { exact: true })).toBeVisible();
    await expect(alert).toHaveCount(0);
    await expect.poll(() => contextRequests).toBe(1);
    await page.waitForTimeout(350);
    expect(contextRequests).toBe(1);

    page.off('framenavigated', onFrameNavigated);
    page.off('request', onRequest);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  });
});
