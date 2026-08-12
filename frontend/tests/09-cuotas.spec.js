const { test, expect } = require('./fixtures/auth.fixture');
const { companyData, familyData, personData } = require('./fixtures/socios.fixture');
const {
  apiCall,
  cleanupCategoriesByPrefix,
  cleanupDiscountsByThresholds,
  cleanupFamilyByPrefix,
  cleanupSocioByDocument,
  expectApiError,
} = require('./helpers/api.helper');
const {
  createCompany,
  createFamily,
  createPerson,
} = require('./helpers/entities.helper');
const { todayIso, uniqueSuffix } = require('./helpers/data.helper');

const person = personData();
const company = companyData();
const familyPersonOne = personData();
const familyPersonTwo = personData();
const batchPersonOne = personData();
const batchPersonTwo = personData();
const historicalPricePerson = personData();
const yearRangePerson = personData();
const family = familyData();
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;
const previousYear = currentYear - 1;
const secondaryMonth = currentMonth === 1 ? 2 : 1;
const historicalMonth = currentMonth === 1 ? 12 : currentMonth - 1;
const historicalYear = currentMonth === 1 ? previousYear : currentYear;

const pad2 = (value) => String(value).padStart(2, '0');

async function createHistoricalCategory(request) {
  const suffix = uniqueSuffix();
  const name = `PW E2E CAT CUOTAS ${suffix}`;
  const oldAmount = '1200.00';
  const currentAmount = '2400.00';
  const firstEffectiveYear = Math.max(2000, historicalYear - 1);
  const firstEffectiveDate = `${firstEffectiveYear}-01-01`;
  const changeDate = `${currentYear}-${pad2(currentMonth)}-01`;

  const created = await apiCall(request, 'categorias_guardar', {
    method: 'POST',
    data: {
      nombre: name,
      descripcion: 'PW E2E HISTORIAL DE MONTOS PARA CUOTAS',
      monto_actual: oldAmount,
      vigente_desde: firstEffectiveDate,
    },
  });

  const updated = await apiCall(request, 'categorias_guardar', {
    method: 'POST',
    data: {
      id_categoria: created.item.id_categoria,
      nombre: name,
      descripcion: 'PW E2E HISTORIAL DE MONTOS PARA CUOTAS',
      monto_actual: currentAmount,
      vigente_desde: changeDate,
    },
  });

  return {
    id_categoria: Number(updated.item.id_categoria),
    name,
    prefix: name,
    oldAmount: Number(oldAmount),
    currentAmount: Number(currentAmount),
    firstEffectiveDate,
    changeDate,
  };
}

function discountAppliesToday(rule, memberCount) {
  const today = todayIso();
  return Boolean(
    rule.activo &&
      String(rule.vigencia_desde || '') <= today &&
      (!rule.vigencia_hasta || String(rule.vigencia_hasta) >= today) &&
      Number(rule.cantidad_integrantes_desde) <= memberCount &&
      (rule.cantidad_integrantes_hasta === null ||
        Number(rule.cantidad_integrantes_hasta) >= memberCount),
  );
}

async function ensureTwoMemberDiscount(request) {
  const listed = await apiCall(request, 'descuentos_familiares_listar', {
    params: { estado: 'todos' },
  });
  const existing = (listed.items || []).find((item) => discountAppliesToday(item, 2));
  if (existing) return existing;

  const response = await apiCall(request, 'descuentos_familiares_guardar', {
    method: 'POST',
    data: {
      cantidad_integrantes_desde: 2,
      cantidad_integrantes_hasta: 2,
      porcentaje_descuento: '12.50',
      vigencia_desde: todayIso(),
      vigencia_hasta: todayIso(),
      descripcion: 'PW E2E DESCUENTO GLOBAL CUOTAS',
    },
  });
  return response.item;
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

async function removePayments(request, items = []) {
  for (const item of items) {
    if (!item?.id_pago) continue;
    await apiCall(request, 'cuotas_eliminar_pago', {
      method: 'POST',
      data: { id_pago: item.id_pago },
    });
  }
}


function singlePaymentDialog(page, person) {
  return page.getByRole('dialog', {
    name: new RegExp(person.apellido, 'i'),
  });
}

test.describe('Cuotas de socios y empresas', () => {
  test.afterEach(async ({ request }) => {
    try {
      cleanupFamilyByPrefix(family.prefix);
    } catch (_error) {
      // La familia puede no haberse creado todavía.
    }
    try {
      cleanupDiscountsByThresholds([2]);
    } catch (_error) {
      // Solo elimina la regla E2E, si llegó a crearse.
    }

    for (const target of [
      { tipo: 'PERSONA', documento: person.dni },
      { tipo: 'EMPRESA', documento: company.cuit },
      { tipo: 'PERSONA', documento: familyPersonOne.dni },
      { tipo: 'PERSONA', documento: familyPersonTwo.dni },
      { tipo: 'PERSONA', documento: batchPersonOne.dni },
      { tipo: 'PERSONA', documento: batchPersonTwo.dni },
      { tipo: 'PERSONA', documento: historicalPricePerson.dni },
      { tipo: 'PERSONA', documento: yearRangePerson.dni },
    ]) {
      try {
        await cleanupSocioByDocument(request, target);
      } catch (_error) {
        // La siguiente ejecución vuelve a intentar la limpieza exacta.
      }
    }
  });

  test('muestra las vistas de deudores, pagados y condonados para socios y empresas', async ({ page }) => {
    await page.goto('/cuotas');

    await expect(page.getByRole('heading', { name: 'Cuotas' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Socios' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Empresas' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Deudores' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Pagados' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Condonados/i })).toBeVisible();

    await expect(page.getByRole('table', { name: /Cuotas de socios adeudadas/i })).toBeVisible();
    await page.getByRole('tab', { name: 'Pagados' }).click();
    await expect(page.getByRole('table', { name: /Cuotas de socios pagadas/i })).toBeVisible();
    await page.getByRole('tab', { name: /Condonados/i }).click();
    await expect(page.getByRole('table', { name: /Cuotas de socios condonadas/i })).toBeVisible();
    await page.getByRole('tab', { name: 'Empresas' }).click();
    await expect(page.getByRole('table', { name: /Cuotas de empresas condonadas/i })).toBeVisible();
    await page.getByRole('tab', { name: 'Pagados' }).click();
    await expect(page.getByRole('table', { name: /Cuotas de empresas pagadas/i })).toBeVisible();
    await page.getByRole('tab', { name: 'Deudores' }).click();
    await expect(page.getByRole('table', { name: /Cuotas de empresas adeudadas/i })).toBeVisible();
  });

  test('registra y elimina pagos mensuales para un socio y una empresa', async ({ request }) => {
    await cleanupSocioByDocument(request, { tipo: 'PERSONA', documento: person.dni });
    await cleanupSocioByDocument(request, { tipo: 'EMPRESA', documento: company.cuit });

    const { category, medium } = await activeCategoryAndMedium(request);
    const savedPerson = await createPerson(request, person, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    const savedCompany = await createCompany(request, company, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    for (const target of [
      { tipo: 'PERSONA', item: savedPerson, name: `${person.apellido}, ${person.nombre}` },
      { tipo: 'EMPRESA', item: savedCompany, name: company.razonSocial },
    ]) {
      const debt = await apiCall(request, 'cuotas_listar', {
        params: {
          tipo: target.tipo,
          estado: 'DEUDORES',
          anio: currentYear,
          mes: currentMonth,
          buscar: target.tipo === 'EMPRESA' ? company.cuit : person.dni,
        },
      });
      expect(debt.items).toHaveLength(1);
      expect(debt.items[0].id_socio).toBe(target.item.id_socio);
      expect(debt.items[0].periodo).toContain(String(currentYear));

      const tokenizedDebt = await apiCall(request, 'cuotas_listar', {
        params: {
          tipo: target.tipo,
          estado: 'DEUDORES',
          anio: currentYear,
          mes: currentMonth,
          buscar: target.tipo === 'EMPRESA'
            ? `${company.suffix.toLowerCase()}, empresa`
            : `${person.nombre.toLowerCase()}, ${person.apellido.toLowerCase()}`,
        },
      });
      expect(tokenizedDebt.items.map((item) => item.id_socio)).toContain(target.item.id_socio);

      const payment = await apiCall(request, 'cuotas_registrar_pago', {
        method: 'POST',
        data: {
          id_socio: target.item.id_socio,
          anio: currentYear,
          mes: currentMonth,
          fecha_pago: todayIso(),
          monto: debt.items[0].monto_sugerido,
          id_medio_pago: medium.id_medio_pago,
        },
      });
      expect(payment.item.id_pago).toBeGreaterThan(0);
      expect(payment.item.denominacion).toContain(target.name.split(',')[0]);
      expect(payment.comprobante.lineas).toHaveLength(1);

      await expectApiError(
        request,
        'cuotas_registrar_pago',
        {
          method: 'POST',
          data: {
            id_socio: target.item.id_socio,
            anio: currentYear,
            mes: currentMonth,
            fecha_pago: todayIso(),
            monto: debt.items[0].monto_sugerido,
            id_medio_pago: medium.id_medio_pago,
          },
        },
        { status: 409, code: 'PAGO_YA_REGISTRADO' },
      );

      const paid = await apiCall(request, 'cuotas_listar', {
        params: {
          tipo: target.tipo,
          estado: 'PAGADOS',
          anio: currentYear,
          mes: currentMonth,
          buscar: target.tipo === 'EMPRESA' ? company.cuit : person.dni,
        },
      });
      expect(paid.items).toHaveLength(1);
      expect(paid.items[0].id_pago).toBe(payment.item.id_pago);
      expect(Number(paid.items[0].monto)).toBeGreaterThan(0);

      await apiCall(request, 'cuotas_eliminar_pago', {
        method: 'POST',
        data: { id_pago: payment.item.id_pago },
      });

      const debtAgain = await apiCall(request, 'cuotas_listar', {
        params: {
          tipo: target.tipo,
          estado: 'DEUDORES',
          anio: currentYear,
          mes: currentMonth,
          buscar: target.tipo === 'EMPRESA' ? company.cuit : person.dni,
        },
      });
      expect(debtAgain.items).toHaveLength(1);
      expect(debtAgain.items[0].id_socio).toBe(target.item.id_socio);
    }
  });

  test('mantiene operativos los alias históricos de registrar cobro y anular', async ({ request }) => {
    await cleanupSocioByDocument(request, { tipo: 'PERSONA', documento: person.dni });
    const { category, medium } = await activeCategoryAndMedium(request);
    const savedPerson = await createPerson(request, person, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    const debt = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA',
        estado: 'DEUDORES',
        anio: currentYear,
        mes: currentMonth,
        buscar: person.dni,
      },
    });
    expect(debt.items).toHaveLength(1);

    const paid = await apiCall(request, 'cuotas_registrar_cobro', {
      method: 'POST',
      data: {
        id_socio: savedPerson.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
        monto: debt.items[0].monto_sugerido,
        id_medio_pago: medium.id_medio_pago,
      },
    });
    expect(paid.item.id_pago).toBeGreaterThan(0);

    const removed = await apiCall(request, 'cuotas_anular', {
      method: 'POST',
      data: { id_pago: paid.item.id_pago },
    });
    expect(removed.item.id_pago).toBe(paid.item.id_pago);
  });

  test('detecta el grupo familiar, calcula el descuento y registra todas sus cuotas pendientes', async ({ request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    const discount = await ensureTwoMemberDiscount(request);
    const first = await createPerson(request, familyPersonOne, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    const second = await createPerson(request, familyPersonTwo, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    await createFamily(request, family, [first, second]);

    const context = await apiCall(request, 'cuotas_contexto_pago', {
      params: {
        id_socio: first.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
      },
    });
    expect(context.familia.nombre).toContain(family.nombre);
    expect(context.familia.integrantes).toHaveLength(2);
    expect(context.familia.cantidad_pendientes).toBe(2);
    expect(Number(context.familia.porcentaje_descuento)).toBe(
      Number(discount.porcentaje_descuento),
    );
    expect(Number(context.principal.monto_sugerido)).toBeLessThanOrEqual(
      Number(context.principal.monto_base),
    );

    const response = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: {
        id_socio: first.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
        id_medio_pago: medium.id_medio_pago,
        aplicar_familia: true,
      },
    });
    expect(response.aplico_familia).toBe(true);
    expect(response.items).toHaveLength(2);
    expect(response.comprobante.lineas).toHaveLength(2);
    expect(response.comprobante.modalidad_label).toMatch(/grupo familiar/i);
    expect(Number(response.comprobante.monto)).toBeGreaterThan(0);
    expect(response.comprobante.lineas.map((line) => line.id_socio).sort()).toEqual(
      [first.id_socio, second.id_socio].sort(),
    );

    await removePayments(request, response.items);
  });


  test('al desactivar el pago familiar registra solamente la cuota del socio abierto', async ({ request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await ensureTwoMemberDiscount(request);
    const first = await createPerson(request, familyPersonOne, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    const second = await createPerson(request, familyPersonTwo, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    await createFamily(request, family, [first, second]);

    const context = await apiCall(request, 'cuotas_contexto_pago', {
      params: {
        id_socio: first.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
      },
    });

    const response = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: {
        id_socio: first.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
        monto: context.principal.monto_sugerido,
        id_medio_pago: medium.id_medio_pago,
        aplicar_familia: false,
      },
    });

    expect(response.aplico_familia).toBe(false);
    expect(response.items).toHaveLength(1);
    expect(response.items[0].id_socio).toBe(first.id_socio);

    const secondDebt = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA',
        estado: 'DEUDORES',
        anio: currentYear,
        mes: currentMonth,
        buscar: familyPersonTwo.dni,
      },
    });
    expect(secondDebt.items).toHaveLength(1);
    expect(secondDebt.items[0].id_socio).toBe(second.id_socio);

    await removePayments(request, response.items);
  });

  test('registra varios socios seleccionados en una sola operación y genera un comprobante agrupado', async ({ request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    const first = await createPerson(request, batchPersonOne, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    const second = await createPerson(request, batchPersonTwo, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    const debts = [];
    for (const target of [batchPersonOne, batchPersonTwo]) {
      const response = await apiCall(request, 'cuotas_listar', {
        params: {
          tipo: 'PERSONA',
          estado: 'DEUDORES',
          anio: currentYear,
          mes: currentMonth,
          buscar: target.dni,
        },
      });
      expect(response.items).toHaveLength(1);
      debts.push(response.items[0]);
    }

    const response = await apiCall(request, 'cuotas_registrar_pagos', {
      method: 'POST',
      data: {
        fecha_pago: todayIso(),
        id_medio_pago: medium.id_medio_pago,
        pagos: debts.map((debt) => ({
          id_socio: debt.id_socio,
          anio: debt.anio,
          mes: debt.mes,
          monto: debt.monto_sugerido,
        })),
      },
    });
    expect(response.items).toHaveLength(2);
    expect(response.comprobante.lineas).toHaveLength(2);
    expect(response.comprobante.modalidad_label).toMatch(/múltiple/i);
    expect(response.comprobante.codigo_operacion).toMatch(/^CUO-/);
    expect(response.items.map((item) => item.id_socio).sort()).toEqual(
      [first.id_socio, second.id_socio].sort(),
    );

    await removePayments(request, response.items);
  });

  test('permite seleccionar cuotas en búsquedas sucesivas y muestra el modal de pago múltiple', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await createPerson(request, batchPersonOne, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    await createPerson(request, batchPersonTwo, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });

    await page.goto('/cuotas');
    await page.getByRole('button', { name: 'Selección múltiple' }).click();
    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });

    await search.fill(batchPersonOne.dni);
    await page
      .getByRole('checkbox', { name: new RegExp(batchPersonOne.apellido, 'i') })
      .check();
    await expect(page.getByText(/1 cuota seleccionada/i)).toBeVisible();

    await search.fill(batchPersonTwo.dni);
    await page
      .getByRole('checkbox', { name: new RegExp(batchPersonTwo.apellido, 'i') })
      .check();
    await expect(page.getByText(/2 cuotas seleccionadas/i)).toBeVisible();

    const continueButton = page.getByRole('button', { name: 'Continuar (2)', exact: true });
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    const dialog = page.getByRole('dialog', { name: 'Registrar pagos seleccionados' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(batchPersonOne.apellido);
    await expect(dialog).toContainText(batchPersonTwo.apellido);
    await expect(dialog.getByRole('button', { name: 'Registrar 2 pagos' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('muestra el grupo familiar por defecto y abre el comprobante después de pagar', async ({ page, request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await ensureTwoMemberDiscount(request);
    const first = await createPerson(request, familyPersonOne, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    const second = await createPerson(request, familyPersonTwo, {
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    await createFamily(request, family, [first, second]);

    await page.goto('/cuotas');
    await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(familyPersonOne.dni);
    const debtRow = page
      .getByRole('table', { name: /Cuotas de socios adeudadas/i })
      .getByRole('row')
      .filter({ hasText: familyPersonOne.dni });
    await expect(debtRow).toBeVisible();
    await debtRow.getByRole('button', { name: 'Registrar pago' }).click();

    const paymentDialog = singlePaymentDialog(page, familyPersonOne);
    await expect(paymentDialog).toBeVisible();
    const familyCheck = paymentDialog.getByRole('checkbox', {
      name: 'Aplicar pago a todo el grupo familiar',
    });
    await expect(familyCheck).toBeChecked();
    await paymentDialog.getByRole('button', { name: 'Ver integrantes' }).click();
    await expect(paymentDialog).toContainText(familyPersonTwo.apellido);
    await paymentDialog
      .getByLabel('Medio de pago *')
      .selectOption(String(medium.id_medio_pago));
    await paymentDialog.getByRole('button', { name: /Registrar pago familiar \(2 cuotas\)/ }).click();

    const receiptDialog = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receiptDialog).toContainText(/Pago realizado con éxito/i);
    await expect(receiptDialog.getByRole('region', { name: 'Información del comprobante' })).toBeVisible();
    await expect(receiptDialog.getByRole('button', { name: 'Comprobante' })).toBeVisible();
    await expect(receiptDialog.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();
    await receiptDialog.getByText('Cerrar', { exact: true }).click();

    const paid = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA',
        estado: 'PAGADOS',
        anio: currentYear,
        mes: currentMonth,
        buscar: familyPersonOne.dni,
      },
    });
    const paidSecond = await apiCall(request, 'cuotas_listar', {
      params: {
        tipo: 'PERSONA',
        estado: 'PAGADOS',
        anio: currentYear,
        mes: currentMonth,
        buscar: familyPersonTwo.dni,
      },
    });
    await removePayments(request, [...paid.items, ...paidSecond.items]);
  });

  test('expone los 12 contextos de pago y conserva montos históricos por vigencia real', async ({ request }) => {
    const historicalCategory = await createHistoricalCategory(request);
    let savedPerson = null;

    try {
      const { medium } = await activeCategoryAndMedium(request);
      savedPerson = await createPerson(request, historicalPricePerson, {
        fecha_alta: `${Math.max(2000, historicalYear - 1)}-01-01`,
        id_categoria: historicalCategory.id_categoria,
        id_medio_pago: medium.id_medio_pago,
      });

      const historicalAnnual = await apiCall(request, 'cuotas_contextos_pago', {
        params: {
          id_socio: savedPerson.id_socio,
          anio: historicalYear,
          fecha_pago: todayIso(),
        },
      });
      expect(Object.keys(historicalAnnual.periodos || {})).toHaveLength(12);

      const currentAnnual = historicalYear === currentYear
        ? historicalAnnual
        : await apiCall(request, 'cuotas_contextos_pago', {
            params: {
              id_socio: savedPerson.id_socio,
              anio: currentYear,
              fecha_pago: todayIso(),
            },
          });
      expect(Object.keys(currentAnnual.periodos || {})).toHaveLength(12);

      const historicalPrincipal = historicalAnnual.periodos[String(historicalMonth)]?.principal;
      const currentPrincipal = currentAnnual.periodos[String(currentMonth)]?.principal;
      expect(historicalPrincipal).toBeTruthy();
      expect(currentPrincipal).toBeTruthy();
      expect(Number(historicalPrincipal.monto_base)).toBeCloseTo(historicalCategory.oldAmount, 2);
      expect(Number(currentPrincipal.monto_base)).toBeCloseTo(historicalCategory.currentAmount, 2);

      const historicalOptions = (historicalPrincipal.opciones_monto || []).map((item) =>
        Number(item.monto_base),
      );
      expect(historicalOptions).toEqual(
        expect.arrayContaining([historicalCategory.oldAmount, historicalCategory.currentAmount]),
      );

      const singleContext = await apiCall(request, 'cuotas_contexto_pago', {
        params: {
          id_socio: savedPerson.id_socio,
          anio: currentYear,
          mes: currentMonth,
          fecha_pago: todayIso(),
        },
      });
      expect(Number(singleContext.principal.monto_base)).toBeCloseTo(
        Number(currentPrincipal.monto_base),
        2,
      );
    } finally {
      if (savedPerson) {
        await cleanupSocioByDocument(request, {
          tipo: 'PERSONA',
          documento: historicalPricePerson.dni,
        }).catch(() => undefined);
      }
      cleanupCategoriesByPrefix(historicalCategory.prefix);
    }
  });

  test('permite pagar varios meses a toda la familia y omite solamente los cruces ya pagados', async ({ request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    await ensureTwoMemberDiscount(request);
    const first = await createPerson(request, familyPersonOne, {
      fecha_alta: `${currentYear}-01-01`,
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    const second = await createPerson(request, familyPersonTwo, {
      fecha_alta: `${currentYear}-01-01`,
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    await createFamily(request, family, [first, second]);

    const secondCurrentContext = await apiCall(request, 'cuotas_contexto_pago', {
      params: {
        id_socio: second.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
      },
    });
    const prepayment = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: {
        id_socio: second.id_socio,
        anio: currentYear,
        mes: currentMonth,
        fecha_pago: todayIso(),
        monto: secondCurrentContext.principal.monto_sugerido,
        id_medio_pago: medium.id_medio_pago,
        aplicar_familia: false,
      },
    });

    const response = await apiCall(request, 'cuotas_registrar_pagos', {
      method: 'POST',
      data: {
        id_socio: first.id_socio,
        anio: currentYear,
        meses: [currentMonth, secondaryMonth],
        fecha_pago: todayIso(),
        id_medio_pago: medium.id_medio_pago,
        aplicar_familia: true,
      },
    });

    expect(response.aplico_familia).toBe(true);
    expect(response.items).toHaveLength(3);
    expect(response.comprobante.lineas).toHaveLength(3);
    expect(response.comprobante.modalidad_label).toMatch(/grupo familiar/i);
    expect(
      response.items.some(
        (item) =>
          Number(item.id_socio) === Number(second.id_socio) &&
          Number(item.mes) === Number(currentMonth),
      ),
    ).toBe(false);
    expect(
      response.items.filter((item) => Number(item.mes) === Number(secondaryMonth)),
    ).toHaveLength(2);

    await removePayments(request, response.items);
    await removePayments(request, [prepayment.item]);
  });

  test('muestra años desde el alta más antigua y agrega un año futuro sólo cuando existe un pago', async ({ request }) => {
    const { category, medium } = await activeCategoryAndMedium(request);
    const saved = await createPerson(request, yearRangePerson, {
      fecha_alta: `${previousYear}-01-01`,
      id_categoria: category.id_categoria,
      id_medio_pago: medium.id_medio_pago,
    });
    let futurePayment = null;

    try {
      const before = await apiCall(request, 'cuotas_catalogos');
      const beforeYears = (before.catalogos?.anios || []).map(Number);
      expect(beforeYears).toEqual(expect.arrayContaining([previousYear, currentYear]));

      const testFutureYear = Array.from(
        { length: Math.max(0, 2100 - currentYear) },
        (_, index) => currentYear + index + 1,
      ).find((year) => !beforeYears.includes(year));
      expect(testFutureYear, 'Se necesita al menos un año futuro sin pagos para validar su aparición').toBeTruthy();
      expect(beforeYears).not.toContain(testFutureYear);

      const futureContext = await apiCall(request, 'cuotas_contexto_pago', {
        params: {
          id_socio: saved.id_socio,
          anio: testFutureYear,
          mes: 1,
          fecha_pago: todayIso(),
        },
      });
      futurePayment = await apiCall(request, 'cuotas_registrar_pago', {
        method: 'POST',
        data: {
          id_socio: saved.id_socio,
          anio: testFutureYear,
          mes: 1,
          fecha_pago: todayIso(),
          monto: futureContext.principal.monto_sugerido,
          id_medio_pago: medium.id_medio_pago,
          aplicar_familia: false,
        },
      });

      const after = await apiCall(request, 'cuotas_catalogos');
      expect((after.catalogos?.anios || []).map(Number)).toContain(testFutureYear);

      await apiCall(request, 'cuotas_eliminar_pago', {
        method: 'POST',
        data: { id_pago: futurePayment.item.id_pago },
      });
      futurePayment = null;

      const afterDelete = await apiCall(request, 'cuotas_catalogos');
      expect((afterDelete.catalogos?.anios || []).map(Number)).not.toContain(testFutureYear);
    } finally {
      if (futurePayment?.item?.id_pago) {
        await apiCall(request, 'cuotas_eliminar_pago', {
          method: 'POST',
          data: { id_pago: futurePayment.item.id_pago },
        }).catch(() => undefined);
      }
    }
  });

  test('valida filtros y datos obligatorios del pago', async ({ request }) => {
    await expectApiError(
      request,
      'cuotas_listar',
      { params: { tipo: 'OTRO' } },
      { status: 422, code: 'FILTRO_INVALIDO' },
    );
    await expectApiError(
      request,
      'cuotas_listar',
      { params: { estado: 'ARCHIVADOS' } },
      { status: 422, code: 'FILTRO_INVALIDO' },
    );
    await expectApiError(
      request,
      'cuotas_contextos_pago',
      { params: { id_socio: 1, anio: 'NO_VALIDO' } },
      { status: 422, code: 'VALIDATION_ERROR' },
    );
    await expectApiError(
      request,
      'cuotas_registrar_pago',
      { method: 'POST', data: {} },
      { status: 422, code: 'VALIDATION_ERROR' },
    );
    await expectApiError(
      request,
      'cuotas_registrar_pagos',
      {
        method: 'POST',
        data: {
          fecha_pago: todayIso(),
          id_medio_pago: 1,
          pagos: [],
        },
      },
      { status: 422, code: 'VALIDATION_ERROR' },
    );
    await expectApiError(
      request,
      'cuotas_eliminar_pago',
      { method: 'POST', data: { id_pago: 2147483647 } },
      { status: 404, code: 'PAGO_NO_ENCONTRADO' },
    );
  });
});
