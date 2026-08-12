const { test, expect } = require('./fixtures/auth.fixture');
const { companyData, familyData, personData } = require('./fixtures/socios.fixture');
const {
  apiCall,
  cleanupCategoriesByPrefix,
  cleanupFamilyByPrefix,
  cleanupSocioByDocument,
  cleanupSocioById,
} = require('./helpers/api.helper');
const { createCompany, createFamily, createPerson } = require('./helpers/entities.helper');
const { captureDownload, exportFromGlobalModal } = require('./helpers/download.helper');
const { todayIso } = require('./helpers/data.helper');

const singlePerson = personData();
const condonePerson = personData();
const singleCompany = companyData();
const batchPersonOne = personData();
const batchPersonTwo = personData();
const batchPersonNoDni = personData();
let batchPersonNoDniId = null;
const multiMonthPerson = personData();
const paginationPerson = personData();
const historicalPricePerson = personData();
const familyUiPersonOne = personData();
const familyUiPersonTwo = personData();
const futureYearPerson = personData();
const uiFamily = familyData();
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;
const previousYear = currentYear - 1;
const secondaryMonth = currentMonth === 1 ? 2 : 1;
const historicalMonth = currentMonth === 1 ? 12 : currentMonth - 1;
const historicalYear = currentMonth === 1 ? previousYear : currentYear;
const monthNames = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const monthNamesUpper = monthNames.map((name) => name.toUpperCase());
const pad2 = (value) => String(value).padStart(2, '0');
const historicalCategoryName = `PW E2E CAT CUOTAS UI ${historicalPricePerson.suffix}`;

async function createHistoricalCategory(request) {
  const oldAmount = '1200.00';
  const currentAmount = '2400.00';
  const firstEffectiveYear = Math.max(2000, historicalYear - 1);
  const firstEffectiveDate = `${firstEffectiveYear}-01-01`;
  const changeDate = `${currentYear}-${pad2(currentMonth)}-01`;

  const created = await apiCall(request, 'categorias_guardar', {
    method: 'POST',
    data: {
      nombre: historicalCategoryName,
      descripcion: 'PW E2E HISTORIAL UI CUOTAS',
      monto_actual: oldAmount,
      vigente_desde: firstEffectiveDate,
    },
  });
  const updated = await apiCall(request, 'categorias_guardar', {
    method: 'POST',
    data: {
      id_categoria: created.item.id_categoria,
      nombre: historicalCategoryName,
      descripcion: 'PW E2E HISTORIAL UI CUOTAS',
      monto_actual: currentAmount,
      vigente_desde: changeDate,
    },
  });

  return {
    id_categoria: Number(updated.item.id_categoria),
    oldAmount: Number(oldAmount),
    currentAmount: Number(currentAmount),
  };
}

async function activeCategoryAndMedium(request) {
  const categories = await apiCall(request, 'categorias_listar', {
    params: { estado: 'activo' },
  });
  const category = (categories.items || []).find(
    (item) => item.activo && Number(item.monto_actual || 0) > 0,
  );
  expect(category).toBeTruthy();

  const catalogs = await apiCall(request, 'cuotas_catalogos');
  const medium = catalogs.catalogos?.medios_pago?.[0];
  expect(medium).toBeTruthy();
  return { category, medium };
}

async function cleanupPerson(request, data) {
  await cleanupSocioByDocument(request, {
    tipo: 'PERSONA',
    documento: data.dni,
  }).catch(() => undefined);
}

async function cleanupCompany(request, data) {
  await cleanupSocioByDocument(request, {
    tipo: 'EMPRESA',
    documento: data.cuit,
  }).catch(() => undefined);
}

function debtRow(page, data) {
  return page
    .getByRole('table', { name: /Cuotas de socios adeudadas/i })
    .getByRole('row')
    .filter({ hasText: data.dni });
}

function paidRow(page, data) {
  return page
    .getByRole('table', { name: /Cuotas de socios pagadas/i })
    .getByRole('row')
    .filter({ hasText: data.dni });
}

function condonedRow(page, data) {
  return page
    .getByRole('table', { name: /Cuotas de socios condonadas/i })
    .getByRole('row')
    .filter({ hasText: data.dni });
}

async function selectPreferredMedium(dialog) {
  const medium = dialog.getByLabel('Medio de pago *');
  if (!(await medium.inputValue())) await medium.selectOption({ index: 1 });
}

async function expectReceiptPopup(page, trigger) {
  await page.context().addInitScript(() => {
    window.print = () => undefined;
  });
  const popupPromise = page.waitForEvent('popup');
  await trigger();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  // El comprobante actual es un div accesible por aria-label; no declara role="region".
  const receipt = popup.locator('.gcuotas-comprobante[aria-label="Comprobante de pago"]');
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText(/Estado:\s*PAGADO/i);
  await popup.close();
}


function singlePaymentDialog(page, person) {
  return page.getByRole('dialog', {
    name: new RegExp(person.apellido, 'i'),
  });
}

test.describe.configure({ timeout: 90000 });

test.describe('Cuotas completas desde la interfaz', () => {
  test.afterEach(async ({ request }) => {
    try {
      cleanupFamilyByPrefix(uiFamily.prefix);
    } catch (_error) {
      // La familia puede no haberse creado en el caso ejecutado.
    }

    await cleanupCompany(request, singleCompany);

    if (batchPersonNoDniId) {
      await cleanupSocioById(request, batchPersonNoDniId).catch(() => false);
      batchPersonNoDniId = null;
    }

    for (const person of [
      singlePerson,
      condonePerson,
      batchPersonOne,
      batchPersonTwo,
      multiMonthPerson,
      paginationPerson,
      historicalPricePerson,
      familyUiPersonOne,
      familyUiPersonTwo,
      futureYearPerson,
    ]) {
      await cleanupPerson(request, person);
    }

    try {
      cleanupCategoriesByPrefix(historicalCategoryName);
    } catch (_error) {
      // La categoría histórica sólo existe en su prueba específica.
    }
  });

  test('registra un pago, imprime y exporta el comprobante, vuelve a imprimirlo y lo elimina', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await createPerson(request, singlePerson, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    let annualContextRequests = 0;
    let monthlyContextRequests = 0;
    page.on('request', (requestEvent) => {
      const url = new URL(requestEvent.url());
      const action = url.searchParams.get('action');
      if (action === 'cuotas_contextos_pago') annualContextRequests += 1;
      if (action === 'cuotas_contexto_pago') monthlyContextRequests += 1;
    });

    await page.goto('/cuotas');
    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(singlePerson.dni);

    let row = debtRow(page, singlePerson);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Registrar pago de/i }).click();

    const paymentDialog = singlePaymentDialog(page, singlePerson);
    await expect(paymentDialog).toBeVisible();
    await expect.poll(() => annualContextRequests).toBe(1);
    expect(monthlyContextRequests).toBe(0);
    const currentMonthButton = paymentDialog.getByRole('button', {
      name: new RegExp(`${monthNames[currentMonth - 1]} ${currentYear}:`, 'i'),
    });
    await expect(currentMonthButton).toHaveAttribute('aria-pressed', 'true');
    await currentMonthButton.click();
    await expect(paymentDialog.getByRole('button', { name: 'Registrar pago', exact: true })).toBeDisabled();
    await currentMonthButton.click();
    await selectPreferredMedium(paymentDialog);
    await paymentDialog.getByRole('button', { name: 'Registrar pago', exact: true }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText(/Pago realizado con éxito/i);
    await expectReceiptPopup(page, () => receipt.getByRole('button', { name: 'Comprobante' }).click());
    await captureDownload(
      page,
      () => receipt.getByRole('button', { name: 'PDF', exact: true }).click(),
      { extension: '.pdf', signature: '%PDF', minimumBytes: 300 },
    );
    await receipt.getByText('Cerrar', { exact: true }).click();

    await page.getByRole('tab', { name: 'Pagados' }).click();
    row = paidRow(page, singlePerson);
    await expect(row).toBeVisible();
    await expectReceiptPopup(page, () => row.getByRole('button', { name: /Imprimir comprobante de/i }).click());

    await row.getByRole('button', { name: /Eliminar pago de/i }).click();
    let deleteDialog = page.getByRole('dialog', { name: 'Eliminar pago registrado' });
    await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(deleteDialog).toBeHidden();

    await row.getByRole('button', { name: /Eliminar pago de/i }).click();
    deleteDialog = page.getByRole('dialog', { name: 'Eliminar pago registrado' });
    await deleteDialog.getByRole('button', { name: 'Eliminar pago', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Deudores' })).toHaveAttribute('aria-selected', 'true');
    await expect(debtRow(page, singlePerson)).toBeVisible();
  });

  test('condona una cuota, la muestra en Condonados y elimina la condonación', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await createPerson(request, condonePerson, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    await page.goto('/cuotas');
    await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(condonePerson.dni);

    let row = debtRow(page, condonePerson);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Condonar cuota de/i }).click();

    const condoneDialog = page.getByRole('dialog', { name: 'Condonar cuota' });
    await expect(condoneDialog).toBeVisible();
    await expect(condoneDialog).toContainText(condonePerson.apellido);

    const condoneResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.searchParams.get('action') === 'cuotas_condonar_pago';
    });
    await condoneDialog.getByRole('button', { name: 'Condonar cuota', exact: true }).click();
    const condoneResponse = await condoneResponsePromise;
    expect(condoneResponse.ok()).toBeTruthy();
    const condoneBody = await condoneResponse.json();
    expect(condoneBody.item?.estado).toBe('CONDONADO');
    expect(Number(condoneBody.item?.monto)).toBe(0);

    await expect(debtRow(page, condonePerson)).toHaveCount(0);
    await page.getByRole('tab', { name: /Condonados/i }).click();
    row = condonedRow(page, condonePerson);
    await expect(row).toBeVisible();
    await expect(row).toContainText('CONDONADO');

    await row.getByRole('button', { name: /Eliminar condonación de/i }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Eliminar condonación' });
    await expect(deleteDialog).toBeVisible();
    const deleteResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.searchParams.get('action') === 'cuotas_eliminar_pago';
    });
    await deleteDialog
      .getByRole('button', { name: 'Eliminar condonación', exact: true })
      .click();
    expect((await deleteResponsePromise).ok()).toBeTruthy();

    await expect(page.getByRole('tab', { name: 'Deudores' })).toHaveAttribute('aria-selected', 'true');
    await expect(debtRow(page, condonePerson)).toBeVisible();
  });

  test('registra y elimina un pago de empresa desde la interfaz completa de Cuotas', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await cleanupCompany(request, singleCompany);
    await createCompany(request, singleCompany, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    await page.goto('/cuotas');
    await page.getByRole('tab', { name: 'Empresas' }).click();
    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(singleCompany.cuit);

    let row = page
      .getByRole('table', { name: /Cuotas de empresas adeudadas/i })
      .getByRole('row')
      .filter({ hasText: singleCompany.cuit });
    await expect(row).toContainText(singleCompany.razonSocial);
    await row.getByRole('button', { name: /Registrar pago de/i }).click();

    const paymentDialog = page.getByRole('dialog', { name: 'Pago de empresa' });
    await expect(paymentDialog).toBeVisible();
    await expect(paymentDialog).toContainText(singleCompany.razonSocial);
    await expect(paymentDialog).toContainText(singleCompany.cuit);
    await selectPreferredMedium(paymentDialog);
    await paymentDialog.getByRole('button', { name: 'Registrar pago', exact: true }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText(/Pago realizado con éxito/i);
    await receipt.getByText('Cerrar', { exact: true }).click();

    await page.getByRole('tab', { name: 'Pagados' }).click();
    row = page
      .getByRole('table', { name: /Cuotas de empresas pagadas/i })
      .getByRole('row')
      .filter({ hasText: singleCompany.cuit });
    await expect(row).toContainText(singleCompany.razonSocial);
    await row.getByRole('button', { name: /Eliminar pago de/i }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Eliminar pago registrado' });
    await deleteDialog.getByRole('button', { name: 'Eliminar pago', exact: true }).click();

    await expect(page.getByRole('tab', { name: 'Deudores' })).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('table', { name: /Cuotas de empresas adeudadas/i })
        .getByRole('row')
        .filter({ hasText: singleCompany.cuit }),
    ).toBeVisible();
  });

  test('selección múltiple ofrece monto actual e históricos, usa actual por defecto y registra el elegido', async ({ page, request }) => {
    const historicalCategory = await createHistoricalCategory(request);
    const { medium } = await activeCategoryAndMedium(request);
    await createPerson(request, batchPersonOne, {
      id_categoria: historicalCategory.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    await createPerson(request, batchPersonTwo, {
      id_categoria: historicalCategory.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    await page.goto('/cuotas');
    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await page.getByRole('button', { name: 'Selección múltiple' }).first().click();

    await search.fill(batchPersonOne.dni);
    let row = debtRow(page, batchPersonOne);
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText(/1 cuota seleccionada/i)).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar selección' }).first().click();
    await expect(page.getByText(/cuota seleccionada/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Selección múltiple' }).first().click();
    await search.fill(batchPersonOne.dni);
    row = debtRow(page, batchPersonOne);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/1 cuota seleccionada/i)).toBeVisible();

    await search.fill(batchPersonTwo.dni);
    row = debtRow(page, batchPersonTwo);
    await row.getByRole('checkbox', { name: /Seleccionar cuota de/i }).check();
    await expect(page.getByText(/2 cuotas seleccionadas/i)).toBeVisible();

    await page.getByRole('button', { name: 'Limpiar', exact: true }).click();
    await expect(page.getByText(/0 cuotas seleccionadas/i)).toBeVisible();

    await search.fill(batchPersonOne.dni);
    await debtRow(page, batchPersonOne)
      .getByRole('checkbox', { name: /Seleccionar cuota de/i })
      .check();
    await search.fill(batchPersonTwo.dni);
    await debtRow(page, batchPersonTwo)
      .getByRole('checkbox', { name: /Seleccionar cuota de/i })
      .check();

    await page.getByRole('button', { name: 'Continuar (2)', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Registrar pagos seleccionados' });
    await expect(dialog).toContainText(batchPersonOne.apellido);
    await expect(dialog).toContainText(batchPersonTwo.apellido);
    await expect(dialog).toContainText(batchPersonOne.dni);
    await expect(dialog).toContainText(batchPersonTwo.dni);

    const firstAmount = dialog.getByLabel(
      new RegExp(`Monto de .*${batchPersonOne.apellido}`, 'i'),
    );
    const secondAmount = dialog.getByLabel(
      new RegExp(`Monto de .*${batchPersonTwo.apellido}`, 'i'),
    );
    await expect(firstAmount).toBeVisible();
    await expect(secondAmount).toBeVisible();

    for (const amountSelect of [firstAmount, secondAmount]) {
      await expect(amountSelect.locator('option:checked')).toContainText(/2\.400,00/);
      await expect(amountSelect.locator('option:checked')).toContainText(/actual/i);
      await expect(amountSelect.locator('option').filter({ hasText: /1\.200,00/ })).toHaveCount(1);
    }

    const oldOption = firstAmount.locator('option').filter({ hasText: /1\.200,00/ }).first();
    const oldValue = await oldOption.getAttribute('value');
    expect(oldValue).toBeTruthy();
    await firstAmount.selectOption(oldValue);
    await expect(firstAmount.locator('option:checked')).toContainText(/1\.200,00/);
    await expect(secondAmount.locator('option:checked')).toContainText(/2\.400,00/);
    await expect(dialog.getByText(/\$\s*3\.600,00/).first()).toBeVisible();

    await selectPreferredMedium(dialog);
    await dialog.getByRole('button', { name: 'Registrar 2 pagos' }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt.getByRole('region', { name: 'Información del comprobante' })).toBeVisible();
    await receipt.getByText('Cerrar', { exact: true }).click();

    const expectedAmounts = new Map([
      [batchPersonOne.dni, historicalCategory.oldAmount],
      [batchPersonTwo.dni, historicalCategory.currentAmount],
    ]);
    for (const target of [batchPersonOne, batchPersonTwo]) {
      const paid = await apiCall(request, 'cuotas_listar', {
        params: {
          tipo: 'PERSONA',
          estado: 'PAGADOS',
          anio: currentYear,
          mes: currentMonth,
          buscar: target.dni,
        },
      });
      expect(paid.items).toHaveLength(1);
      expect(Number(paid.items[0].monto)).toBeCloseTo(expectedAmounts.get(target.dni), 2);
    }
  });

  test('selección múltiple omite DNI y separadores vacíos cuando el socio no tiene documento', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    const created = await createPerson(request, batchPersonNoDni, {
      dni: null,
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    batchPersonNoDniId = Number(created.id_socio);

    await page.goto('/cuotas');
    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await page.getByRole('button', { name: 'Selección múltiple' }).first().click();
    await search.fill(batchPersonNoDni.apellido);

    const row = page
      .getByRole('table', { name: /Cuotas de socios adeudadas/i })
      .getByRole('row')
      .filter({ hasText: batchPersonNoDni.apellido });
    await expect(row).toBeVisible();
    await row.getByRole('checkbox', { name: /Seleccionar cuota de/i }).check();
    await page.getByRole('button', { name: 'Continuar (1)', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Registrar pagos seleccionados' });
    const article = dialog.locator('article').filter({ hasText: batchPersonNoDni.apellido });
    await expect(article).toBeVisible();
    await expect(article).not.toContainText('— ·');
    await expect(article).not.toContainText(/SIN DNI/i);
    await expect(article).toContainText(category.nombre);
    await expect(article).toContainText(`${currentMonth}/${currentYear}`);

    const metadata = article.locator('div > span').first();
    await expect(metadata).not.toHaveText(/^\s*·/);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('selecciona todos los meses disponibles, los desmarca y registra dos períodos juntos', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await createPerson(request, multiMonthPerson, {
      fecha_alta: `${currentYear}-01-01`,
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    await page.goto('/cuotas');
    await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(multiMonthPerson.dni);
    await debtRow(page, multiMonthPerson)
      .getByRole('button', { name: /Registrar pago de/i })
      .click();

    const dialog = singlePaymentDialog(page, multiMonthPerson);
    const yearButton = dialog.getByRole('button', { name: `Año ${currentYear}` });
    await yearButton.click();
    await dialog.getByRole('option', { name: String(currentYear), exact: true }).click();

    const allButton = dialog.getByRole('button', { name: 'Seleccionar todos' });
    await expect(allButton).toBeEnabled();
    await allButton.click();
    await expect(dialog.getByRole('button', { name: 'Deseleccionar todos' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Deseleccionar todos' }).click();

    const availableMonths = dialog.locator('.cuotas-month-grid button:not([disabled])');
    expect(await availableMonths.count()).toBeGreaterThanOrEqual(2);
    await availableMonths.nth(0).click();
    await availableMonths.nth(1).click();
    await selectPreferredMedium(dialog);
    await dialog.getByRole('button', { name: 'Registrar 2 cuotas' }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText(/Pago realizado con éxito/i);
    await expect(receipt.getByRole('region', { name: 'Información del comprobante' })).toBeVisible();
    await receipt.getByText('Cerrar', { exact: true }).click();

    let paidCount = 0;
    for (let month = 1; month <= 12; month += 1) {
      const response = await apiCall(request, 'cuotas_listar', {
        params: {
          tipo: 'PERSONA',
          estado: 'PAGADOS',
          anio: currentYear,
          mes: month,
          buscar: multiMonthPerson.dni,
        },
      });
      paidCount += response.items.length;
    }
    expect(paidCount).toBe(2);
  });

  test('muestra el monto desde el primer mes, preselecciona el histórico correcto y permite un monto personalizado', async ({ page, request }) => {
    const historicalCategory = await createHistoricalCategory(request);
    const { medium } = await activeCategoryAndMedium(request);
    await createPerson(request, historicalPricePerson, {
      fecha_alta: `${Math.max(2000, historicalYear - 1)}-01-01`,
      id_categoria: historicalCategory.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    await page.goto('/cuotas');
    await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(historicalPricePerson.dni);
    await debtRow(page, historicalPricePerson)
      .getByRole('button', { name: /Registrar pago de/i })
      .click();

    const dialog = singlePaymentDialog(page, historicalPricePerson);
    await expect(dialog).toBeVisible();

    const currentLabel = monthNamesUpper[currentMonth - 1];
    const currentAmountSelect = dialog.getByLabel(`Monto de categoría para ${currentLabel}`);
    await expect(currentAmountSelect).toBeVisible();
    await expect(currentAmountSelect.locator('option:checked')).toContainText(/2\.400,00/);
    await expect(currentAmountSelect.locator('option:checked')).toContainText(/actual/i);
    await expect(dialog.getByRole('checkbox', { name: 'Monto personalizado' })).toBeVisible();

    if (historicalYear !== currentYear) {
      await dialog.getByRole('button', { name: `Año ${currentYear}` }).click();
      await dialog.getByRole('option', { name: String(historicalYear), exact: true }).click();
    } else {
      await dialog.getByRole('button', {
        name: new RegExp(`${monthNames[currentMonth - 1]} ${currentYear}:`, 'i'),
      }).click();
    }

    const historicalLabel = monthNamesUpper[historicalMonth - 1];
    await dialog.getByRole('button', {
      name: new RegExp(`${monthNames[historicalMonth - 1]} ${historicalYear}: disponible`, 'i'),
    }).click();

    const historicalAmountSelect = dialog.getByLabel(`Monto de categoría para ${historicalLabel}`);
    await expect(historicalAmountSelect).toBeVisible();
    await expect(historicalAmountSelect.locator('option:checked')).toContainText(/1\.200,00/);
    await expect(historicalAmountSelect.locator('option:checked')).toContainText(/hasta/i);

    await historicalAmountSelect.selectOption('actual');
    await expect(historicalAmountSelect.locator('option:checked')).toContainText(/2\.400,00/);

    const historicalOption = historicalAmountSelect.locator('option').filter({ hasText: /1\.200,00/ }).first();
    const historicalOptionValue = await historicalOption.getAttribute('value');
    expect(historicalOptionValue).toBeTruthy();
    await historicalAmountSelect.selectOption(historicalOptionValue);
    await expect(historicalAmountSelect.locator('option:checked')).toContainText(/1\.200,00/);

    await dialog.getByRole('checkbox', { name: 'Monto personalizado' }).check();
    const customAmount = dialog.getByLabel(`Monto personalizado para ${historicalLabel}`);
    await expect(customAmount).toBeVisible();
    await customAmount.fill('777.77');
    await selectPreferredMedium(dialog);
    await dialog.getByRole('button', { name: 'Registrar pago', exact: true }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText(/Pago realizado con éxito/i);
    await receipt.getByText('Cerrar', { exact: true }).click();

    const paid = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA',
        estado: 'PAGADOS',
        anio: historicalYear,
        mes: historicalMonth,
        buscar: historicalPricePerson.dni,
      },
    });
    expect(paid.items).toHaveLength(1);
    expect(Number(paid.items[0].monto)).toBeCloseTo(777.77, 2);
  });

  test('mantiene habilitado el pago familiar con varios meses y explica en verde los períodos ya pagados', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    const first = await createPerson(request, familyUiPersonOne, {
      fecha_alta: `${currentYear}-01-01`,
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    const second = await createPerson(request, familyUiPersonTwo, {
      fecha_alta: `${currentYear}-01-01`,
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    await createFamily(request, uiFamily, [first, second]);

    const alreadyPaidContext = await apiCall(request, 'cuotas_contexto_pago', {
      params: {
        id_socio: second.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
      },
    });
    await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: {
        id_socio: second.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
        monto: alreadyPaidContext.principal.monto_sugerido,
        id_medio_pago: medium.id_medio_pago,
        aplicar_familia: false,
      },
    });

    await page.goto('/cuotas');
    await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(familyUiPersonOne.dni);
    await debtRow(page, familyUiPersonOne)
      .getByRole('button', { name: /Registrar pago de/i })
      .click();

    const dialog = singlePaymentDialog(page, familyUiPersonOne);
    const familyCard = dialog.getByRole('region', { name: 'Grupo familiar del socio' });
    await expect(familyCard).toBeVisible();
    await expect(familyCard).toContainText(uiFamily.nombre);
    await expect(familyCard.getByRole('button', { name: 'Ver integrantes' })).toBeVisible();

    const familyCheck = dialog.getByRole('checkbox', {
      name: 'Aplicar pago a todo el grupo familiar',
    });
    const currentMonthButton = dialog.getByRole('button', {
      name: new RegExp(`${monthNames[currentMonth - 1]} ${currentYear}:`, 'i'),
    });
    await currentMonthButton.click();
    await expect(familyCard).toBeVisible();
    await expect(familyCheck).toBeDisabled();
    await currentMonthButton.click();

    await dialog.getByRole('button', {
      name: new RegExp(`${monthNames[secondaryMonth - 1]} ${currentYear}: disponible`, 'i'),
    }).click();

    await expect(familyCheck).toBeEnabled();
    await expect(familyCheck).toBeChecked();
    await expect(dialog.getByText('Hay cuotas ya pagadas en la selección.')).toBeVisible();

    await familyCard.getByRole('button', { name: 'Ver integrantes' }).click();
    const paidMember = dialog
      .locator('.cuotas-family-members article')
      .filter({ hasText: familyUiPersonTwo.apellido });
    await expect(paidMember).toHaveClass(/has-paid-selected-period/);
    await expect(paidMember).toContainText('Pagó');
    await expect(paidMember).toContainText('PAGADO');

    await selectPreferredMedium(dialog);
    await dialog.getByRole('button', { name: 'Registrar pago familiar (3 cuotas)' }).click();
    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText(/Pago realizado con éxito/i);
    await expect(receipt.getByRole('region', { name: 'Información del comprobante' })).toBeVisible();
    await receipt.getByText('Cerrar', { exact: true }).click();

    for (const [person, month] of [
      [familyUiPersonOne, currentMonth],
      [familyUiPersonOne, secondaryMonth],
      [familyUiPersonTwo, currentMonth],
      [familyUiPersonTwo, secondaryMonth],
    ]) {
      const paid = await apiCall(request, 'cuotas_listar', {
        params: {
          tipo: 'PERSONA',
          estado: 'PAGADOS',
          anio: currentYear,
          mes: month,
          buscar: person.dni,
        },
      });
      expect(paid.items).toHaveLength(1);
    }
  });

  test('agrega el próximo año desde el propio selector y lo vuelve visible tras registrar un pago', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await createPerson(request, futureYearPerson, {
      fecha_alta: `${currentYear}-01-01`,
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    await page.goto('/cuotas');
    await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(futureYearPerson.dni);
    await debtRow(page, futureYearPerson)
      .getByRole('button', { name: /Registrar pago de/i })
      .click();

    const dialog = singlePaymentDialog(page, futureYearPerson);
    await dialog.getByRole('button', { name: `Año ${currentYear}` }).click();
    const yearList = dialog.getByRole('listbox');
    const addYearOption = yearList.getByRole('option', { name: /^\+ Agregar \d{4}$/ });
    await expect(addYearOption).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^\+ Agregar \d{4}$/ })).toHaveCount(0);
    const addYearText = (await addYearOption.textContent()).trim();
    const addedYear = Number(addYearText.match(/(\d{4})/)?.[1]);
    expect(addedYear).toBeGreaterThan(currentYear);
    await addYearOption.click();

    await expect(dialog.getByRole('button', { name: `Año ${addedYear}` })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Registrar pago', exact: true })).toBeDisabled();

    const firstAvailableMonth = dialog.locator('.cuotas-month-grid button:not([disabled])').first();
    await expect(firstAvailableMonth).toBeVisible();
    await firstAvailableMonth.click();
    await selectPreferredMedium(dialog);
    await dialog.getByRole('button', { name: 'Registrar pago', exact: true }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText(/Pago realizado con éxito/i);
    await receipt.getByText('Cerrar', { exact: true }).click();

    await page.reload();
    await expect(page.getByLabel('Año').locator(`option[value="${addedYear}"]`)).toHaveCount(1);
  });

  test('pagina cuotas con número, Anterior y Siguiente', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    const saved = await createPerson(request, paginationPerson, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    const real = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA',
        estado: 'DEUDORES',
        anio: currentYear,
        mes: currentMonth,
        buscar: paginationPerson.dni,
      },
    });
    const template = real.items.find((item) => item.id_socio === saved.id_socio) || real.items[0];
    expect(template).toBeTruthy();

    await page.route(/api\.php\?action=cuotas_listar(?:&|$)/, async (route) => {
      const url = new URL(route.request().url());
      const requestedPage = Number(url.searchParams.get('pagina') || 1);
      const makeItem = (index) => ({
        ...template,
        id_socio: 800000 + index,
        documento: String(60000000 + index),
        denominacion: `CUOTA PAGINA ${String(index).padStart(3, '0')}`,
      });
      const items = requestedPage === 1
        ? Array.from({ length: 100 }, (_, index) => makeItem(index + 1))
        : [makeItem(101)];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: true,
          items,
          resumen: { ...(real.resumen || {}), total: 101 },
          periodo: real.periodo,
          catalogos: real.catalogos,
          paginacion: {
            pagina: requestedPage,
            por_pagina: 100,
            total: 101,
            total_paginas: 2,
            desde: requestedPage === 1 ? 1 : 101,
            hasta: requestedPage === 1 ? 100 : 101,
          },
        }),
      });
    });

    await page.goto('/cuotas');
    const pagination = page.getByRole('navigation', { name: 'Paginación de cuotas' });
    await expect(pagination).toContainText('1–100 de 101');
    await pagination.getByRole('button', { name: '2', exact: true }).click();
    await expect(pagination).toContainText('101–101 de 101');
    await expect(page.getByRole('table', { name: /Cuotas de socios adeudadas/i })).toContainText('CUOTA PAGINA 101');
    await pagination.getByRole('button', { name: 'Anterior' }).click();
    await expect(pagination).toContainText('1–100 de 101');
    await pagination.getByRole('button', { name: 'Siguiente' }).click();
    await expect(pagination).toContainText('101–101 de 101');

    const exportButton = page.getByRole('button', { name: 'Exportar', exact: true }).first();
    await exportButton.click();
    let exportDialog = page.getByRole('dialog', { name: 'Exportar cuotas' });
    await expect(exportDialog).toBeVisible();
    await expect(exportDialog.getByRole('radio', { name: /Exportar esta página/i })).toBeVisible();
    await expect(exportDialog.getByRole('radio', { name: /Exportar todas las cuotas filtradas/i })).toBeVisible();
    await exportDialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(exportDialog).toBeHidden();

    await exportButton.click();
    exportDialog = page.getByRole('dialog', { name: 'Exportar cuotas' });
    await exportDialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(exportDialog).toBeHidden();

    await exportButton.click();
    exportDialog = page.getByRole('dialog', { name: 'Exportar cuotas' });
    await page.keyboard.press('Escape');
    await expect(exportDialog).toBeHidden();

    await page.route(/api\.php\?action=perfil_logo_institucional(?:&|$)/, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ exito: false, mensaje: 'Sin logo E2E' }),
      });
    });

    await exportFromGlobalModal(page, {
      openButton: exportButton,
      format: 'Excel',
      scope: 'Exportar esta página',
      expectedExtension: '.xlsx',
    });
    await exportFromGlobalModal(page, {
      openButton: exportButton,
      format: 'PDF',
      scope: 'Exportar todas las cuotas filtradas',
      expectedExtension: '.pdf',
    });
  });
});
