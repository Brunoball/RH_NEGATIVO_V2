const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, apiResult, expectApiError } = require('./helpers/api.helper');
const { createSocio } = require('./helpers/entities.helper');
const {
  createQuotaCategory,
  createQuotaSocio,
  currentYear,
  deletePayment,
  paymentPayload,
  quotaCatalogs,
} = require('./helpers/cuotas.helper');
const { familyData, socioData } = require('./fixtures/socios.fixture');
const { addDaysIso, lettersFromSuffix, todayIso, uniqueSuffix } = require('./helpers/data.helper');

function rowByText(page, text) {
  return page.getByRole('row').filter({ hasText: text }).last();
}

async function createContableOption(request, type, name) {
  const response = await apiCall(request, 'contable_opcion_guardar', {
    method: 'POST',
    data: { tipo: type, nombre: name },
  });
  return response.item;
}

async function deleteContableOption(request, item) {
  if (!item?.id_opcion) return;
  try {
    await apiCall(request, 'contable_opcion_eliminar', {
      method: 'POST',
      data: { id_opcion: item.id_opcion },
    });
  } catch (_error) {
    // El cleanup E2E global también elimina opciones con prefijo PW E2E.
  }
}

function socioUpdatePayload(item, fechaIngreso) {
  return {
    id_socio: item.id_socio,
    nombre: item.nombre,
    dni: item.dni || '',
    fecha_nacimiento: item.fecha_nacimiento || '',
    id_grupo_sanguineo: item.id_grupo_sanguineo || '',
    domicilio: item.domicilio || '',
    numero: item.numero || '',
    telefono_movil: item.telefono_movil || '',
    telefono_fijo: item.telefono_fijo || '',
    domicilio_cobro: item.domicilio_cobro || '',
    fecha_ingreso: fechaIngreso,
    id_estado: item.id_estado || '',
    id_categoria: item.id_categoria,
    id_cobrador: item.id_cobrador,
    observaciones: item.observaciones || '',
  };
}

function fakeDebtRows(count = 101) {
  return Array.from({ length: count }, (_unused, index) => ({
    id_socio: 900000000 + index,
    socio: `PW E2E CARGAR TODOS ${String(index + 1).padStart(3, '0')}`,
    dni: String(98000000 + index),
    categoria: 'PW E2E',
    estado: index % 2 ? 'ACTIVO' : 'PASIVO',
    ingreso: `${currentYear()}-01-01`,
    domicilio: `CALLE E2E ${index + 1}`,
    telefono: `351${String(1000000 + index)}`,
    cobrador: 'PW E2E COBRADOR',
    anio: currentYear(),
    id_periodo: (index % 6) + 1,
    periodo: `PERÍODO ${(index % 6) + 1}`,
    monto: 1000 + index,
    descuento_familiar: 0,
  }));
}

test.describe('Blindaje final · integridad histórica y acciones deterministas', () => {
  // Chromium/Node puede ser abortado por Windows con 0xC0000409 antes de que
  // Playwright ejecute el cuerpo de una prueba. Un único reintento levanta un
  // worker limpio; los errores funcionales reales vuelven a fallar y se informan.
  test.describe.configure({ retries: process.platform === 'win32' ? 1 : 0 });

  test('Socios ejecuta BAJA_SUPERPONE_FAMILIA cuando la baja queda antes de un vínculo vigente', async ({ request }) => {
    const familySocio = await createSocio(request, socioData('BAJA SUP FAMILIA'), {
      fecha_ingreso: addDaysIso(-20),
    });
    const family = familyData();
    await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [{ id_socio: familySocio.id_socio, desde: todayIso() }],
      },
    });

    await expectApiError(request, 'socios_eliminar', {
      method: 'POST',
      data: {
        id: familySocio.id_socio,
        fecha_baja: addDaysIso(-1),
        motivo_baja: 'PW E2E BAJA ANTERIOR AL VINCULO',
      },
    }, { status: 409, code: 'BAJA_SUPERPONE_FAMILIA' });
  });

  test('Socios ejecuta CRONOLOGIA_SOCIO_INVALIDA al retroceder una transición ya registrada', async ({ request }) => {
    const chronologySocio = await createSocio(request, socioData('CRONOLOGIA'), {
      fecha_ingreso: addDaysIso(-20),
    });
    await apiCall(request, 'socios_eliminar', {
      method: 'POST',
      data: {
        id: chronologySocio.id_socio,
        fecha_baja: todayIso(),
        motivo_baja: 'PW E2E BAJA CRONOLOGICA',
      },
    });
    await apiCall(request, 'socios_reactivar', {
      method: 'POST',
      data: {
        id: chronologySocio.id_socio,
        fecha_reactivacion: todayIso(),
        motivo_reactivacion: 'PW E2E REACTIVACION CRONOLOGICA',
      },
    });

    await expectApiError(request, 'socios_eliminar', {
      method: 'POST',
      data: {
        id: chronologySocio.id_socio,
        fecha_baja: addDaysIso(-1),
        motivo_baja: 'PW E2E BAJA FUERA DE ORDEN',
      },
    }, { status: 409, code: 'CRONOLOGIA_SOCIO_INVALIDA' });
  });

  test('Familias ejecuta FAMILIA_INTERVALO_SUPERPUESTO contra un vínculo histórico cerrado', async ({ request }) => {
    const overlapSocio = await createSocio(request, socioData('FAMILIA SOLAPE'), {
      fecha_ingreso: addDaysIso(-30),
    });
    const anchorSocio = await createSocio(request, socioData('FAMILIA ANCLA'), {
      fecha_ingreso: addDaysIso(-30),
    });
    const familyA = familyData();
    const familyB = familyData();

    const savedA = await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: familyA.nombre,
        observaciones: familyA.descripcion,
        integrantes: [
          { id_socio: overlapSocio.id_socio, desde: addDaysIso(-10) },
          { id_socio: anchorSocio.id_socio, desde: addDaysIso(-10) },
        ],
      },
    });

    // Cerramos sólo el vínculo del socio objetivo. Si intentáramos crear la
    // segunda familia mientras el primer vínculo sigue abierto, la regla previa
    // SOCIO_YA_TIENE_FAMILIA sería la que corresponde y nunca llegaríamos a la
    // validación histórica FAMILIA_INTERVALO_SUPERPUESTO.
    await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        id_familia: savedA.item.id_familia,
        nombre: familyA.nombre,
        observaciones: familyA.descripcion,
        fecha_desvinculacion: addDaysIso(-5),
        integrantes: [{ id_socio: anchorSocio.id_socio, desde: addDaysIso(-10) }],
      },
    });

    await expectApiError(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: familyB.nombre,
        observaciones: familyB.descripcion,
        integrantes: [{ id_socio: overlapSocio.id_socio, desde: addDaysIso(-7) }],
      },
    }, { status: 409, code: 'FAMILIA_INTERVALO_SUPERPUESTO' });
  });

  test('Socios ejecuta FECHA_INGRESO_AFECTA_HISTORIAL cuando una edición queda después de actividad económica', async ({ request }) => {
    const quotaCategory = await createQuotaCategory(request);
    const historyData = socioData('FECHA INGRESO HISTORIAL');
    const historySocio = await createSocio(request, historyData, {
      id_categoria: quotaCategory.item.id_categoria,
      fecha_ingreso: `${currentYear() - 1}-01-01`,
    });
    const catalogs = await quotaCatalogs(request);
    const firstPeriod = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const payment = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: historySocio.id_socio,
        periodId: firstPeriod,
        mediumId: catalogs.medium.id_medio_pago,
      }),
    });
    try {
      await expectApiError(request, 'socios_guardar', {
        method: 'POST',
        data: socioUpdatePayload(historySocio, `${currentYear()}-02-01`),
      }, { status: 409, code: 'FECHA_INGRESO_AFECTA_HISTORIAL' });
    } finally {
      await deletePayment(request, payment.items?.[0]?.id_pago);
    }
  });

  test('Contabilidad rechaza comprobantes de más de 10 MB aunque PHP aplique un límite previo', async ({ request }) => {
    const suffix = lettersFromSuffix(uniqueSuffix(), 10);
    const receipt = `PW E2E OVERSIZE ${suffix}`;
    const createdOptions = [];
    try {
      const provider = await createContableOption(request, 'PROVEEDOR', `PW E2E CT SIZE PROV ${suffix}`);
      const category = await createContableOption(request, 'CATEGORIA_EGRESO', `PW E2E CT SIZE CAT ${suffix}`);
      const concept = await createContableOption(request, 'CONCEPTO_EGRESO', `PW E2E CT SIZE CON ${suffix}`);
      createdOptions.push(provider, category, concept);

      const catalogs = await apiCall(request, 'contable_catalogos');
      const medium = (catalogs.medios_pago || []).find((item) => item.activo !== false) || (catalogs.medios_pago || [])[0];
      expect(medium, 'Se requiere al menos un medio de pago para validar el límite de archivo').toBeTruthy();

      let oversized = null;
      let transportError = null;
      try {
        oversized = await apiResult(request, 'contable_egreso_guardar', {
          method: 'POST',
          multipart: {
            fecha: todayIso(),
            id_medio_pago: String(medium.id_medio_pago),
            id_proveedor: String(provider.id_opcion),
            id_categoria: String(category.id_opcion),
            id_concepto: String(concept.id_opcion),
            numero_comprobante: receipt,
            importe: '1000',
            detalle: 'PW E2E ARCHIVO SUPERIOR A 10 MB',
            archivo: {
              name: 'pw-e2e-oversize.pdf',
              mimeType: 'application/pdf',
              buffer: Buffer.alloc((10 * 1024 * 1024) + 1, 0x41),
            },
          },
        });
      } catch (error) {
        transportError = error;
      }

      if (transportError) {
        // Algunos entornos cortan el request en el servidor web antes de PHP.
        // Sólo aceptamos un rechazo explícito por tamaño/transporte, nunca un
        // error arbitrario del runner.
        expect(String(transportError.message || transportError)).toMatch(/413|too large|content-length|request entity|payload|respuesta no json/i);
      } else {
        expect(oversized.ok).toBe(false);
        if (Number(oversized.status) === 413) {
          expect(Number(oversized.status)).toBe(413);
        } else {
          expect(Number(oversized.status)).toBe(422);
          // ARCHIVO_DEMASIADO_GRANDE es la rama propia (>10 MB). En PHP con
          // upload_max_filesize menor se recibe ARCHIVO_UPLOAD_ERROR; si
          // post_max_size es menor, PHP vacía el multipart y la validación de
          // campos responde VALIDATION_ERROR antes de guardar. Las tres rutas
          // son rechazos seguros del mismo archivo sobredimensionado.
          expect([
            'ARCHIVO_DEMASIADO_GRANDE',
            'ARCHIVO_UPLOAD_ERROR',
            'VALIDATION_ERROR',
          ]).toContain(oversized.body?.codigo);
        }
      }

      // El objetivo de seguridad no es sólo recibir un error: confirmamos que
      // el intento nunca haya creado un egreso parcial.
      const list = await apiCall(request, 'contable_egresos_listar', {
        params: {
          anio: currentYear(),
          mes: Number(todayIso().slice(5, 7)),
          buscar: receipt,
        },
      });
      expect(list.items || []).toHaveLength(0);
    } finally {
      for (const item of createdOptions.reverse()) await deleteContableOption(request, item);
    }
  });

  test('paginación backend respeta el contrato real de Socios y entrega páginas distintas en Cuotas', async ({ request }) => {
    const commonSocioLabel = `PAGINACION API ${lettersFromSuffix(uniqueSuffix(), 6)}`;
    const first = await createSocio(request, socioData(commonSocioLabel), { fecha_ingreso: `${currentYear()}-01-01` });
    const second = await createSocio(request, socioData(commonSocioLabel), { fecha_ingreso: `${currentYear()}-01-01` });

    // Socios tiene por_pagina=100 como contrato fijo. Verificamos que no pueda
    // alterarse desde querystring y que una página fuera de rango se normalice.
    const sociosPage = await apiCall(request, 'socios_listar', {
      params: { vigente: 'VIGENTE', buscar: commonSocioLabel, pagina: 9999, por_pagina: 1 },
    });
    expect(Number(sociosPage.paginacion.por_pagina)).toBe(100);
    expect(Number(sociosPage.paginacion.total)).toBeGreaterThanOrEqual(2);
    expect(Number(sociosPage.paginacion.pagina)).toBe(Number(sociosPage.paginacion.total_paginas));
    const sociosIds = (sociosPage.items || []).map((item) => Number(item.id_socio));
    expect(sociosIds).toContain(Number(first.id_socio));
    expect(sociosIds).toContain(Number(second.id_socio));

    // Cuotas sí permite variar por_pagina; con dos socios E2E garantizamos dos
    // páginas reales sin depender del volumen preexistente de la base.
    const category = await createQuotaCategory(request);
    const quotaLabel = `PAGINACION CUOTAS ${lettersFromSuffix(uniqueSuffix(), 6)}`;
    const quotaA = await createQuotaSocio(request, quotaLabel, category.item.id_categoria);
    const quotaB = await createQuotaSocio(request, quotaLabel, category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);

    const cuotasPage1 = await apiCall(request, 'cuotas_listar', {
      params: {
        estado: 'DEUDORES',
        anio: currentYear(),
        mes: periodId,
        buscar: quotaLabel,
        pagina: 1,
        por_pagina: 1,
      },
    });
    const cuotasPage2 = await apiCall(request, 'cuotas_listar', {
      params: {
        estado: 'DEUDORES',
        anio: currentYear(),
        mes: periodId,
        buscar: quotaLabel,
        pagina: 2,
        por_pagina: 1,
      },
    });
    expect(Number(cuotasPage1.paginacion.total)).toBeGreaterThanOrEqual(2);
    expect(Number(cuotasPage1.paginacion.total_paginas)).toBeGreaterThanOrEqual(2);
    expect(cuotasPage1.items).toHaveLength(1);
    expect(cuotasPage2.items).toHaveLength(1);
    expect(Number(cuotasPage1.items[0].id_socio)).not.toBe(Number(cuotasPage2.items[0].id_socio));
    expect([quotaA.item.id_socio, quotaB.item.id_socio].map(Number)).toContain(Number(cuotasPage1.items[0].id_socio));
    expect([quotaA.item.id_socio, quotaB.item.id_socio].map(Number)).toContain(Number(cuotasPage2.items[0].id_socio));
  });

  test('paginación UI ejecuta siempre Siguiente y Anterior en Socios y Cuotas', async ({ page }) => {
    const sociosMatcher = /api\.php\?[^#]*action=socios_listar/;
    const sociosRequestedPages = [];
    let sociosBaseBody = null;
    await page.route(sociosMatcher, async (route) => {
      const requestedPage = Number(new URL(route.request().url()).searchParams.get('pagina') || 1);
      sociosRequestedPages.push(requestedPage);

      if (!sociosBaseBody) {
        const response = await route.fetch();
        sociosBaseBody = await response.json();
      }
      const body = JSON.parse(JSON.stringify(sociosBaseBody));
      body.paginacion = {
        ...(body.paginacion || {}),
        pagina: requestedPage,
        por_pagina: 100,
        total: 101,
        total_paginas: 2,
        desde: requestedPage === 1 ? 1 : 101,
        hasta: requestedPage === 1 ? 100 : 101,
        tiene_anterior: requestedPage > 1,
        tiene_siguiente: requestedPage < 2,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(body),
      });
    });

    await page.goto('/socios/personas');
    const sociosPagination = page.getByRole('navigation', { name: 'Paginación de socios' });
    const sociosNext = sociosPagination.getByRole('button', { name: 'Siguiente', exact: true });
    await expect(sociosNext).toBeEnabled();
    await sociosNext.click();
    await expect.poll(() => sociosRequestedPages.includes(2)).toBe(true);
    await expect(sociosPagination.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');

    const sociosPrevious = sociosPagination.getByRole('button', { name: 'Anterior', exact: true });
    await expect(sociosPrevious).toBeEnabled();
    const pageOneRequestsBefore = sociosRequestedPages.filter((value) => value === 1).length;
    await sociosPrevious.click();
    await expect.poll(() => sociosRequestedPages.filter((value) => value === 1).length).toBeGreaterThan(pageOneRequestsBefore);
    await expect(sociosPagination.getByRole('button', { name: '1', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.unroute(sociosMatcher);

    const cuotasMatcher = /api\.php\?[^#]*action=cuotas_listar/;
    const cuotasRequestedPages = [];
    let cuotasBaseBody = null;
    await page.route(cuotasMatcher, async (route) => {
      const requestedPage = Number(new URL(route.request().url()).searchParams.get('pagina') || 1);
      cuotasRequestedPages.push(requestedPage);

      if (!cuotasBaseBody) {
        const response = await route.fetch();
        cuotasBaseBody = await response.json();
      }
      const body = JSON.parse(JSON.stringify(cuotasBaseBody));
      body.paginacion = {
        ...(body.paginacion || {}),
        pagina: requestedPage,
        por_pagina: 100,
        total: 101,
        total_paginas: 2,
        desde: requestedPage === 1 ? 1 : 101,
        hasta: requestedPage === 1 ? 100 : 101,
        tiene_anterior: requestedPage > 1,
        tiene_siguiente: requestedPage < 2,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(body),
      });
    });

    await page.goto('/cuotas');
    const cuotasPagination = page.getByRole('navigation', { name: 'Paginación de cuotas' });
    const cuotasNext = cuotasPagination.getByRole('button', { name: 'Siguiente', exact: true });
    await expect(cuotasNext).toBeEnabled();
    await cuotasNext.click();
    await expect.poll(() => cuotasRequestedPages.includes(2)).toBe(true);
    await expect(cuotasPagination.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');

    const cuotasPrevious = cuotasPagination.getByRole('button', { name: 'Anterior', exact: true });
    await expect(cuotasPrevious).toBeEnabled();
    const cuotasPageOneBefore = cuotasRequestedPages.filter((value) => value === 1).length;
    await cuotasPrevious.click();
    await expect.poll(() => cuotasRequestedPages.filter((value) => value === 1).length).toBeGreaterThan(cuotasPageOneBefore);
    await expect(cuotasPagination.getByRole('button', { name: '1', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.unroute(cuotasMatcher);
  });

  test('Balance anual: Cargar todos ejecuta la rama >100 y muestra todos los deudores', async ({ page }) => {
    const balanceMatcher = /api\.php\?[^#]*action=contable_balance/;
    await page.route(balanceMatcher, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.balance = body.balance || {};
      body.balance.deudores = body.balance.deudores || {};
      body.balance.deudores.items = fakeDebtRows(101);
      await route.fulfill({ response, json: body });
    });

    try {
      await page.goto('/contable/ingresos');
      await page.getByRole('button', { name: 'Balance anual', exact: true }).click();
      const balance = page.locator('[role="dialog"].ct-balance-modal');
      await expect(balance).toBeVisible();

      await balance.getByRole('button', { name: 'Generar balance', exact: true }).click();
      await expect(balance.getByRole('button', { name: 'Actualizar balance', exact: true })).toBeVisible();
      await balance.getByRole('tab', { name: 'Deudores por período', exact: true }).click();

      const debtTable = balance.getByRole('table', { name: 'Detalle completo de deudores por período' });
      await expect(debtTable.locator('.global-divTable__row')).toHaveCount(100);
      const loadAll = balance.getByRole('button', { name: 'Cargar todos', exact: true });
      await expect(loadAll).toBeVisible();
      await expect(balance.getByText(/Quedan 1 registros más\./)).toBeVisible();

      await loadAll.click();
      await expect(loadAll).toHaveCount(0);
      await expect(debtTable.locator('.global-divTable__row')).toHaveCount(101);
      await expect(rowByText(balance, 'PW E2E CARGAR TODOS 101')).toBeVisible();
    } finally {
      await page.unroute(balanceMatcher);
    }
  });
});
