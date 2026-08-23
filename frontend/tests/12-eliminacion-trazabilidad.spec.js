const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall } = require('./helpers/api.helper');
const { exportFromGlobalModal } = require('./helpers/download.helper');
const { todayIso } = require('./helpers/data.helper');
const { createSocio } = require('./helpers/entities.helper');
const {
  createQuotaCategory,
  createQuotaSocio,
  currentYear,
  paymentPayload,
  quotaCatalogs,
} = require('./helpers/cuotas.helper');
const { familyData, socioData } = require('./fixtures/socios.fixture');

function currentMonth() {
  return Number(todayIso().slice(5, 7));
}

function currentPeriod() {
  return Math.ceil(currentMonth() / 2);
}

function registrationMedium(catalogs) {
  const medium = (catalogs.catalogos.medios_pago || []).find((item) => {
    const name = String(item.nombre || '').toUpperCase();
    return item.activo !== false && (name.includes('EFECTIVO') || name.includes('TRANSFERENCIA'));
  });
  if (!medium) throw new Error('El blindaje de eliminación requiere EFECTIVO o TRANSFERENCIA para inscripción.');
  return medium;
}

async function createPaidPartner(request, label) {
  const category = await createQuotaCategory(request);
  const socio = await createQuotaSocio(request, label, category.item.id_categoria);
  const catalogs = await quotaCatalogs(request);
  const periodId = currentPeriod();
  const period = catalogs.bimonthly.find(
    (item) => Number(item.id_periodo ?? item.id_mes) === periodId,
  );
  if (!period) throw new Error(`No existe el período bimestral ${periodId} para el blindaje de eliminación.`);

  const payment = await apiCall(request, 'cuotas_registrar_pago', {
    method: 'POST',
    data: paymentPayload({
      socioId: socio.item.id_socio,
      periodId,
      mediumId: catalogs.medium.id_medio_pago,
    }),
  });
  const medium = registrationMedium(catalogs);
  const registration = await apiCall(request, 'cuotas_registrar_inscripcion', {
    method: 'POST',
    data: {
      id_socio: socio.item.id_socio,
      fecha_pago: todayIso(),
      monto: '12345',
      id_medio_pago: medium.id_medio_pago,
    },
  });

  return { category, socio, catalogs, periodId, payment, registration, registrationMedium: medium };
}

function configItem(data, list, idField, id) {
  return (data.listas?.[list] || []).find((item) => Number(item[idField]) === Number(id));
}

test.describe('Eliminación definitiva · trazabilidad transversal', () => {
  test('Familias cierra el vínculo operativo pero conserva integrante, DNI y búsqueda histórica', async ({ request }) => {
    const removedData = socioData('DELETE FAMILIA HIST');
    const survivorData = socioData('DELETE FAMILIA ACTIVO');
    const removed = await createSocio(request, removedData);
    const survivor = await createSocio(request, survivorData);
    const family = familyData();

    const saved = await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [
          { id_socio: removed.id_socio, desde: todayIso() },
          { id_socio: survivor.id_socio, desde: todayIso() },
        ],
      },
    });
    const familyId = Number(saved.item.id_familia);

    const deleted = await apiCall(request, 'socios_eliminar_definitivo', {
      method: 'POST', data: { id: removed.id_socio },
    });
    expect(Number(deleted.vinculos_familiares_cerrados)).toBe(1);

    const detail = await apiCall(request, 'familias_obtener', { params: { id: familyId } });
    expect(detail.item.integrante_ids).toEqual([Number(survivor.id_socio)]);
    expect(detail.item.integrantes.some((item) => Number(item.id_socio) === Number(removed.id_socio))).toBe(false);

    const historical = (detail.item.historial_integrantes || []).find(
      (item) => Number(item.id_socio) === Number(removed.id_socio),
    );
    expect(historical, 'El integrante eliminado debe seguir en el historial familiar').toBeTruthy();
    expect(historical.vinculo_activo).toBe(false);
    expect(historical.fecha_desvinculacion).toBe(todayIso());
    expect(String(historical.dni)).toBe(String(removedData.dni));

    const byHistoricalDni = await apiCall(request, 'familias_listar', {
      params: { estado: 'activo', buscar: removedData.dni },
    });
    expect(
      (byHistoricalDni.items || []).some((item) => Number(item.id_familia) === familyId),
      'Buscar una familia por el DNI histórico del integrante eliminado debe conservar la trazabilidad',
    ).toBe(true);
    expect(
      (byHistoricalDni.catalogos?.socios || []).some((item) => Number(item.id_socio) === Number(removed.id_socio)),
      'El socio eliminado no debe volver al catálogo operativo para armar familias',
    ).toBe(false);
  });

  test('Dashboard y Configuración dejan de contar al eliminado como socio actual sin borrar la protección histórica', async ({ request }) => {
    const category = await createQuotaCategory(request);
    const socio = await createSocio(request, socioData('DELETE DASH CONFIG'), {
      id_categoria: category.item.id_categoria,
      fecha_ingreso: todayIso(),
    });

    const dashboardBefore = (await apiCall(request, 'dashboard_resumen')).resumen;
    const configBefore = await apiCall(request, 'configuracion_obtener');
    const categoryBefore = configItem(configBefore, 'categoria', 'id_categoria', category.item.id_categoria);
    expect(categoryBefore).toBeTruthy();
    expect(Number(categoryBefore.cantidad_usos)).toBe(1);

    await apiCall(request, 'socios_eliminar_definitivo', {
      method: 'POST', data: { id: socio.id_socio },
    });

    const dashboardAfter = (await apiCall(request, 'dashboard_resumen')).resumen;
    expect(Number(dashboardAfter.socios.activos)).toBe(Number(dashboardBefore.socios.activos) - 1);
    expect(Number(dashboardAfter.socios.con_categoria)).toBe(Number(dashboardBefore.socios.con_categoria) - 1);
    expect(Number(dashboardAfter.socios.altas_mes)).toBe(Number(dashboardBefore.socios.altas_mes) - 1);
    const configAfter = await apiCall(request, 'configuracion_obtener');
    const categoryAfter = configItem(configAfter, 'categoria', 'id_categoria', category.item.id_categoria);
    expect(categoryAfter).toBeTruthy();
    expect(Number(categoryAfter.cantidad_usos)).toBe(0);
    expect(Number(categoryAfter.cantidad_usos_protegidos)).toBeGreaterThanOrEqual(1);
  });

  test('Resumen y Balance conservan cuotas, inscripción e identidad histórica después de eliminar', async ({ request }) => {
    const setup = await createPaidPartner(request, 'DELETE RESUMEN BALANCE');
    const year = currentYear();
    const month = currentMonth();

    const summaryBefore = (await apiCall(request, 'contable_resumen', {
      params: { anio: year, mes: month },
    })).resumen;

    await apiCall(request, 'socios_eliminar_definitivo', {
      method: 'POST', data: { id: setup.socio.item.id_socio },
    });

    const summaryAfter = (await apiCall(request, 'contable_resumen', {
      params: { anio: year, mes: month },
    })).resumen;

    for (const field of ['ingresos_cuotas', 'ingresos_inscripciones', 'ingresos_socios', 'ingresos']) {
      expect(summaryAfter.totales_mes[field], `${field} mensual no puede cambiar por eliminar al socio`).toBe(summaryBefore.totales_mes[field]);
      expect(summaryAfter.totales[field], `${field} anual no puede cambiar por eliminar al socio`).toBe(summaryBefore.totales[field]);
    }

    const balance = (await apiCall(request, 'contable_balance', {
      params: { desde: `${year}-01-01`, hasta: `${year}-12-31` },
    })).balance;
    const registration = (balance.inscripciones.items || []).find(
      (item) => Number(item.id_socio) === Number(setup.socio.item.id_socio),
    );
    expect(registration, 'La inscripción del socio eliminado debe seguir en Balance').toBeTruthy();
    expect(String(registration.dni)).toBe(String(setup.socio.data.dni));
    expect(Number(registration.id_inscripcion)).toBe(Number(setup.registration.item.id_inscripcion));
  });

  test('Balance histórico de deudores conserva el DNI archivado sin revivir al socio en períodos posteriores', async ({ request }) => {
    test.skip(currentMonth() <= 2, 'Este escenario necesita al menos un período bimestral cerrado del año actual.');

    const category = await createQuotaCategory(request);
    const socio = await createQuotaSocio(request, 'DELETE DEUDA HIST', category.item.id_categoria, {
      fecha_ingreso: `${currentYear()}-01-01`,
    });

    await apiCall(request, 'socios_eliminar_definitivo', {
      method: 'POST', data: { id: socio.item.id_socio },
    });

    const historicalBalance = (await apiCall(request, 'contable_balance', {
      params: { desde: `${currentYear()}-01-01`, hasta: `${currentYear()}-02-28` },
    })).balance;
    const historicalDebt = (historicalBalance.deudores.items || []).find(
      (item) => Number(item.id_socio) === Number(socio.item.id_socio),
    );
    expect(historicalDebt, 'El socio debe conservar su deuda del período previo a la eliminación').toBeTruthy();
    expect(String(historicalDebt.dni)).toBe(String(socio.data.dni));

    const periodStartMonth = (currentPeriod() - 1) * 2 + 1;
    const currentFrom = `${currentYear()}-${String(periodStartMonth).padStart(2, '0')}-01`;
    const currentEndMonth = periodStartMonth + 1;
    const currentEndDay = new Date(Date.UTC(currentYear(), currentEndMonth, 0)).getUTCDate();
    const currentTo = `${currentYear()}-${String(currentEndMonth).padStart(2, '0')}-${String(currentEndDay).padStart(2, '0')}`;
    const afterDeletionBalance = (await apiCall(request, 'contable_balance', {
      params: { desde: currentFrom, hasta: currentTo },
    })).balance;
    expect(
      (afterDeletionBalance.deudores.items || []).some(
        (item) => Number(item.id_socio) === Number(socio.item.id_socio),
      ),
      'Un socio eliminado no debe revivir como deudor operativo en el período que cierra después de su eliminación',
    ).toBe(false);
  });

  test('Ingresos de socios permite buscar y exportar los movimientos preservados del socio eliminado', async ({ page, request }) => {
    const setup = await createPaidPartner(request, 'DELETE EXPORT CONTABLE');
    const originalDni = setup.socio.data.dni;
    const originalName = setup.socio.data.nombre;

    await apiCall(request, 'socios_eliminar_definitivo', {
      method: 'POST', data: { id: setup.socio.item.id_socio },
    });

    await page.goto('/contable/ingresos');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Período', { exact: true }).selectOption(String(setup.periodId));
    const segmented = page.getByRole('tablist', { name: 'Vista' });
    await segmented.getByRole('tab', { name: 'Detalle', exact: true }).click();

    const search = page.getByRole('textbox', { name: 'Socio', exact: true });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes('buscar=')),
      search.fill(originalDni),
    ]);

    const table = page.getByRole('table', { name: 'Detalle de cobros recibidos' });
    await expect(table.getByRole('row').filter({ hasText: originalName }).filter({ has: page.locator('.mov-gridCell:nth-child(2) .mov-categoryChip').filter({ hasText: /^CUOTA$/ }) })).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: originalName }).filter({ has: page.locator('.mov-gridCell:nth-child(2) .mov-categoryChip').filter({ hasText: /^INSCRIPCIÓN$/ }) })).toBeVisible();
    await expect(table.getByText(originalDni).first()).toBeVisible();

    for (const [format, extension] of [['Excel', '.xlsx'], ['PDF', '.pdf']]) {
      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar', exact: true }),
        format,
        scope: 'registros visibles|esta página',
        expectedExtension: extension,
      });
    }
  });
});
