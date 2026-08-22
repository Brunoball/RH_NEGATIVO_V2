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

  test('UI renderiza tarjetas, gráfico e Indicadores generales con valores reales', async ({ page, request }) => {
    const result = await apiCall(request, 'dashboard_resumen');
    const summary = result.resumen;

    await page.goto('/panel');
    await expect(page.getByRole('heading', { name: 'Panel de gestión' })).toBeVisible();
    for (const label of ['Socios activos', 'Cuotas cubiertas', 'Cuotas pendientes', 'Saldo del mes']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Cuotas registradas' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Cuotas registradas durante los últimos seis períodos' })).toBeVisible();

    const indicators = page.getByRole('complementary').filter({
      has: page.getByRole('heading', { name: 'Indicadores generales', exact: true }),
    });
    await expect(indicators).toBeVisible();

    const qualityLabel = indicators.getByText('Calidad general de datos', { exact: true });
    await expect(qualityLabel).toBeVisible();
    const qualityCard = qualityLabel.locator('xpath=ancestor::article[1]');
    await expect(qualityCard).toContainText(`Socios con categoría: ${Number(summary.estado?.socios_con_categoria || 0)}%`);
    await expect(qualityCard).toContainText(`Personas con familia: ${Number(summary.estado?.socios_con_familia || 0)}%`);
    const dataItems = [
      ['Personas activas', summary.socios.personas_activas],
      ['Socios de baja', summary.socios.inactivos],
      ['Con categoría', summary.socios.con_categoria],
      ['Cobros del mes', summary.cuotas.cobros_registrados_mes],
    ];
    for (const [label, value] of dataItems) {
      const labelNode = indicators.getByText(label, { exact: true });
      await expect(labelNode, `Falta el indicador del dashboard: ${label}`).toBeVisible();
      const item = labelNode.locator('xpath=ancestor::article[1]');
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
