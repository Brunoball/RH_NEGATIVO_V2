const { test, expect } = require('./fixtures/auth.fixture');
const { userData } = require('./fixtures/usuarios.fixture');
const {
  cleanupUserByUsername,
  findUserByUsername,
} = require('./helpers/api.helper');
const { dismissPersistentToast, expectToast } = require('./helpers/auth.helper');
const { loadTestEnv } = require('./helpers/env.helper');

loadTestEnv();
const user = userData();

function userRow(page, username) {
  return page
    .getByRole('table', { name: 'Usuarios del sistema' })
    .getByRole('row')
    .filter({ hasText: username })
    .last();
}

async function selectRole(dialog, accessibleName) {
  const radio = dialog.getByRole('radio', { name: accessibleName });
  await radio.locator('xpath=ancestor::label[1]').click();
  await expect(radio).toBeChecked();
}

test.describe.configure({ mode: 'serial' });

test.describe('Usuarios y roles', () => {
  test.afterEach(async ({ request }) => {
    for (const username of [user.username, user.usernameEdited]) {
      try {
        await cleanupUserByUsername(request, username);
      } catch (_error) {
        // Conserva el fallo original del test.
      }
    }
  });

  test('protege la sesión actual y ofrece baja o eliminación definitiva incluso con historial', async ({ page, request }) => {
    await cleanupUserByUsername(request, user.username).catch(() => false);
    await cleanupUserByUsername(request, user.usernameEdited).catch(() => false);

    await page.goto('/configuracion/usuarios');
    await expect(page.getByRole('heading', { name: 'Configuración de usuarios' })).toBeVisible();
    await expect(page.getByLabel('Resumen de usuarios')).toBeVisible();

    const search = page.getByRole('textbox', { name: 'Buscar', exact: true });
    await search.fill(process.env.PW_USER);
    const currentRow = userRow(page, process.env.PW_USER);
    await expect(currentRow).toContainText('Sesión actual');
    await expect(
      currentRow.getByRole('button', { name: `Dar de baja ${process.env.PW_USER}` }),
    ).toBeDisabled();
    await expect(
      currentRow.getByRole('button', { name: `Eliminar ${process.env.PW_USER}` }),
    ).toBeDisabled();
    await currentRow
      .getByRole('button', { name: `Editar ${process.env.PW_USER}` })
      .click();
    let dialog = page.getByRole('dialog', { name: 'Editar usuario' });
    const currentRoleOptions = dialog.getByRole('radiogroup', { name: 'Rol del usuario' });
    await expect(currentRoleOptions.getByRole('radio')).toHaveCount(2);
    await expect(currentRoleOptions.getByRole('radio', { name: /^Administrador/i })).toBeDisabled();
    await expect(currentRoleOptions.getByRole('radio', { name: /^Solo lectura/i })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    await search.fill('');
    await page.getByRole('button', { name: 'Nuevo usuario' }).click();
    dialog = page.getByRole('dialog', { name: 'Nuevo usuario' });
    await dialog.getByLabel('Usuario *').fill(user.username);
    await dialog.getByLabel('Email').fill(user.email);
    await selectRole(dialog, /^Solo lectura/i);
    await dialog.getByLabel('Contraseña *', { exact: true }).fill(user.password);
    await dialog.getByLabel('Confirmar contraseña *', { exact: true }).fill(`${user.password}X`);
    await dialog.getByRole('button', { name: 'Crear usuario' }).click();
    await expectToast(page, 'Las contraseñas no coinciden.');
    await dismissPersistentToast(page);

    await dialog.getByLabel('Confirmar contraseña *', { exact: true }).fill(user.password);
    await dialog.getByRole('button', { name: 'Crear usuario' }).click();
    await expectToast(page, 'Usuario creado correctamente.');

    await search.fill(user.username);
    let row = userRow(page, user.username);
    await expect(row).toContainText(user.email);
    await expect(row).toContainText('Solo lectura');
    await expect(row).toContainText('Activo');

    await row.getByRole('button', { name: `Editar ${user.username}` }).click();
    dialog = page.getByRole('dialog', { name: 'Editar usuario' });
    await dialog.getByLabel('Usuario *').fill(user.usernameEdited);
    await dialog.getByLabel('Email').fill(user.emailEdited);
    await selectRole(dialog, /^Administrador/i);
    await dialog.getByLabel('Nueva contraseña', { exact: true }).fill(user.newPassword);
    await dialog.getByLabel('Confirmar nueva contraseña', { exact: true }).fill(user.newPassword);
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectToast(page, 'Usuario actualizado correctamente.');

    await search.fill(user.usernameEdited);
    row = userRow(page, user.usernameEdited);
    await expect(row).toContainText(user.emailEdited);
    await expect(row).toContainText('Administrador');

    const disableButton = row.getByRole('button', {
      name: `Dar de baja ${user.usernameEdited}`,
    });
    const deleteButton = row.getByRole('button', {
      name: `Eliminar ${user.usernameEdited}`,
    });
    await expect(disableButton).toBeEnabled();
    await expect(deleteButton).toBeEnabled();

    await deleteButton.click();
    let deleteDialog = page.getByRole('dialog', { name: 'Eliminar usuario' });
    await expect(deleteDialog).toContainText(/se eliminará definitivamente/i);
    await expect(deleteDialog).toContainText(/usá Dar de baja/i);
    await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(deleteDialog).toBeHidden();

    await disableButton.click();
    let stateDialog = page.getByRole('dialog', { name: 'Dar de baja usuario' });
    await stateDialog.getByRole('button', { name: 'Dar de baja' }).click();
    await expectToast(page, 'Usuario dado de baja correctamente.');

    await page.getByRole('tab', { name: 'Dados de baja' }).click();
    row = userRow(page, user.usernameEdited);
    await expect(row).toContainText('Baja');
    await row
      .getByRole('button', { name: `Reactivar ${user.usernameEdited}` })
      .click();
    stateDialog = page.getByRole('dialog', { name: 'Reactivar usuario' });
    await stateDialog.getByRole('button', { name: 'Reactivar' }).click();
    await expectToast(page, 'Usuario reactivado correctamente.');

    await page.getByRole('tab', { name: 'Activos' }).click();
    row = userRow(page, user.usernameEdited);
    await expect(
      row.getByRole('button', { name: `Dar de baja ${user.usernameEdited}` }),
    ).toBeEnabled();
    await row
      .getByRole('button', { name: `Eliminar ${user.usernameEdited}` })
      .click();
    deleteDialog = page.getByRole('dialog', { name: 'Eliminar usuario' });
    await deleteDialog.getByRole('button', { name: 'Eliminar' }).click();
    await expectToast(page, 'Usuario eliminado correctamente.');
    await expect(userRow(page, user.usernameEdited)).toHaveCount(0);

    expect(await findUserByUsername(request, user.usernameEdited)).toBeNull();
  });
});
