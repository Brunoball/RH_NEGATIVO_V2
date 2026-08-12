const path = require('path');
const { test, expect } = require('./fixtures/auth.fixture');
const { personData } = require('./fixtures/socios.fixture');
const {
  actionUrl,
  apiCall,
  cleanupContableOptionByName,
  cleanupSocioByDocument,
  readAuthSession,
} = require('./helpers/api.helper');
const { createPerson } = require('./helpers/entities.helper');
const { exportFromGlobalModal } = require('./helpers/download.helper');
const { lettersFromSuffix, todayIso, uniqueSuffix } = require('./helpers/data.helper');

const suffix = uniqueSuffix();
const textSuffix = lettersFromSuffix(suffix);
const date = todayIso();
const [year, month] = date.split('-').map(Number);
const names = {
  incomeProvider: `PW EE PROVEEDOR ING ${textSuffix}`,
  incomeCategory: `PW EE CAT ING ${textSuffix}`,
  incomeConcept: `PW EE CONCEPTO ING ${textSuffix}`,
  expenseProvider: `PW EE PROVEEDOR EGR ${textSuffix}`,
  expenseCategory: `PW EE CAT EGR ${textSuffix}`,
  expenseConcept: `PW EE CONCEPTO EGR ${textSuffix}`,
};
const incomeDetail = `PW E2E UI INGRESO ${suffix}`;
const incomeEdited = `${incomeDetail} EDITADO`;
const expenseDetail = `PW E2E UI EGRESO ${suffix}`;
const expenseEdited = `${expenseDetail} EDITADO`;
const validPdf = path.join(__dirname, 'fixtures', 'files', 'comprobante-e2e.pdf');
const invalidFile = path.join(__dirname, 'fixtures', 'files', 'archivo-invalido.txt');
const accountingYearPerson = personData();
const previousYear = year - 1;
const futurePeriodYear = year + 1;
const accountingPaymentDate = `${previousYear}-${String(month).padStart(2, '0')}-07`;

function rowByText(page, tableName, text) {
  return page
    .getByRole('table', { name: tableName })
    .getByRole('row')
    .filter({ hasText: text })
    .last();
}

async function activeCategoryAndMedium(request) {
  const categories = await apiCall(request, 'categorias_listar', {
    params: { estado: 'activo' },
  });
  const category = (categories.items || []).find(
    (item) => item.activo && Number(item.monto_actual || 0) > 0,
  );
  expect(category).toBeTruthy();

  const quotasCatalogs = await apiCall(request, 'cuotas_catalogos');
  const medium = quotasCatalogs.catalogos?.medios_pago?.[0];
  expect(medium).toBeTruthy();
  return { category, medium };
}

async function addInlineOption(page, dialog, selectLabel, optionName) {
  await dialog.getByLabel(selectLabel).selectOption('__ADD__');
  const optionDialog = page.locator('.contable-option-modal');
  await expect(optionDialog).toBeVisible();
  await optionDialog.getByLabel('Nombre *').fill(optionName);
  await optionDialog.getByRole('button', { name: 'Agregar opción' }).click();
  await expect(optionDialog).toHaveCount(0);
  await expect(dialog.getByLabel(selectLabel)).toHaveValue(/\d+/);
}

async function cleanupMovements(request) {
  const incomes = await apiCall(request, 'contable_ingresos_listar', {
    params: { anio: year, mes: month, buscar: suffix },
  }).catch(() => ({ items: [] }));
  for (const item of incomes.items || []) {
    await apiCall(request, 'contable_ingreso_eliminar', {
      method: 'POST',
      data: { id_ingreso: item.id_ingreso },
    }).catch(() => undefined);
  }

  const expenses = await apiCall(request, 'contable_egresos_listar', {
    params: { anio: year, mes: month, buscar: suffix },
  }).catch(() => ({ items: [] }));
  for (const item of expenses.items || []) {
    await apiCall(request, 'contable_egreso_eliminar', {
      method: 'POST',
      data: { id_egreso: item.id_egreso },
    }).catch(() => undefined);
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Contabilidad completa desde la interfaz', () => {
  test.afterEach(async ({ request }) => {
    await cleanupMovements(request);
    for (const [type, name] of [
      ['PROVEEDOR', names.incomeProvider],
      ['CATEGORIA_INGRESO', names.incomeCategory],
      ['CONCEPTO_INGRESO', names.incomeConcept],
      ['PROVEEDOR', names.expenseProvider],
      ['CATEGORIA_EGRESO', names.expenseCategory],
      ['CONCEPTO_EGRESO', names.expenseConcept],
    ]) {
      await cleanupContableOptionByName(request, type, name).catch(() => undefined);
    }
  });

  test('cierra los modales por Cancelar, X y Escape, y protege el formulario ante clicks de fondo', async ({ page }) => {
    await page.goto('/contable/ingresos');
    await page.getByRole('tab', { name: 'Otros ingresos' }).click();

    await page.getByRole('button', { name: 'Registrar ingreso' }).first().click();
    let dialog = page.getByRole('dialog', { name: 'Registrar ingreso' });
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Registrar ingreso' }).first().click();
    dialog = page.getByRole('dialog', { name: 'Registrar ingreso' });
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Registrar ingreso' }).first().click();
    dialog = page.getByRole('dialog', { name: 'Registrar ingreso' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Registrar ingreso' }).first().click();
    dialog = page.getByRole('dialog', { name: 'Registrar ingreso' });
    await page.locator('.entity-modal-overlay').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
  });

  test('exporta ingresos de socios en Excel y PDF y mantiene esa vista sin acciones de mutación', async ({ page }) => {
    await page.route(/api\.php\?action=contable_ingresos_socios(?:&|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: true,
          items: [{
            id_pago: 930001,
            fecha: date,
            socio: 'PW E2E SOCIO CONTABLE',
            dni: '99999991',
            categoria: 'PW E2E CATEGORÍA SOCIO',
            periodo: `${String(month).padStart(2, '0')}/${year}`,
            medio: 'EFECTIVO',
            monto: '1234.56',
            monto_estimado: false,
          }],
          resumen: { registros: 1, importe: '1234.56', estimados: 0, categorias: [] },
        }),
      });
    });

    await page.goto('/contable/ingresos');
    await expect(page.getByRole('tab', { name: 'Socios' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Registrar ingreso' })).toHaveCount(0);
    const table = page.getByRole('table', { name: 'Listado de ingresos' });
    await expect(table).toContainText('PW E2E SOCIO CONTABLE');
    await expect(table).toContainText('PW E2E CATEGORÍA SOCIO');
    await expect(table).toContainText('EFECTIVO');
    await expect(table).toContainText('1.234,56');

    const exportButton = page.getByRole('button', { name: 'Exportar', exact: true }).first();
    await exportFromGlobalModal(page, {
      openButton: exportButton,
      format: 'Excel',
      expectedExtension: '.xlsx',
    });
    await exportFromGlobalModal(page, {
      openButton: exportButton,
      format: 'PDF',
      expectedExtension: '.pdf',
    });
  });

  test('crea opciones dentro del formulario y completa alta, edición, Excel y eliminación de ingreso', async ({ page }) => {
    await page.goto('/contable/ingresos');
    await page.getByRole('tab', { name: 'Otros ingresos' }).click();
    await page.getByRole('button', { name: 'Registrar ingreso' }).first().click();

    let dialog = page.getByRole('dialog', { name: 'Registrar ingreso' });
    const incomeMediumSelect = dialog.getByLabel('Medio de pago *');
    await incomeMediumSelect.selectOption({ index: 1 });
    const incomeMediumLabel = String(
      await incomeMediumSelect.locator('option:checked').textContent(),
    ).trim();
    await addInlineOption(page, dialog, 'Persona / proveedor *', names.incomeProvider);
    await addInlineOption(page, dialog, 'Categoría *', names.incomeCategory);
    await addInlineOption(page, dialog, 'Descripción / concepto *', names.incomeConcept);
    await dialog.getByLabel('Importe (ARS) *').fill('1234.56');
    await dialog.getByLabel('Detalle opcional').fill(incomeDetail.toLowerCase());
    await expect(dialog.getByLabel('Detalle opcional')).toHaveValue(incomeDetail);
    await dialog.getByRole('button', { name: 'Guardar ingreso' }).click();
    await expect(dialog).toBeHidden();

    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(`${textSuffix.toLowerCase()}, ingreso`);
    await expect(rowByText(page, 'Listado de ingresos', suffix)).toBeVisible();
    await search.fill(suffix);
    let row = rowByText(page, 'Listado de ingresos', suffix);
    await expect(row).toContainText(incomeDetail);
    await expect(row).toContainText(names.incomeProvider);

    const incomeCategoryFilter = page.getByLabel('Categoría');
    const incomeMediumFilter = page.getByLabel('Medio de pago');
    await incomeCategoryFilter.selectOption({ label: names.incomeCategory });
    await incomeMediumFilter.selectOption({ label: incomeMediumLabel });
    await expect(rowByText(page, 'Listado de ingresos', suffix)).toBeVisible();
    await incomeCategoryFilter.selectOption('');
    await incomeMediumFilter.selectOption('');

    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar ingreso' });
    await dialog.getByLabel('Importe (ARS) *').fill('1500.75');
    await dialog.getByLabel('Detalle opcional').fill(incomeEdited);
    await dialog.getByRole('button', { name: 'Guardar ingreso' }).click();
    await expect(dialog).toBeHidden();

    row = rowByText(page, 'Listado de ingresos', suffix);
    await expect(row).toContainText(incomeEdited);

    await exportFromGlobalModal(page, {
      openButton: page.getByRole('button', { name: 'Exportar', exact: true }).first(),
      format: 'Excel',
      expectedExtension: '.xlsx',
    });
    await exportFromGlobalModal(page, {
      openButton: page.getByRole('button', { name: 'Exportar', exact: true }).first(),
      format: 'PDF',
      expectedExtension: '.pdf',
    });

    await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
    await expect(search).toHaveValue('');
    await search.fill(suffix);

    row = rowByText(page, 'Listado de ingresos', suffix);
    await row.getByTitle('Anular').click();
    const deleteDialog = page.getByRole('dialog').filter({ hasText: 'Eliminar ingreso' });
    await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(deleteDialog).toBeHidden();
    await row.getByTitle('Anular').click();
    await page.getByRole('dialog').filter({ hasText: 'Eliminar ingreso' })
      .getByRole('button', { name: 'Eliminar movimiento' }).click();
    await expect(rowByText(page, 'Listado de ingresos', suffix)).toHaveCount(0);
  });

  test('valida archivos y completa alta, descarga, vista, reemplazo, retiro, Excel y eliminación de egreso', async ({ page, request }) => {
    await page.goto('/contable/egresos');
    await page.getByRole('button', { name: 'Registrar egreso' }).first().click();
    let dialog = page.getByRole('dialog', { name: 'Registrar egreso' });

    await addInlineOption(page, dialog, 'Categoría *', names.expenseCategory);
    await addInlineOption(page, dialog, 'Proveedor *', names.expenseProvider);
    await addInlineOption(page, dialog, 'Descripción / concepto *', names.expenseConcept);
    const medium = dialog.getByLabel('Medio de pago *');
    await medium.selectOption({ index: 1 });
    const expenseMediumLabel = String(
      await medium.locator('option:checked').textContent(),
    ).trim();
    await dialog.getByLabel('N.º de comprobante').fill(`e2e-${suffix}`);
    await dialog.getByLabel('Importe (ARS) *').fill('432.10');
    await dialog.getByLabel('Detalle opcional').fill(expenseDetail.toLowerCase());

    await dialog.getByRole('tab', { name: 'Comprobante' }).click();
    await expect(dialog.getByText('Elegir archivo', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Arrastrá una imagen o PDF, o elegí un archivo.')).toBeVisible();
    const dropData = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(['%PDF-1.4\n%%EOF'], 'comprobante-arrastrado.pdf', {
          type: 'application/pdf',
        }),
      );
      return transfer;
    });
    await dialog.locator('.contable-upload').dispatchEvent('drop', {
      dataTransfer: dropData,
    });
    await expect(dialog).toContainText('comprobante-arrastrado.pdf');
    await dialog.getByRole('button', { name: 'Quitar comprobante' }).click();

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles(invalidFile);
    await expect(page.getByText('Solo se permiten PDF, JPG, PNG, GIF o WEBP.')).toBeVisible();

    await fileInput.setInputFiles({
      name: 'demasiado-grande.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 1),
    });
    await expect(page.getByText('El archivo no puede superar los 10 MB.')).toBeVisible();

    await fileInput.setInputFiles(validPdf);
    await expect(dialog).toContainText('comprobante-e2e.pdf');
    await dialog.getByRole('button', { name: 'Quitar comprobante' }).click();
    await expect(dialog.getByRole('button', { name: 'Quitar comprobante' })).toHaveCount(0);

    await fileInput.setInputFiles(validPdf);
    await expect(dialog).toContainText('comprobante-e2e.pdf');
    await dialog.getByRole('button', { name: 'Guardar egreso' }).click();
    await expect(dialog).toBeHidden();

    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(`${textSuffix.toLowerCase()}, egreso`);
    await expect(rowByText(page, 'Listado de egresos', suffix)).toBeVisible();
    await search.fill(suffix);
    let row = rowByText(page, 'Listado de egresos', suffix);
    await expect(row).toContainText(expenseDetail);
    await expect(row.getByTitle('Ver comprobante')).toBeEnabled();

    const expenseCategoryFilter = page.getByLabel('Categoría');
    const expenseMediumFilter = page.getByLabel('Medio de pago');
    await expenseCategoryFilter.selectOption({ label: names.expenseCategory });
    await expenseMediumFilter.selectOption({ label: expenseMediumLabel });
    await expect(rowByText(page, 'Listado de egresos', suffix)).toBeVisible();
    await expenseCategoryFilter.selectOption('');
    await expenseMediumFilter.selectOption('');

    const listed = await apiCall(request, 'contable_egresos_listar', {
      params: { anio: year, mes: month, buscar: suffix },
    });
    const savedExpense = (listed.items || []).find((item) =>
      String(item.detalle || '').includes(suffix),
    );
    expect(savedExpense?.id_egreso).toBeTruthy();
    const session = readAuthSession();
    const fileResponse = await request.fetch(
      actionUrl('contable_egreso_archivo', { id: savedExpense.id_egreso }),
      {
        headers: { Authorization: `Bearer ${session.token}` },
        failOnStatusCode: false,
      },
    );
    expect(fileResponse.status()).toBe(200);
    expect(fileResponse.headers()['content-type']).toMatch(/application\/pdf/i);
    const fileBody = await fileResponse.body();
    expect(fileBody.subarray(0, 4).toString('binary')).toBe('%PDF');

    await page.evaluate(() => {
      window.__pwOriginalOpen = window.open;
      window.__pwComprobantePreview = {
        html: '',
        focused: false,
      };
      window.open = () => ({
        closed: false,
        document: {
          title: '',
          body: { innerHTML: '' },
          open() {
            window.__pwComprobantePreview.html = '';
          },
          write(value) {
            window.__pwComprobantePreview.html += String(value);
          },
          close() {},
        },
        focus() {
          window.__pwComprobantePreview.focused = true;
        },
        close() {},
      });
    });

    const browserFileResponsePromise = page.waitForResponse((response) =>
      response.url().includes('action=contable_egreso_archivo') && response.status() === 200,
    );
    await row.getByTitle('Ver comprobante').click();
    const browserFileResponse = await browserFileResponsePromise;
    expect(browserFileResponse.headers()['content-type']).toMatch(/application\/pdf/i);
    await expect.poll(() => page.evaluate(() => window.__pwComprobantePreview.html))
      .toMatch(/<iframe[^>]+src="blob:/i);
    await expect.poll(() => page.evaluate(() => window.__pwComprobantePreview.focused))
      .toBe(true);
    await page.evaluate(() => {
      window.open = window.__pwOriginalOpen;
      delete window.__pwOriginalOpen;
      delete window.__pwComprobantePreview;
    });

    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar egreso' });
    await dialog.getByLabel('Detalle opcional').fill(expenseEdited);
    await dialog.getByRole('tab', { name: 'Comprobante' }).click();
    await dialog.getByRole('button', { name: 'Quitar comprobante' }).click();
    await dialog.getByRole('button', { name: 'Guardar egreso' }).click();
    await expect(dialog).toBeHidden();

    row = rowByText(page, 'Listado de egresos', suffix);
    await expect(row).toContainText(expenseEdited);
    await expect(row.getByTitle('Sin comprobante')).toBeDisabled();

    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar egreso' });
    await dialog.getByRole('tab', { name: 'Comprobante' }).click();
    await dialog.locator('input[type="file"]').setInputFiles(validPdf);
    await dialog.getByRole('button', { name: 'Guardar egreso' }).click();
    await expect(dialog).toBeHidden();
    row = rowByText(page, 'Listado de egresos', suffix);
    await expect(row.getByTitle('Ver comprobante')).toBeEnabled();

    await exportFromGlobalModal(page, {
      openButton: page.getByRole('button', { name: 'Exportar', exact: true }).first(),
      format: 'Excel',
      expectedExtension: '.xlsx',
    });
    await exportFromGlobalModal(page, {
      openButton: page.getByRole('button', { name: 'Exportar', exact: true }).first(),
      format: 'PDF',
      expectedExtension: '.pdf',
    });

    await row.getByTitle('Anular').click();
    const deleteDialog = page.getByRole('dialog').filter({ hasText: 'Eliminar egreso' });
    await deleteDialog.getByRole('button', { name: 'Eliminar movimiento' }).click();
    await expect(rowByText(page, 'Listado de egresos', suffix)).toHaveCount(0);
  });

  test('pagina ingresos y egresos con número, Anterior y Siguiente', async ({ page }) => {
    const makeIncome = (index) => ({
      id_ingreso: 910000 + index,
      fecha: date,
      id_medio_pago: 1,
      id_proveedor: 1,
      id_categoria: 1,
      id_concepto: 1,
      proveedor: `PROVEEDOR PÁGINA ${String(index).padStart(2, '0')}`,
      categoria: 'CATEGORÍA E2E',
      medio: 'EFECTIVO',
      concepto: `INGRESO PÁGINA ${String(index).padStart(2, '0')}`,
      detalle: `DETALLE INGRESO ${index}`,
      importe: '100.00',
    });
    const makeExpense = (index) => ({
      id_egreso: 920000 + index,
      fecha: date,
      id_medio_pago: 1,
      id_proveedor: 1,
      id_categoria: 1,
      id_concepto: 1,
      proveedor: `PROVEEDOR EGRESO ${String(index).padStart(2, '0')}`,
      categoria: 'CATEGORÍA E2E',
      medio: 'EFECTIVO',
      concepto: `EGRESO PÁGINA ${String(index).padStart(2, '0')}`,
      numero_comprobante: `PAG-${index}`,
      detalle: `DETALLE EGRESO ${index}`,
      importe: '50.00',
      tiene_archivo: false,
    });

    await page.route(/api\.php\?action=contable_ingresos_listar(?:&|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: true,
          items: Array.from({ length: 21 }, (_, index) => makeIncome(index + 1)),
          resumen: { registros: 21, importe: '2100.00' },
        }),
      });
    });
    await page.route(/api\.php\?action=contable_egresos_listar(?:&|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: true,
          items: Array.from({ length: 21 }, (_, index) => makeExpense(index + 1)),
          resumen: { registros: 21, importe: '1050.00' },
        }),
      });
    });

    await page.goto('/contable/ingresos');
    await page.getByRole('tab', { name: 'Otros ingresos' }).click();
    let pagination = page.getByRole('navigation', { name: 'Paginación de ingresos' });
    await expect(pagination).toContainText('1–10 de 21');
    await pagination.getByRole('button', { name: '2', exact: true }).click();
    await expect(pagination).toContainText('11–20 de 21');
    await expect(page.getByRole('table', { name: 'Listado de ingresos' })).toContainText('INGRESO PÁGINA 11');
    await pagination.getByRole('button', { name: 'Siguiente' }).click();
    await expect(pagination).toContainText('21–21 de 21');
    await pagination.getByRole('button', { name: 'Anterior' }).click();
    await expect(pagination).toContainText('11–20 de 21');

    await page.goto('/contable/egresos');
    pagination = page.getByRole('navigation', { name: 'Paginación de egresos' });
    await expect(pagination).toContainText('1–10 de 21');
    await pagination.getByRole('button', { name: '3', exact: true }).click();
    await expect(pagination).toContainText('21–21 de 21');
    await expect(page.getByRole('table', { name: 'Listado de egresos' })).toContainText('EGRESO PÁGINA 21');
    await pagination.getByRole('button', { name: 'Anterior' }).click();
    await expect(pagination).toContainText('11–20 de 21');
    await pagination.getByRole('button', { name: 'Siguiente' }).click();
    await expect(pagination).toContainText('21–21 de 21');
  });

  test('los años contables salen de la fecha real de cobro y la fila de socio no muestra el separador vacío', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    let paymentId = null;

    try {
      const saved = await createPerson(request, accountingYearPerson, {
        fecha_alta: `${previousYear}-01-01`,
        id_categoria: category.id_categoria,
        id_medio_pago: medium.id_medio_pago,
      });
      const context = await apiCall(request, 'cuotas_contexto_pago', {
        params: {
          id_socio: saved.id_socio,
          anio: futurePeriodYear,
          mes: month,
          fecha_pago: accountingPaymentDate,
        },
      });
      const payment = await apiCall(request, 'cuotas_registrar_pago', {
        method: 'POST',
        data: {
          id_socio: saved.id_socio,
          anio: futurePeriodYear,
          mes: month,
          fecha_pago: accountingPaymentDate,
          monto: context.principal.monto_sugerido,
          id_medio_pago: medium.id_medio_pago,
          aplicar_familia: false,
        },
      });
      paymentId = Number(payment.item.id_pago);

      const catalogs = await apiCall(request, 'contable_catalogos');
      expect((catalogs.anios || []).map(Number)).toContain(previousYear);

      const accountingIncome = await apiCall(request, 'contable_ingresos_socios', {
        params: { anio: previousYear, mes: month, buscar: accountingYearPerson.dni },
      });
      const item = (accountingIncome.items || []).find(
        (row) => Number(row.id_pago) === paymentId,
      );
      expect(item).toBeTruthy();
      expect(item.fecha).toBe(accountingPaymentDate);
      expect(item.periodo).toContain(String(futurePeriodYear));

      await page.goto('/contable/ingresos');
      const yearSelect = page.getByLabel('Año');
      await expect(yearSelect.locator(`option[value="${previousYear}"]`)).toHaveCount(1);
      await yearSelect.selectOption(String(previousYear));
      await page.getByLabel('Mes', { exact: true }).selectOption(String(month));
      await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(accountingYearPerson.dni);

      const row = rowByText(page, 'Listado de ingresos', accountingYearPerson.apellido);
      await expect(row).toBeVisible();
      await expect(row).toContainText(`Categoría: ${category.nombre}`);
      await expect(row).not.toContainText('· —');
      await expect(row).toContainText(String(futurePeriodYear));
    } finally {
      if (paymentId) {
        await apiCall(request, 'cuotas_eliminar_pago', {
          method: 'POST',
          data: { id_pago: paymentId },
        }).catch(() => undefined);
      }
      await cleanupSocioByDocument(request, {
        tipo: 'PERSONA',
        documento: accountingYearPerson.dni,
      }).catch(() => undefined);
    }
  });

  test('cambia entre resumen anual y mensual y aplica todos sus filtros', async ({ page }) => {
    await page.goto('/contable/resumen');
    await expect(page.getByRole('tab', { name: 'Anual' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Año')).toBeVisible();
    await expect(page.getByLabel('Mes', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('group', {
        name: 'Gráfico de barras de ingresos y egresos por mes',
      }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Detalle', exact: true }).click();
    const detailDialog = page.getByRole('dialog', { name: 'Detalle mensual contable' });
    await expect(detailDialog).toBeVisible();
    await expect(
      detailDialog.getByRole('table', { name: new RegExp(`Detalle mensual contable del año ${year}`) }),
    ).toBeVisible();
    await expect(detailDialog.getByRole('row')).toHaveCount(13); // encabezado + 12 meses
    await detailDialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(detailDialog).toBeHidden();

    await page.getByRole('tab', { name: 'Mensual' }).click();
    await expect(page.getByRole('tab', { name: 'Mensual' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Categorías de ingresos')).toBeVisible();
    await expect(page.getByText('Categorías de egresos')).toBeVisible();
    await expect(page.getByText('Medios de cobro')).toBeVisible();

    const yearSelect = page.getByLabel('Año');
    await yearSelect.selectOption(await yearSelect.inputValue());
    const monthSelect = page.getByLabel('Mes', { exact: true });
    await expect(monthSelect).toBeVisible();

    const otherMonth = month === 1 ? 2 : 1;
    const summaryRequest = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.searchParams.get('action') === 'contable_resumen' &&
        Number(url.searchParams.get('mes')) === otherMonth &&
        response.ok()
      );
    });
    await monthSelect.selectOption(String(otherMonth));
    const response = await summaryRequest;
    const body = await response.json();

    expect(body.resumen?.mes_seleccionado).toBe(otherMonth);
    expect(body.resumen?.totales_mes).toEqual(expect.objectContaining({
      mes: otherMonth,
      ingresos: expect.any(String),
      egresos: expect.any(String),
      resultado: expect.any(String),
    }));
    await expect(monthSelect).toHaveValue(String(otherMonth));
  });
});
