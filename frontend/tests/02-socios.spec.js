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

function splitFullName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return {
    nombre: parts.slice(0, -1).join(' ') || parts[0] || '',
    apellido: parts.length > 1 ? parts.at(-1) : 'PLAYWRIGHT',
  };
}

async function fillSocioForm(dialog, data, catalogs, { birthday = false } = {}) {
  const person = splitFullName(data.nombre);
  await dialog.getByLabel('Nombre *', { exact: true }).fill(person.nombre);
  await dialog.getByLabel('Apellido *', { exact: true }).fill(person.apellido);
  await dialog.getByLabel('DNI').fill(data.dni);
  await dialog.getByLabel('Fecha de nacimiento').fill(birthday ? '2008-01-01' : '1999-05-15');
  await dialog.getByLabel('Domicilio', { exact: true }).fill('CALLE PLAYWRIGHT');
  await dialog.getByRole('textbox', { name: 'Número', exact: true }).fill('123');
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

async function birthdayDrawer(page, { open = false } = {}) {
  const drawer = page.getByLabel('Socios para contactar de 18 a 23 años');
  if ((await drawer.count()) === 0) return null;

  if (open) {
    const openButton = drawer.getByRole('button', { name: 'Abrir avisos de cumpleaños' });
    if (await openButton.isVisible().catch(() => false)) {
      await openButton.click();
      await expect(drawer).toHaveClass(/\bis-open\b/);
    }
  }

  return drawer;
}

async function closeBirthdayDrawer(page) {
  // Este helper sólo evita que el drawer pueda tapar controles posteriores.
  // La acción funcional importante (marcar el aviso como gestionado) ya se
  // valida por API/feedback en el test. Tras esa acción React puede desmontar
  // el portal o reemplazar su contenido, por lo que no debemos conservar un
  // locator viejo ni exigir una clase CSS concreta.
  const closeButton = page.getByRole('button', {
    name: 'Cerrar avisos de cumpleaños',
    exact: true,
  });

  if ((await closeButton.count()) === 0) return;

  // Usamos un locator fresco y force porque el panel tiene una transición
  // lateral; el objetivo es ejecutar el handler real, no validar geometría CSS.
  await closeButton.first().click({ force: true }).catch(async () => {
    // Si React desmontó el portal entre count() y click(), ya está cerrado.
    if ((await closeButton.count()) > 0) {
      await closeButton.first().evaluate((element) => element.click()).catch(() => {});
    }
  });
}

async function findBirthdayCardFor(page, name) {
  const card = await birthdayDrawer(page, { open: true });
  if (!card) return null;

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
      const firstIdField = dialog.getByLabel('ID', { exact: true });
      await expect(firstIdField).toHaveAttribute('readonly', '');
      await expect(firstIdField).toHaveAttribute('title', 'ID reservado para el nuevo socio');
      const firstShownId = Number(await firstIdField.inputValue());
      expect(firstShownId).toBeGreaterThan(0);

      // Los campos required usan validación nativa del navegador.
      // Antes se esperaba un toast que nunca podía ejecutarse porque el submit
      // queda bloqueado por HTML5 antes de entrar al handler de React.
      const validationName = dialog.getByLabel('Nombre *', { exact: true });
      const validationLastName = dialog.getByLabel('Apellido *', { exact: true });
      await validationName.fill('');
      await validationLastName.fill('');
      await dialog.getByRole('button', { name: 'Crear socio' }).click();
      expect(await validationName.evaluate((element) => element.checkValidity())).toBe(false);

      await validationName.fill('PW EEE SOCIO');
      await dialog.getByRole('button', { name: 'Crear socio' }).click();
      expect(await validationLastName.evaluate((element) => element.checkValidity())).toBe(false);
      await validationLastName.fill('VALIDACION');
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

      // Alta: si se informa DNI, debe tener exactamente 8 números. La misma
      // regla que se aplica al editar debe impedir crear un socio inválido.
      // El DNI vive en la pestaña Datos personales; después de validar Gestión
      // volvemos a esa pestaña para interactuar con un control realmente visible.
      await dialog.getByRole('tab', { name: 'Datos personales' }).click();
      const validationDni = dialog.getByLabel('DNI');
      await validationDni.fill('1234567');
      await dialog.getByRole('button', { name: 'Crear socio' }).click();
      expect(await validationDni.evaluate((element) => element.checkValidity())).toBe(false);
      await expect(dialog).toBeVisible();
      await validationDni.fill('');

      // Cerrar con cambios no puede descartar silenciosamente el formulario.
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      let discardDialog = page.getByRole('dialog', { name: '¿Salir sin guardar?' });
      await expect(discardDialog).toBeVisible();
      await expect(discardDialog).toContainText('vas a perder todos los cambios');
      await discardDialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(discardDialog).toBeHidden();
      await expect(dialog).toBeVisible();
      await expect(validationName).toHaveValue('PW EEE SOCIO');
      await expect(validationLastName).toHaveValue('VALIDACION');

      // Confirmar la salida sí descarta el formulario y permite reabrir limpio.
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      discardDialog = page.getByRole('dialog', { name: '¿Salir sin guardar?' });
      await discardDialog.getByRole('button', { name: 'Sí, salir' }).click();
      await expect(dialog).toBeHidden();

      // Reabre para probar el alta desde los defaults reales del formulario.
      await page.getByRole('button', { name: 'Nuevo socio' }).click();
      dialog = page.getByRole('dialog', { name: 'Nuevo socio' });
      const createIdField = dialog.getByLabel('ID', { exact: true });
      await expect(createIdField).toHaveAttribute('readonly', '');
      await expect(createIdField).toHaveAttribute('title', 'ID reservado para el nuevo socio');
      const shownCreateId = Number(await createIdField.inputValue());
      expect(shownCreateId).toBeGreaterThan(0);
      await fillSocioForm(dialog, data, catalogs, { birthday: true });
      await dialog.getByRole('button', { name: 'Crear socio' }).click();
      await expectFeedback(page, 'Socio creado correctamente.');

      const found = await apiCall(request, 'socios_listar', {
        params: { vigente: 'VIGENTE', buscar: data.dni, pagina: 1 },
      });
      const created = (found.items || []).find((item) => item.dni === data.dni);
      expect(created).toBeTruthy();
      createdId = created.id_socio;
      expect(Number(createdId)).toBe(shownCreateId);

      const search = page.getByLabel('Socio', { exact: true });
      await search.fill(data.dni);
      let row = rowByText(page, data.nombre);
      // La grilla de Socios no muestra el DNI como columna: el DNI es un
      // criterio de búsqueda. Validamos que buscar por el DNI único deje
      // visible exactamente al socio creado, sin exigir texto que la UI no
      // está diseñada para renderizar en la fila.
      await expect(search).toHaveValue(data.dni);
      await expect(row).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: data.nombre })).toHaveCount(1);

      // El ID tiene un campo independiente y exacto. Buscar por ID no se
      // interpreta como DNI/domicilio/teléfono ni comparte estado con Socio.
      const idSearch = page.getByLabel('ID', { exact: true });
      await search.fill('');
      await idSearch.fill(String(createdId));
      await expect(rowByText(page, data.nombre)).toBeVisible();
      await expect(page.locator('.socios-table .global-divTable__row')).toHaveCount(1);
      await idSearch.fill('');
      await search.fill(data.dni);

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

      await page.getByRole('button', { name: 'Pagos', exact: true }).click();
      const debtChoice = page.locator('.socios-filterChoices').getByRole('button', { name: /Al día|Debe 1 o 2 meses|Debe 3 meses o más/ }).first();
      await debtChoice.click();
      await debtChoice.click();

      await page.getByRole('button', { name: 'Último contacto', exact: true }).click();
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
      await closeBirthdayDrawer(page);

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
      // El fondo no cierra la ficha; Cancelar sí. Escape ya se valida arriba.
      await page.locator('.entity-modal-overlay').click({ position: { x: 5, y: 5 } });
      await expect(info).toBeVisible();
      await info.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(info).toBeHidden();

      // Edición completa conservando el prefijo E2E.
      row = rowByText(page, data.nombre);
      await row.getByTitle('Editar socio').click();
      dialog = page.getByRole('dialog', { name: 'Editar socio' });
      const editIdField = dialog.getByLabel('ID', { exact: true });
      await expect(editIdField).toHaveAttribute('readonly', '');
      await expect(editIdField).toHaveAttribute('title', 'ID actual del socio');
      await expect(editIdField).toHaveValue(String(createdId));
      const editedPerson = splitFullName(data.nombreEditado);
      await dialog.getByLabel('Nombre *', { exact: true }).fill(editedPerson.nombre);
      await dialog.getByLabel('Apellido *', { exact: true }).fill(editedPerson.apellido);
      const editedMobile = `351${data.dni}`.slice(0, 10);
      await dialog.getByLabel('Teléfono móvil').fill(editedMobile);

      // Escape también debe pedir confirmación y Cancelar debe conservar todo.
      await page.keyboard.press('Escape');
      discardDialog = page.getByRole('dialog', { name: '¿Salir sin guardar?' });
      await expect(discardDialog).toBeVisible();
      await discardDialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Teléfono móvil')).toHaveValue(editedMobile);

      // La X usa la misma protección y tampoco debe perder los cambios.
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
      discardDialog = page.getByRole('dialog', { name: '¿Salir sin guardar?' });
      await expect(discardDialog).toBeVisible();
      await discardDialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialog.getByLabel('Teléfono móvil')).toHaveValue(editedMobile);

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
          nombre: 'PW EEE DNI INVALIDO',
          dni: '1234567',
          id_categoria: created.id_categoria,
          id_cobrador: created.id_cobrador,
          fecha_ingreso: todayIso(),
        },
      }, { status: 422, code: 'VALIDATION_ERROR' });
      await expectApiError(request, 'socios_guardar', {
        method: 'POST',
        data: {
          nombre: 'PW EEE SOCIO DUPLICADO',
          dni: data.dni,
          id_categoria: created.id_categoria,
          id_cobrador: created.id_cobrador,
          fecha_ingreso: todayIso(),
        },
      }, { status: 409, code: 'DNI_DUPLICADO' });
      // Eliminación definitiva: el socio sale del padrón operativo, pero la UI
      // deja explícito que pagos e historial quedan preservados para Contabilidad.
      await row.getByTitle('Eliminar socio definitivamente').click();
      let deleteDialog = page.getByRole('dialog', { name: 'Eliminar socio definitivamente' });
      await expect(deleteDialog).toContainText('movimientos económicos NO se borran');
      await expect(deleteDialog).toContainText('acción es irreversible');
      await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();
      await row.getByTitle('Eliminar socio definitivamente').click();
      deleteDialog = page.getByRole('dialog', { name: 'Eliminar socio definitivamente' });
      await deleteDialog.getByRole('button', { name: 'Eliminar definitivamente', exact: true }).click();
      await expectFeedback(page, /Socio eliminado del padrón\..*(pagos|inscripciones).*(historial|trazabilidad)/i);
      await expectApiError(request, 'socios_obtener', { params: { id: createdId } }, {
        status: 404, code: 'SOCIO_NO_ENCONTRADO',
      });
      createdId = null;
  });

  test('exporta únicamente la vista filtrada del socio E2E en Excel y PDF', async ({ page, request }) => {
    const data = socioData('EXPORT');
    const created = await createSocio(request, data);
    await page.goto('/socios/personas');
      await page.getByLabel('Socio', { exact: true }).fill(data.dni);
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

      // En una familia nueva, quitar un integrante antes de guardar debe ser
      // reversible y no generar una desvinculación histórica inexistente.
      await dialog.getByRole('button', { name: `Quitar a ${firstData.nombre}`, exact: true }).click();
      await expect(dialog.getByRole('button', { name: `Quitar a ${firstData.nombre}`, exact: true })).toHaveCount(0);
      await memberSearch.fill(firstData.dni);
      const firstOptionAgain = dialog.locator('label.familias-modal__member').filter({ hasText: firstData.nombre });
      await expect(firstOptionAgain).toBeVisible();
      await firstOptionAgain.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: /Agregar miembros/ }).click();
      await expect(dialog.getByText(firstData.nombre, { exact: true }).last()).toBeVisible();

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

      // El buscador de Familias debe resolver tanto por nombre de familia como
      // por un integrante relacionado (nombre/DNI), no sólo por el texto principal.
      const familyByMember = await apiCall(request, 'familias_listar', {
        params: { estado: 'activo', buscar: firstData.dni },
      });
      expect((familyByMember.items || []).some((item) => item.id_familia === familyId)).toBe(true);
      await search.fill(firstData.dni);
      await expect(rowByText(page, family.nombreEditado)).toBeVisible();
      await search.fill(family.nombreEditado);

      // Exportación familiar filtrada en todos los formatos disponibles.
      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar' }),
        format: 'Excel',
        expectedExtension: '.xlsx',
      });
      await exportFromGlobalModal(page, {
        openButton: page.getByRole('button', { name: 'Exportar' }),
        format: 'PDF',
        expectedExtension: '.pdf',
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

      // La eliminación definitiva sólo se habilita después de la baja. La
      // reactivación anterior no restaura integrantes, pero la familia sigue
      // siendo un registro activo hasta volver a darla de baja.
      await expect(row.getByTitle('Eliminar definitivamente la familia')).toHaveCount(0);
      await row.getByTitle('Dar de baja').click();
      stateDialog = page.getByRole('dialog', { name: 'Dar de baja la familia' });
      await stateDialog.getByLabel('Motivo de baja *').fill('PW E2E BAJA PREVIA A ELIMINAR');
      await stateDialog.getByRole('button', { name: 'Dar de baja', exact: true }).click();
      await expectFeedback(page, 'Familia dada de baja correctamente.');

      await page.getByRole('tab', { name: 'Bajas' }).click();
      await search.fill(family.nombreEditado);
      row = rowByText(page, family.nombreEditado);

      await expectApiError(request, 'familias_eliminar_definitivo', {
        method: 'POST', data: { id: familyId, confirmacion: 'NO' },
      }, { status: 422, code: 'CONFIRMACION_ELIMINACION_INVALIDA' });

      await row.getByTitle('Eliminar definitivamente la familia').click();
      let deleteDialog = page.getByRole('dialog', { name: 'Eliminar definitivamente la familia' });
      await expect(deleteDialog).toContainText('SE CONSERVAN');
      await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();

      // Una familia inactiva y sin integrantes actuales puede eliminarse de la
      // gestión. Sus vínculos quedan archivados sólo para cálculos históricos;
      // nunca se borran los socios ni sus pagos.
      await row.getByTitle('Eliminar definitivamente la familia').click();
      deleteDialog = page.getByRole('dialog', { name: 'Eliminar definitivamente la familia' });
      await deleteDialog.getByRole('button', { name: 'Eliminar definitivamente' }).click();
      await expectFeedback(page, 'La familia fue eliminada definitivamente. Sus socios quedaron sin familia.');
      await expect(rowByText(page, family.nombreEditado)).toHaveCount(0);

      await expectApiError(request, 'familias_obtener', {
        params: { id: familyId },
      }, { status: 404, code: 'FAMILIA_NO_ENCONTRADA' });

      // Garantía de seguridad funcional: los socios test siguen existiendo.
      const stillFirst = await apiCall(request, 'socios_obtener', { params: { id: first.id_socio } });
      const stillSecond = await apiCall(request, 'socios_obtener', { params: { id: second.id_socio } });
      expect(stillFirst.item.id_socio).toBe(first.id_socio);
      expect(stillSecond.item.id_socio).toBe(second.id_socio);
  });
});
