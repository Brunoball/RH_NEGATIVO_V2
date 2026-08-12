const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, expectApiError } = require('./helpers/api.helper');
const { expectFeedback } = require('./helpers/auth.helper');
const { exportFromGlobalModal } = require('./helpers/download.helper');
const { todayIso } = require('./helpers/data.helper');
const {
  createSocio,
  socioCatalogs,
} = require('./helpers/entities.helper');
const { familyData, socioData } = require('./fixtures/socios.fixture');

function rowByText(page, text) {
  return page.getByRole('row').filter({ hasText: text }).last();
}

async function fillSocioForm(dialog, data, catalogs, { birthday = false } = {}) {
  await dialog.getByLabel('Nombre completo *').fill(data.nombre);
  await dialog.getByLabel('DNI').fill(data.dni);
  await dialog.getByLabel('Fecha de nacimiento').fill(birthday ? '2008-01-01' : '1999-05-15');
  await dialog.getByLabel('Domicilio', { exact: true }).fill('CALLE PLAYWRIGHT');
  await dialog.getByLabel('Número').fill('123');
  await dialog.getByLabel('Teléfono móvil').fill(data.movil);
  await dialog.getByLabel('Teléfono fijo').fill(data.fijo);
  await dialog.getByLabel('Domicilio de cobro').fill('DOMICILIO COBRO PLAYWRIGHT');

  const isActive = (item) => item?.activo === true || Number(item?.activo) === 1;
  const blood = (catalogs.grupos_sanguineos || []).find(isActive);
  if (blood) await dialog.getByLabel('Grupo sanguíneo').selectOption(String(blood.id_grupo_sanguineo));

  await dialog.getByRole('tab', { name: 'Gestión' }).click();
  const state = (catalogs.estados || []).find(isActive);
  const category = (catalogs.categorias || []).find(isActive);
  const collector = (catalogs.cobradores || []).find(isActive);
  if (!category || !collector) throw new Error('Falta una categoría o cobrador activo para probar Socios.');
  if (state) await dialog.getByLabel('Estado').selectOption(String(state.id_estado));
  await dialog.getByLabel('Categoría *').selectOption(String(category.id_categoria));
  await dialog.getByLabel('Cobrador *').selectOption(String(collector.id_cobrador));
  await dialog.getByLabel('Fecha de ingreso').fill(todayIso());
  await dialog.getByLabel('Observaciones').fill(data.observaciones);
}

async function findBirthdayCardFor(page, name) {
  const card = page.getByLabel('Socios para contactar de 18 a 23 años');
  if (!(await card.isVisible().catch(() => false))) return null;
  const counter = await card.locator('.socios-birthdayCard__counter').textContent();
  const total = Number(String(counter || '1/1').split('/')[1] || 1);
  for (let i = 0; i < total; i += 1) {
    const current = (await card.locator('.socios-birthdayCard__name').textContent())?.trim();
    if (current === name) return card;
    const next = card.locator('.socios-birthdayCard__nav').last();
    if (!(await next.isEnabled().catch(() => false))) break;
    await next.click();
  }
  return null;
}

test.describe('Socios', () => {
  test('cubre alta, validaciones, filtros, cumpleaños, ficha, contactos, edición, baja y reactivación', async ({ page, request }) => {
    const data = socioData('PRINCIPAL');
    const { catalogs } = await socioCatalogs(request);
    let createdId = null;

    await page.goto('/socios/personas');
      await expect(page.getByRole('heading', { name: 'Socios' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Vigentes' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Bajas' })).toBeVisible();

      await page.getByRole('button', { name: 'Nuevo socio' }).click();
      let dialog = page.getByRole('dialog', { name: 'Nuevo socio' });
      await expect(dialog).toBeVisible();

      // Los campos required usan validación nativa del navegador.
      // Antes se esperaba un toast que nunca podía ejecutarse porque el submit
      // queda bloqueado por HTML5 antes de entrar al handler de React.
      const validationName = dialog.getByLabel('Nombre completo *');
      await validationName.fill('');
      await dialog.getByRole('button', { name: 'Crear socio' }).click();
      expect(await validationName.evaluate((element) => element.checkValidity())).toBe(false);

      await validationName.fill('PW E2E SOCIO VALIDACION');
      await dialog.getByRole('tab', { name: 'Gestión' }).click();
      const validationCategory = dialog.getByLabel('Categoría *');
      const validationCollector = dialog.getByLabel('Cobrador *');
      const activeCategory = (catalogs.categorias || []).find((item) => item?.activo === true || Number(item?.activo) === 1);
      const activeCollector = (catalogs.cobradores || []).find((item) => item?.activo === true || Number(item?.activo) === 1);
      if (!activeCategory || !activeCollector) throw new Error('Falta una categoría o cobrador activo para validar el formulario.');

      await validationCategory.selectOption('');
      await dialog.getByRole('button', { name: 'Crear socio' }).click();
      expect(await validationCategory.evaluate((element) => element.checkValidity())).toBe(false);
      await validationCategory.selectOption(String(activeCategory.id_categoria));

      await validationCollector.selectOption('');
      await dialog.getByRole('button', { name: 'Crear socio' }).click();
      expect(await validationCollector.evaluate((element) => element.checkValidity())).toBe(false);
      await validationCollector.selectOption(String(activeCollector.id_cobrador));

      // Reabre para probar el alta desde los defaults reales del formulario.
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await page.getByRole('button', { name: 'Nuevo socio' }).click();
      dialog = page.getByRole('dialog', { name: 'Nuevo socio' });
      await fillSocioForm(dialog, data, catalogs, { birthday: true });
      await dialog.getByRole('button', { name: 'Crear socio' }).click();
      await expectFeedback(page, 'Socio creado correctamente.');

      const found = await apiCall(request, 'socios_listar', {
        params: { vigente: 'VIGENTE', buscar: data.dni, pagina: 1 },
      });
      const created = (found.items || []).find((item) => item.dni === data.dni);
      expect(created).toBeTruthy();
      createdId = created.id_socio;

      const search = page.getByLabel('Buscar socio');
      await search.fill(data.dni);
      let row = rowByText(page, data.nombre);
      await expect(row).toContainText(data.dni);

      // Filtro principal por categoría, sin modificar ninguna categoría real.
      await page.getByLabel('Categoría').selectOption(String(created.id_categoria));
      await expect(rowByText(page, data.nombre)).toBeVisible();

      // Todos los grupos del selector avanzado se abren y se ejercitan.
      const filterButton = page.getByRole('button', { name: /Aplicar Filtros/ });
      await filterButton.click();
      await page.getByRole('button', { name: 'Filtrar de la A a la Z' }).click();
      const firstLetter = data.nombre.charAt(0).toUpperCase();
      const letterButton = page.locator('.socios-letterGrid').getByRole('button', { name: firstLetter, exact: true });
      await letterButton.click();
      await letterButton.click();

      await page.getByRole('button', { name: 'Tipo de sangre' }).click();
      if (created.grupo_sanguineo) {
        const bloodChoice = page.locator('.socios-filterChoices').getByRole('button', { name: created.grupo_sanguineo, exact: true });
        await bloodChoice.click();
        await bloodChoice.click();
      }

      await page.getByRole('button', { name: 'Estado' }).click();
      if (created.estado) {
        const stateChoice = page.locator('.socios-filterChoices').getByRole('button', { name: created.estado, exact: true });
        await stateChoice.click();
        await stateChoice.click();
      }

      await page.getByRole('button', { name: 'Deudas / pagos' }).click();
      const debtChoice = page.locator('.socios-filterChoices').getByRole('button', { name: /Al día|Debe 1 o 2 meses|Debe 3 meses o más/ }).first();
      await debtChoice.click();
      await debtChoice.click();

      await page.getByRole('button', { name: 'Último contacto' }).click();
      const noContact = page.locator('.socios-filterChoices').getByRole('button', { name: 'Sin gestión', exact: true });
      await noContact.click();
      await noContact.click();

      await page.getByRole('button', { name: 'Fecha de ingreso' }).click();
      const dateSection = page.locator('.socios-dateFilter');
      await dateSection.getByLabel(/Desde/).fill(todayIso());
      await dateSection.getByLabel(/Hasta/).fill(todayIso());
      await dateSection.getByRole('button', { name: 'Limpiar' }).click();
      await dateSection.getByRole('button', { name: 'Aplicar' }).click();

      await filterButton.click();
      await page.getByRole('button', { name: 'Mostrar Todos' }).click();
      await search.fill(data.dni);

      // Tarjeta 18-23: sólo actúa cuando la tarjeta visible corresponde al socio E2E.
      const card = await findBirthdayCardFor(page, data.nombre);
      if (card) {
        await card.getByRole('button', { name: 'Ver socio' }).click();
        let info = page.getByRole('dialog', { name: 'Información del socio' });
        await expect(info).toContainText(data.nombre);
        await page.keyboard.press('Escape');
        await expect(info).toBeHidden();

        const sameCard = await findBirthdayCardFor(page, data.nombre);
        if (sameCard) {
          await sameCard.getByTitle('Marcar aviso como gestionado este año').click();
          await expectFeedback(page, 'Aviso marcado como gestionado para este año.');
        }
      } else {
        // Si el backend alcanzó el límite de 100 avisos reales, se cubre la misma acción
        // por API exclusivamente sobre el ID E2E, sin tocar avisos de socios reales.
        await apiCall(request, 'socios_cumpleanios_cerrar', {
          method: 'POST', data: { id: createdId },
        });
      }

      // Ficha y las cuatro pestañas.
      row = rowByText(page, data.nombre);
      await row.getByTitle('Ver ficha, contactos, pagos e historial').click();
      let info = page.getByRole('dialog', { name: 'Información del socio' });
      await expect(info).toContainText(data.nombre);
      await info.getByRole('tab', { name: 'Contactos' }).click();
      await info.getByLabel('Resultado *').selectOption('PENDIENTE');
      await info.getByLabel('Detalle').fill('PW E2E CONTACTO PENDIENTE');
      await info.getByRole('button', { name: 'Registrar gestión' }).click();
      await expectFeedback(page, 'Gestión de contacto registrada correctamente.');
      await expect(info).toContainText('PENDIENTE');
      await info.getByRole('tab', { name: 'Pagos' }).click();
      await info.getByRole('tab', { name: 'Historial' }).click();
      await expect(info).toContainText(/ALTA|MOVIMIENTO/);
      await info.getByRole('tab', { name: 'General' }).click();
      await page.keyboard.press('Escape');

      // Edición completa conservando el prefijo E2E.
      row = rowByText(page, data.nombre);
      await row.getByTitle('Editar socio').click();
      dialog = page.getByRole('dialog', { name: 'Editar socio' });
      await dialog.getByLabel('Nombre completo *').fill(data.nombreEditado);
      await dialog.getByLabel('Teléfono móvil').fill(`351${data.dni}`.slice(0, 10));
      await dialog.getByRole('tab', { name: 'Gestión' }).click();
      await dialog.getByLabel('Observaciones').fill(`${data.observaciones} EDITADO`);
      await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
      await expectFeedback(page, 'Socio actualizado correctamente.');
      await search.fill(data.dni);
      row = rowByText(page, data.nombreEditado);
      await expect(row).toBeVisible();

      // Baja: cancelar primero, luego confirmar con motivo. Reactivación idem.
      await row.getByTitle('Dar de baja').click();
      let stateDialog = page.getByRole('dialog', { name: 'Dar de baja al socio' });
      await stateDialog.getByRole('button', { name: 'Cancelar' }).click();
      await row.getByTitle('Dar de baja').click();
      stateDialog = page.getByRole('dialog', { name: 'Dar de baja al socio' });
      await stateDialog.getByLabel('Motivo de baja *').fill('PW E2E BAJA CONTROLADA');
      await stateDialog.getByRole('button', { name: 'Dar de baja', exact: true }).click();
      await expectFeedback(page, 'Socio dado de baja correctamente.');

      await page.getByRole('tab', { name: 'Bajas' }).click();
      await search.fill(data.dni);
      row = rowByText(page, data.nombreEditado);
      await row.getByTitle('Reactivar').click();
      stateDialog = page.getByRole('dialog', { name: 'Reactivar socio' });
      await stateDialog.getByRole('button', { name: 'Reactivar', exact: true }).click();
      await expectFeedback(page, 'Socio reactivado correctamente.');

      await page.getByRole('tab', { name: 'Vigentes' }).click();
      await search.fill(data.dni);
      row = rowByText(page, data.nombreEditado);

      // Contratos negativos de API que no crean registros extra.
      await expectApiError(request, 'socios_guardar', {
        method: 'POST',
        data: {
          nombre: '',
          id_categoria: created.id_categoria,
          id_cobrador: created.id_cobrador,
        },
      }, { status: 422, code: 'VALIDATION_ERROR' });
      await expectApiError(request, 'socios_guardar', {
        method: 'POST',
        data: {
          nombre: 'PW E2E SOCIO DUPLICADO',
          dni: data.dni,
          id_categoria: created.id_categoria,
          id_cobrador: created.id_cobrador,
          fecha_ingreso: todayIso(),
        },
      }, { status: 409, code: 'DNI_DUPLICADO' });
      // Política RH V2: los socios reales nunca se borran físicamente.
      // La UI no debe ofrecer esa acción y el backend la rechaza aunque se invoque directo.
      await expect(row.getByTitle('Eliminar definitivamente')).toHaveCount(0);
      await expectApiError(request, 'socios_eliminar_definitivo', {
        method: 'POST', data: { id: createdId, confirmacion: 'ELIMINAR' },
      }, { status: 405, code: 'ELIMINACION_FISICA_NO_PERMITIDA' });
  });

  test('exporta únicamente la vista filtrada del socio E2E en Excel y PDF', async ({ page, request }) => {
    const data = socioData('EXPORT');
    const created = await createSocio(request, data);
    await page.goto('/socios/personas');
      await page.getByLabel('Buscar socio').fill(data.dni);
      await expect(rowByText(page, data.nombre)).toBeVisible();

      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar' }),
        format: 'Excel',
        scope: 'registros visibles|esta página',
        expectedExtension: '.xlsx',
      });
      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar' }),
        format: 'PDF',
        scope: 'registros visibles|esta página',
        expectedExtension: '.pdf',
      });
  });

  test('Familias: alta, integrantes, edición/desvinculación, ficha, exportación, baja, reactivación y eliminación sin borrar socios', async ({ page, request }) => {
    const firstData = socioData('FAMILIA A');
    const secondData = socioData('FAMILIA B');
    const family = familyData();
    const first = await createSocio(request, firstData);
    const second = await createSocio(request, secondData);
    let familyId = null;

    await page.goto('/socios/familias');
      await expect(page.getByRole('heading', { name: 'Familias' })).toBeVisible();
      await page.getByRole('button', { name: 'Nueva familia' }).click();
      let dialog = page.getByRole('dialog', { name: 'Nueva familia' });
      await dialog.getByLabel('Nombre de la familia *').fill(family.nombre);
      await dialog.getByLabel('Observaciones').fill(family.descripcion);
      await dialog.getByRole('tab', { name: 'Integrantes' }).click();

      const memberSearch = dialog.getByLabel('Buscar socio por nombre, DNI o categoría');
      for (const member of [firstData, secondData]) {
        await memberSearch.fill(member.dni);
        const option = dialog.locator('label.familias-modal__member').filter({ hasText: member.nombre });
        await expect(option).toBeVisible();
        await option.getByRole('checkbox').check();
        await dialog.getByRole('button', { name: /Agregar miembros/ }).click();
      }
      await expect(dialog.getByText(firstData.nombre, { exact: true }).last()).toBeVisible();
      await expect(dialog.getByText(secondData.nombre, { exact: true }).last()).toBeVisible();
      await dialog.getByRole('button', { name: 'Crear familia' }).click();
      await expectFeedback(page, 'Familia creada correctamente.');

      const familyList = await apiCall(request, 'familias_listar', {
        params: { estado: 'activo', buscar: family.nombre },
      });
      const created = (familyList.items || []).find((item) => item.nombre === family.nombre);
      expect(created).toBeTruthy();
      familyId = created.id_familia;

      const search = page.getByRole('textbox', { name: 'Búsqueda', exact: true });
      await search.fill(family.nombre);
      let row = rowByText(page, family.nombre);
      await expect(row).toContainText('2');

      // Ficha actual + historial.
      await row.getByTitle('Ver integrantes e historial').click();
      let info = page.getByRole('dialog', { name: 'Ficha de la familia' });
      await expect(info).toContainText(firstData.nombre);
      await expect(info).toContainText(secondData.nombre);
      await info.getByRole('tab', { name: 'Historial' }).click();
      await expect(info).toContainText('VÍNCULO ACTIVO');
      await page.keyboard.press('Escape');

      // Edita nombre y desvincula sólo al segundo socio.
      row = rowByText(page, family.nombre);
      await row.getByTitle('Editar').click();
      dialog = page.getByRole('dialog', { name: 'Editar familia' });
      await dialog.getByLabel('Nombre de la familia *').fill(family.nombreEditado);
      await dialog.getByRole('tab', { name: 'Integrantes' }).click();
      await dialog.getByRole('button', { name: `Quitar a ${secondData.nombre}` }).click();
      await expect(dialog.getByLabel('Fecha de desvinculación *')).toBeVisible();
      await dialog.getByLabel('Fecha de desvinculación *').fill(todayIso());
      await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
      await expectFeedback(page, 'Familia actualizada correctamente.');

      await search.fill(family.nombreEditado);
      row = rowByText(page, family.nombreEditado);
      await expect(row).toContainText('1');

      await row.getByTitle('Ver integrantes e historial').click();
      info = page.getByRole('dialog', { name: 'Ficha de la familia' });
      await expect(info).toContainText(firstData.nombre);
      await info.getByRole('tab', { name: 'Historial' }).click();
      await expect(info).toContainText(secondData.nombre);
      await expect(info).toContainText('VÍNCULO FINALIZADO');
      await page.keyboard.press('Escape');

      // Exportación familiar filtrada.
      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar' }),
        format: 'Excel',
        expectedExtension: '.xlsx',
      });

      // Baja y reactivación. La baja cierra los vínculos; no borra socios.
      row = rowByText(page, family.nombreEditado);
      await row.getByTitle('Dar de baja').click();
      let stateDialog = page.getByRole('dialog', { name: 'Dar de baja la familia' });
      await stateDialog.getByLabel('Motivo de baja *').fill('PW E2E BAJA FAMILIAR');
      await stateDialog.getByRole('button', { name: 'Dar de baja', exact: true }).click();
      await expectFeedback(page, 'Familia dada de baja correctamente.');

      await page.getByRole('tab', { name: 'Bajas' }).click();
      await search.fill(family.nombreEditado);
      row = rowByText(page, family.nombreEditado);
      await row.getByTitle('Reactivar').click();
      stateDialog = page.getByRole('dialog', { name: 'Reactivar familia' });
      await stateDialog.getByRole('button', { name: 'Reactivar', exact: true }).click();
      await expectFeedback(page, 'Familia reactivada correctamente.');

      await page.getByRole('tab', { name: 'Activas' }).click();
      await search.fill(family.nombreEditado);
      row = rowByText(page, family.nombreEditado);

      await expectApiError(request, 'familias_eliminar_definitivo', {
        method: 'POST', data: { id: familyId, confirmacion: 'NO' },
      }, { status: 422, code: 'CONFIRMACION_ELIMINACION_INVALIDA' });

      await row.getByTitle('Eliminar definitivamente la familia').click();
      let deleteDialog = page.getByRole('dialog', { name: 'Eliminar definitivamente la familia' });
      await expect(deleteDialog).toContainText('SE CONSERVAN');
      await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();
      await row.getByTitle('Eliminar definitivamente la familia').click();
      deleteDialog = page.getByRole('dialog', { name: 'Eliminar definitivamente la familia' });
      await deleteDialog.getByRole('button', { name: 'Eliminar definitivamente' }).click();
      await expectFeedback(page, 'La familia fue eliminada definitivamente.');
      familyId = null;

      // Garantía de seguridad funcional: los socios test siguen existiendo.
      const stillFirst = await apiCall(request, 'socios_obtener', { params: { id: first.id_socio } });
      const stillSecond = await apiCall(request, 'socios_obtener', { params: { id: second.id_socio } });
      expect(stillFirst.item.id_socio).toBe(first.id_socio);
      expect(stillSecond.item.id_socio).toBe(second.id_socio);
  });
});
