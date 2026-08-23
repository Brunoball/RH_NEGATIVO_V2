const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, apiResult, expectApiError, readAuthSession } = require('./helpers/api.helper');
const { exportFromGlobalModal } = require('./helpers/download.helper');
const { SESSION_KEY } = require('./helpers/auth.helper');
const { addDaysIso, todayIso } = require('./helpers/data.helper');
const { cuotaFamilyData } = require('./fixtures/cuotas.fixture');
const { configValues } = require('./fixtures/configuracion.fixture');
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

async function openQuotaAdvancedFilters(page) {
  const trigger = page.getByRole('button', { name: /^Filtros(?:\s+\d+)?$/ });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return trigger;
}

async function selectQuotaAdvancedFilter(page, sectionName, optionName) {
  await openQuotaAdvancedFilters(page);
  const sectionButton = page.getByRole('button', { name: sectionName, exact: true });
  const section = sectionButton.locator('xpath=..');
  const isOpen = await section.evaluate((element) => element.classList.contains('is-open'));
  if (!isOpen) await sectionButton.click();
  await section.getByRole('button', { name: optionName, exact: true }).click();
}

async function resetQuotaAdvancedFilters(page) {
  await openQuotaAdvancedFilters(page);
  await page.getByRole('button', { name: 'Mostrar Todos', exact: true }).click();
}

async function closeQuotaAdvancedFilters(page) {
  const trigger = page.getByRole('button', { name: /^Filtros(?:\s+\d+)?$/ });
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
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
  const barcodeButton = page.getByRole('button', { name: 'Cód. barras', exact: true });
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

  test('Contado Anual exige los seis períodos disponibles y no puede forzarse por API', async ({ request }) => {
    const category = await createQuotaCategory(request);
    const socio = await createQuotaSocio(
      request,
      'ANUAL INCOMPLETO API',
      category.item.id_categoria,
      { fecha_ingreso: `${currentYear()}-07-01` },
    );
    const catalogs = await quotaCatalogs(request);
    const annualId = Number(catalogs.annual.id_periodo ?? catalogs.annual.id_mes);

    const contexts = await apiCall(request, 'cuotas_contextos_pago', {
      params: {
        id_socio: socio.item.id_socio,
        anio: currentYear(),
        fecha_pago: todayIso(),
      },
    });
    expect(contexts.periodos['1'].principal.disponible).toBe(false);
    expect(contexts.periodos[String(annualId)].principal.disponible).toBe(false);
    expect(contexts.periodos[String(annualId)].principal.motivo_no_disponible).toContain(
      'seis períodos',
    );

    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: socio.item.id_socio,
        periodId: annualId,
        mediumId: catalogs.medium.id_medio_pago,
      }),
    }, { status: 409, code: 'MODALIDAD_NO_DISPONIBLE' });
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
          { id_socio: a.item.id_socio, desde: `${currentYear()}-01-01` },
          { id_socio: b.item.id_socio, desde: `${currentYear()}-01-01` },
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
    const referenceDate = `${currentYear()}-01-01`;
    const rulesResponse = await apiCall(request, 'descuentos_familiares_listar', { params: { estado: 'todos' } });
    const rules = Array.isArray(rulesResponse.items) ? rulesResponse.items : [];

    const covers = (rule, count) => {
      const from = Number(rule.cantidad_integrantes_desde);
      const to = rule.cantidad_integrantes_hasta == null ? Infinity : Number(rule.cantidad_integrantes_hasta);
      return count >= from && count <= to;
    };
    const activeAtReference = (rule) => Boolean(rule.activo)
      && String(rule.vigencia_desde) <= referenceDate
      && (!rule.vigencia_hasta || String(rule.vigencia_hasta) >= referenceDate);
    // El backend conserva el historial completo de reglas y no permite
    // superponer una regla nueva con ninguna vigencia histórica, aunque la
    // fila ya figure en el historial. El fixture debe respetar esa misma regla.
    const overlapsReferenceToToday = (rule) => String(rule.vigencia_desde) <= today
      && (!rule.vigencia_hasta || String(rule.vigencia_hasta) >= referenceDate);

    let memberCount = null;
    let expectedDiscount = null;
    for (let count = 2; count <= 50; count += 1) {
      const rule = rules.find((item) => activeAtReference(item) && covers(item, count) && Number(item.porcentaje_descuento) > 0);
      if (rule) {
        memberCount = count;
        expectedDiscount = Number(rule.porcentaje_descuento);
        break;
      }
    }

    // Si no existe una regla histórica utilizable, creamos una sólo en un rango
    // que no solape reglas reales durante el año. Así el test es determinista.
    if (memberCount == null) {
      memberCount = Array.from({ length: 49 }, (_, index) => index + 2).find(
        (count) => !rules.some((rule) => overlapsReferenceToToday(rule) && covers(rule, count)),
      );
      if (memberCount == null) {
        throw new Error('No se encontró un tamaño familiar E2E libre ni una regla histórica utilizable entre 2 y 50 integrantes.');
      }
      expectedDiscount = 12.5;
      await apiCall(request, 'descuentos_familiares_guardar', {
        method: 'POST',
        data: {
          cantidad_integrantes_desde: memberCount,
          cantidad_integrantes_hasta: memberCount,
          porcentaje_descuento: expectedDiscount,
          vigencia_desde: referenceDate,
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
        integrantes: members.map((member) => ({ id_socio: member.item.id_socio, desde: referenceDate })),
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

  test('totales por estado concilian exactamente con Deudores, Pagados y Condonados bajo los mismos filtros', async ({ request }) => {
    const category = await createQuotaCategory(request);
    const debt = await createQuotaSocio(request, 'TOTALES DEBE', category.item.id_categoria);
    const paidSocio = await createQuotaSocio(request, 'TOTALES PAGA', category.item.id_categoria);
    const waivedSocio = await createQuotaSocio(request, 'TOTALES CONDONA', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const commonSearch = 'PW EEE SOCIO CUOTA TOTALES';

    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: paidSocio.item.id_socio,
        periodId,
        mediumId: catalogs.medium.id_medio_pago,
      }),
    });
    const waived = await apiCall(request, 'cuotas_condonar_pago', {
      method: 'POST',
      data: {
        id_socio: waivedSocio.item.id_socio,
        anio: currentYear(),
        mes: periodId,
        fecha_condonacion: todayIso(),
        motivo: 'PW E2E TOTAL CONDONADO',
      },
    });

    const filter = {
      anio: currentYear(),
      mes: periodId,
      buscar: commonSearch,
      tipo: 'PERSONA',
    };
    const totals = await apiCall(request, 'cuotas_totales_estado', { params: filter });
    expect(totals.totales).toEqual(expect.objectContaining({
      DEUDORES: expect.any(Number),
      PAGADOS: expect.any(Number),
      CONDONADOS: expect.any(Number),
    }));

    for (const state of ['DEUDORES', 'PAGADOS', 'CONDONADOS']) {
      const list = await apiCall(request, 'cuotas_listar', {
        params: { ...filter, estado: state, pagina: 1, por_pagina: 1, incluir_catalogos: 'false' },
      });
      expect(
        Number(totals.totales[state]),
        `el total ${state} debe ser idéntico al total paginado de cuotas_listar`,
      ).toBe(Number(list.paginacion.total));
    }

    const debtList = await apiCall(request, 'cuotas_listar', {
      params: { ...filter, estado: 'DEUDORES', buscar: debt.data.dni },
    });
    expect(debtList.items.some((item) => item.id_socio === debt.item.id_socio)).toBe(true);

    await deletePayment(request, paid.items[0].id_pago);
    await deletePayment(request, waived.item.id_pago);
  });

  test('inscripción es única y concurrente, valida monto/fecha/medio, persiste en contexto y puede eliminarse', async ({ request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'INSCRIPCION API');
    const allowedMedium = (catalogs.catalogos.medios_pago || []).find((item) => {
      const name = String(item.nombre || '').toUpperCase();
      return item.activo !== false && (name.includes('EFECTIVO') || name.includes('TRANSFERENCIA'));
    });
    if (!allowedMedium) throw new Error('Cuotas E2E requiere un medio EFECTIVO o TRANSFERENCIA activo para inscripción.');

    const before = await apiCall(request, 'cuotas_contextos_pago', {
      params: { id_socio: socio.item.id_socio, anio: currentYear(), fecha_pago: todayIso() },
    });
    expect(before.inscripcion?.pagada).toBe(false);

    await expectApiError(request, 'cuotas_registrar_inscripcion', {
      method: 'POST',
      data: {
        id_socio: socio.item.id_socio,
        fecha_pago: todayIso(),
        monto: '1234.50',
        id_medio_pago: allowedMedium.id_medio_pago,
      },
    }, { status: 422, code: 'MONTO_INSCRIPCION_INVALIDO' });

    await expectApiError(request, 'cuotas_registrar_inscripcion', {
      method: 'POST',
      data: {
        id_socio: socio.item.id_socio,
        fecha_pago: addDaysIso(1),
        monto: '12345',
        id_medio_pago: allowedMedium.id_medio_pago,
      },
    }, { code: 'FECHA_PAGO_FUTURA' });

    const disallowedMedium = (catalogs.catalogos.medios_pago || []).find((item) => {
      const name = String(item.nombre || '').toUpperCase();
      return item.activo !== false && !name.includes('EFECTIVO') && !name.includes('TRANSFERENCIA');
    });
    if (disallowedMedium) {
      await expectApiError(request, 'cuotas_registrar_inscripcion', {
        method: 'POST',
        data: {
          id_socio: socio.item.id_socio,
          fecha_pago: todayIso(),
          monto: '12345',
          id_medio_pago: disallowedMedium.id_medio_pago,
        },
      }, { status: 422, code: 'MEDIO_PAGO_INSCRIPCION_INVALIDO' });
    }

    const payload = {
      id_socio: socio.item.id_socio,
      fecha_pago: todayIso(),
      monto: '12345',
      id_medio_pago: allowedMedium.id_medio_pago,
    };
    const [first, second] = await Promise.all([
      apiResult(request, 'cuotas_registrar_inscripcion', { method: 'POST', data: payload }),
      apiResult(request, 'cuotas_registrar_inscripcion', { method: 'POST', data: payload }),
    ]);
    const concurrent = [first, second];
    expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
    expect(
      concurrent.filter((result) => result.status === 409 && result.body?.codigo === 'INSCRIPCION_YA_REGISTRADA'),
    ).toHaveLength(1);

    const success = concurrent.find((result) => result.ok);
    expect(Number(success.body.item.monto)).toBe(12345);
    expect(Number(success.body.item.id_socio)).toBe(socio.item.id_socio);

    const after = await apiCall(request, 'cuotas_contextos_pago', {
      params: { id_socio: socio.item.id_socio, anio: currentYear(), fecha_pago: todayIso() },
    });
    expect(after.inscripcion?.pagada).toBe(true);
    expect(Number(after.inscripcion?.pago?.id_inscripcion)).toBe(Number(success.body.item.id_inscripcion));

    const deleted = await apiCall(request, 'cuotas_eliminar_inscripcion', {
      method: 'POST', data: { id_inscripcion: success.body.item.id_inscripcion },
    });
    expect(Number(deleted.item.id_inscripcion)).toBe(Number(success.body.item.id_inscripcion));

    const pendingAgain = await apiCall(request, 'cuotas_contextos_pago', {
      params: { id_socio: socio.item.id_socio, anio: currentYear(), fecha_pago: todayIso() },
    });
    expect(pendingAgain.inscripcion?.pagada).toBe(false);

    await expectApiError(request, 'cuotas_eliminar_inscripcion', {
      method: 'POST', data: { id_inscripcion: success.body.item.id_inscripcion },
    }, { status: 404, code: 'INSCRIPCION_NO_ENCONTRADA' });
  });

  test('pago familiar legacy resuelve integrantes según la fecha histórica de cada período', async ({ request }) => {
    const category = await createQuotaCategory(request);
    const a = await createQuotaSocio(request, 'FAMILIA HIST A', category.item.id_categoria);
    const b = await createQuotaSocio(request, 'FAMILIA HIST B', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const firstPeriod = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const julyPeriod = Number(catalogs.bimonthly[3].id_periodo ?? catalogs.bimonthly[3].id_mes);
    const family = cuotaFamilyData();
    const year = currentYear();

    await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [
          { id_socio: a.item.id_socio, desde: `${year}-01-01` },
          { id_socio: b.item.id_socio, desde: `${year}-07-01` },
        ],
      },
    });

    const historical = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: a.item.id_socio,
        periodId: firstPeriod,
        mediumId: catalogs.medium.id_medio_pago,
        extra: { aplicar_familia: true },
      }),
    });
    expect(historical.items.map((item) => item.id_socio)).toEqual([a.item.id_socio]);

    const currentComposition = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: a.item.id_socio,
        periodId: julyPeriod,
        mediumId: catalogs.medium.id_medio_pago,
        extra: { aplicar_familia: true },
      }),
    });
    expect(currentComposition.items.map((item) => item.id_socio).sort((x, y) => x - y)).toEqual(
      [a.item.id_socio, b.item.id_socio].sort((x, y) => x - y),
    );

    for (const item of [...historical.items, ...currentComposition.items]) {
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
  test('Contado Anual queda deshabilitado si falta cualquier período del año', async ({ page, request }) => {
    const category = await createQuotaCategory(request);
    const socio = await createQuotaSocio(
      request,
      'ANUAL INCOMPLETO UI',
      category.item.id_categoria,
      { fecha_ingreso: `${currentYear()}-07-01` },
    );
    const catalogs = await quotaCatalogs(request);
    const annualId = Number(catalogs.annual.id_periodo ?? catalogs.annual.id_mes);
    const annualName = String(catalogs.annual.nombre || 'CONTADO ANUAL');

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(String(annualId));
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));

    const row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Registrar pago de ${socio.data.nombre}` }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: socio.data.nombre }).last();
    const annualChoice = dialog.getByRole('button', {
      name: new RegExp(`^${escapeRegExp(annualName)} ${currentYear()}: no disponible$`, 'i'),
    });
    await expect(annualChoice).toBeVisible();
    await expect(annualChoice).toBeDisabled();
    await expect(annualChoice).toHaveAttribute('aria-pressed', 'false');
  });

  test('flujo visible completo: pagar, comprobante, listar pagado, eliminar, condonar y eliminar condonación', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'UI CICLO');
    const periodId = String(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const year = String(currentYear());

    await page.goto('/cuotas');
    await expect(page.getByRole('heading', { name: 'Cuotas' })).toBeVisible();
    await page.getByLabel('Año').selectOption(year);
    await page.getByLabel('Mes', { exact: true }).selectOption(periodId);
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
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
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
    row = rowByText(page, socio.data.nombre);
    // El estado visible de la tabla es ACTIVO/PASIVO del socio. Que la cuota
    // esté pagada se expresa por la pestaña Pagados y por sus acciones.
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: `Eliminar pago de ${socio.data.nombre}` })).toBeVisible();
    await row.getByRole('button', { name: `Eliminar pago de ${socio.data.nombre}` }).click();
    let actionDialog = page.getByRole('dialog', { name: 'Eliminar pago' });
    await actionDialog.getByRole('button', { name: 'Eliminar pago', exact: true }).click();

    await page.getByRole('tab', { name: /Deudores/ }).click();
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
    row = rowByText(page, socio.data.nombre);
    await row.getByRole('button', { name: `Condonar cuota de ${socio.data.nombre}` }).click();
    actionDialog = page.getByRole('dialog', { name: 'Condonar cuota' });
    await actionDialog.getByRole('button', { name: 'Condonar cuota', exact: true }).click();

    await page.getByRole('tab', { name: /Condonados/ }).click();
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
    row = rowByText(page, socio.data.nombre);
    // En Condonados la columna Estado sigue mostrando ACTIVO/PASIVO. El $0 y
    // la acción de eliminar condonación identifican correctamente el registro.
    await expect(row).toContainText(/\$\s*0[,.]00/);
    await expect(row.getByRole('button', { name: `Eliminar condonación de ${socio.data.nombre}` })).toBeVisible();
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
    await page.getByRole('textbox', { name: 'Socio', exact: true }).fill('PW EEE SOCIO CUOTA MULTI');
    await page.getByRole('button', { name: 'Seleccionar', exact: true }).first().click();
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
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
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
    const customAmountInput = dialog.getByLabel(`Monto personalizado para ${periodName}`);

    // El checkbox es controlado por React y, justo después de cambiar de año/período,
    // puede recibir una actualización tardía del contexto que revierta un primer click.
    // Reintentamos la acción real de usuario hasta que tanto el checkbox como el editor
    // queden montados de forma estable, evitando un falso negativo intermitente del E2E.
    for (let attempt = 0; attempt < 4 && !(await customToggle.isChecked()); attempt += 1) {
      await customToggle.click();
      if (!(await customToggle.isChecked())) {
        await page.waitForTimeout(150);
      }
    }
    await expect(customToggle).toBeChecked();
    await expect(customAmountInput).toBeVisible();
    await customAmountInput.fill('3999,99');
    // El front normaliza el separador decimal interno a punto en algunos navegadores
    // (3999,99 -> 3999.99). Validamos el mismo valor numérico sin acoplar el E2E
    // a la representación textual interna del input.
    await expect(customAmountInput).toHaveValue(/^3999[.,]99$/);

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
    await receipt.getByRole('button', { name: 'Imprimir', exact: true }).click();
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
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
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

  test('inscripción completa desde UI: registra una sola vez, reaparece como pagada y puede eliminarse', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'INSCRIPCION UI');
    const periodId = String(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const allowedMedium = (catalogs.catalogos.medios_pago || []).find((item) => {
      const name = String(item.nombre || '').toUpperCase();
      return item.activo !== false && (name.includes('EFECTIVO') || name.includes('TRANSFERENCIA'));
    });
    if (!allowedMedium) throw new Error('Cuotas UI requiere EFECTIVO o TRANSFERENCIA activo para inscripción.');

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(periodId);
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
    let row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Registrar pago de ${socio.data.nombre}` }).click();

    let dialog = page.getByRole('dialog').filter({ hasText: socio.data.nombre }).last();
    await dialog.getByRole('tab', { name: /^Inscripción/ }).click();
    await expect(dialog.getByRole('region', { name: 'Pago de inscripción' })).toBeVisible();

    const amount = dialog.getByLabel('Monto de inscripción *');
    // Primero probamos el saneo sin superar maxlength; después el límite
    // nativo de 10 dígitos. El navegador trunca antes de disparar onChange.
    await amount.fill('12AB34.56');
    await expect(amount).toHaveValue('123456');
    await amount.fill('123456789012');
    await expect(amount).toHaveValue('1234567890');
    await amount.fill('12345');
    await dialog.getByLabel('Medio de pago de inscripción *').selectOption(String(allowedMedium.id_medio_pago));
    await dialog.getByRole('button', { name: 'Registrar inscripción', exact: true }).click();
    await expect(page.getByText('Inscripción pagada correctamente.').last()).toBeVisible();

    const persisted = await apiCall(request, 'cuotas_contextos_pago', {
      params: { id_socio: socio.item.id_socio, anio: currentYear(), fecha_pago: todayIso() },
    });
    expect(persisted.inscripcion?.pagada).toBe(true);
    expect(Number(persisted.inscripcion?.pago?.monto)).toBe(12345);

    row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Registrar pago de ${socio.data.nombre}` }).click();
    dialog = page.getByRole('dialog').filter({ hasText: socio.data.nombre }).last();
    await dialog.getByRole('tab', { name: /^Inscripción/ }).click();
    const registrationRegion = dialog.getByRole('region', { name: 'Pago de inscripción' });
    await expect(registrationRegion.getByText('Inscripción ya registrada', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Inscripción ya registrada', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Eliminar pago de inscripción', exact: true }).click();

    const deleteDialog = page.getByRole('dialog', { name: 'Eliminar pago de inscripción' });
    await expect(deleteDialog).toContainText(socio.data.nombre);
    await deleteDialog.getByRole('button', { name: 'Eliminar pago', exact: true }).click();
    await expect(page.getByText(/Pago de inscripción eliminado correctamente/i).last()).toBeVisible();

    const pending = await apiCall(request, 'cuotas_contextos_pago', {
      params: { id_socio: socio.item.id_socio, anio: currentYear(), fecha_pago: todayIso() },
    });
    expect(pending.inscripcion?.pagada).toBe(false);
  });

  test('tabla nueva y comprobantes cubren Deudores, Pagados y Condonados con Estado/Cobrador e impresión masiva', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'TABLA PRINT TODAS');
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const expectedColumns = ['ID', 'Socio', 'Dirección', 'Estado', 'Cobrador', 'Importe', 'Acciones'];

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(String(periodId));
    const quotaSearch = page.getByRole('textbox', { name: 'ID', exact: true });
    await quotaSearch.fill(String(socio.item.id_socio));
    await expect(rowByText(page, socio.data.nombre)).toBeVisible();

    // La X global del buscador debe resetear únicamente la búsqueda.
    const clearQuotaSearch = page.getByRole('button', { name: 'Limpiar búsqueda', exact: true });
    await expect(clearQuotaSearch).toBeVisible();
    await clearQuotaSearch.click();
    await expect(quotaSearch).toHaveValue('');
    await quotaSearch.fill(String(socio.item.id_socio));

    await page.evaluate(() => {
      window.__pwQuotaPopups = [];
      window.open = () => {
        const entry = { html: '', printed: false, closed: false };
        window.__pwQuotaPopups.push(entry);
        return {
          document: {
            open() {},
            write(html) { entry.html = String(html || ''); },
            close() {},
          },
          focus() {},
          print() { entry.printed = true; },
          close() { entry.closed = true; },
        };
      };
    });

    const assertTableContract = async () => {
      const headers = await page.locator('.cuotas-table').getByRole('columnheader').allTextContents();
      expect(headers.map((value) => value.trim())).toEqual(expectedColumns);
      await expect(page.getByRole('columnheader', { name: 'Medio de pago', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Filtros(?:\s+\d+)?$/ })).toBeVisible();
    };

    const lastPopup = () => page.evaluate(() => window.__pwQuotaPopups.at(-1) || null);

    // DEUDORES: columnas nuevas, filtros funcionales e impresión individual/masiva.
    let row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await expect(row).toContainText('DOMICILIO DE COBRO PLAYWRIGHT');
    await assertTableContract();
    if (socio.item.id_estado) {
      const state = (catalogs.catalogos.estados || []).find(
        (item) => String(item.id_estado) === String(socio.item.id_estado),
      );
      expect(state, 'El estado del socio debe estar disponible en filtros de Cuotas').toBeTruthy();
      await selectQuotaAdvancedFilter(page, 'Estado', state.nombre);
      await expect(rowByText(page, socio.data.nombre)).toBeVisible();
      await closeQuotaAdvancedFilters(page);
      const removeStateChip = page.getByRole('button', {
        name: `Eliminar filtro Estado: ${state.nombre}`,
        exact: true,
      });
      await expect(removeStateChip).toBeVisible();
      await removeStateChip.click();
      await expect(removeStateChip).toHaveCount(0);
      await expect(rowByText(page, socio.data.nombre)).toBeVisible();
    }
    const collector = (catalogs.catalogos.cobradores || []).find(
      (item) => String(item.id_cobrador) === String(socio.item.id_cobrador),
    );
    expect(collector, 'El cobrador del socio debe estar disponible en filtros de Cuotas').toBeTruthy();
    await selectQuotaAdvancedFilter(page, 'Cobrador', collector.nombre);
    await closeQuotaAdvancedFilters(page);
    const removeCollectorChip = page.getByRole('button', {
      name: `Eliminar filtro Cobrador: ${collector.nombre}`,
      exact: true,
    });
    await expect(removeCollectorChip).toBeVisible();
    await removeCollectorChip.click();
    await expect(removeCollectorChip).toHaveCount(0);
    row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Imprimir comprobante de ${socio.data.nombre}` }).click();
    await expect.poll(async () => String((await lastPopup())?.html || '')).toContain(socio.data.nombre);
    await expect.poll(async () => Boolean((await lastPopup())?.printed)).toBe(true);
    await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
    await expect.poll(async () => String((await lastPopup())?.html || '')).toContain('PENDIENTE');

    // PAGADOS: misma tabla, mantiene filtro de medio sólo como filtro y no como columna.
    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: socio.item.id_socio,
        periodId,
        mediumId: catalogs.medium.id_medio_pago,
      }),
    });
    await page.getByRole('tab', { name: /Pagados/ }).click();
    row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await assertTableContract();
    await selectQuotaAdvancedFilter(page, 'Medio de pago', catalogs.medium.nombre);
    await expect(rowByText(page, socio.data.nombre)).toBeVisible();
    await closeQuotaAdvancedFilters(page);
    const removeMediumChip = page.getByRole('button', {
      name: `Eliminar filtro Medio: ${catalogs.medium.nombre}`,
      exact: true,
    });
    await expect(removeMediumChip).toBeVisible();
    await removeMediumChip.click();
    await expect(removeMediumChip).toHaveCount(0);
    row = rowByText(page, socio.data.nombre);
    await row.getByRole('button', { name: `Imprimir comprobante de ${socio.data.nombre}` }).click();
    await expect.poll(async () => String((await lastPopup())?.html || '')).toContain('PAGADO');
    await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
    await expect.poll(async () => String((await lastPopup())?.html || '')).toContain('PAGADO');
    await deletePayment(request, paid.items[0].id_pago);

    // CONDONADOS: impresión volvió a estar disponible y siempre conserva monto cero.
    const waived = await apiCall(request, 'cuotas_condonar_pago', {
      method: 'POST',
      data: {
        id_socio: socio.item.id_socio,
        anio: currentYear(),
        mes: periodId,
        fecha_condonacion: todayIso(),
        motivo: 'PW E2E PRINT CONDONADO',
      },
    });
    await page.getByRole('tab', { name: /Condonados/ }).click();
    row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await assertTableContract();
    await openQuotaAdvancedFilters(page);
    await expect(page.getByRole('button', { name: 'Medio de pago', exact: true })).toHaveCount(0);
    await closeQuotaAdvancedFilters(page);
    await row.getByRole('button', { name: `Imprimir comprobante de ${socio.data.nombre}` }).click();
    await expect.poll(async () => String((await lastPopup())?.html || '')).toContain('CONDONADO');
    await expect.poll(async () => Boolean((await lastPopup())?.printed)).toBe(true);
    await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
    await expect.poll(async () => String((await lastPopup())?.html || '')).toContain('CONDONADO');

    const stillWaived = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'CONDONADOS', anio: currentYear(), mes: periodId, buscar: socio.data.dni },
    });
    const item = stillWaived.items.find((candidate) => candidate.id_pago === waived.item.id_pago);
    expect(item).toBeTruthy();
    expect(Number(item.monto)).toBe(0);
    expect(item.id_medio_pago).toBeNull();
    await deletePayment(request, waived.item.id_pago);
  });

  test('Contado Anual se muestra compacto como CONTADO ANUAL + año en Pagados', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'ANUAL UI LABEL');
    const annualId = Number(catalogs.annual.id_periodo ?? catalogs.annual.id_mes);
    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: socio.item.id_socio,
        periodId: annualId,
        mediumId: catalogs.medium.id_medio_pago,
      }),
    });

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(String(annualId));
    await page.getByRole('tab', { name: /Pagados/ }).click();
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
    const row = rowByText(page, socio.data.nombre);
    await expect(row).toBeVisible();
    await expect(row).toContainText(`CONTADO ANUAL ${currentYear()}`);
    await expect(page.getByRole('columnheader', { name: 'Medio de pago', exact: true })).toHaveCount(0);

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

  test('filtros de Cuotas, búsqueda por ID, reset y Seleccionar todo lo filtrado funcionan con el front actual', async ({ page, request }) => {
    const first = await setupQuotaPartner(request, 'FILTROS TOTAL A');
    const second = await setupQuotaPartner(request, 'FILTROS TOTAL B');
    const periodId = Number(first.catalogs.bimonthly[0].id_periodo ?? first.catalogs.bimonthly[0].id_mes);
    const definitions = configValues();
    const wrongState = await apiCall(request, 'configuracion_lista_guardar', {
      method: 'POST', data: { lista: 'estado', nombre: definitions.estado.nombre },
    });
    const wrongCollector = await apiCall(request, 'configuracion_lista_guardar', {
      method: 'POST', data: { lista: 'cobrador', nombre: definitions.cobrador.nombre },
    });
    const wrongMedium = await apiCall(request, 'configuracion_lista_guardar', {
      method: 'POST', data: { lista: 'medios_pago', nombre: definitions.medios_pago.nombre },
    });

    const matchingFilters = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA',
        estado: 'DEUDORES',
        anio: currentYear(),
        mes: periodId,
        id_socio: first.socio.item.id_socio,
        categoria: first.category.item.id_categoria,
        estado_persona: first.socio.item.id_estado,
        cobrador: first.socio.item.id_cobrador,
      },
    });
    expect(matchingFilters.items.some((item) => Number(item.id_socio) === Number(first.socio.item.id_socio))).toBe(true);

    const aliasFilters = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA',
        estado: 'DEUDORES',
        anio: currentYear(),
        id_periodo: periodId,
        id_socio: first.socio.item.id_socio,
        id_estado: first.socio.item.id_estado,
        id_cobrador: first.socio.item.id_cobrador,
      },
    });
    expect(aliasFilters.items.some((item) => Number(item.id_socio) === Number(first.socio.item.id_socio))).toBe(true);

    const wrongCategory = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'DEUDORES', anio: currentYear(), mes: periodId, id_socio: first.socio.item.id_socio, categoria: 2147483647 },
    });
    expect(wrongCategory.items).toHaveLength(0);
    const missingId = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'DEUDORES', anio: currentYear(), mes: periodId, id_socio: 2147483647 },
    });
    expect(missingId.items).toHaveLength(0);

    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(String(periodId));

    const idSearch = page.getByRole('textbox', { name: 'ID', exact: true });
    const socioSearch = page.getByRole('textbox', { name: 'Socio', exact: true });
    await idSearch.fill(String(first.socio.item.id_socio));
    await expect(rowByText(page, first.socio.data.nombre)).toBeVisible();
    await expect(rowByText(page, second.socio.data.nombre)).toHaveCount(0);
    await idSearch.fill('2147483647');
    await expect(rowByText(page, first.socio.data.nombre)).toHaveCount(0);
    await expect(rowByText(page, second.socio.data.nombre)).toHaveCount(0);
    await idSearch.fill(String(first.socio.item.id_socio));
    await expect(rowByText(page, first.socio.data.nombre)).toBeVisible();

    // Los dos campos son independientes: el ID es igualdad exacta y el campo
    // Socio queda para nombre/DNI. Nunca inferimos uno a partir del otro.
    await idSearch.fill('');
    await socioSearch.fill('PW EEE SOCIO CUOTA FILTROS TOTAL');
    await expect(rowByText(page, first.socio.data.nombre)).toBeVisible();
    await expect(rowByText(page, second.socio.data.nombre)).toBeVisible();

    await selectQuotaAdvancedFilter(page, 'Estado', wrongState.item.nombre);
    await expect(rowByText(page, first.socio.data.nombre)).toHaveCount(0);
    await resetQuotaAdvancedFilters(page);
    await expect(rowByText(page, first.socio.data.nombre)).toBeVisible();

    await selectQuotaAdvancedFilter(page, 'Cobrador', wrongCollector.item.nombre);
    await expect(rowByText(page, first.socio.data.nombre)).toHaveCount(0);
    await resetQuotaAdvancedFilters(page);
    await expect(rowByText(page, first.socio.data.nombre)).toBeVisible();

    await page.getByRole('button', { name: 'Seleccionar', exact: true }).click();
    const selectAll = page.getByRole('button', { name: /Seleccionar todo lo filtrado \(2\)/ });
    await expect(selectAll).toBeVisible();
    await selectAll.click();
    await expect(page.getByText('2 cuotas seleccionadas', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar (2)', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Limpiar', exact: true }).click();
    await expect(page.getByText('0 cuotas seleccionadas', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar selección', exact: true }).click();

    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: first.socio.item.id_socio,
        periodId,
        mediumId: first.catalogs.medium.id_medio_pago,
      }),
    });
    const paidByMedium = await apiCall(request, 'cuotas_listar', {
      params: {
        estado: 'PAGADOS', anio: currentYear(), mes: periodId,
        id_socio: first.socio.item.id_socio, medio_pago: first.catalogs.medium.id_medio_pago,
      },
    });
    expect(paidByMedium.items.some((item) => Number(item.id_socio) === Number(first.socio.item.id_socio))).toBe(true);
    const paidByMediumAlias = await apiCall(request, 'cuotas_listar', {
      params: {
        estado: 'PAGADOS', anio: currentYear(), id_periodo: periodId,
        id_socio: first.socio.item.id_socio, id_medio_pago: first.catalogs.medium.id_medio_pago,
      },
    });
    expect(paidByMediumAlias.items.some((item) => Number(item.id_socio) === Number(first.socio.item.id_socio))).toBe(true);

    await page.getByRole('tab', { name: /Pagados/ }).click();
    await idSearch.fill(String(first.socio.item.id_socio));
    await expect(rowByText(page, first.socio.data.nombre)).toBeVisible();
    await selectQuotaAdvancedFilter(page, 'Medio de pago', wrongMedium.item.nombre);
    await expect(rowByText(page, first.socio.data.nombre)).toHaveCount(0);
    await resetQuotaAdvancedFilters(page);
    await expect(rowByText(page, first.socio.data.nombre)).toBeVisible();

    await deletePayment(request, paid.items[0].id_pago);
  });

  test('exporta la vista filtrada de cuotas en Excel y PDF', async ({ page, request }) => {
    const { socio, catalogs } = await setupQuotaPartner(request, 'EXPORT');
    const periodId = String(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(periodId);
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
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
