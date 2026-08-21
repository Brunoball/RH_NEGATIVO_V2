const { test, expect } = require('./fixtures/auth.fixture');

async function openDesktopGroup(page, name) {
  const sidebar = page.locator('.pp-sidebar');
  await sidebar.hover();
  const button = page.getByRole('button', { name, exact: true });
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click();
  }
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await sidebar.hover();
}

test.describe('Shell · navegación de módulos incluidos', () => {
  test('sidebar navega Dashboard, Socios/Familias, Cuotas, Categorías y Contabilidad completa', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/panel');
    await expect(page.getByRole('heading', { name: 'Panel de gestión' })).toBeVisible();

    await openDesktopGroup(page, 'Socios');
    await page.getByRole('link', { name: 'Socios', exact: true }).click();
    await expect(page).toHaveURL(/\/socios\/personas$/);

    await openDesktopGroup(page, 'Socios');
    await page.getByRole('link', { name: 'Familias', exact: true }).click();
    await expect(page).toHaveURL(/\/socios\/familias$/);

    await page.locator('.pp-sidebar').hover();
    await page.getByRole('link', { name: 'Cuotas', exact: true }).click();
    await expect(page).toHaveURL(/\/cuotas$/);

    await openDesktopGroup(page, 'Categorías');
    await page.getByRole('link', { name: 'Categorías', exact: true }).click();
    await expect(page).toHaveURL(/\/categorias$/);

    await openDesktopGroup(page, 'Categorías');
    await page.getByRole('link', { name: 'Descuentos familiares', exact: true }).click();
    await expect(page).toHaveURL(/\/categorias\/descuentos$/);

    await openDesktopGroup(page, 'Contabilidad');
    await page.getByRole('link', { name: 'Ingresos', exact: true }).click();
    await expect(page).toHaveURL(/\/contable\/ingresos$/);

    await openDesktopGroup(page, 'Contabilidad');
    await page.getByRole('link', { name: 'Egresos', exact: true }).click();
    await expect(page).toHaveURL(/\/contable\/egresos$/);

    await openDesktopGroup(page, 'Contabilidad');
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    await expect(page).toHaveURL(/\/contable\/resumen$/);

    await page.locator('.pp-sidebar').hover();
    await page.getByRole('link', { name: 'Administración', exact: true }).click();
    await expect(page).toHaveURL(/\/panel$/);

    // El botón de un grupo también tiene una acción distinta al clic simple:
    // doble clic debe ingresar directamente a su ruta por defecto.
    const sociosGroup = page.getByRole('button', { name: 'Socios', exact: true });
    await sociosGroup.dblclick();
    await expect(page).toHaveURL(/\/socios\/personas$/);
    await expect(sociosGroup).toHaveAttribute('aria-expanded', 'true');
  });

  test('menú móvil, perfil y acceso a Configuración responden a sus acciones', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/panel');

    const openMenu = page.getByRole('button', { name: 'Abrir menú' });
    await expect(openMenu).toBeVisible();
    await openMenu.click();
    await expect(page.getByRole('button', { name: 'Cerrar menú' })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar menú' }).click();

    // El fondo/overlay es una segunda vía real de cierre del drawer móvil.
    await openMenu.click();
    const overlay = page.locator('.pp-drawerOverlay');
    await expect(overlay).toHaveClass(/is-open/);
    await overlay.click({ position: { x: 385, y: 20 } });
    await expect(overlay).not.toHaveClass(/is-open/);

    await page.getByRole('button', { name: 'Abrir perfil' }).click();
    let profile = page.getByRole('dialog', { name: 'Perfil de usuario' });
    await expect(profile).toBeVisible();
    await profile.getByRole('button', { name: 'Cerrar perfil' }).click();
    await expect(profile).toBeHidden();

    await page.getByRole('button', { name: 'Abrir perfil' }).click();
    profile = page.getByRole('dialog', { name: 'Perfil de usuario' });
    await profile.getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(page).toHaveURL(/\/configuracion$/);

    await page.goto('/panel');
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    await expect(page).toHaveURL(/\/configuracion$/);
  });
});
