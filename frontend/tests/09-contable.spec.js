const { test, expect } = require('./fixtures/auth.fixture');
const {
  apiBinaryResult,
  apiCall,
  apiMultipartCall,
  apiResult,
  expectApiError,
} = require('./helpers/api.helper');
const { exportFromGlobalModal } = require('./helpers/download.helper');
const { createSocio } = require('./helpers/entities.helper');
const { configValues } = require('./fixtures/configuracion.fixture');
const { socioData } = require('./fixtures/socios.fixture');
const { lettersFromSuffix, todayIso, uniqueSuffix } = require('./helpers/data.helper');

function dateParts() {
  const today = todayIso();
  return {
    today,
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    period: Math.ceil(Number(today.slice(5, 7)) / 2),
  };
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function contableNames(label = 'BASE') {
  const letters = lettersFromSuffix(`${label}-${uniqueSuffix()}`, 10);
  return {
    provider: `PW E2E CT PROV ${letters}`,
    incomeCategory: `PW E2E CT ING CAT ${letters}`,
    incomeConcept: `PW E2E CT ING CON ${letters}`,
    expenseCategory: `PW E2E CT EGR CAT ${letters}`,
    expenseConcept: `PW E2E CT EGR CON ${letters}`,
    detail: `PW E2E CONTABLE ${letters}`,
    receipt: `PW-E2E-${letters}`,
  };
}

async function createOption(request, type, name) {
  const response = await apiCall(request, 'contable_opcion_guardar', {
    method: 'POST',
    data: { tipo: type, nombre: name },
  });
  return response.item;
}

async function removeOptionIfPossible(request, item) {
  if (!item?.id_opcion) return;
  try {
    await apiCall(request, 'contable_opcion_eliminar', {
      method: 'POST',
      data: { id_opcion: item.id_opcion },
    });
  } catch (_error) {
    // El teardown global vuelve a limpiar exclusivamente los prefijos PW E2E CT.
  }
}

async function baseCatalogs(request) {
  const catalogs = await apiCall(request, 'contable_catalogos');
  const medium = (catalogs.medios_pago || [])[0];
  if (!medium) throw new Error('Contabilidad E2E requiere al menos un medio de pago activo.');
  return { catalogs, medium };
}

async function createIncomeOptions(request, names) {
  const provider = await createOption(request, 'PROVEEDOR', names.provider);
  const category = await createOption(request, 'CATEGORIA_INGRESO', names.incomeCategory);
  const concept = await createOption(request, 'CONCEPTO_INGRESO', names.incomeConcept);
  return { provider, category, concept };
}

async function createExpenseOptions(request, names) {
  const provider = await createOption(request, 'PROVEEDOR', names.provider);
  const category = await createOption(request, 'CATEGORIA_EGRESO', names.expenseCategory);
  const concept = await createOption(request, 'CONCEPTO_EGRESO', names.expenseConcept);
  return { provider, category, concept };
}

async function removeOptions(request, options) {
  for (const item of Object.values(options || {})) await removeOptionIfPossible(request, item);
}

function expectMoneyIdentity(actual, expected, message) {
  expect(cents(actual), message).toBe(cents(expected));
}

test.describe('Contabilidad · informes de socios y conciliaciones', () => {
  test('Detalle, Detalle de Socios y Detalle de Cobranza concilian, ordenan y paginan de a 100', async ({ request }) => {
    const { year, period } = dateParts();
    const catalogs = await apiCall(request, 'contable_catalogos');
    expect(catalogs.periodos.map((item) => Number(item.id_periodo))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(catalogs.anios).toContain(year);

    const report = await apiCall(request, 'contable_ingresos_socios', {
      params: { anio: year, periodo: period, pagina: 1 },
    });
    expect(report.periodo.anio).toBe(year);
    expect(Number(report.periodo.id_periodo)).toBe(period);

    const detail = report.detalle;
    expect(Number(detail.paginacion.por_pagina)).toBe(100);
    expect(detail.items.length).toBeLessThanOrEqual(100);
    expect(Number(detail.paginacion.total)).toBe(Number(detail.resumen.registros));
    expect(Number(detail.resumen_general.registros)).toBeGreaterThanOrEqual(Number(detail.resumen.registros));

    const firstPageIds = detail.items.map((item) => Number(item.id_pago));
    expect(new Set(firstPageIds).size).toBe(firstPageIds.length);
    for (let index = 1; index < detail.items.length; index += 1) {
      const previous = detail.items[index - 1];
      const current = detail.items[index];
      expect(previous.fecha >= current.fecha, 'El cobro más actual debe aparecer primero').toBe(true);
    }

    if (Number(detail.paginacion.total_paginas) > 1) {
      const second = await apiCall(request, 'contable_ingresos_socios', {
        params: { anio: year, periodo: period, pagina: 2 },
      });
      expect(Number(second.detalle.paginacion.pagina)).toBe(2);
      const firstIds = new Set(detail.items.map((item) => item.id_pago));
      expect(second.detalle.items.some((item) => firstIds.has(item.id_pago))).toBe(false);
    }

    if (detail.items[0]?.socio) {
      const searched = await apiCall(request, 'contable_ingresos_socios', {
        params: { anio: year, periodo: period, pagina: 1, buscar: detail.items[0].socio },
      });
      expect(Number(searched.detalle.resumen.registros)).toBeLessThanOrEqual(Number(detail.resumen_general.registros));
      expectMoneyIdentity(
        searched.detalle.resumen_general.importe,
        report.cobranza.resumen.cuotas_recaudadas,
        'Buscar/paginar no debe romper la conciliación general de caja',
      );
    }

    const partnerSummary = report.socios.resumen;
    expect(Number(partnerSummary.total)).toBe(
      Number(partnerSummary.activos) + Number(partnerSummary.pasivos) + Number(partnerSummary.sin_estado),
    );

    const collection = report.cobranza.resumen;
    expectMoneyIdentity(
      Number(collection.cuotas_recaudadas) + Number(collection.inscripciones_recaudadas),
      collection.total_ingresado,
      'Cuotas + inscripciones debe ser total ingresado',
    );
    expectMoneyIdentity(
      Number(collection.cuotas_esperadas) - Number(collection.cuotas_recaudadas),
      collection.diferencia_cuotas,
      'Esperado - recaudado debe ser faltante/superávit',
    );
    expectMoneyIdentity(
      detail.resumen_general.importe,
      collection.cuotas_recaudadas,
      'El detalle completo debe sumar exactamente las cuotas recaudadas',
    );

    const annual = await apiCall(request, 'contable_ingresos_socios', {
      params: { anio: year, periodo: 7, pagina: 1 },
    });
    expect(Number(annual.periodo.id_periodo)).toBe(7);
    expect(String(annual.periodo.etiqueta).toUpperCase()).toContain('CONTADO ANUAL');
    expect(annual.detalle.items.every((item) => Number(item.id_periodo) === 7)).toBe(true);

    await expectApiError(request, 'contable_ingresos_socios', {
      params: { anio: year, periodo: period, pagina: 0 },
    }, { status: 422, code: 'PAGINA_INVALIDA' });
  });

  test('estados auxiliares del catálogo no rompen Contabilidad y se clasifican como SIN ESTADO', async ({ request }) => {
    const { year, period } = dateParts();
    const definition = configValues().estado;
    let stateId = null;
    let socioId = null;

    try {
      const state = await apiCall(request, 'configuracion_lista_guardar', {
        method: 'POST',
        data: { lista: 'estado', nombre: definition.nombre },
      });
      stateId = Number(state.item.id_estado);

      const socio = await createSocio(request, socioData('CONTABLE ESTADO AUX'), {
        id_estado: stateId,
        fecha_ingreso: todayIso(),
      });
      socioId = Number(socio.id_socio);

      const report = await apiCall(request, 'contable_ingresos_socios', {
        params: { anio: year, periodo: period, pagina: 1 },
      });
      expect(Number(report.socios.resumen.sin_estado)).toBeGreaterThanOrEqual(1);
      expect(Number(report.socios.resumen.total)).toBe(
        Number(report.socios.resumen.activos)
          + Number(report.socios.resumen.pasivos)
          + Number(report.socios.resumen.sin_estado),
      );

      const startMonth = (period - 1) * 2 + 1;
      const endMonth = startMonth + 1;
      const from = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
      const to = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
      const balance = await apiCall(request, 'contable_balance', {
        params: { desde: from, hasta: to },
      });
      const debtItem = (balance.balance.deudores.items || [])
        .find((item) => Number(item.id_socio) === socioId);
      if (debtItem) expect(debtItem.estado).toBe('SIN ESTADO');

      const registrationItem = (balance.balance.inscripciones.items || [])
        .find((item) => Number(item.id_socio) === socioId);
      if (registrationItem) expect(registrationItem.estado).toBe('SIN ESTADO');
    } finally {
      if (socioId) {
        try {
          await apiCall(request, 'socios_eliminar_definitivo', {
            method: 'POST',
            data: { id: socioId },
          });
        } catch (_error) {}
      }
      if (stateId) {
        try {
          await apiCall(request, 'configuracion_lista_eliminar_definitivo', {
            method: 'POST',
            data: { lista: 'estado', id: stateId },
          });
        } catch (_error) {}
      }
    }
  });

  test('Resumen y Balance anual mantienen todas sus identidades internas y validaciones de rango', async ({ request }) => {
    const { year, month } = dateParts();
    const summaryResponse = await apiCall(request, 'contable_resumen', {
      params: { anio: year, mes: month },
    });
    const summary = summaryResponse.resumen;
    expect(summary.meses).toHaveLength(12);

    const annualIncome = summary.meses.reduce((sum, row) => sum + cents(row.ingresos), 0);
    const annualExpenses = summary.meses.reduce((sum, row) => sum + cents(row.egresos), 0);
    expect(annualIncome).toBe(cents(summary.totales.ingresos));
    expect(annualExpenses).toBe(cents(summary.totales.egresos));
    expect(cents(summary.totales.resultado)).toBe(annualIncome - annualExpenses);
    for (const row of summary.meses) {
      expect(cents(row.resultado)).toBe(cents(row.ingresos) - cents(row.egresos));
    }

    const from = `${year}-01-01`;
    const to = `${year}-02-28`;
    const balanceResponse = await apiCall(request, 'contable_balance', {
      params: { desde: from, hasta: to },
    });
    const balance = balanceResponse.balance;
    expect(balance.desde).toBe(from);
    expect(balance.hasta).toBe(to);
    expect(balance.periodos.length).toBeGreaterThan(0);

    const registrations = balance.inscripciones.resumen;
    expect(Number(registrations.inscripciones)).toBe(
      Number(registrations.pagadas) + Number(registrations.sin_importe) + Number(registrations.sin_registro),
    );
    expect(Number(registrations.inscripciones)).toBe(
      Number(registrations.activos) + Number(registrations.pasivos) + Number(registrations.sin_estado),
    );

    const leavers = balance.bajas.resumen;
    expect(Number(leavers.total_bajas)).toBe(
      Number(leavers.activos) + Number(leavers.pasivos) + Number(leavers.sin_estado),
    );
    const debts = balance.deudores.resumen;
    expect(Number(debts.total_deudas)).toBe(
      Number(debts.activos) + Number(debts.pasivos) + Number(debts.sin_estado),
    );

    await expectApiError(request, 'contable_balance', {
      params: { desde: `${year}-03-01`, hasta: `${year}-02-01` },
    }, { status: 422, code: 'RANGO_FECHAS_INVALIDO' });
    await expectApiError(request, 'contable_balance', {
      params: { desde: '2000-01-01', hasta: '2020-12-31' },
    }, { status: 422, code: 'RANGO_FECHAS_DEMASIADO_AMPLIO' });
    await expectApiError(request, 'contable_resumen', {
      params: { anio: year, mes: 13 },
    }, { status: 422, code: 'FILTRO_INVALIDO' });
  });
});

test.describe('Contabilidad · configuración y movimientos API', () => {
  test('las cinco listas contables cubren alta, duplicado, edición, baja, reactivación y eliminación', async ({ request }) => {
    const names = contableNames('OPTIONS');
    const types = [
      ['PROVEEDOR', names.provider],
      ['CATEGORIA_INGRESO', names.incomeCategory],
      ['CONCEPTO_INGRESO', names.incomeConcept],
      ['CATEGORIA_EGRESO', names.expenseCategory],
      ['CONCEPTO_EGRESO', names.expenseConcept],
    ];
    const created = [];

    try {
      for (const [type, name] of types) {
        const item = await createOption(request, type, name);
        created.push(item);
        expect(item.tipo).toBe(type);
        expect(item.activo).toBe(true);

        await expectApiError(request, 'contable_opcion_guardar', {
          method: 'POST', data: { tipo: type, nombre: name },
        }, { status: 409, code: 'OPCION_DUPLICADA' });

        const editedName = `${name} X`;
        const edited = await apiCall(request, 'contable_opcion_guardar', {
          method: 'POST', data: { id_opcion: item.id_opcion, tipo: type, nombre: editedName },
        });
        expect(edited.item.nombre).toBe(editedName);
        item.nombre = editedName;

        const disabled = await apiCall(request, 'contable_opcion_cambiar_estado', {
          method: 'POST', data: { id_opcion: item.id_opcion, activo: false },
        });
        expect(disabled.activo).toBe(false);
        const enabled = await apiCall(request, 'contable_opcion_cambiar_estado', {
          method: 'POST', data: { id_opcion: item.id_opcion, activo: true },
        });
        expect(enabled.activo).toBe(true);
      }

      const config = await apiCall(request, 'contable_opciones_configuracion');
      for (const item of created) {
        expect((config.listas[item.tipo] || []).some((row) => row.id_opcion === item.id_opcion)).toBe(true);
      }

      for (const item of created) {
        const removed = await apiCall(request, 'contable_opcion_eliminar', {
          method: 'POST', data: { id_opcion: item.id_opcion },
        });
        expect(removed.eliminado_definitivo).toBe(true);
      }
      created.length = 0;

      await expectApiError(request, 'contable_opcion_cambiar_estado', {
        method: 'POST', data: { id_opcion: 2147483647, activo: true },
      }, { status: 404, code: 'OPCION_CONTABLE_NO_ENCONTRADA' });
    } finally {
      for (const item of created) await removeOptionIfPossible(request, item);
    }
  });

  test('otros ingresos: alta, filtros, edición, resumen, opción en uso y eliminación', async ({ request }) => {
    const names = contableNames('INCOME');
    const options = await createIncomeOptions(request, names);
    const { medium } = await baseCatalogs(request);
    const { today, year, month } = dateParts();
    let incomeId = null;

    try {
      const created = await apiCall(request, 'contable_ingreso_guardar', {
        method: 'POST',
        data: {
          fecha: today,
          id_medio_pago: medium.id_medio_pago,
          id_proveedor: options.provider.id_opcion,
          id_categoria: options.category.id_opcion,
          id_concepto: options.concept.id_opcion,
          importe: '12345.67',
          detalle: names.detail,
        },
      });
      incomeId = created.id_ingreso;
      expect(Number(incomeId)).toBeGreaterThan(0);

      let list = await apiCall(request, 'contable_ingresos_listar', {
        params: { anio: year, mes: month, buscar: names.detail },
      });
      expect(list.items).toHaveLength(1);
      expect(list.items[0].id_ingreso).toBe(incomeId);
      expect(cents(list.resumen.importe)).toBe(cents('12345.67'));

      list = await apiCall(request, 'contable_ingresos_listar', {
        params: {
          anio: year,
          mes: month,
          categoria: options.category.id_opcion,
          medio: medium.id_medio_pago,
          buscar: names.provider,
        },
      });
      expect(list.items.some((item) => item.id_ingreso === incomeId)).toBe(true);

      const editedDetail = `${names.detail} EDITADO`;
      await apiCall(request, 'contable_ingreso_guardar', {
        method: 'POST',
        data: {
          id_ingreso: incomeId,
          fecha: today,
          id_medio_pago: medium.id_medio_pago,
          id_proveedor: options.provider.id_opcion,
          id_categoria: options.category.id_opcion,
          id_concepto: options.concept.id_opcion,
          importe: '15000.50',
          detalle: editedDetail,
        },
      });
      const editedList = await apiCall(request, 'contable_ingresos_listar', {
        params: { anio: year, mes: month, buscar: editedDetail },
      });
      expect(editedList.items[0].id_ingreso).toBe(incomeId);
      expect(cents(editedList.items[0].importe)).toBe(cents('15000.50'));

      const summary = await apiCall(request, 'contable_resumen', { params: { anio: year, mes: month } });
      expect(cents(summary.resumen.totales_mes.otros_ingresos)).toBeGreaterThanOrEqual(cents('15000.50'));

      await expectApiError(request, 'contable_opcion_eliminar', {
        method: 'POST', data: { id_opcion: options.provider.id_opcion },
      }, { status: 409, code: 'OPCION_CONTABLE_EN_USO' });
      await expectApiError(request, 'contable_ingreso_guardar', {
        method: 'POST',
        data: {
          fecha: today,
          id_medio_pago: 2147483647,
          id_proveedor: options.provider.id_opcion,
          id_categoria: options.category.id_opcion,
          id_concepto: options.concept.id_opcion,
          importe: '1',
        },
      }, { status: 409, code: 'MEDIO_PAGO_INVALIDO' });

      await apiCall(request, 'contable_ingreso_eliminar', {
        method: 'POST', data: { id_ingreso: incomeId },
      });
      incomeId = null;
      const empty = await apiCall(request, 'contable_ingresos_listar', {
        params: { anio: year, mes: month, buscar: editedDetail },
      });
      expect(empty.items).toHaveLength(0);

      await expectApiError(request, 'contable_ingreso_eliminar', {
        method: 'POST', data: { id_ingreso: 2147483647 },
      }, { status: 404, code: 'INGRESO_NO_ENCONTRADO' });
    } finally {
      if (incomeId) {
        try { await apiCall(request, 'contable_ingreso_eliminar', { method: 'POST', data: { id_ingreso: incomeId } }); } catch (_error) {}
      }
      await removeOptions(request, options);
    }
  });

  test('egresos: alta con PDF, descarga segura, edición/quita de archivo, filtros y eliminación', async ({ request }) => {
    const names = contableNames('EXPENSE');
    const options = await createExpenseOptions(request, names);
    const { medium } = await baseCatalogs(request);
    const { today, year, month } = dateParts();
    let expenseId = null;

    try {
      const created = await apiMultipartCall(request, 'contable_egreso_guardar', {
        fecha: today,
        id_medio_pago: String(medium.id_medio_pago),
        id_proveedor: String(options.provider.id_opcion),
        id_categoria: String(options.category.id_opcion),
        id_concepto: String(options.concept.id_opcion),
        numero_comprobante: names.receipt,
        importe: '7654.32',
        detalle: names.detail,
        eliminar_archivo: '0',
        archivo: {
          name: 'pw-e2e-comprobante.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n% PW E2E comprobante\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
        },
      });
      expenseId = created.id_egreso;
      expect(Number(expenseId)).toBeGreaterThan(0);

      let list = await apiCall(request, 'contable_egresos_listar', {
        params: { anio: year, mes: month, buscar: names.receipt },
      });
      expect(list.items).toHaveLength(1);
      expect(list.items[0].id_egreso).toBe(expenseId);
      expect(list.items[0].tiene_archivo).toBe(true);
      expect(list.items[0].archivo_nombre.toLowerCase()).toMatch(/\.pdf$/);

      const file = await apiBinaryResult(request, 'contable_egreso_archivo', {
        params: { id: expenseId },
      });
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toContain('application/pdf');
      expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(String(file.headers['x-content-type-options'] || '').toLowerCase()).toBe('nosniff');

      await apiMultipartCall(request, 'contable_egreso_guardar', {
        id_egreso: String(expenseId),
        fecha: today,
        id_medio_pago: String(medium.id_medio_pago),
        id_proveedor: String(options.provider.id_opcion),
        id_categoria: String(options.category.id_opcion),
        id_concepto: String(options.concept.id_opcion),
        numero_comprobante: `${names.receipt}-EDIT`,
        importe: '8000.00',
        detalle: `${names.detail} EDITADO`,
        eliminar_archivo: '1',
      });

      list = await apiCall(request, 'contable_egresos_listar', {
        params: {
          anio: year,
          mes: month,
          categoria: options.category.id_opcion,
          medio: medium.id_medio_pago,
          buscar: `${names.receipt}-EDIT`,
        },
      });
      expect(list.items).toHaveLength(1);
      expect(list.items[0].tiene_archivo).toBe(false);
      expect(cents(list.items[0].importe)).toBe(cents('8000.00'));

      await expectApiError(request, 'contable_egreso_archivo', {
        params: { id: expenseId },
      }, { status: 404, code: 'ARCHIVO_NO_ENCONTRADO' });

      await expectApiError(request, 'contable_egreso_guardar', {
        method: 'POST',
        multipart: {
          fecha: today,
          id_medio_pago: String(medium.id_medio_pago),
          id_proveedor: String(options.provider.id_opcion),
          id_categoria: String(options.category.id_opcion),
          id_concepto: String(options.concept.id_opcion),
          importe: '1',
          archivo: {
            name: 'pw-e2e-no-permitido.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('PW E2E archivo no permitido'),
          },
        },
      }, { status: 422, code: 'TIPO_ARCHIVO_INVALIDO' });

      await apiCall(request, 'contable_egreso_eliminar', {
        method: 'POST', data: { id_egreso: expenseId },
      });
      expenseId = null;
      await expectApiError(request, 'contable_egreso_eliminar', {
        method: 'POST', data: { id_egreso: 2147483647 },
      }, { status: 404, code: 'EGRESO_NO_ENCONTRADO' });
    } finally {
      if (expenseId) {
        try { await apiCall(request, 'contable_egreso_eliminar', { method: 'POST', data: { id_egreso: expenseId } }); } catch (_error) {}
      }
      await removeOptions(request, options);
    }
  });
});

test.describe('Contabilidad · UI completa', () => {
  test('Ingresos de socios cubre las tres pestañas, búsqueda, paginación, Contado Anual, exportación y Balance anual', async ({ page, request }) => {
    const { year, period } = dateParts();
    const apiReport = await apiCall(request, 'contable_ingresos_socios', {
      params: { anio: year, periodo: period, pagina: 1 },
    });

    await page.goto('/contable/ingresos');
    await expect(page.getByRole('heading', { name: 'Ingresos' })).toBeVisible();
    await page.getByLabel('Año').selectOption(String(year));
    await page.getByLabel('Período', { exact: true }).selectOption(String(period));

    const segmented = page.getByRole('tablist', { name: 'Vista' });
    await segmented.getByRole('tab', { name: 'Detalle', exact: true }).click();
    await expect(page.getByText('Detalle de cobros recibidos')).toBeVisible();

    if (apiReport.detalle.items[0]?.socio) {
      const search = page.getByRole('textbox', { name: 'Buscar' });
      await expect(search).toHaveAttribute('placeholder', /Socio, categoría, cobrador, período/i);
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes('buscar=')),
        search.fill(apiReport.detalle.items[0].socio),
      ]);
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && !response.url().includes('buscar=')),
        search.fill(''),
      ]);
    }

    if (Number(apiReport.detalle.paginacion.total_paginas) > 1) {
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes('pagina=2')),
        page.getByRole('button', { name: 'Siguiente', exact: true }).click(),
      ]);
      await expect(page.getByText(/101/).first()).toBeVisible();
      await page.getByRole('button', { name: 'Anterior', exact: true }).click();
    }

    await segmented.getByRole('tab', { name: /Detalle de socios/i }).click();
    await expect(page.getByRole('columnheader', { name: 'Estado' })).toBeVisible();
    const partnerTotals = page.getByRole('region', { name: 'Totales de socios por estado' });
    await expect(partnerTotals).toBeVisible();
    await expect(partnerTotals.getByText('Total activos', { exact: true })).toBeVisible();
    await expect(partnerTotals.getByText('Total pasivos', { exact: true })).toBeVisible();
    await expect(partnerTotals.getByText('Total general', { exact: true })).toBeVisible();

    await segmented.getByRole('tab', { name: /Detalle de cobranza/i }).click();
    const collectionTotals = page.getByRole('region', { name: 'Totales de cobranza del período' });
    await expect(collectionTotals).toBeVisible();
    await expect(collectionTotals.getByText('Cuotas recaudadas', { exact: true })).toBeVisible();
    await expect(collectionTotals.getByText('Inscripciones recaudadas', { exact: true })).toBeVisible();
    await expect(collectionTotals.getByText('Cuotas esperadas', { exact: true })).toBeVisible();
    const expectedDifferenceLabel = Number(apiReport.cobranza?.resumen?.diferencia_cuotas || 0) >= 0
      ? 'Faltante'
      : 'Superávit';
    await expect(collectionTotals.getByText(expectedDifferenceLabel, { exact: true })).toBeVisible();

    await Promise.all([
      page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes('periodo=7')),
      page.getByLabel('Período', { exact: true }).selectOption('7'),
    ]);
    await expect(page.getByLabel('Período', { exact: true })).toHaveValue('7');
    await expect(page.getByLabel('Período', { exact: true }).locator('option:checked')).toHaveText('CONTADO ANUAL');
    await segmented.getByRole('tab', { name: 'Detalle', exact: true }).click();

    const annualApi = await apiCall(request, 'contable_ingresos_socios', {
      params: { anio: year, periodo: 7, pagina: 1 },
    });
    if (Number(annualApi.detalle.paginacion.total) > 0) {
      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar', exact: true }),
        format: 'Excel',
        scope: 'registros visibles|esta página',
        expectedExtension: '.xlsx',
      });
    }

    await page.getByRole('button', { name: 'Balance anual' }).click();
    const balance = page.getByRole('dialog', { name: 'Balance anual' });
    await expect(balance).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('action=contable_balance')),
      balance.getByRole('button', { name: 'Generar balance' }).click(),
    ]);
    await expect(balance.getByRole('button', { name: 'Actualizar balance' })).toBeVisible();
    await balance.getByRole('button', { name: 'Cerrar' }).click();
  });

  test('Otros ingresos UI registra, edita, filtra, exporta y elimina un movimiento real E2E', async ({ page, request }) => {
    const names = contableNames('UIINCOME');
    const options = await createIncomeOptions(request, names);
    const { medium } = await baseCatalogs(request);
    const { year, month } = dateParts();
    let incomeId = null;

    try {
      await page.goto('/contable/ingresos');
      await page.getByRole('tab', { name: 'Otros ingresos', exact: true }).click();
      await page.getByLabel('Año').selectOption(String(year));
      await page.getByLabel('Mes').selectOption(String(month));
      await page.getByRole('button', { name: 'Registrar ingreso' }).click();

      let dialog = page.getByRole('dialog', { name: 'Registrar ingreso' });
      await dialog.getByLabel('Medio de pago *').selectOption(String(medium.id_medio_pago));
      await dialog.getByLabel('Persona / proveedor *').selectOption(String(options.provider.id_opcion));
      await dialog.getByLabel('Categoría *').selectOption(String(options.category.id_opcion));
      await dialog.getByLabel('Descripción / concepto *').selectOption(String(options.concept.id_opcion));
      await dialog.getByLabel('Importe (ARS) *').fill('4321.50');
      await dialog.getByLabel('Detalle opcional').fill(names.detail);
      await dialog.getByRole('button', { name: 'Guardar ingreso' }).click();
      await expect(dialog).toBeHidden();

      let list = await apiCall(request, 'contable_ingresos_listar', {
        params: { anio: year, mes: month, buscar: names.detail },
      });
      expect(list.items).toHaveLength(1);
      incomeId = list.items[0].id_ingreso;

      const search = page.getByRole('textbox', { name: 'Búsqueda' });
      await search.fill(names.detail);
      const row = page.getByRole('row').filter({ hasText: names.provider });
      await expect(row).toBeVisible();
      await row.locator('button[title="Editar"]').click();
      dialog = page.getByRole('dialog', { name: 'Editar ingreso' });
      await dialog.getByLabel('Importe (ARS) *').fill('5000.25');
      await dialog.getByLabel('Detalle opcional').fill(`${names.detail} EDITADO`);
      await dialog.getByRole('button', { name: 'Guardar ingreso' }).click();
      await expect(dialog).toBeHidden();

      await search.fill(`${names.detail} EDITADO`);
      const editedRow = page.getByRole('row').filter({ hasText: names.provider });
      await expect(editedRow).toContainText('5.000');

      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar' }).first(),
        format: 'Excel', expectedExtension: '.xlsx',
      });

      await editedRow.locator('button[title="Anular"]').click();
      const remove = page.getByRole('dialog', { name: 'Eliminar ingreso' });
      await remove.getByRole('button', { name: 'Eliminar movimiento' }).click();
      await expect(remove).toBeHidden();
      incomeId = null;
      await expect(page.getByRole('row').filter({ hasText: names.provider })).toHaveCount(0);
    } finally {
      if (incomeId) {
        try { await apiCall(request, 'contable_ingreso_eliminar', { method: 'POST', data: { id_ingreso: incomeId } }); } catch (_error) {}
      }
      await removeOptions(request, options);
    }
  });

  test('Egresos UI registra, adjunta comprobante, edita, quita archivo y elimina', async ({ page, request }) => {
    const names = contableNames('UIEXPENSE');
    const options = await createExpenseOptions(request, names);
    const { medium } = await baseCatalogs(request);
    const { year, month } = dateParts();
    let expenseId = null;

    try {
      await page.goto('/contable/egresos');
      await page.getByLabel('Año').selectOption(String(year));
      await page.getByLabel('Mes').selectOption(String(month));
      await page.getByRole('button', { name: 'Registrar egreso' }).click();

      let dialog = page.getByRole('dialog', { name: 'Registrar egreso' });
      await dialog.getByLabel('Medio de pago *').selectOption(String(medium.id_medio_pago));
      await dialog.getByLabel('Categoría *').selectOption(String(options.category.id_opcion));
      await dialog.getByLabel('Proveedor *').selectOption(String(options.provider.id_opcion));
      await dialog.getByLabel('Descripción / concepto *').selectOption(String(options.concept.id_opcion));
      await dialog.getByLabel('N.º de comprobante').fill(names.receipt);
      await dialog.getByLabel('Importe (ARS) *').fill('6789.10');
      await dialog.getByLabel('Detalle opcional').fill(names.detail);
      await dialog.getByRole('tab', { name: /Comprobante/ }).click();
      const fileInput = dialog.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: 'pw-e2e-ui.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n% PW E2E UI\n%%EOF\n'),
      });
      await expect(dialog.getByText('pw-e2e-ui.pdf')).toBeVisible();
      await dialog.getByRole('button', { name: 'Guardar egreso' }).click();
      await expect(dialog).toBeHidden();

      let list = await apiCall(request, 'contable_egresos_listar', {
        params: { anio: year, mes: month, buscar: names.receipt },
      });
      expect(list.items).toHaveLength(1);
      expenseId = list.items[0].id_egreso;
      expect(list.items[0].tiene_archivo).toBe(true);

      const search = page.getByRole('textbox', { name: 'Búsqueda' });
      await search.fill(names.receipt);
      let row = page.getByRole('row').filter({ hasText: names.provider });
      await expect(row).toBeVisible();
      await expect(row.locator('button[title="Ver comprobante"]')).toBeEnabled();

      await row.locator('button[title="Editar"]').click();
      dialog = page.getByRole('dialog', { name: 'Editar egreso' });
      await dialog.getByRole('tab', { name: /Comprobante/ }).click();
      await dialog.getByRole('button', { name: 'Quitar comprobante' }).click();
      await dialog.getByRole('tab', { name: /Datos del egreso/ }).click();
      await dialog.getByLabel('Importe (ARS) *').fill('7000.00');
      await dialog.getByRole('button', { name: 'Guardar egreso' }).click();
      await expect(dialog).toBeHidden();

      list = await apiCall(request, 'contable_egresos_listar', {
        params: { anio: year, mes: month, buscar: names.receipt },
      });
      expect(list.items[0].tiene_archivo).toBe(false);
      expect(cents(list.items[0].importe)).toBe(cents('7000'));

      row = page.getByRole('row').filter({ hasText: names.provider });
      await row.locator('button[title="Anular"]').click();
      const remove = page.getByRole('dialog', { name: 'Eliminar egreso' });
      await remove.getByRole('button', { name: 'Eliminar movimiento' }).click();
      await expect(remove).toBeHidden();
      expenseId = null;
    } finally {
      if (expenseId) {
        try { await apiCall(request, 'contable_egreso_eliminar', { method: 'POST', data: { id_egreso: expenseId } }); } catch (_error) {}
      }
      await removeOptions(request, options);
    }
  });

  test('Resumen UI alterna anual/mensual y abre el detalle de los 12 meses', async ({ page }) => {
    const { year, month } = dateParts();
    await page.goto('/contable/resumen');
    await expect(page.getByText('Resumen contable', { exact: true })).toBeVisible();
    await page.getByLabel('Año').selectOption(String(year));

    const monthlyTab = page.getByRole('tab', { name: 'Mensual', exact: true });
    await monthlyTab.click();
    await expect(monthlyTab).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Mes').selectOption(String(month));

    // Acotar la comprobación al resumen visible evita tomar el rótulo oculto
    // "Ingresos" del submenú lateral de Contabilidad.
    const periodTotals = page.getByRole('region', { name: 'Totales del período' });
    await expect(periodTotals).toBeVisible();
    await expect(periodTotals).toContainText('Ingresos');
    await expect(periodTotals).toContainText('Egresos');
    await expect(periodTotals).toContainText('Resultado');

    await page.getByRole('tab', { name: 'Anual', exact: true }).click();

    await page.getByRole('button', { name: 'Detalle', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Detalle mensual contable' });
    await expect(dialog).toBeVisible();
    const table = dialog.getByRole('table', { name: new RegExp(`Detalle mensual contable del año ${year}`) });
    await expect(table.getByRole('row')).toHaveCount(13);
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
  });

  test('Configuración contable UI cubre alta, edición, baja, reactivación, búsqueda y eliminación definitiva', async ({ page, request }) => {
    const names = contableNames('UICONFIG');
    let optionId = null;
    try {
      await page.goto('/configuracion/contable');
      await expect(page.getByRole('heading', { name: 'Configuración contable' })).toBeVisible();
      await page.getByRole('button', { name: 'Nueva persona o proveedor' }).click();
      let dialog = page.getByRole('dialog', { name: 'Agregar persona o proveedor' });
      await dialog.getByLabel('Nombre *').fill(names.provider);
      await dialog.getByRole('button', { name: /Agregar|Guardar/i }).click();
      await expect(dialog).toBeHidden();

      let config = await apiCall(request, 'contable_opciones_configuracion');
      const created = config.listas.PROVEEDOR.find((item) => item.nombre === names.provider);
      expect(created).toBeTruthy();
      optionId = created.id_opcion;

      const search = page.getByRole('textbox', { name: 'Buscar' });
      await search.fill(names.provider);
      let row = page.locator('.config-contableTable__row').filter({ hasText: names.provider });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: `Editar ${names.provider}` }).click();
      dialog = page.getByRole('dialog', { name: 'Editar persona o proveedor' });
      const editedName = `${names.provider} EDITADO`;
      await dialog.getByLabel('Nombre *').fill(editedName);
      await dialog.getByRole('button', { name: /Guardar|Modificar/i }).click();
      await expect(dialog).toBeHidden();

      await search.fill(editedName);
      row = page.locator('.config-contableTable__row').filter({ hasText: editedName });
      await row.getByRole('button', { name: `Dar de baja ${editedName}` }).click();
      let stateDialog = page.getByRole('dialog', { name: 'Dar de baja persona o proveedor' });
      await stateDialog.getByRole('button', { name: /Dar de baja|Confirmar/i }).click();
      await expect(row).toContainText('Baja');

      await row.getByRole('button', { name: `Reactivar ${editedName}` }).click();
      stateDialog = page.getByRole('dialog', { name: 'Reactivar persona o proveedor' });
      await stateDialog.getByRole('button', { name: /Reactivar|Confirmar/i }).click();
      await expect(row).toContainText('Disponible');

      await row.getByRole('button', { name: `Eliminar definitivamente ${editedName}` }).click();
      const deleteDialog = page.getByRole('dialog', { name: 'Eliminar persona o proveedor' });
      await deleteDialog.getByRole('button', { name: /Eliminar definitivamente|Eliminar/i }).click();
      optionId = null;
      await expect(page.locator('.config-contableTable__row').filter({ hasText: editedName })).toHaveCount(0);
    } finally {
      if (optionId) {
        try { await apiCall(request, 'contable_opcion_eliminar', { method: 'POST', data: { id_opcion: optionId } }); } catch (_error) {}
      }
    }
  });
});
