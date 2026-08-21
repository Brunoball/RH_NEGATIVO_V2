const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall } = require('./helpers/api.helper');

test.describe('Dashboard', () => {
  test('API devuelve el contrato completo y métricas coherentes', async ({ request }) => {
    const result = await apiCall(request, 'dashboard_resumen');
    const summary = result.resumen;
    expect(summary).toBeTruthy();
    for (const key of ['periodo', 'socios', 'familias', 'categorias', 'cuotas', 'contable', 'estado', 'actividad', 'serie_cuotas', 'fuentes']) {
      expect(summary, `falta ${key}`).toHaveProperty(key);
    }
    expect(Number(summary.periodo.anio)).toBeGreaterThanOrEqual(2000);
    expect(Array.isArray(summary.serie_cuotas)).toBe(true);
    expect(summary.serie_cuotas).toHaveLength(6);
    for (const metric of [summary.socios.activos, summary.socios.inactivos, summary.cuotas.pagadas_mes, summary.cuotas.pendientes_mes]) {
      expect(Number(metric)).toBeGreaterThanOrEqual(0);
    }
    expect(Number(summary.cuotas.cumplimiento_mes || 0)).toBeGreaterThanOrEqual(0);
    expect(Number(summary.cuotas.cumplimiento_mes || 0)).toBeLessThanOrEqual(100);
  });

  test('UI renderiza tarjetas, gráfico, controles de calidad y Datos registrados con valores reales', async ({ page, request }) => {
    const result = await apiCall(request, 'dashboard_resumen');
    const summary = result.resumen;

    await page.goto('/panel');
    await expect(page.getByRole('heading', { name: 'Panel de gestión' })).toBeVisible();
    for (const label of ['Socios activos', 'Cuotas cubiertas', 'Cuotas pendientes', 'Saldo del mes']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Cuotas registradas' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Cuotas registradas durante los últimos seis períodos' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Calidad de los datos' })).toBeVisible();
    await expect(page.getByText('Socios con categoría', { exact: true })).toBeVisible();
    await expect(page.getByText('Personas con familia', { exact: true })).toBeVisible();
    if (summary.fuentes?.recordatorios_disponibles === false) {
      await expect(page.getByText('Recordatorios habilitados', { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText('Recordatorios habilitados', { exact: true })).toBeVisible();
    }

    const dataPanel = page.locator('.admin-dashboard__panel--data');
    await expect(dataPanel.getByRole('heading', { name: 'Datos registrados' })).toBeVisible();
    const dataItems = [
      ['Personas activas', summary.socios.personas_activas],
      ['Socios de baja', summary.socios.inactivos],
      ['Con categoría', summary.socios.con_categoria],
      ['Cobros del mes', summary.cuotas.cobros_registrados_mes],
    ];
    for (const [label, value] of dataItems) {
      const item = dataPanel.locator('.admin-dashboard__dataItem').filter({ hasText: label });
      await expect(item, `Falta la tarjeta nueva del dashboard: ${label}`).toBeVisible();
      await expect(item.getByText(label, { exact: true })).toBeVisible();
      await expect(item.locator('strong')).toHaveText(String(Number(value || 0)));
    }
  });

  test('UI muestra error controlado y Reintentar recupera el dashboard', async ({ page }) => {
    let failed = false;
    await page.route(/api\.php\?[^#]*action=dashboard_resumen/, async (route) => {
      if (!failed) {
        failed = true;
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ exito: false, codigo: 'PW_E2E_ERROR', mensaje: 'Fallo simulado de dashboard' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/panel');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('No se pudo cargar el dashboard');
    await expect(alert).toContainText('Fallo simulado de dashboard');
    await alert.getByRole('button', { name: /Reintentar/ }).click();
    await expect(page.getByText('Socios activos', { exact: true })).toBeVisible();
    await expect(alert).toBeHidden();
  });
});
