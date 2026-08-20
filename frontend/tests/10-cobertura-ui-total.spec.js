const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, apiMultipartCall, expectApiError } = require('./helpers/api.helper');
const { exportFromGlobalModal } = require('./helpers/download.helper');
const { createSocio } = require('./helpers/entities.helper');
const {
  createQuotaCategory,
  createQuotaSocio,
  currentYear,
  deletePayment,
  paymentPayload,
  quotaCatalogs,
} = require('./helpers/cuotas.helper');
const { socioData } = require('./fixtures/socios.fixture');
const { lettersFromSuffix, todayIso, uniqueSuffix } = require('./helpers/data.helper');

function rowByText(page, text) {
  return page.getByRole('row').filter({ hasText: text }).last();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dateParts() {
  const today = todayIso();
  return {
    today,
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    period: Math.ceil(Number(today.slice(5, 7)) / 2),
  };
}

function optionNames(label = 'UI TOTAL') {
  const suffix = lettersFromSuffix(`${label}-${uniqueSuffix()}`, 12);
  return {
    provider: `PW EEE CT INLINE PROVEEDOR ${suffix}`,
    incomeCategory: `PW EEE CT INLINE CATEGORIA INGRESO ${suffix}`,
    incomeConcept: `PW EEE CT INLINE CONCEPTO INGRESO ${suffix}`,
    expenseCategory: `PW EEE CT INLINE CATEGORIA EGRESO ${suffix}`,
    expenseConcept: `PW EEE CT INLINE CONCEPTO EGRESO ${suffix}`,
    receipt: `PW-E2E-VISTA-${suffix}`,
    detail: `PW E2E VISTA COMPROBANTE ${suffix}`,
  };
}

async function createOption(request, type, name) {
  const response = await apiCall(request, 'contable_opcion_guardar', {
    method: 'POST',
    data: { tipo: type, nombre: name },
  });
  return response.item;
}

async function deleteOption(request, item) {
  if (!item?.id_opcion) return;
  try {
    await apiCall(request, 'contable_opcion_eliminar', {
      method: 'POST',
      data: { id_opcion: item.id_opcion },
    });
  } catch (_error) {
    // El cleanup global también elimina las opciones PW E2E remanentes.
  }
}

async function currentMedium(request) {
  const catalogs = await apiCall(request, 'contable_catalogos');
  const medium = (catalogs.medios_pago || []).find((item) => item.activo !== false);
  if (!medium) throw new Error('La cobertura UI total requiere un medio de pago activo.');
  return medium;
}

async function createInlineOption(page, request, parentDialog, fieldLabel, type, name) {
  const select = parentDialog.getByRole('combobox', { name: fieldLabel, exact: true });
  await select.selectOption('__ADD__');

  const optionDialog = page.getByRole('dialog').filter({
    hasText: 'La nueva opción quedará disponible inmediatamente en este selector.',
  }).last();
  await expect(optionDialog).toBeVisible();
  await optionDialog.getByLabel('Nombre *').fill(name);
  await optionDialog.getByRole('button', { name: 'Agregar opción', exact: true }).click();
  await expect(optionDialog).toBeHidden();

  const config = await apiCall(request, 'contable_opciones_configuracion');
  const item = (config.listas?.[type] || []).find((candidate) => candidate.nombre === name);
  expect(item, `La opción inline ${type} debe persistirse`).toBeTruthy();
  await expect(select).toHaveValue(String(item.id_opcion));
  return item;
}

test.describe('Cobertura UI total · huecos funcionales', () => {
  test('Socios: búsqueda exacta por ID, paginación y modal de motivo de baja', async ({ page, request }) => {
    const data = socioData('ID MOTIVO TOTAL');
    const created = await createSocio(request, data);

    await page.goto('/socios/personas');

    // El popover informativo usa role=dialog aunque no sea un CrudModal. Lo
    // abrimos de forma explícita para que también quede cubierto por E2E.
    const contactReferenceButton = page.getByRole('button', { name: 'Ver referencia de último contacto', exact: true });
    await contactReferenceButton.click();
    const contactReference = page.getByRole('dialog', { name: 'Referencia de último contacto', exact: true });
    await expect(contactReference).toBeVisible();
    await expect(contactReference).toContainText('Último contacto');
    await contactReferenceButton.click();
    await expect(contactReference).toBeHidden();

    const sociosPagination = page.getByRole('navigation', { name: 'Paginación de socios' });
    const next = sociosPagination.getByRole('button', { name: 'Siguiente', exact: true });
    if (await next.isEnabled().catch(() => false)) {
      await next.click();
      await expect(sociosPagination.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');
      await sociosPagination.getByRole('button', { name: 'Anterior', exact: true }).click();
      await expect(sociosPagination.getByRole('button', { name: '1', exact: true })).toHaveAttribute('aria-current', 'page');
    }

    const search = page.getByRole('textbox', { name: 'Socio / ID', exact: true });
    await search.fill(String(created.id_socio));
    await expect(rowByText(page, data.nombre)).toBeVisible();

    const reason = `PW E2E MOTIVO COMPLETO PARA MODAL ${'DETALLE '.repeat(45)}`.trim();

    // Dar de baja por el mismo flujo que usa el usuario y verificar que la
    // respuesta inmediata conserve exactamente fecha y motivo registrados.
    await rowByText(page, data.nombre).getByTitle('Dar de baja').click();
    const stateDialog = page.getByRole('dialog', { name: 'Dar de baja al socio' });
    await expect(stateDialog).toBeVisible();
    const bajaDate = todayIso();
    await stateDialog.getByLabel('Fecha de baja *').fill(bajaDate);
    await stateDialog.getByLabel('Motivo de baja *').fill(reason);

    // Este flujo debe persistir el motivo enviado. Si la API responde 200 pero
    // devuelve motivo_baja=null, es un fallo funcional real del backend y el
    // test debe señalarlo enseguida en vez de esperar 60 s por un botón que no
    // puede existir en la tabla de bajas.
    const bajaResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      response.url().includes('action=socios_eliminar')
    );
    await stateDialog.getByRole('button', { name: 'Dar de baja', exact: true }).click();
    const bajaResponse = await bajaResponsePromise;
    const bajaPayload = await bajaResponse.json();
    expect(bajaPayload?.item?.fecha_baja,
      'socios_eliminar debe persistir y devolver la fecha_baja enviada por la UI'
    ).toBe(bajaDate);
    expect(bajaPayload?.item?.motivo_baja,
      'socios_eliminar debe persistir y devolver el motivo_baja enviado por la UI'
    ).toBe(reason);
    await expect(stateDialog).toBeHidden();

    await page.reload();
    await page.getByRole('tab', { name: 'Bajas', exact: true }).click();
    await page.getByRole('textbox', { name: 'Socio / ID', exact: true }).fill(String(created.id_socio));
    const row = rowByText(page, data.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', {
      name: `Ver motivo de baja completo de ${data.nombre}`,
      exact: true,
    }).click();

    const reasonDialog = page.getByRole('dialog', { name: 'Motivo de baja' });
    await expect(reasonDialog).toBeVisible();
    await expect(reasonDialog).toContainText(reason);
    await reasonDialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  });

  test('Cuotas: Contado Anual se registra desde UI y abre su eliminación especial', async ({ page, request }) => {
    const category = await createQuotaCategory(request);
    const socio = await createQuotaSocio(request, 'ANUAL UI COMPLETO', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const annualId = Number(catalogs.annual.id_periodo ?? catalogs.annual.id_mes);
    const annualName = String(catalogs.annual.nombre || 'CONTADO ANUAL');
    const firstBimonthly = catalogs.bimonthly[0];
    const firstBimonthlyName = String(firstBimonthly.nombre);

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(String(annualId));

    const quotaPagination = page.getByRole('navigation', { name: 'Paginación de cuotas' });
    const next = quotaPagination.getByRole('button', { name: 'Siguiente', exact: true });
    if (await next.isEnabled().catch(() => false)) {
      await next.click();
      await expect(quotaPagination.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');
      await quotaPagination.getByRole('button', { name: 'Anterior', exact: true }).click();
    }

    await page.getByRole('textbox', { name: 'Socio / ID', exact: true }).fill(String(socio.item.id_socio));
    let row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Registrar pago de ${socio.data.nombre}` }).click();

    const paymentDialog = page.getByRole('dialog').filter({ hasText: socio.data.nombre }).last();
    const annualChoice = paymentDialog.getByRole('button', {
      name: new RegExp(`^${escapeRegExp(annualName)} ${currentYear()}: (?:disponible|seleccionado)$`, 'i'),
    });
    await expect(annualChoice).toBeVisible();
    if ((await annualChoice.getAttribute('aria-pressed')) !== 'true') {
      await annualChoice.click();
    }
    await expect(annualChoice).toHaveAttribute('aria-pressed', 'true');

    const blockedBimonthly = paymentDialog.getByRole('button', {
      name: new RegExp(`^${escapeRegExp(firstBimonthlyName)} ${currentYear()}: modalidad exclusiva$`, 'i'),
    });
    await expect(blockedBimonthly).toBeDisabled();

    await paymentDialog.getByLabel('Medio de pago *').selectOption(String(catalogs.medium.id_medio_pago));
    await paymentDialog.getByRole('button', { name: 'Registrar pago', exact: true }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText('Pago realizado con éxito');
    await receipt.locator('.payment-receipt-actions__close').click();

    const annualList = await apiCall(request, 'cuotas_listar', {
      params: {
        estado: 'PAGADOS',
        anio: currentYear(),
        mes: annualId,
        id_socio: socio.item.id_socio,
      },
    });
    const annualPayment = annualList.items.find((item) => Number(item.id_socio) === Number(socio.item.id_socio));
    expect(annualPayment).toBeTruthy();

    await page.getByRole('tab', { name: /Pagados/ }).click();
    await page.getByRole('textbox', { name: 'Socio / ID', exact: true }).fill(String(socio.item.id_socio));
    row = rowByText(page, socio.data.nombre);
    await expect(row).toContainText(`CONTADO ANUAL ${currentYear()}`);
    await row.getByRole('button', { name: `Eliminar pago de ${socio.data.nombre}` }).click();

    const deleteDialog = page.getByRole('dialog', { name: 'Eliminar Contado Anual' });
    await expect(deleteDialog).toContainText('los seis períodos volverán a figurar como deuda');
    await deleteDialog.getByRole('button', { name: 'Eliminar Contado Anual', exact: true }).click();
    await expect(deleteDialog).toBeHidden();

    const firstContext = await apiCall(request, 'cuotas_contexto_pago', {
      params: {
        id_socio: socio.item.id_socio,
        anio: currentYear(),
        mes: Number(firstBimonthly.id_periodo ?? firstBimonthly.id_mes),
      },
    });
    expect(firstContext.principal.disponible).toBe(true);
  });

  test('Exportaciones: ejecuta explícitamente el alcance visible en Socios y detalle completo contable', async ({ page, request }) => {
    const socio = await createSocio(request, socioData('EXPORT TODOS'));

    await page.goto('/socios/personas');
    await page.getByRole('textbox', { name: 'Socio / ID', exact: true }).fill(String(socio.id_socio));
    await expect(rowByText(page, socio.nombre)).toBeVisible();
    await exportFromGlobalModal(page, {
      openButton: page.getByRole('button', { name: 'Exportar', exact: true }),
      format: 'Excel',
      scope: 'registros visibles|esta página',
      expectedExtension: '.xlsx',
    });

    const category = await createQuotaCategory(request);
    const quotaSocio = await createQuotaSocio(request, 'EXPORT CONTABLE TODOS', category.item.id_categoria);
    const { year, period } = dateParts();
    const quota = await quotaCatalogs(request, year);
    const periodItem = quota.bimonthly.find((item) => Number(item.id_periodo ?? item.id_mes) === period);
    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: quotaSocio.item.id_socio,
        periodId: Number(periodItem.id_periodo ?? periodItem.id_mes),
        mediumId: quota.medium.id_medio_pago,
        year,
      }),
    });

    try {
      await page.goto('/contable/ingresos');
      await page.getByLabel('Año').selectOption(String(year));
      await page.getByLabel('Período', { exact: true }).selectOption(String(period));
      await page.getByRole('tablist', { name: 'Vista' }).getByRole('tab', { name: 'Detalle', exact: true }).click();
      const search = page.getByRole('textbox', { name: 'Buscar', exact: true });
      await search.fill(quotaSocio.data.nombre);
      await expect(page.getByRole('row').filter({ hasText: quotaSocio.data.nombre }).first()).toBeVisible();
      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar', exact: true }),
        format: 'PDF',
        scope: 'registros visibles|esta página',
        expectedExtension: '.pdf',
      });
    } finally {
      await deletePayment(request, paid.items[0].id_pago);
    }
  });

  test('Contabilidad: AGREGAR NUEVA OPCIÓN funciona inline para los cinco tipos', async ({ page, request }) => {
    const names = optionNames('INLINE');
    const created = [];

    try {
      await page.goto('/contable/ingresos');
      await page.getByRole('tab', { name: 'Otros ingresos', exact: true }).click();
      await page.getByRole('button', { name: 'Registrar ingreso', exact: true }).click();
      let parent = page.getByRole('dialog').filter({ hasText: 'Registrar ingreso' }).last();

      created.push(await createInlineOption(page, request, parent, 'Persona / proveedor *', 'PROVEEDOR', names.provider));
      created.push(await createInlineOption(page, request, parent, 'Categoría *', 'CATEGORIA_INGRESO', names.incomeCategory));
      created.push(await createInlineOption(page, request, parent, 'Descripción / concepto *', 'CONCEPTO_INGRESO', names.incomeConcept));
      await parent.getByRole('button', { name: 'Cancelar', exact: true }).click();

      await page.goto('/contable/egresos');
      await page.getByRole('button', { name: 'Registrar egreso', exact: true }).click();
      parent = page.getByRole('dialog').filter({ hasText: 'Registrar egreso' }).last();
      created.push(await createInlineOption(page, request, parent, 'Categoría *', 'CATEGORIA_EGRESO', names.expenseCategory));
      created.push(await createInlineOption(page, request, parent, 'Descripción / concepto *', 'CONCEPTO_EGRESO', names.expenseConcept));
      await parent.getByRole('button', { name: 'Cancelar', exact: true }).click();
    } finally {
      for (const item of created.reverse()) await deleteOption(request, item);
    }
  });

  test('Egresos: Ver comprobante ejecuta descarga segura y construye la vista previa', async ({ page, request }) => {
    const names = optionNames('PREVIEW');
    const provider = await createOption(request, 'PROVEEDOR', names.provider);
    const category = await createOption(request, 'CATEGORIA_EGRESO', names.expenseCategory);
    const concept = await createOption(request, 'CONCEPTO_EGRESO', names.expenseConcept);
    const medium = await currentMedium(request);
    const { today, year, month } = dateParts();
    let expenseId = null;

    try {
      const created = await apiMultipartCall(request, 'contable_egreso_guardar', {
        fecha: today,
        id_medio_pago: String(medium.id_medio_pago),
        id_proveedor: String(provider.id_opcion),
        id_categoria: String(category.id_opcion),
        id_concepto: String(concept.id_opcion),
        numero_comprobante: names.receipt,
        importe: '1234.56',
        detalle: names.detail,
        eliminar_archivo: '0',
        archivo: {
          name: 'pw-e2e-vista.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n% PW E2E VISTA\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
        },
      });
      expenseId = created.id_egreso;

      await page.goto('/contable/egresos');
      await page.getByLabel('Año').selectOption(String(year));
      await page.getByLabel('Mes').selectOption(String(month));
      await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(names.receipt);
      const row = page.getByRole('row').filter({ hasText: names.receipt });
      await expect(row).toBeVisible();

      await page.evaluate(() => {
        window.__pwExpensePreviewHtml = '';
        window.__pwExpensePreviewFocused = false;
        window.open = () => ({
          closed: false,
          document: {
            title: '',
            body: { innerHTML: '' },
            open() {},
            write(html) { window.__pwExpensePreviewHtml = String(html || ''); },
            close() {},
          },
          focus() { window.__pwExpensePreviewFocused = true; },
          close() {},
        });
        URL.createObjectURL = () => 'blob:pw-e2e-preview';
        URL.revokeObjectURL = () => {};
      });

      await Promise.all([
        page.waitForResponse((response) => response.url().includes('action=contable_egreso_archivo')),
        row.locator('button[title="Ver comprobante"]').click(),
      ]);
      await expect.poll(() => page.evaluate(() => window.__pwExpensePreviewHtml)).toContain('Vista previa del comprobante');
      await expect.poll(() => page.evaluate(() => window.__pwExpensePreviewFocused)).toBe(true);
    } finally {
      if (expenseId) {
        try {
          await apiCall(request, 'contable_egreso_eliminar', {
            method: 'POST', data: { id_egreso: expenseId },
          });
        } catch (_error) {}
      }
      await deleteOption(request, concept);
      await deleteOption(request, category);
      await deleteOption(request, provider);
    }
  });

  test('Balance anual: abre y renderiza Inscripciones, Bajas y Deudores por período', async ({ page }) => {
    const { year } = dateParts();
    await page.goto('/contable/ingresos');
    await page.getByLabel('Año').selectOption(String(year));
    await page.getByRole('button', { name: 'Balance anual', exact: true }).click();

    const balance = page.locator('[role="dialog"].ct-balance-modal');
    await expect(balance).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('action=contable_balance')),
      balance.getByRole('button', { name: 'Generar balance', exact: true }).click(),
    ]);

    const tabs = balance.getByRole('tablist', { name: 'Secciones del balance anual' });
    await tabs.getByRole('tab', { name: 'Inscripciones', exact: true }).click();
    await expect(balance.getByRole('table', { name: 'Resumen de inscripciones por período de ingreso' })).toBeVisible();
    await expect(balance.getByRole('table', { name: 'Detalle completo de socios inscriptos' })).toBeVisible();

    await tabs.getByRole('tab', { name: 'Bajas', exact: true }).click();
    await expect(balance.getByRole('table', { name: 'Resumen por período de baja' })).toBeVisible();
    await expect(balance.getByRole('table', { name: 'Detalle de socios dados de baja' })).toBeVisible();

    await tabs.getByRole('tab', { name: 'Deudores por período', exact: true }).click();
    await expect(balance.getByRole('table', { name: 'Resumen de deudores por período' })).toBeVisible();
    await expect(balance.getByRole('table', { name: 'Detalle completo de deudores por período' })).toBeVisible();
    await balance.getByRole('button', { name: 'Cerrar', exact: true }).click();
  });

  test('Configuración contable: las cinco listas abren su modal de alta correspondiente', async ({ page }) => {
    const cases = [
      ['Personas / proveedores', 'Nueva persona o proveedor', 'Agregar persona o proveedor'],
      ['Categorías de ingresos', 'Nueva categoría de ingreso', 'Agregar categoría de ingreso'],
      ['Conceptos de ingresos', 'Nuevo concepto de ingreso', 'Agregar concepto de ingreso'],
      ['Categorías de egresos', 'Nueva categoría de egreso', 'Agregar categoría de egreso'],
      ['Conceptos de egresos', 'Nuevo concepto de egreso', 'Agregar concepto de egreso'],
    ];

    await page.goto('/configuracion/contable');
    const tabs = page.getByRole('tablist', { name: 'Listas contables' });
    for (const [tabName, createButton, dialogName] of cases) {
      await tabs.getByRole('tab', { name: tabName, exact: true }).click();
      await page.getByRole('button', { name: createButton, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: dialogName });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(dialog).toBeHidden();
    }
  });

  test('API segura adicional: valida estados estructurales y opciones/filtros contables inválidos', async ({ request }) => {
    await expectApiError(request, 'configuracion_lista_guardar', {
      method: 'POST',
      data: { lista: 'estado', id: 1, nombre: 'PW E2E NO RENOMBRAR ESTADO' },
    }, { status: 409, code: 'ESTADO_ESTRUCTURAL' });

    await expectApiError(request, 'contable_ingresos_socios', {
      params: { anio: currentYear(), periodo: 99, pagina: 1 },
    }, { status: 422, code: 'FILTRO_PERIODO_INVALIDO' });

    await expectApiError(request, 'contable_opcion_guardar', {
      method: 'POST', data: { tipo: 'TIPO_INVENTADO', nombre: 'PW E2E INVALIDA' },
    }, { status: 422, code: 'TIPO_OPCION_INVALIDO' });

    const names = optionNames('ERRORES');
    const provider = await createOption(request, 'PROVEEDOR', names.provider);
    const category = await createOption(request, 'CATEGORIA_INGRESO', names.incomeCategory);
    const concept = await createOption(request, 'CONCEPTO_INGRESO', names.incomeConcept);
    const medium = await currentMedium(request);

    try {
      await expectApiError(request, 'contable_opcion_cambiar_estado', {
        method: 'POST', data: { id_opcion: provider.id_opcion, activo: 'ESTADO_INVALIDO' },
      }, { status: 422, code: 'ESTADO_OPCION_INVALIDO' });

      await apiCall(request, 'contable_opcion_cambiar_estado', {
        method: 'POST', data: { id_opcion: concept.id_opcion, activo: false },
      });

      await expectApiError(request, 'contable_ingreso_guardar', {
        method: 'POST',
        data: {
          fecha: todayIso(),
          id_medio_pago: medium.id_medio_pago,
          id_proveedor: provider.id_opcion,
          id_categoria: category.id_opcion,
          id_concepto: concept.id_opcion,
          importe: '100.00',
          detalle: 'PW E2E OPCION INACTIVA',
        },
      }, { status: 409, code: 'OPCION_CONTABLE_INVALIDA' });
    } finally {
      await deleteOption(request, concept);
      await deleteOption(request, category);
      await deleteOption(request, provider);
    }
  });
});
