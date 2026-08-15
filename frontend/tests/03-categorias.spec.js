const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, expectApiError } = require('./helpers/api.helper');
const { expectFeedback } = require('./helpers/auth.helper');
const { todayIso } = require('./helpers/data.helper');
const { categoryData, discountData } = require('./fixtures/categorias.fixture');

function rowByText(page, text) {
  return page.getByRole('row').filter({ hasText: text }).last();
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function discountCovers(rule, threshold) {
  const from = Number(rule.cantidad_integrantes_desde);
  const to = rule.cantidad_integrantes_hasta == null ? 50 : Number(rule.cantidad_integrantes_hasta);
  return threshold >= from && threshold <= to;
}

async function safeDiscountSlot(request) {
  const response = await apiCall(request, 'descuentos_familiares_listar', {
    params: { estado: 'todos' },
  });
  const active = (response.items || []).filter((item) => item.activo);
  const today = todayIso();

  for (let threshold = 50; threshold >= 2; threshold -= 1) {
    const conflicts = active.filter((item) => discountCovers(item, threshold));
    if (conflicts.some((item) => item.vigencia_hasta == null)) continue;

    let start = addDays(today, 1);
    for (const rule of conflicts) {
      if (rule.vigencia_hasta && rule.vigencia_hasta >= start) {
        start = addDays(rule.vigencia_hasta, 1);
      }
    }
    if (start <= '2099-12-30') {
      return { threshold, desde: start, hasta: start };
    }
  }

  throw new Error(
    'No existe un hueco seguro entre 2 y 50 integrantes para crear un descuento E2E sin superponerse con reglas reales.',
  );
}

test.describe('Categorías y descuentos familiares', () => {
  test('Categorías: alta, validaciones, búsqueda, valores mensual/anual, historial, edición, baja y reactivación', async ({ page, request }) => {
    const data = categoryData();
    let categoryId = null;

    await page.goto('/categorias');
    await expect(page.getByRole('heading', { name: 'Categorías' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Activas' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Dadas de baja' })).toBeVisible();
    await expect(page.getByText('Promedio mensual')).toBeVisible();
    await expect(page.getByText('Promedio anual')).toBeVisible();

    await page.getByRole('button', { name: 'Nueva categoría' }).click();
    let dialog = page.getByRole('dialog', { name: 'Nueva categoría' });

    // Los required se validan primero por HTML5; por eso no corresponde esperar
    // un toast de React cuando el control está vacío.
    const categoryName = dialog.getByLabel('Nombre *');
    await dialog.getByRole('button', { name: 'Crear categoría' }).click();
    expect(await categoryName.evaluate((element) => element.checkValidity())).toBe(false);

    await categoryName.fill(data.nombre);
    await dialog.getByRole('tab', { name: 'Valores' }).click();
    const monthly = dialog.getByLabel('Monto mensual *');
    const annual = dialog.getByLabel('Monto anual *');
    const effectiveFrom = dialog.getByLabel('Vigente desde *');

    await monthly.fill('');
    await dialog.getByRole('button', { name: 'Crear categoría' }).click();
    expect(await monthly.evaluate((element) => element.checkValidity())).toBe(false);

    await monthly.fill(data.mensual);
    await annual.fill('');
    await dialog.getByRole('button', { name: 'Crear categoría' }).click();
    expect(await annual.evaluate((element) => element.checkValidity())).toBe(false);

    await annual.fill(data.anual);
    await effectiveFrom.fill('');
    await dialog.getByRole('button', { name: 'Crear categoría' }).click();
    expect(await effectiveFrom.evaluate((element) => element.checkValidity())).toBe(false);

    await effectiveFrom.fill(todayIso());
    await dialog.getByRole('button', { name: 'Crear categoría' }).click();
    await expectFeedback(page, 'Categoría creada correctamente.');

    const list = await apiCall(request, 'categorias_listar', {
      params: { estado: 'activo', buscar: data.nombre },
    });
    const created = (list.items || []).find((item) => item.nombre === data.nombre);
    expect(created).toBeTruthy();
    categoryId = created.id_categoria;

    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(data.nombre);
    let row = rowByText(page, data.nombre);
    await expect(row).toContainText(/1[.,]234/);
    await expect(row).toContainText(/12[.,]000/);

    // Historial inicial mensual + anual.
    await row.getByTitle('Ver historial de valores').click();
    let history = page.getByRole('dialog', { name: 'Historial de valores' });
    await expect(history).toContainText('MENSUAL');
    await expect(history).toContainText('ANUAL');
    await expect(history).toContainText(/1[.,]234/);
    await expect(history).toContainText(/12[.,]000/);
    await page.keyboard.press('Escape');

    // Edita nombre y ambos valores, generando nuevos históricos.
    row = rowByText(page, data.nombre);
    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar categoría' });
    await dialog.getByLabel('Nombre *').fill(data.nombreEditado);
    await dialog.getByRole('tab', { name: 'Valores' }).click();
    await dialog.getByLabel('Monto mensual *').fill(data.mensualEditado);
    await dialog.getByLabel('Monto anual *').fill(data.anualEditado);
    await dialog.getByLabel('Vigente desde *').fill(todayIso());
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectFeedback(page, 'Categoría actualizada correctamente.');

    await search.fill(data.nombreEditado);
    row = rowByText(page, data.nombreEditado);
    await expect(row).toContainText(/1[.,]789/);
    await expect(row).toContainText(/17[.,]000/);

    await row.getByTitle('Ver historial de valores').click();
    history = page.getByRole('dialog', { name: 'Historial de valores' });
    await expect(history).toContainText(/1[.,]789/);
    await expect(history).toContainText(/17[.,]000/);
    await expect(history).toContainText(/1[.,]234/);
    await expect(history).toContainText(/12[.,]000/);
    await page.keyboard.press('Escape');

    // API: duplicado, fecha futura y reactivación sin cambio.
    await expectApiError(request, 'categorias_guardar', {
      method: 'POST',
      data: {
        nombre: data.nombreEditado,
        monto_mensual: '1000',
        monto_anual: '10000',
        vigente_desde: todayIso(),
      },
    }, { status: 409, code: 'CATEGORIA_DUPLICADA' });

    await expectApiError(request, 'categorias_guardar', {
      method: 'POST',
      data: {
        nombre: `${data.nombre} FUTURA`,
        monto_mensual: '1000',
        monto_anual: '10000',
        vigente_desde: addDays(todayIso(), 1),
      },
    }, { status: 422, code: 'VIGENCIA_PRECIO_INVALIDA' });

    await expectApiError(request, 'categorias_reactivar', {
      method: 'POST', data: { id: categoryId },
    }, { status: 409, code: 'ESTADO_SIN_CAMBIOS' });

    // Baja: cancelar y confirmar.
    row = rowByText(page, data.nombreEditado);
    await row.getByTitle('Dar de baja').click();
    let stateDialog = page.getByRole('dialog', { name: 'Dar de baja la categoría' });
    await stateDialog.getByRole('button', { name: 'Cancelar' }).click();
    await row.getByTitle('Dar de baja').click();
    stateDialog = page.getByRole('dialog', { name: 'Dar de baja la categoría' });
    await stateDialog.getByRole('button', { name: 'Dar de baja', exact: true }).click();
    await expectFeedback(page, 'Categoría dada de baja correctamente.');

    await page.getByRole('tab', { name: 'Dadas de baja' }).click();
    await search.fill(data.nombreEditado);
    row = rowByText(page, data.nombreEditado);
    await row.getByTitle('Reactivar').click();
    stateDialog = page.getByRole('dialog', { name: 'Reactivar categoría' });
    await stateDialog.getByRole('button', { name: 'Reactivar', exact: true }).click();
    await expectFeedback(page, 'Categoría reactivada correctamente.');

    await page.getByRole('tab', { name: 'Activas' }).click();
    await search.fill(data.nombreEditado);
    await expect(rowByText(page, data.nombreEditado)).toBeVisible();

    // No existe acción de borrado definitivo de categoría en esta pantalla.
    // El endpoint e2e_cleanup la elimina al terminar, sólo porque mantiene prefijo PW EE CAT.
  });

  test('Descuentos familiares: validaciones, creación aislada, edición, solapamiento y envío al historial', async ({ page, request }) => {
    const data = discountData();
    const slot = await safeDiscountSlot(request);

    await page.goto('/categorias/descuentos');
    await expect(page.getByRole('heading', { name: 'Descuentos familiares' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Activas' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Historial' })).toBeVisible();
    await expect(page.getByText(/total familiar/i).first()).toBeVisible();

    await page.getByRole('button', { name: 'Nuevo descuento' }).click();
    let dialog = page.getByRole('dialog', { name: 'Nuevo descuento familiar' });

    const minimumMembers = dialog.getByLabel('Cantidad mínima de integrantes *');
    const discountPercent = dialog.getByLabel('Porcentaje de descuento *');

    // El formulario trae defaults válidos para mínimo (2) y vigencia desde.
    // El porcentaje sí comienza vacío y required, por lo que es el control correcto
    // para comprobar que HTML5 detiene el submit antes del handler de React.
    await expect(minimumMembers).toHaveValue('2');
    await dialog.getByRole('button', { name: 'Crear descuento' }).click();
    expect(await discountPercent.evaluate((element) => element.checkValidity())).toBe(false);

    // Para alcanzar las validaciones propias de React se completan primero los demás required.
    await minimumMembers.fill('1');
    await discountPercent.fill('10');
    await dialog.getByRole('button', { name: 'Crear descuento' }).click();
    await expectFeedback(page, 'Ingresá una cantidad mínima entre 2 y 50.');

    await minimumMembers.fill(String(slot.threshold));
    await dialog.getByLabel('Cantidad máxima de integrantes').fill(String(slot.threshold - 1));
    await dialog.getByRole('button', { name: 'Crear descuento' }).click();
    await expectFeedback(page, 'La cantidad máxima debe ser igual o mayor que la mínima y de hasta 50.');

    await dialog.getByLabel('Cantidad máxima de integrantes').fill(String(slot.threshold));
    await dialog.getByLabel('Porcentaje de descuento *').fill('101');
    await dialog.getByRole('button', { name: 'Crear descuento' }).click();
    await expectFeedback(page, 'Ingresá un porcentaje mayor a 0 y de hasta 100.');

    await dialog.getByLabel('Porcentaje de descuento *').fill(data.porcentaje);
    await dialog.getByLabel('Vigencia desde *').fill(slot.desde);
    await dialog.getByLabel('Vigencia hasta').fill(slot.hasta);
    await dialog.getByLabel('Descripción').fill(data.descripcion);
    await dialog.getByRole('button', { name: 'Crear descuento' }).click();
    await expectFeedback(page, 'Descuento familiar creado correctamente.');

    let row = rowByText(page, data.descripcion);
    await expect(row).toContainText(`${slot.threshold} INTEGRANTES`);
    await expect(row).toContainText('PROGRAMADO');
    await expect(row).toContainText('TOTAL FAMILIAR');

    const all = await apiCall(request, 'descuentos_familiares_listar', {
      params: { estado: 'todos' },
    });
    const created = (all.items || []).find((item) => item.descripcion === data.descripcion);
    expect(created).toBeTruthy();

    // Duplicado exacto: no se crea ningún registro adicional.
    await expectApiError(request, 'descuentos_familiares_guardar', {
      method: 'POST',
      data: {
        cantidad_integrantes_desde: slot.threshold,
        cantidad_integrantes_hasta: slot.threshold,
        porcentaje_descuento: '10',
        vigencia_desde: slot.desde,
        vigencia_hasta: slot.hasta,
        descripcion: 'PW E2E DESC DUPLICADO NO CREADO',
      },
    }, { status: 409, code: 'DESCUENTO_FAMILIAR_DUPLICADO' });

    // Edita sin mover la vigencia; así no toca ni se superpone con reglas reales.
    await row.getByTitle('Editar descuento').click();
    dialog = page.getByRole('dialog', { name: 'Editar descuento familiar' });
    await dialog.getByLabel('Porcentaje de descuento *').fill(data.porcentajeEditado);
    await dialog.getByLabel('Descripción').fill(data.descripcionEditada);
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectFeedback(page, 'Descuento familiar actualizado correctamente.');

    row = rowByText(page, data.descripcionEditada);
    await expect(row).toContainText(/19[.,]25%/);

    // Enviar al historial: cancelar primero y luego confirmar.
    await row.getByTitle('Enviar al historial').click();
    let historyDialog = page.getByRole('dialog', { name: 'Enviar descuento al historial' });
    await expect(historyDialog).toContainText('TOTAL FAMILIAR');
    await historyDialog.getByRole('button', { name: 'Cancelar' }).click();
    await row.getByTitle('Enviar al historial').click();
    historyDialog = page.getByRole('dialog', { name: 'Enviar descuento al historial' });
    await historyDialog.getByRole('button', { name: 'Enviar al historial', exact: true }).click();
    await expectFeedback(page, 'Descuento familiar enviado al historial correctamente.');

    await page.getByRole('tab', { name: 'Historial' }).click();
    const historical = rowByText(page, data.descripcionEditada);
    await expect(historical).toContainText('HISTÓRICO');
    await expect(historical.getByTitle('Editar descuento')).toHaveCount(0);

    await expectApiError(request, 'descuentos_familiares_eliminar', {
      method: 'POST', data: { id: created.id_descuento_familiar },
    }, { status: 409, code: 'ESTADO_SIN_CAMBIOS' });

    // El cleanup final borra físicamente esta regla histórica por su descripción PW E2E DESC.
  });
});
