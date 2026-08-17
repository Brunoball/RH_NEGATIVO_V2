const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, apiResult, expectApiError, readAuthSession } = require('./helpers/api.helper');
const { exportFromGlobalModal } = require('./helpers/download.helper');
const { SESSION_KEY } = require('./helpers/auth.helper');
const { addDaysIso, todayIso } = require('./helpers/data.helper');
const { cuotaFamilyData } = require('./fixtures/cuotas.fixture');
const {
  createQuotaCategory,
  createQuotaSocio,
  currentYear,
  deletePayment,
  paymentPayload,
  quotaCatalogs,
} = require('./helpers/cuotas.helper');

function rowByText(page, text) {
  return page.getByRole('row').filter({ hasText: text }).last();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function setupQuotaPartner(request, label) {
  const category = await createQuotaCategory(request);
  const socio = await createQuotaSocio(request, label, category.item.id_categoria);
  const catalogs = await quotaCatalogs(request);
  return { category, socio, catalogs };
}

async function openBarcodeReader(page) {
  // El lector es una acción exclusiva de admin. Cada test ya recibe la sesión
  // del runner desde auth.fixture, pero revalidamos y, si el navegador perdió
  // el sessionStorage durante una navegación, restauramos la misma sesión E2E
  // antes de comprobar la acción. No se inventa ningún permiso ni se saltea UI.
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
    role = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null')?.usuario?.rol || null, SESSION_KEY);
  }

  expect(role).toBe('admin');
  // En <=1499px la acción superior se reemplaza por su versión inferior.
  // getByRole ignora el botón oculto y usa la acción realmente disponible al usuario.
  const barcodeButton = page.getByRole('button', { name: 'Código de barras', exact: true });
  await expect(barcodeButton).toBeVisible();
  await barcodeButton.click();
  const dialog = page.getByRole('dialog', { name: 'Registro por código de barras' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Cuotas · API y reglas de negocio', () => {
  test('catálogos, años, períodos 1..7, filtros, paginación y contextos tienen contrato coherente', async ({ request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'CONTEXTOS');
    const year = currentYear();
    const first = catalogs.bimonthly[0];
    const firstId = Number(first.id_periodo ?? first.id_mes);

    const rawCatalogs = await apiCall(request, 'cuotas_catalogos', { params: { anio: year, mes: firstId } });
    const raw = rawCatalogs.catalogos || rawCatalogs;
    expect((raw.anios || []).map(Number)).toContain(year);
    const ids = (raw.periodos || raw.meses || []).map((p) => Number(p.id_periodo ?? p.id_mes));
    expect(ids).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7]));

    const list = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA', estado: 'DEUDORES', anio: year, mes: firstId,
        buscar: socio.data.dni, pagina: 1, por_pagina: 1, incluir_catalogos: 'false',
      },
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id_socio).toBe(socio.item.id_socio);
    expect(list.paginacion.pagina).toBe(1);
    expect(list.paginacion.por_pagina).toBe(1);
    expect(list.catalogos).toBeUndefined();

    const context = await apiCall(request, 'cuotas_contexto_pago', {
      params: { id_socio: socio.item.id_socio, anio: year, mes: firstId, fecha_pago: todayIso() },
    });
    expect(context.principal.id_socio).toBe(socio.item.id_socio);
    expect(context.principal.disponible).toBe(true);
    expect(Number(context.principal.monto_sugerido)).toBeGreaterThan(0);
    expect(context.principal.codigo_barra).toBeTruthy();

    const allContexts = await apiCall(request, 'cuotas_contextos_pago', {
      params: { id_socio: socio.item.id_socio, anio: year, fecha_pago: todayIso() },
    });
    expect(Object.keys(allContexts.periodos).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    await expectApiError(request, 'cuotas_listar', { params: { tipo: 'EMPRESA' } }, { code: 'FILTRO_INVALIDO' });
    await expectApiError(request, 'cuotas_listar', { params: { estado: 'OTRO' } }, { code: 'FILTRO_INVALIDO' });
    await expectApiError(request, 'cuotas_listar', { params: { anio: 1999 } }, { code: 'PERIODO_INVALIDO' });
    await expectApiError(request, 'cuotas_contexto_pago', {
      params: { id_socio: socio.item.id_socio, anio: year, mes: 999 },
    }, { code: 'PERIODO_INVALIDO' });
  });

  test('selector de años solo expone año actual o años con movimientos reales', async ({ request }) => {
    const year = currentYear();
    const catalogs = await apiCall(request, 'cuotas_catalogos', { params: { anio: year, mes: 1 } });
    const years = (catalogs.catalogos?.anios || catalogs.anios || []).map(Number);
    expect(years).toContain(year);
    expect(new Set(years).size).toBe(years.length);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
    expect(years.every((value) => value >= 2000 && value <= year + 1)).toBe(true);

    // Todo año distinto del actual que el selector publique debe estar respaldado
    // por al menos un PAGADO o CONDONADO real en alguno de los siete períodos.
    for (const candidate of years.filter((value) => value !== year)) {
      let foundMovement = false;
      for (let periodId = 1; periodId <= 7 && !foundMovement; periodId += 1) {
        for (const state of ['PAGADOS', 'CONDONADOS']) {
          const list = await apiCall(request, 'cuotas_listar', {
            params: {
              estado: state,
              anio: candidate,
              mes: periodId,
              pagina: 1,
              por_pagina: 1,
              incluir_catalogos: 'false',
            },
          });
          if (Number(list.paginacion?.total || 0) > 0) {
            foundMovement = true;
            break;
          }
        }
      }
      expect(foundMovement, `el año ${candidate} no debe aparecer vacío en el selector`).toBe(true);
    }
  });

  test('pago simple queda persistido, duplicado concurrente es imposible y eliminar devuelve la deuda', async ({ request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'UNIQUE');
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const payload = paymentPayload({
      socioId: socio.item.id_socio,
      periodId,
      mediumId: catalogs.medium.id_medio_pago,
      amount: '4321.25',
    });

    const [a, b] = await Promise.all([
      apiResult(request, 'cuotas_registrar_pago', { method: 'POST', data: payload }),
      apiResult(request, 'cuotas_registrar_pago', { method: 'POST', data: payload }),
    ]);
    const results = [a, b].sort((x, y) => x.status - y.status);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body?.codigo === 'CUOTA_YA_REGISTRADA')).toHaveLength(1);

    const success = [a, b].find((r) => r.ok);
    const payment = success.body.items[0];
    expect(payment.estado).toBe('PAGADO');
    expect(Number(payment.monto)).toBeCloseTo(4321.25, 2);

    const paid = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'PAGADOS', anio: currentYear(), mes: periodId, buscar: socio.data.dni },
    });
    expect(paid.items).toHaveLength(1);
    expect(paid.items[0].id_pago).toBe(payment.id_pago);

    await deletePayment(request, payment.id_pago);
    const debt = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'DEUDORES', anio: currentYear(), mes: periodId, buscar: socio.data.dni },
    });
    expect(debt.items.some((item) => item.id_socio === socio.item.id_socio)).toBe(true);
  });

  test('pago múltiple es atómico: un duplicado revierte períodos que todavía estaban libres', async ({ request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'ROLLBACK');
    const p1 = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const p2 = Number(catalogs.bimonthly[1].id_periodo ?? catalogs.bimonthly[1].id_mes);
    const base = { socioId: socio.item.id_socio, mediumId: catalogs.medium.id_medio_pago };

    const first = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST', data: paymentPayload({ ...base, periodId: p1 }),
    });
    await expectApiError(request, 'cuotas_registrar_pagos', {
      method: 'POST',
      data: {
        fecha_pago: todayIso(),
        id_medio_pago: catalogs.medium.id_medio_pago,
        pagos: [
          { id_socio: socio.item.id_socio, anio: currentYear(), mes: p1 },
          { id_socio: socio.item.id_socio, anio: currentYear(), mes: p2 },
        ],
      },
    }, { status: 409, code: 'CUOTA_YA_REGISTRADA' });

    const p2Context = await apiCall(request, 'cuotas_contexto_pago', {
      params: { id_socio: socio.item.id_socio, anio: currentYear(), mes: p2 },
    });
    expect(p2Context.principal.disponible).toBe(true);
    expect(p2Context.principal.id_pago ?? null).toBeNull();
    await deletePayment(request, first.items[0].id_pago);
  });

  test('Contado Anual es exclusivo y se proyecta sobre los seis períodos; alias de anulación funciona', async ({ request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'ANUAL');
    const annualId = Number(catalogs.annual.id_periodo ?? catalogs.annual.id_mes);
    const bimonthId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);

    const annual = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: socio.item.id_socio, periodId: annualId, mediumId: catalogs.medium.id_medio_pago }),
    });
    const annualPaymentId = annual.items[0].id_pago;

    for (let id = 1; id <= 6; id += 1) {
      const paid = await apiCall(request, 'cuotas_listar', {
        params: { estado: 'PAGADOS', anio: currentYear(), mes: id, buscar: socio.data.dni },
      });
      const item = paid.items.find((row) => row.id_socio === socio.item.id_socio);
      expect(item, `proyección anual en período ${id}`).toBeTruthy();
      expect(item.origen_anual).toBe(true);
      expect(item.id_pago).toBe(annualPaymentId);
    }

    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: socio.item.id_socio, periodId: bimonthId, mediumId: catalogs.medium.id_medio_pago }),
    }, { status: 409, code: 'MODALIDAD_NO_DISPONIBLE' });

    await deletePayment(request, annualPaymentId, 'cuotas_anular');

    const bimonth = await apiCall(request, 'cuotas_registrar_cobro', {
      method: 'POST',
      data: paymentPayload({ socioId: socio.item.id_socio, periodId: bimonthId, mediumId: catalogs.medium.id_medio_pago }),
    });
    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: socio.item.id_socio, periodId: annualId, mediumId: catalogs.medium.id_medio_pago }),
    }, { status: 409, code: 'MODALIDAD_NO_DISPONIBLE' });
    await deletePayment(request, bimonth.items[0].id_pago);
  });

  test('condonación registra $0 sin medio, bloquea duplicado y puede eliminarse', async ({ request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'CONDONAR');
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const response = await apiCall(request, 'cuotas_condonar_pago', {
      method: 'POST',
      data: { id_socio: socio.item.id_socio, anio: currentYear(), mes: periodId, fecha_condonacion: todayIso(), motivo: 'PW E2E CONDONACION' },
    });
    expect(response.item.estado).toBe('CONDONADO');
    expect(Number(response.item.monto)).toBe(0);
    expect(response.item.id_medio_pago).toBeNull();

    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: socio.item.id_socio, periodId, mediumId: catalogs.medium.id_medio_pago }),
    }, { status: 409, code: 'CUOTA_YA_REGISTRADA' });

    const waived = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'CONDONADOS', anio: currentYear(), mes: periodId, buscar: socio.data.dni },
    });
    expect(waived.items.some((item) => item.id_pago === response.item.id_pago)).toBe(true);
    await deletePayment(request, response.item.id_pago);
  });

  test('pago familiar expande la operación a todos los integrantes activos', async ({ request }) => {
    const category = await createQuotaCategory(request);
    const a = await createQuotaSocio(request, 'FAMILIA A', category.item.id_categoria);
    const b = await createQuotaSocio(request, 'FAMILIA B', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const family = cuotaFamilyData();
    await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [
          { id_socio: a.item.id_socio, desde: todayIso() },
          { id_socio: b.item.id_socio, desde: todayIso() },
        ],
      },
    });
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: a.item.id_socio,
        periodId,
        mediumId: catalogs.medium.id_medio_pago,
        extra: { aplicar_familia: true },
      }),
    });
    expect(paid.items.map((item) => item.id_socio).sort((x, y) => x - y)).toEqual(
      [a.item.id_socio, b.item.id_socio].sort((x, y) => x - y),
    );
    for (const item of paid.items) await deletePayment(request, item.id_pago);
  });

  test('descuento familiar vigente se aplica al contexto y al pago de todos los integrantes', async ({ request }) => {
    const today = todayIso();
    const rulesResponse = await apiCall(request, 'descuentos_familiares_listar', { params: { estado: 'todos' } });
    const rules = Array.isArray(rulesResponse.items) ? rulesResponse.items : [];

    const applicableAt = (count) => rules.find((rule) => {
      const from = Number(rule.cantidad_integrantes_desde);
      const to = rule.cantidad_integrantes_hasta == null ? Infinity : Number(rule.cantidad_integrantes_hasta);
      const activeToday = Boolean(rule.activo) && String(rule.vigencia_desde) <= today && (!rule.vigencia_hasta || String(rule.vigencia_hasta) >= today);
      return activeToday && count >= from && count <= to && Number(rule.porcentaje_descuento) > 0;
    });

    let memberCount = null;
    let expectedDiscount = null;
    for (let count = 2; count <= 6; count += 1) {
      const rule = applicableAt(count);
      if (rule) {
        memberCount = count;
        expectedDiscount = Number(rule.porcentaje_descuento);
        break;
      }
    }

    // Si la base no trae una regla usable entre 2 y 6 integrantes, creamos una
    // regla E2E en un tamaño libre. La limpieza global la elimina al finalizar.
    if (memberCount == null) {
      const isCovered = (count) => rules.some((rule) => {
        const from = Number(rule.cantidad_integrantes_desde);
        const to = rule.cantidad_integrantes_hasta == null ? Infinity : Number(rule.cantidad_integrantes_hasta);
        const activeToday = Boolean(rule.activo) && String(rule.vigencia_desde) <= today && (!rule.vigencia_hasta || String(rule.vigencia_hasta) >= today);
        return activeToday && count >= from && count <= to;
      });
      memberCount = [2, 3, 4, 5, 6].find((count) => !isCovered(count));
      if (memberCount == null) {
        throw new Error('No se encontró un tamaño familiar E2E libre ni una regla vigente utilizable entre 2 y 6 integrantes.');
      }
      expectedDiscount = 12.5;
      await apiCall(request, 'descuentos_familiares_guardar', {
        method: 'POST',
        data: {
          cantidad_integrantes_desde: memberCount,
          cantidad_integrantes_hasta: memberCount,
          porcentaje_descuento: expectedDiscount,
          vigencia_desde: today,
          vigencia_hasta: today,
          descripcion: `PW E2E DESC CUOTAS ${Date.now()}`,
        },
      });
    }

    const category = await createQuotaCategory(request);
    const members = [];
    for (let index = 0; index < memberCount; index += 1) {
      members.push(await createQuotaSocio(request, `DESC FAM ${index + 1}`, category.item.id_categoria));
    }
    const family = cuotaFamilyData();
    await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: members.map((member) => ({ id_socio: member.item.id_socio, desde: today })),
      },
    });

    const catalogs = await quotaCatalogs(request);
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const context = await apiCall(request, 'cuotas_contexto_pago', {
      params: { id_socio: members[0].item.id_socio, anio: currentYear(), mes: periodId, fecha_pago: today },
    });
    const principal = context.principal;
    expect(Number(principal.porcentaje_descuento_familiar)).toBeCloseTo(expectedDiscount, 2);
    const expectedAmount = Number((Number(principal.monto_base) * (1 - expectedDiscount / 100)).toFixed(2));
    expect(Number(principal.monto_sugerido)).toBeCloseTo(expectedAmount, 2);

    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: members[0].item.id_socio,
        periodId,
        mediumId: catalogs.medium.id_medio_pago,
        extra: { aplicar_familia: true },
      }),
    });
    expect(paid.items).toHaveLength(memberCount);
    for (const item of paid.items) {
      expect(Number(item.porcentaje_descuento_familiar)).toBeCloseTo(expectedDiscount, 2);
      expect(Number(item.monto)).toBeCloseTo(expectedAmount, 2);
      await deletePayment(request, item.id_pago);
    }
  });

  test('validaciones rechazan fecha futura, medio inexistente, monto inválido, lote vacío y socio inexistente', async ({ request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'VALIDACIONES');
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const tomorrow = addDaysIso(1);

    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST', data: paymentPayload({ socioId: socio.item.id_socio, periodId, mediumId: catalogs.medium.id_medio_pago, date: tomorrow }),
    }, { code: 'FECHA_PAGO_FUTURA' });
    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST', data: paymentPayload({ socioId: socio.item.id_socio, periodId, mediumId: 2147483647 }),
    }, { code: 'MEDIO_PAGO_INVALIDO' });
    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST', data: paymentPayload({ socioId: socio.item.id_socio, periodId, mediumId: catalogs.medium.id_medio_pago, amount: '0' }),
    }, { status: 422 });
    await expectApiError(request, 'cuotas_registrar_pagos', {
      method: 'POST', data: { fecha_pago: todayIso(), id_medio_pago: catalogs.medium.id_medio_pago, pagos: [] },
    }, { code: 'VALIDATION_ERROR' });
    await expectApiError(request, 'cuotas_contextos_pago', {
      params: { id_socio: 2147483647, anio: currentYear() },
    }, { status: 404, code: 'SOCIO_NO_ENCONTRADO' });
  });
});

test.describe('Cuotas · UI', () => {
  test('flujo visible completo: pagar, comprobante, listar pagado, eliminar, condonar y eliminar condonación', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'UI CICLO');
    const periodId = String(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const year = String(currentYear());

    await page.goto('/cuotas');
    await expect(page.getByRole('heading', { name: 'Cuotas' })).toBeVisible();
    await page.getByLabel('Año').selectOption(year);
    await page.getByLabel('Mes', { exact: true }).selectOption(periodId);
    await page.getByRole('textbox', { name: 'Búsqueda' }).fill(socio.data.dni);
    let row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: `Registrar pago de ${socio.data.nombre}` }).click();
    let paymentDialog = page.getByRole('dialog').filter({ hasText: socio.data.nombre }).last();
    await paymentDialog.getByLabel('Medio de pago *').selectOption(String(catalogs.medium.id_medio_pago));
    await paymentDialog.getByRole('button', { name: 'Registrar pago', exact: true }).click();
    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText('Pago realizado con éxito');
    await receipt.locator('.payment-receipt-actions__close').click();

    await page.getByRole('tab', { name: /Pagados/ }).click();
    await page.getByRole('textbox', { name: 'Búsqueda' }).fill(socio.data.dni);
    row = rowByText(page, socio.data.nombre);
    await expect(row).toContainText('PAGADO');
    await row.getByRole('button', { name: `Eliminar pago de ${socio.data.nombre}` }).click();
    let actionDialog = page.getByRole('dialog', { name: 'Eliminar pago' });
    await actionDialog.getByRole('button', { name: 'Eliminar pago', exact: true }).click();

    await page.getByRole('tab', { name: /Deudores/ }).click();
    await page.getByRole('textbox', { name: 'Búsqueda' }).fill(socio.data.dni);
    row = rowByText(page, socio.data.nombre);
    await row.getByRole('button', { name: `Condonar cuota de ${socio.data.nombre}` }).click();
    actionDialog = page.getByRole('dialog', { name: 'Condonar cuota' });
    await actionDialog.getByRole('button', { name: 'Condonar cuota', exact: true }).click();

    await page.getByRole('tab', { name: /Condonados/ }).click();
    await page.getByRole('textbox', { name: 'Búsqueda' }).fill(socio.data.dni);
    row = rowByText(page, socio.data.nombre);
    await expect(row).toContainText('CONDONADO');
    await row.getByRole('button', { name: `Eliminar condonación de ${socio.data.nombre}` }).click();
    actionDialog = page.getByRole('dialog', { name: 'Eliminar condonación' });
    await actionDialog.getByRole('button', { name: 'Eliminar condonación', exact: true }).click();
  });

  test('selección múltiple registra dos socios en una sola operación', async ({ page, request }) => {
    const category = await createQuotaCategory(request);
    const a = await createQuotaSocio(request, 'MULTI A', category.item.id_categoria);
    const b = await createQuotaSocio(request, 'MULTI B', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const periodId = String(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(periodId);
    await page.getByRole('textbox', { name: 'Búsqueda' }).fill('PW EEE SOCIO CUOTA MULTI');
    await page.getByRole('button', { name: 'Selección múltiple' }).first().click();
    await page.getByRole('checkbox', { name: `Seleccionar cuota de ${a.data.nombre}` }).check();
    await page.getByRole('checkbox', { name: `Seleccionar cuota de ${b.data.nombre}` }).check();
    await page.getByRole('button', { name: 'Continuar (2)' }).click();

    const dialog = page.getByRole('dialog', { name: 'Registrar pagos seleccionados' });
    await dialog.getByLabel('Medio de pago *').selectOption(String(catalogs.medium.id_medio_pago));
    await dialog.getByRole('button', { name: 'Registrar 2 pagos' }).click();
    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText(a.data.nombre);
    await expect(receipt).toContainText(b.data.nombre);
    await receipt.locator('.payment-receipt-actions__close').click();
  });

  test('modal de pago cubre agregar año, seleccionar/deseleccionar todos, monto personalizado y PDF del comprobante', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'UI MONTO ANIO');
    const current = currentYear();
    const next = current + 1;
    const period = catalogs.bimonthly[0];
    const periodId = String(period.id_periodo ?? period.id_mes);
    const periodName = String(period.nombre);

    // Fuerza únicamente en la respuesta de catálogo que el año siguiente no esté
    // prepublicado, de modo que la acción "Agregar año" se pruebe siempre aunque
    // una base real ya tenga algún pago futuro.
    await page.route(/api\.php\?[^#]*action=cuotas_catalogos/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (body?.catalogos?.anios) {
        body.catalogos.anios = body.catalogos.anios.filter((value) => Number(value) !== next);
      }
      await route.fulfill({ response, json: body });
    });

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(current));
    await page.getByLabel('Mes', { exact: true }).selectOption(periodId);
    await page.getByRole('textbox', { name: 'Búsqueda' }).fill(socio.data.dni);
    const row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Registrar pago de ${socio.data.nombre}` }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: socio.data.nombre }).last();
    await expect(dialog.getByRole('button', { name: `Año ${current}` })).toBeVisible();
    await dialog.getByRole('button', { name: `Año ${current}` }).click();
    const yearList = dialog.getByRole('listbox');
    await expect(yearList.getByRole('option', { name: /Agregar año/ })).toBeVisible();
    await yearList.getByRole('option', { name: /Agregar año/ }).click();
    await expect(dialog.getByRole('button', { name: `Año ${next}` })).toBeVisible();

    // Volvemos al año actual: agregar un año sólo habilita el selector, no crea un pago.
    await dialog.getByRole('button', { name: `Año ${next}` }).click();
    await dialog.getByRole('option', { name: String(current), exact: true }).click();

    await dialog.getByRole('button', { name: 'Seleccionar todos' }).click();
    await expect(dialog.getByRole('button', { name: 'Deseleccionar todos' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Deseleccionar todos' }).click();
    await expect(dialog.getByRole('button', { name: 'Seleccionar todos' })).toBeVisible();

    await dialog.getByRole('button', { name: new RegExp(`^${escapeRegExp(periodName)} ${current}: disponible$`, 'i') }).click();

    // El editor de importes vive en su pestaña propia. Esto prueba la UI real
    // en lugar de depender de que el control permanezca montado fuera de vista.
    await dialog.getByRole('tab', { name: /Importe por período/ }).click();
    const customToggle = dialog.getByRole('checkbox', { name: 'Monto personalizado' });
    await customToggle.check();
    await dialog.getByLabel(`Monto personalizado para ${periodName}`).fill('3999,99');

    // Fecha y medio de pago pertenecen a "Meses a pagar".
    await dialog.getByRole('tab', { name: /Meses a pagar/ }).click();
    await dialog.getByLabel('Medio de pago *').selectOption(String(catalogs.medium.id_medio_pago));
    await dialog.getByRole('button', { name: 'Registrar pago', exact: true }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText('Pago realizado con éxito');
    const downloadPromise = page.waitForEvent('download');
    await receipt.getByRole('button', { name: 'PDF', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^Comprobante-.*\.pdf$/i);

    // Evitamos abrir el diálogo nativo de impresión y comprobamos igualmente que
    // el botón genera el HTML del comprobante y solicita impresión.
    await page.evaluate(() => {
      window.__pwReceiptHtml = '';
      window.__pwReceiptPrint = false;
      window.open = () => ({
        document: {
          open() {},
          write(html) { window.__pwReceiptHtml = String(html || ''); },
          close() {},
        },
        focus() {},
        print() { window.__pwReceiptPrint = true; },
      });
    });
    await receipt.getByRole('button', { name: 'Comprobante', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__pwReceiptHtml.length)).toBeGreaterThan(100);
    await expect.poll(() => page.evaluate(() => window.__pwReceiptPrint)).toBe(true);
    await receipt.locator('.payment-receipt-actions__close').click();

    const paid = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'PAGADOS', anio: current, mes: periodId, buscar: socio.data.dni },
    });
    const item = paid.items.find((candidate) => candidate.id_socio === socio.item.id_socio);
    expect(item).toBeTruthy();
    expect(Number(item.monto)).toBeCloseTo(3999.99, 2);
    await deletePayment(request, item.id_pago);
  });

  test('comprobante de una fila pagada vuelve a generar impresión sin alterar el pago', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'UI PRINT ROW');
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: socio.item.id_socio, periodId, mediumId: catalogs.medium.id_medio_pago }),
    });

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(String(periodId));
    await page.getByRole('tab', { name: /Pagados/ }).click();
    await page.getByRole('textbox', { name: 'Búsqueda' }).fill(socio.data.dni);
    const row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await page.evaluate(() => {
      window.__pwRowReceiptHtml = '';
      window.__pwRowReceiptPrint = false;
      window.open = () => ({
        document: {
          open() {},
          write(html) { window.__pwRowReceiptHtml = String(html || ''); },
          close() {},
        },
        focus() {},
        print() { window.__pwRowReceiptPrint = true; },
      });
    });
    await row.getByRole('button', { name: `Imprimir comprobante de ${socio.data.nombre}` }).click();
    await expect.poll(() => page.evaluate(() => window.__pwRowReceiptHtml.length)).toBeGreaterThan(100);
    await expect.poll(() => page.evaluate(() => window.__pwRowReceiptPrint)).toBe(true);

    const stillPaid = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'PAGADOS', anio: currentYear(), mes: periodId, buscar: socio.data.dni },
    });
    expect(stillPaid.items.some((item) => item.id_pago === paid.items[0].id_pago)).toBe(true);
    await deletePayment(request, paid.items[0].id_pago);
  });

  test('lector de código: error, monto personalizado, pago, relectura, reset y condonación', async ({ page, request }) => {
    const first = await setupQuotaPartner(request, 'BARCODE PAGO');
    const second = await setupQuotaPartner(request, 'BARCODE CONDONA');
    const periodId = Number(first.catalogs.bimonthly[0].id_periodo ?? first.catalogs.bimonthly[0].id_mes);
    const payContext = await apiCall(request, 'cuotas_contexto_pago', {
      params: { id_socio: first.socio.item.id_socio, anio: currentYear(), mes: periodId },
    });
    const condoneContext = await apiCall(request, 'cuotas_contexto_pago', {
      params: { id_socio: second.socio.item.id_socio, anio: currentYear(), mes: periodId },
    });

    const dialog = await openBarcodeReader(page);
    const codeInput = dialog.getByLabel('Código de barras');

    await codeInput.fill('1');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await codeInput.fill(payContext.principal.codigo_barra);
    await expect(dialog.getByText(first.socio.data.nombre, { exact: true })).toBeVisible();

    const customToggle = dialog.getByRole('checkbox', { name: 'Monto personalizado' });
    await customToggle.check();
    const customInput = dialog.locator('label').filter({ hasText: 'Monto personalizado' }).getByRole('textbox');
    await customInput.fill('2777,77');
    const mediumSelect = dialog.locator('label').filter({ hasText: 'Medio de pago' }).getByRole('combobox');
    await mediumSelect.selectOption(String(first.catalogs.medium.id_medio_pago));
    await dialog.getByRole('button', { name: 'Registrar pago', exact: true }).click();
    let confirm = page.getByRole('dialog', { name: 'Confirmar pago' });
    await confirm.getByRole('button', { name: 'Registrar pago', exact: true }).click();
    await expect(page.getByText('Período pagado correctamente.').last()).toBeVisible();
    await expect(codeInput).toHaveValue('');

    const paid = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'PAGADOS', anio: currentYear(), mes: periodId, buscar: first.socio.data.dni },
    });
    const paidItem = paid.items.find((item) => item.id_socio === first.socio.item.id_socio);
    expect(Number(paidItem.monto)).toBeCloseTo(2777.77, 2);

    // Releer el mismo comprobante muestra que ya no está disponible y habilita reset.
    await codeInput.fill(payContext.principal.codigo_barra);
    await expect(dialog.getByText(first.socio.data.nombre, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Leer otro código' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Leer otro código' }).click();
    await expect(codeInput).toHaveValue('');

    // La segunda rama del lector condona el período y no solicita medio de pago.
    await codeInput.fill(condoneContext.principal.codigo_barra);
    await expect(dialog.getByText(second.socio.data.nombre, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Condonar', exact: true }).click();
    confirm = page.getByRole('dialog', { name: 'Condonar cuota' }).last();
    await confirm.getByRole('button', { name: 'Condonar cuota', exact: true }).click();
    await expect(page.getByText('Cuota condonada correctamente.').last()).toBeVisible();

    const waived = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'CONDONADOS', anio: currentYear(), mes: periodId, buscar: second.socio.data.dni },
    });
    const waivedItem = waived.items.find((item) => item.id_socio === second.socio.item.id_socio);
    expect(waivedItem).toBeTruthy();
    expect(Number(waivedItem.monto)).toBe(0);
    expect(waivedItem.id_medio_pago).toBeNull();

    await deletePayment(request, paidItem.id_pago);
    await deletePayment(request, waivedItem.id_pago);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  });

  test('exporta la vista filtrada de cuotas en Excel y PDF', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'EXPORT');
    const periodId = String(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(periodId);
    await page.getByRole('textbox', { name: 'Búsqueda' }).fill(socio.data.dni);
    await expect(rowByText(page, socio.data.nombre)).toBeVisible();

    await exportFromGlobalModal(page, {
      openButton: page.getByRole('button', { name: 'Exportar' }).first(),
      format: 'Excel', expectedExtension: '.xlsx',
    });
    await exportFromGlobalModal(page, {
      openButton: page.getByRole('button', { name: 'Exportar' }).first(),
      format: 'PDF', expectedExtension: '.pdf',
    });
  });
});
