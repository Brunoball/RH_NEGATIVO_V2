const { test, expect } = require('./fixtures/auth.fixture');
const { categoryData, discountData } = require('./fixtures/categorias.fixture');
const {
  apiCall,
  cleanupCategoriesByPrefix,
  cleanupDiscountsByThresholds,
  expectApiError,
  readAuditActions,
} = require('./helpers/api.helper');
const { expectToast } = require('./helpers/auth.helper');
const { todayIso } = require('./helpers/data.helper');

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function isoDaysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function tableRow(page, tableName, text) {
  return page
    .getByRole('table', { name: tableName })
    .getByRole('row')
    .filter({ hasText: text })
    .last();
}

async function findCategory(request, name, estado = 'activo') {
  const response = await apiCall(request, 'categorias_listar', {
    params: { buscar: name, estado },
  });
  return (response.items || []).find(
    (item) => String(item.nombre).toUpperCase() === String(name).toUpperCase(),
  ) || null;
}

async function findDiscount(request, from, estado = 'vigente') {
  const response = await apiCall(request, 'descuentos_familiares_listar', {
    params: { estado },
  });
  return (response.items || []).find(
    (item) => Number(item.cantidad_integrantes_desde) === Number(from),
  ) || null;
}

function auditActionNames(rows) {
  return rows.map((row) => row.accion);
}

test.describe.configure({ mode: 'serial' });

test.describe('Categorías y descuentos familiares', () => {
  const category = categoryData();
  const discounts = discountData();

  test.beforeAll(() => {
    cleanupCategoriesByPrefix(category.prefix);
    cleanupDiscountsByThresholds(discounts.thresholds);
  });

  test.afterAll(() => {
    cleanupCategoriesByPrefix(category.prefix);
    cleanupDiscountsByThresholds(discounts.thresholds);
  });

  test('cubre alta, edición, historial, búsqueda, baja, reactivación y auditoría de categorías', async ({ page, request }) => {
    await page.goto('/categorias');
    await expect(page.getByRole('heading', { name: 'Categorías' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Listado de categorías' })).toBeVisible();

    await page.getByRole('button', { name: 'Nueva categoría' }).click();
    let dialog = page.getByRole('dialog', { name: 'Nueva categoría' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Nombre *').fill('   ');
    await dialog.getByRole('button', { name: 'Crear categoría' }).click();
    await expectToast(page, 'Completá el nombre de la categoría.');

    await dialog.getByLabel('Nombre *').fill(category.nombre);
    await dialog.getByLabel('Descripción').fill(category.descripcion);
    await dialog.getByRole('button', { name: 'Crear categoría' }).click();
    await expectToast(page, 'Ingresá un monto mensual válido.');

    await expect(dialog.getByRole('tab', { name: 'Precio y vigencia' })).toHaveAttribute('aria-selected', 'true');
    await dialog.getByLabel('Monto mensual *').fill(category.montoInicial);
    await dialog.getByLabel('Vigente desde *').fill(isoDaysAgo(1));
    await dialog.getByRole('button', { name: 'Crear categoría' }).click();
    await expectToast(page, 'Categoría creada correctamente.');

    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(`${category.textSuffix.toLowerCase()}, playwright`);
    await expect(tableRow(page, 'Listado de categorías', category.nombre)).toBeVisible();
    await search.fill(category.nombre);
    let row = tableRow(page, 'Listado de categorías', category.nombre);
    await expect(row).toBeVisible();
    await expect(row).toContainText(category.descripcion);
    await expect(row.getByTitle('Dar de baja')).toBeVisible();

    const created = await findCategory(request, category.nombre);
    expect(created).toBeTruthy();
    expect(created.monto_actual).toBe(category.montoInicial);

    await row.getByTitle('Ver historial de precios').click();
    let historyDialog = page.getByRole('dialog', { name: 'Historial de precios' });
    await expect(historyDialog).toContainText('0,00');
    await expect(historyDialog).toContainText('1.234,56');
    await historyDialog.getByRole('button', { name: 'Cerrar' }).click();

    row = tableRow(page, 'Listado de categorías', category.nombre);
    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar categoría' });
    await dialog.getByLabel('Nombre *').fill(category.nombreEditado);
    await dialog.getByLabel('Descripción').fill(category.descripcionEditada);
    await dialog.getByRole('tab', { name: 'Precio y vigencia' }).click();
    await dialog.getByLabel('Monto mensual *').fill(category.montoEditado);
    await dialog.getByLabel('Vigente desde *').fill(todayIso());
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectToast(page, 'Categoría actualizada correctamente.');

    await search.fill(category.nombreEditado);
    row = tableRow(page, 'Listado de categorías', category.nombreEditado);
    await expect(row).toContainText(category.descripcionEditada);

    await row.getByTitle('Ver historial de precios').click();
    historyDialog = page.getByRole('dialog', { name: 'Historial de precios' });
    await expect(historyDialog).toContainText('1.789,45');
    await expect(historyDialog).toContainText('1.234,56');
    await expect(historyDialog.getByText(/Cambio registrado:/)).toHaveCount(2);
    await historyDialog.getByRole('button', { name: 'Cerrar' }).click();

    row = tableRow(page, 'Listado de categorías', category.nombreEditado);
    await row.getByTitle('Dar de baja').click();
    let stateDialog = page.getByRole('dialog', { name: 'Dar de baja la categoría' });
    await expect(stateDialog).toContainText(category.nombreEditado);
    await stateDialog.getByRole('button', { name: 'Dar de baja' }).click();
    await expectToast(page, 'Categoría dada de baja correctamente.');

    await page.getByRole('tab', { name: 'Dadas de baja' }).click();
    row = tableRow(page, 'Listado de categorías', category.nombreEditado);
    await expect(row.getByTitle('Reactivar')).toBeVisible();
    await row.getByTitle('Reactivar').click();
    stateDialog = page.getByRole('dialog', { name: 'Reactivar categoría' });
    await stateDialog.getByRole('button', { name: 'Reactivar' }).click();
    await expectToast(page, 'Categoría reactivada correctamente.');

    await page.getByRole('tab', { name: 'Activas' }).click();
    row = tableRow(page, 'Listado de categorías', category.nombreEditado);
    await expect(row.getByTitle('Dar de baja')).toBeVisible();

    await expectApiError(
      request,
      'categorias_guardar',
      {
        method: 'POST',
        data: {
          nombre: category.nombreEditado,
          descripcion: 'DUPLICADA',
          monto_actual: '1000',
          vigente_desde: todayIso(),
        },
      },
      { status: 409, code: 'CATEGORIA_DUPLICADA' },
    );
    await expectApiError(
      request,
      'categorias_guardar',
      {
        method: 'POST',
        data: {
          nombre: `${category.nombre} FUTURA`,
          monto_actual: '1000',
          vigente_desde: isoDaysFromNow(1),
        },
      },
      { status: 422, code: 'VIGENCIA_PRECIO_INVALIDA' },
    );
    await expectApiError(
      request,
      'categorias_reactivar',
      { method: 'POST', data: { id: created.id_categoria } },
      { status: 409, code: 'ESTADO_SIN_CAMBIOS' },
    );

    const audit = readAuditActions('categorias', created.id_categoria);
    expect(auditActionNames(audit)).toEqual(
      expect.arrayContaining(['CREAR', 'EDITAR', 'DAR_BAJA', 'REACTIVAR']),
    );
  });

  test('cubre descuentos globales por cantidad, solapamientos, edición, baja lógica y auditoría', async ({ page, request }) => {
    await page.goto('/categorias/descuentos');
    await expect(page.getByRole('heading', { name: 'Descuentos familiares' })).toBeVisible();
    const discountsTable = page.getByRole('table', { name: 'Descuentos familiares' });
    await expect(discountsTable).toBeVisible();
    await expect(discountsTable.getByText('Aplicación', { exact: true })).toBeVisible();
    await expect(discountsTable.getByText('Categoría', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Nuevo descuento' }).click();
    let dialog = page.getByRole('dialog', { name: 'Nuevo descuento familiar' });
    await expect(dialog.getByLabel('Categoría *')).toHaveCount(0);
    await dialog.getByLabel('Cantidad mínima de integrantes *').fill(String(discounts.first.desde));
    await dialog.getByLabel('Cantidad máxima de integrantes').fill(String(discounts.first.hasta));
    await dialog.getByLabel('Porcentaje de descuento *').fill(discounts.first.porcentaje);
    await dialog.getByLabel('Vigencia desde *').fill(discounts.vigenciaDesde);
    await dialog.getByLabel('Vigencia hasta').fill(discounts.vigenciaHasta);
    await dialog.getByLabel('Descripción').fill(discounts.first.descripcion);
    await dialog.getByRole('button', { name: 'Crear descuento' }).click();
    await expectToast(page, 'Descuento familiar creado correctamente.');

    await page.getByRole('button', { name: 'Nuevo descuento' }).click();
    dialog = page.getByRole('dialog', { name: 'Nuevo descuento familiar' });
    await dialog.getByLabel('Cantidad mínima de integrantes *').fill(String(discounts.second.desde));
    await dialog.getByLabel('Porcentaje de descuento *').fill(discounts.second.porcentaje);
    await dialog.getByLabel('Vigencia desde *').fill(discounts.vigenciaDesde);
    await dialog.getByLabel('Vigencia hasta').fill(discounts.vigenciaHasta);
    await dialog.getByLabel('Descripción').fill(discounts.second.descripcion);
    await dialog.getByRole('button', { name: 'Crear descuento' }).click();
    await expectToast(page, 'Descuento familiar creado correctamente.');

    let firstRow = tableRow(page, 'Descuentos familiares', `${discounts.first.desde} INTEGRANTES`);
    let secondRow = tableRow(page, 'Descuentos familiares', `DESDE ${discounts.second.desde} INTEGRANTES`);
    await expect(firstRow).toContainText('TOTAL FAMILIAR');
    await expect(firstRow).toContainText('91,37%');
    await expect(firstRow).toContainText('FINALIZADO');
    await expect(secondRow).toContainText('TOTAL FAMILIAR');
    await expect(secondRow).toContainText('92,48%');

    const firstCreated = await findDiscount(request, discounts.first.desde);
    const secondCreated = await findDiscount(request, discounts.second.desde);
    expect(firstCreated).toBeTruthy();
    expect(secondCreated).toBeTruthy();
    expect(firstCreated).not.toHaveProperty('id_categoria');
    expect(firstCreated).not.toHaveProperty('categoria');

    await firstRow.getByTitle('Editar descuento').click();
    dialog = page.getByRole('dialog', { name: 'Editar descuento familiar' });
    await dialog.getByLabel('Porcentaje de descuento *').fill(discounts.first.porcentajeEditado);
    await dialog.getByLabel('Vigencia desde *').fill(discounts.vigenciaDesde);
    await dialog.getByLabel('Vigencia hasta').fill(discounts.vigenciaHasta);
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectToast(page, 'Descuento familiar actualizado correctamente.');

    firstRow = tableRow(page, 'Descuentos familiares', `${discounts.first.desde} INTEGRANTES`);
    await expect(firstRow).toContainText('93,59%');

    await expectApiError(
      request,
      'descuentos_familiares_guardar',
      {
        method: 'POST',
        data: {
          cantidad_integrantes_desde: discounts.first.desde,
          cantidad_integrantes_hasta: discounts.first.hasta,
          porcentaje_descuento: '10',
          vigencia_desde: discounts.vigenciaDesde,
          vigencia_hasta: discounts.vigenciaHasta,
        },
      },
      { status: 409, code: 'DESCUENTO_FAMILIAR_DUPLICADO' },
    );
    await expectApiError(
      request,
      'descuentos_familiares_guardar',
      {
        method: 'POST',
        data: {
          cantidad_integrantes_desde: discounts.first.desde,
          cantidad_integrantes_hasta: discounts.second.desde,
          porcentaje_descuento: '10',
          vigencia_desde: discounts.vigenciaDesde,
          vigencia_hasta: discounts.vigenciaHasta,
        },
      },
      { status: 409, code: 'DESCUENTO_FAMILIAR_DUPLICADO' },
    );
    await expectApiError(
      request,
      'descuentos_familiares_guardar',
      {
        method: 'POST',
        data: {
          cantidad_integrantes_desde: 1,
          porcentaje_descuento: '10',
        },
      },
      { status: 422, code: 'VALIDATION_ERROR' },
    );
    await expectApiError(
      request,
      'descuentos_familiares_guardar',
      {
        method: 'POST',
        data: {
          cantidad_integrantes_desde: 49,
          porcentaje_descuento: '101',
        },
      },
      { status: 422, code: 'VALIDATION_ERROR' },
    );

    secondRow = tableRow(page, 'Descuentos familiares', `DESDE ${discounts.second.desde} INTEGRANTES`);
    await secondRow.getByTitle('Eliminar descuento').click();
    const deleteDialog = page.getByRole('dialog', { name: 'Eliminar descuento familiar' });
    await expect(deleteDialog).toContainText('TOTAL');
    await expect(deleteDialog).toContainText('92,48%');
    await expect(deleteDialog.getByText('Categoría', { exact: true })).toHaveCount(0);
    await deleteDialog.getByRole('button', { name: 'Eliminar regla' }).click();
    await expectToast(page, 'Descuento familiar eliminado correctamente.');
    await expect(tableRow(page, 'Descuentos familiares', `DESDE ${discounts.second.desde} INTEGRANTES`)).toHaveCount(0);

    await page.getByRole('tab', { name: 'Historial' }).click();
    const historyRow = tableRow(page, 'Descuentos familiares', `DESDE ${discounts.second.desde} INTEGRANTES`);
    await expect(historyRow).toContainText('HISTÓRICO');

    const firstAudit = readAuditActions('descuentos_familiares', firstCreated.id_descuento_familiar);
    expect(auditActionNames(firstAudit)).toEqual(expect.arrayContaining(['CREAR', 'EDITAR']));
    const secondAudit = readAuditActions('descuentos_familiares', secondCreated.id_descuento_familiar);
    expect(auditActionNames(secondAudit)).toEqual(expect.arrayContaining(['CREAR', 'ELIMINAR']));
  });
});
