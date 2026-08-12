const { test, expect } = require('./fixtures/auth.fixture');
const { companyData, familyData, personData } = require('./fixtures/socios.fixture');
const {
  apiCall,
  cleanupFamilyByPrefix,
  cleanupSocioByDocument,
  expectApiError,
} = require('./helpers/api.helper');
const { dismissPersistentToast, expectToast } = require('./helpers/auth.helper');
const { todayIso } = require('./helpers/data.helper');

const person = personData();
const company = companyData();
const family = familyData();
const familyMember = personData();
const familyMemberRemoved = personData();
const familyMemberForDelete = personData();

function tableRow(page, tableName, text) {
  return page
    .getByRole('table', { name: tableName })
    .getByRole('row')
    .filter({ hasText: text })
    .last();
}

async function permanentDeleteCurrentPartner(page, row) {
  await row.getByTitle(/Eliminar definitivamente/i).click();

  const deleteDialog = page
    .getByRole('dialog')
    .filter({ hasText: /Eliminar definitivamente/i });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog
    .getByRole('button', { name: 'Eliminar definitivamente' })
    .click();
  await expectToast(page, /eliminados definitivamente/i);
}

// Cada caso usa datos propios y cleanup independiente. Un crash nativo de Chromium/Windows
// (0xC0000409) se reintenta una sola vez en un worker limpio sin saltear el resto.
test.describe.configure({ retries: 1 });

test.describe('Socios, empresas y familias', () => {
  test.afterEach(async ({ request }) => {
    try {
      cleanupFamilyByPrefix(family.prefix);
    } catch (_error) {
      // La familia puede no haberse creado todavía.
    }

    for (const target of [
      { tipo: 'PERSONA', documento: person.dni },
      { tipo: 'EMPRESA', documento: company.cuit },
      { tipo: 'PERSONA', documento: familyMember.dni },
      { tipo: 'PERSONA', documento: familyMemberRemoved.dni },
      { tipo: 'PERSONA', documento: familyMemberForDelete.dni },
    ]) {
      try {
        await cleanupSocioByDocument(request, target);
      } catch (_error) {
        // El test principal conservará el error original. La siguiente corrida
        // volverá a intentar limpiar el registro exacto.
      }
    }
  });

  test('cubre el ciclo completo de un socio persona', async ({ page, request }) => {
    await cleanupSocioByDocument(request, { tipo: 'PERSONA', documento: person.dni });

    await page.goto('/socios/personas');
    await expect(page.getByRole('heading', { name: 'Socios' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Listado de socios' })).toBeVisible();
    await page.getByRole('tab', { name: 'Activos' }).click();

    await page.getByRole('button', { name: 'Nuevo socio' }).click();
    let dialog = page.getByRole('dialog', { name: 'Nuevo socio' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Crear socio' }).click();
    await expectToast(page, /Completá apellido, nombre y fecha de alta/i);

    await dialog.getByLabel('Apellido *').fill(person.apellido);
    await dialog.getByLabel('Nombre *').fill(person.nombre);
    await dialog.getByLabel('DNI').fill(person.dni);
    await dialog.getByRole('tab', { name: 'Contacto y membresía' }).click();
    await dialog.getByRole('textbox', { name: 'Domicilio', exact: true }).fill('CALLE PLAYWRIGHT');
    await dialog.getByLabel('Número').fill('123');
    await dialog.getByLabel('Localidad').fill('SAN FRANCISCO');
    const reminderCheckbox = dialog.getByRole('checkbox', { name: /Enviar recordatorios/i });
    await expect(reminderCheckbox).toBeDisabled();
    const phoneInput = dialog.getByRole('textbox', { name: 'Teléfono', exact: true });
    await phoneInput.fill('123');
    await expect(reminderCheckbox).toBeDisabled();

    const formattedPhone = `549${person.telefono}`;
    await phoneInput.fill(formattedPhone);
    await phoneInput.blur();
    await expect(phoneInput).toHaveValue(person.telefono);
    await expect(reminderCheckbox).toBeEnabled();
    await dialog.getByLabel('Correo').fill(person.email);
    await dialog.getByLabel('Domicilio alternativo').fill('SEDE ALTERNATIVA PLAYWRIGHT');
    const categorySelect = dialog.getByLabel('Categoría');
    let selectedCategoryValue = '';
    if ((await categorySelect.locator('option').count()) > 1) {
      await categorySelect.selectOption({ index: 1 });
      selectedCategoryValue = await categorySelect.inputValue();
    }
    const usualPaymentSelect = dialog.getByLabel('Medio de pago habitual');
    if ((await usualPaymentSelect.locator('option').count()) > 1) {
      await usualPaymentSelect.selectOption({ index: 1 });
    }
    await dialog.getByLabel('Observaciones').fill('ALTA AUTOMÁTICA DE PLAYWRIGHT');
    await reminderCheckbox.uncheck();
    await dialog.getByRole('button', { name: 'Crear socio' }).click();
    await expectToast(page, 'Registro creado correctamente.');

    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(`  ${person.nombre.toLowerCase()} ,  ${person.apellido.toLowerCase()}  `);
    await expect(tableRow(page, 'Listado de socios', person.dni)).toBeVisible();
    await search.fill(person.dni);
    let row = tableRow(page, 'Listado de socios', person.dni);
    await expect(row).toContainText(`${person.apellido}, ${person.nombre}`);
    await expect(row).toContainText('SIN AVISO');

    if (selectedCategoryValue) {
      const categoryFilter = page.getByLabel('Categoría');
      await categoryFilter.selectOption(selectedCategoryValue);
      await expect(tableRow(page, 'Listado de socios', person.dni)).toBeVisible();
      await categoryFilter.selectOption('');
    }

    await row.getByTitle('Ver ficha e historial').click();
    let infoDialog = page.getByRole('dialog', { name: 'Información del Socio' });
    await expect(infoDialog).toContainText(person.dni);
    await infoDialog.getByRole('tab', { name: 'Contacto' }).click();
    await expect(infoDialog).toContainText(person.email);
    await expect(infoDialog).toContainText('SEDE ALTERNATIVA PLAYWRIGHT');
    await infoDialog.getByRole('tab', { name: 'Estados' }).click();
    await expect(infoDialog).toContainText(/ALTA|ACTIVO/i);
    await infoDialog.getByRole('tab', { name: 'Estado de pagos' }).click();
    await expect(infoDialog.getByText(/Meses —/)).toBeVisible();
    await infoDialog.getByRole('button', { name: 'Cerrar' }).click();

    row = tableRow(page, 'Listado de socios', person.dni);
    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar socio' });
    await dialog.getByLabel('Nombre *').fill(person.nombreEditado);
    await dialog.getByRole('tab', { name: 'Contacto y membresía' }).click();
    const editReminderCheckbox = dialog.getByRole('checkbox', { name: /Enviar recordatorios/i });
    const editPhoneInput = dialog.getByRole('textbox', { name: 'Teléfono', exact: true });
    await editPhoneInput.fill(`0${person.telefono.slice(0, 3)} 15 ${person.telefono.slice(3)}`);
    await editPhoneInput.blur();
    await expect(editPhoneInput).toHaveValue(person.telefono);
    await expect(editReminderCheckbox).toBeEnabled();
    await editReminderCheckbox.check();
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectToast(page, 'Registro actualizado correctamente.');

    row = tableRow(page, 'Listado de socios', person.dni);
    await expect(row).toContainText(person.nombreEditado);
    await expect(row).toContainText('WHATSAPP');

    await row.getByTitle('Dar de baja').click();
    let stateDialog = page.getByRole('dialog').filter({ hasText: /Dar de baja.*socio/i });
    await stateDialog.getByRole('button', { name: 'Dar de baja' }).click();
    await expectToast(page, 'Tenés que completar el motivo para continuar.');
    await dismissPersistentToast(page);
    await stateDialog.getByLabel('Motivo de baja *').fill('PRUEBA DE BAJA AUTOMÁTICA');
    await stateDialog.getByLabel('Fecha de baja *').fill(todayIso());
    await stateDialog.getByRole('button', { name: 'Dar de baja' }).click();
    await expectToast(page, 'Registro dado de baja correctamente.');

    await page.getByRole('tab', { name: 'Bajas' }).click();
    row = tableRow(page, 'Listado de socios', person.dni);
    await expect(row).toBeVisible();
    await row.getByTitle('Reactivar').click();
    stateDialog = page.getByRole('dialog').filter({ hasText: /Reactivar socio/i });
    await stateDialog.getByRole('button', { name: 'Reactivar' }).click();
    await expectToast(page, 'Registro reactivado correctamente.');

    await page.getByRole('tab', { name: 'Activos' }).click();
    row = tableRow(page, 'Listado de socios', person.dni);
    await permanentDeleteCurrentPartner(page, row);
    await expect(tableRow(page, 'Listado de socios', person.dni)).toHaveCount(0);
  });

  test('cubre el ciclo completo de una empresa', async ({ page, request }) => {
    await cleanupSocioByDocument(request, { tipo: 'EMPRESA', documento: company.cuit });

    await page.goto('/socios/empresas');
    await expect(page.getByRole('heading', { name: 'Empresas' })).toBeVisible();
    await page.getByRole('tab', { name: 'Activos' }).click();
    await page.getByRole('button', { name: 'Nueva empresa' }).click();

    let dialog = page.getByRole('dialog', { name: 'Nueva empresa' });
    await dialog.getByRole('button', { name: 'Crear empresa' }).click();
    await expectToast(page, /Completá la razón social y la fecha de alta/i);

    await dialog.getByLabel('Razón social *').fill(company.razonSocial);
    await dialog.getByLabel('CUIT').fill(company.cuit);
    const iva = dialog.getByLabel('Condición de IVA');
    if ((await iva.locator('option').count()) > 1) {
      await iva.selectOption({ index: 1 });
    }
    await dialog.getByRole('tab', { name: 'Contacto y membresía' }).click();
    await dialog.getByRole('textbox', { name: 'Domicilio', exact: true }).fill('AVENIDA E2E 456');
    await dialog.getByRole('textbox', { name: 'Teléfono', exact: true }).fill(company.telefono);
    await dialog.getByLabel('Correo').fill(company.email);
    await dialog.getByRole('button', { name: 'Crear empresa' }).click();
    await expectToast(page, 'Registro creado correctamente.');

    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(`${company.suffix.toLowerCase()}, empresa`);
    await expect(tableRow(page, 'Listado de empresas', company.cuit)).toBeVisible();
    await search.fill(company.cuit);
    let row = tableRow(page, 'Listado de empresas', company.cuit);
    await expect(row).toContainText(company.razonSocial);

    await row.getByTitle('Ver ficha e historial').click();
    const infoDialog = page.getByRole('dialog', { name: 'Información de la Empresa' });
    await expect(infoDialog).toContainText(company.cuit);
    await infoDialog.getByRole('tab', { name: 'Contacto' }).click();
    await expect(infoDialog).toContainText(company.email);
    await infoDialog.getByRole('button', { name: 'Cerrar' }).click();

    row = tableRow(page, 'Listado de empresas', company.cuit);
    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar empresa' });
    await dialog.getByLabel('Razón social *').fill(company.razonSocialEditada);
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectToast(page, 'Registro actualizado correctamente.');

    row = tableRow(page, 'Listado de empresas', company.cuit);
    await expect(row).toContainText(company.razonSocialEditada);
    await row.getByTitle('Dar de baja').click();
    let stateDialog = page.getByRole('dialog').filter({ hasText: /Dar de baja.*empresa/i });
    await stateDialog.getByLabel('Motivo de baja *').fill('BAJA E2E DE EMPRESA');
    await stateDialog.getByRole('button', { name: 'Dar de baja' }).click();
    await expectToast(page, 'Registro dado de baja correctamente.');

    await page.getByRole('tab', { name: 'Bajas' }).click();
    row = tableRow(page, 'Listado de empresas', company.cuit);
    await row.getByTitle('Reactivar').click();
    stateDialog = page.getByRole('dialog').filter({ hasText: /Reactivar empresa/i });
    await stateDialog.getByRole('button', { name: 'Reactivar' }).click();
    await expectToast(page, 'Registro reactivado correctamente.');

    await page.getByRole('tab', { name: 'Activos' }).click();
    row = tableRow(page, 'Listado de empresas', company.cuit);
    await permanentDeleteCurrentPartner(page, row);
    await expect(tableRow(page, 'Listado de empresas', company.cuit)).toHaveCount(0);
  });

  test('cubre el ciclo completo y elimina una familia sin borrar sus socios', async ({ page, request }) => {
    cleanupFamilyByPrefix(family.prefix);
    await cleanupSocioByDocument(request, {
      tipo: 'PERSONA',
      documento: familyMember.dni,
    });
    await cleanupSocioByDocument(request, {
      tipo: 'PERSONA',
      documento: familyMemberRemoved.dni,
    });
    await cleanupSocioByDocument(request, {
      tipo: 'PERSONA',
      documento: familyMemberForDelete.dni,
    });

    const createdMemberResponse = await apiCall(request, 'socios_guardar', {
      method: 'POST',
      data: {
        tipo_socio: 'PERSONA',
        apellido: familyMember.apellido,
        nombre: familyMember.nombre,
        dni: familyMember.dni,
        fecha_alta: todayIso(),
        telefono: familyMember.telefono,
        email: familyMember.email,
        id_categoria: null,
        id_medio_pago: null,
        id_condicion_iva: null,
        enviar_recordatorio: true,
        observaciones: 'INTEGRANTE PARA PRUEBA DE FAMILIAS',
      },
    });

    const removedMemberResponse = await apiCall(request, 'socios_guardar', {
      method: 'POST',
      data: {
        tipo_socio: 'PERSONA',
        apellido: familyMemberRemoved.apellido,
        nombre: familyMemberRemoved.nombre,
        dni: familyMemberRemoved.dni,
        fecha_alta: todayIso(),
        telefono: familyMemberRemoved.telefono,
        email: familyMemberRemoved.email,
        id_categoria: null,
        id_medio_pago: null,
        id_condicion_iva: null,
        enviar_recordatorio: true,
        observaciones: 'INTEGRANTE PARA DESVINCULACIÓN E2E',
      },
    });

    const deleteMemberResponse = await apiCall(request, 'socios_guardar', {
      method: 'POST',
      data: {
        tipo_socio: 'PERSONA',
        apellido: familyMemberForDelete.apellido,
        nombre: familyMemberForDelete.nombre,
        dni: familyMemberForDelete.dni,
        fecha_alta: todayIso(),
        telefono: familyMemberForDelete.telefono,
        email: familyMemberForDelete.email,
        id_categoria: null,
        id_medio_pago: null,
        id_condicion_iva: null,
        enviar_recordatorio: true,
        observaciones: 'INTEGRANTE PARA ELIMINACIÓN DEFINITIVA E2E',
      },
    });

    await page.goto('/socios/familias');
    await page.getByRole('tab', { name: 'Activas' }).click();
    await expect(page.getByRole('heading', { name: 'Familias' })).toBeVisible();
    await page.getByRole('button', { name: 'Nueva familia' }).click();

    let dialog = page.getByRole('dialog', { name: 'Nueva familia' });
    await dialog.getByRole('button', { name: 'Crear familia' }).click();
    await expectToast(page, 'Completá el nombre de la familia.');
    await dismissPersistentToast(page);
    await dialog.getByLabel('Nombre de la familia *').fill(family.nombre);
    await dialog.getByLabel('Descripción').fill(family.descripcion);
    await dialog.getByRole('button', { name: 'Crear familia' }).click();
    await expectToast(page, 'Seleccioná al menos un integrante para la familia.');
    await dismissPersistentToast(page);

    await expect(dialog.getByRole('tab', { name: 'Integrantes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const memberSearch = dialog.getByLabel('Buscar socio por nombre, DNI o categoría');
    await memberSearch.fill(
      `  ${familyMember.nombre.toLowerCase()} ${familyMember.apellido.toLowerCase()}  `,
    );
    const memberCheckbox = dialog.getByRole('checkbox', {
      name: new RegExp(familyMember.apellido, 'i'),
    });
    await expect(memberCheckbox).toBeVisible();
    await memberSearch.fill(familyMember.dni);
    await memberCheckbox.check();
    await dialog.getByRole('button', { name: /Agregar miembros \(1\)/ }).click();
    const selectedMember = dialog.locator('.familias-selected-member').filter({
      hasText: familyMember.apellido,
    });
    await expect(selectedMember).toBeVisible();
    await selectedMember.getByRole('radio', { name: 'Titular' }).check();
    await selectedMember.getByPlaceholder('Parentesco').fill('TITULAR');
    await selectedMember.getByPlaceholder('Observaciones').fill('VÍNCULO E2E');
    await dialog.getByRole('button', { name: 'Crear familia' }).click();
    await expectToast(page, 'Familia creada correctamente.');

    const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
    await search.fill(
      `${family.textSuffix.toLowerCase()}, ${familyMember.apellido.toLowerCase()}`,
    );
    await expect(tableRow(page, 'Listado de familias', family.nombre)).toBeVisible();
    await search.fill(family.prefix);
    let row = tableRow(page, 'Listado de familias', family.prefix);
    await expect(row).toContainText(familyMember.apellido);
    await expect(row.getByTitle('Dar de baja')).toBeVisible();

    await row.getByTitle('Ver integrantes e historial').click();
    let infoDialog = page.getByRole('dialog', { name: 'Ficha de la familia' });
    await expect(infoDialog).toContainText(familyMember.apellido);
    await infoDialog.getByRole('tab', { name: 'Historial' }).click();
    await expect(infoDialog).toContainText(familyMember.apellido);
    await infoDialog.getByRole('button', { name: 'Cerrar' }).click();

    row = tableRow(page, 'Listado de familias', family.prefix);
    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar familia' });
    await dialog.getByLabel('Nombre de la familia *').fill(family.nombreEditado);
    await dialog.getByLabel('Descripción').fill(`${family.descripcion} EDITADA`);
    await dialog.getByRole('tab', { name: 'Integrantes' }).click();
    await dialog
      .getByLabel('Buscar socio por nombre, DNI o categoría')
      .fill(familyMemberRemoved.dni);
    await dialog.getByRole('checkbox', {
      name: new RegExp(familyMemberRemoved.apellido, 'i'),
    }).check();
    await dialog.getByRole('button', { name: /Agregar miembros \(1\)/ }).click();
    await expect(dialog.locator('.familias-selected-member').filter({
      hasText: familyMemberRemoved.apellido,
    })).toBeVisible();
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectToast(page, 'Familia actualizada correctamente.');

    await search.fill(family.nombreEditado);
    row = tableRow(page, 'Listado de familias', family.nombreEditado);
    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar familia' });
    await dialog.getByRole('tab', { name: 'Integrantes' }).click();
    const removedMember = dialog.locator('.familias-selected-member').filter({
      hasText: familyMemberRemoved.apellido,
    });
    await removedMember.getByTitle('Quitar integrante').click();
    await expect(dialog).toContainText('1 integrante será desvinculado');
    await dialog.getByLabel('Motivo de desvinculación *').fill('DESVINCULACIÓN AUTOMÁTICA E2E');
    await dialog.getByLabel('Fecha de desvinculación *').fill(todayIso());
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectToast(page, 'Familia actualizada correctamente.');

    row = tableRow(page, 'Listado de familias', family.nombreEditado);
    await row.getByTitle('Ver integrantes e historial').click();
    infoDialog = page.getByRole('dialog', { name: 'Ficha de la familia' });
    await infoDialog.getByRole('tab', { name: 'Historial' }).click();
    await expect(infoDialog).toContainText(familyMemberRemoved.apellido);
    await expect(infoDialog).toContainText(/DESVINCULACIÓN AUTOMÁTICA E2E/i);
    await infoDialog.getByRole('button', { name: 'Cerrar' }).click();

    await search.fill(family.nombreEditado);
    row = tableRow(page, 'Listado de familias', family.nombreEditado);
    await row.getByTitle('Dar de baja').click();
    let stateDialog = page.getByRole('dialog', { name: 'Dar de baja la familia' });
    await stateDialog.getByLabel('Motivo de baja *').fill('BAJA AUTOMÁTICA DE FAMILIA');
    await stateDialog.getByLabel('Fecha de baja *').fill(todayIso());
    await stateDialog.getByRole('button', { name: 'Dar de baja' }).click();
    await expectToast(page, 'Familia dada de baja correctamente.');

    await page.getByRole('tab', { name: 'Bajas' }).click();
    row = tableRow(page, 'Listado de familias', family.nombreEditado);
    await expect(row.getByTitle('Reactivar')).toBeVisible();
    await row.getByTitle('Reactivar').click();
    stateDialog = page.getByRole('dialog', { name: 'Reactivar familia' });
    await stateDialog.getByRole('button', { name: 'Reactivar' }).click();
    await expectToast(page, 'Familia reactivada correctamente.');

    await page.getByRole('tab', { name: 'Activas' }).click();
    row = tableRow(page, 'Listado de familias', family.nombreEditado);
    await expect(row).toBeVisible();
    await expect(row.getByTitle('Dar de baja')).toBeVisible();

    // La reactivación no restaura vínculos cerrados. Se incorpora un tercer socio,
    // sin vínculo histórico con esta familia, para probar el borrado con miembros.
    await row.getByTitle('Editar').click();
    dialog = page.getByRole('dialog', { name: 'Editar familia' });
    await dialog.getByRole('tab', { name: 'Integrantes' }).click();
    await dialog
      .getByLabel('Buscar socio por nombre, DNI o categoría')
      .fill(familyMemberForDelete.dni);
    await dialog
      .getByRole('checkbox', { name: new RegExp(familyMemberForDelete.apellido, 'i') })
      .check();
    await dialog.getByRole('button', { name: /Agregar miembros \(1\)/ }).click();
    const readdedMember = dialog.locator('.familias-selected-member').filter({
      hasText: familyMemberForDelete.apellido,
    });
    await readdedMember.getByRole('radio', { name: 'Titular' }).check();
    await readdedMember.getByPlaceholder('Parentesco').fill('TITULAR');
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expectToast(page, 'Familia actualizada correctamente.');

    row = tableRow(page, 'Listado de familias', family.nombreEditado);
    await expect(row).toContainText(familyMemberForDelete.apellido);

    const familiesBeforeDelete = await apiCall(request, 'familias_listar', {
      params: { estado: 'activo', buscar: family.nombreEditado },
    });
    const familyBeforeDelete = (familiesBeforeDelete.items || []).find(
      (item) => item.nombre === family.nombreEditado,
    );
    expect(familyBeforeDelete).toBeTruthy();

    await row.getByTitle('Eliminar definitivamente la familia').click();
    const deleteDialog = page.getByRole('dialog', {
      name: 'Eliminar definitivamente la familia',
    });
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog).toContainText(
      'Esta operación es irreversible, pero no eliminará ningún socio ni sus pagos.',
    );
    await expect(deleteDialog).toContainText('Socios que quedarán sin familia');
    await expect(deleteDialog).toContainText('Vínculos familiares que se borrarán');
    await expect(deleteDialog).toContainText('SE CONSERVAN');
    await expect(
      deleteDialog.locator('.gdel-row').filter({
        hasText: 'Socios que quedarán sin familia',
      }),
    ).toContainText('1');
    await expect(
      deleteDialog.locator('.gdel-row').filter({
        hasText: 'Vínculos familiares que se borrarán',
      }),
    ).toContainText('3');
    await expect(
      deleteDialog.getByRole('button', { name: 'Eliminar definitivamente' }),
    ).toBeEnabled();
    await deleteDialog
      .getByRole('button', { name: 'Eliminar definitivamente' })
      .click();
    await expectToast(
      page,
      'La familia fue eliminada definitivamente. Sus socios quedaron sin familia.',
    );
    await expect(tableRow(page, 'Listado de familias', family.nombreEditado)).toHaveCount(0);

    await expectApiError(
      request,
      'familias_obtener',
      { params: { id: familyBeforeDelete.id_familia } },
      { status: 404, code: 'FAMILIA_NO_ENCONTRADA' },
    );

    for (const created of [
      createdMemberResponse.item,
      removedMemberResponse.item,
      deleteMemberResponse.item,
    ]) {
      const partner = await apiCall(request, 'socios_obtener', {
        params: { id: created.id_socio },
      });
      expect(partner.item.id_socio).toBe(created.id_socio);
      expect(partner.item.id_familia).toBeNull();
      expect(partner.item.familia).toBeNull();
    }

    cleanupFamilyByPrefix(family.prefix);
    await cleanupSocioByDocument(request, {
      tipo: 'PERSONA',
      documento: familyMember.dni,
    });
    await cleanupSocioByDocument(request, {
      tipo: 'PERSONA',
      documento: familyMemberRemoved.dni,
    });
    await cleanupSocioByDocument(request, {
      tipo: 'PERSONA',
      documento: familyMemberForDelete.dni,
    });
  });
});
