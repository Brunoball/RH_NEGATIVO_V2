const { test, expect } = require('./fixtures/auth.fixture');
const {
  apiCall,
  cleanupCatalogByName,
  cleanupContableOptionByName,
  cleanupSocioByDocument,
} = require('./helpers/api.helper');
const { expectToast } = require('./helpers/auth.helper');
const { lettersFromSuffix, uniqueSuffix } = require('./helpers/data.helper');
const { companyData, personData } = require('./fixtures/socios.fixture');
const { createCatalog, createCompany, createPerson } = require('./helpers/entities.helper');

const suffix = uniqueSuffix();
const textSuffix = lettersFromSuffix(suffix);
const catalogs = [
  {
    tab: 'Medios de pago',
    list: 'medios_pago',
    label: 'medio de pago',
    original: `PW EE MEDIO ${textSuffix}`,
    edited: `PW EE MEDIO EDITADO ${textSuffix}`,
  },
  {
    tab: 'Condiciones frente al IVA',
    list: 'condiciones_iva',
    label: 'condición frente al IVA',
    original: `PW EE IVA ${textSuffix}`,
    edited: `PW EE IVA EDITADA ${textSuffix}`,
  },
];

const usedCatalogPerson = personData();
const usedCatalogCompany = companyData();
const usedCatalogs = [
  {
    tab: 'Medios de pago',
    list: 'medios_pago',
    label: 'medio de pago',
    name: `PW EE MEDIO USADO UI ${textSuffix}`,
    idField: 'id_medio_pago',
    owner: usedCatalogPerson,
    type: 'PERSONA',
  },
  {
    tab: 'Condiciones frente al IVA',
    list: 'condiciones_iva',
    label: 'condición frente al IVA',
    name: `PW EE IVA USADA UI ${textSuffix}`,
    idField: 'id_condicion_iva',
    owner: usedCatalogCompany,
    type: 'EMPRESA',
  },
];

const contableLists = [
  {
    tab: 'Personas / proveedores',
    type: 'PROVEEDOR',
    label: 'persona o proveedor',
    createLabel: 'Nueva persona o proveedor',
    original: `PW EE PROVEEDOR ${textSuffix}`,
    edited: `PW EE PROVEEDOR EDITADO ${textSuffix}`,
  },
  {
    tab: 'Categorías de ingresos',
    type: 'CATEGORIA_INGRESO',
    label: 'categoría de ingreso',
    createLabel: 'Nueva categoría de ingreso',
    original: `PW EE CAT ING ${textSuffix}`,
    edited: `PW EE CAT ING EDITADA ${textSuffix}`,
  },
  {
    tab: 'Conceptos de ingresos',
    type: 'CONCEPTO_INGRESO',
    label: 'concepto de ingreso',
    createLabel: 'Nuevo concepto de ingreso',
    original: `PW EE CON ING ${textSuffix}`,
    edited: `PW EE CON ING EDITADO ${textSuffix}`,
  },
  {
    tab: 'Categorías de egresos',
    type: 'CATEGORIA_EGRESO',
    label: 'categoría de egreso',
    createLabel: 'Nueva categoría de egreso',
    original: `PW EE CAT EGR ${textSuffix}`,
    edited: `PW EE CAT EGR EDITADA ${textSuffix}`,
  },
  {
    tab: 'Conceptos de egresos',
    type: 'CONCEPTO_EGRESO',
    label: 'concepto de egreso',
    createLabel: 'Nuevo concepto de egreso',
    original: `PW EE CON EGR ${textSuffix}`,
    edited: `PW EE CON EGR EDITADO ${textSuffix}`,
  },
];

function catalogTableRow(page, tableName, name) {
  return page
    .getByRole('table', { name: tableName })
    .getByRole('row')
    .filter({ hasText: name })
    .last();
}

function contableOptionCard(page, name) {
  return page.locator('.config-contableTable__row').filter({ hasText: name }).last();
}

test.describe('Configuración general', () => {
  // Cada escenario limpia únicamente los datos que pudo crear. Antes se recorrían
  // todos los catálogos y listas después de CADA test, generando decenas de requests
  // innecesarios durante el cierre del contexto de Chromium. En Windows eso podía
  // coincidir con un cierre nativo del worker (0xC0000409) y dejar el test siguiente
  // como flaky aunque su retry pasara.
  test.afterEach(async ({ page, request }, testInfo) => {
    // Primero desmontamos la pantalla React y dejamos terminar cualquier request
    // del módulo antes de iniciar la limpieza por API.
    try {
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 5000 });
    } catch (_error) {
      // Si la página ya se cerró por un fallo, la limpieza de datos igual continúa.
    }

    const title = testInfo.title;

    if (title === 'crea, busca, edita y elimina los dos catálogos generales' && testInfo.status !== 'passed') {
      for (const catalog of catalogs) {
        for (const name of [catalog.original, catalog.edited]) {
          try {
            await cleanupCatalogByName(request, catalog.list, name);
          } catch (_error) {
            // El error principal del escenario debe conservarse.
          }
        }
      }
      return;
    }

    if (title === 'da de baja, reactiva y elimina definitivamente catálogos usados dejando la relación en null') {
      for (const definition of usedCatalogs) {
        try {
          await cleanupSocioByDocument(request, {
            tipo: definition.type,
            documento: definition.type === 'PERSONA'
              ? definition.owner.dni
              : definition.owner.cuit,
          });
        } catch (_error) {
          // Puede no haberse creado el registro asociado.
        }
        try {
          await cleanupCatalogByName(request, definition.list, definition.name);
        } catch (_error) {
          // Conserva el fallo principal.
        }
      }
      return;
    }

    if (title === 'administra las cinco listas usadas por ingresos y egresos' && testInfo.status !== 'passed') {
      for (const list of contableLists) {
        for (const name of [list.original, list.edited]) {
          try {
            await cleanupContableOptionByName(request, list.type, name);
          } catch (_error) {
            // El error principal del escenario debe conservarse.
          }
        }
      }
    }
  });

  test('muestra solamente las secciones actuales y navega correctamente', async ({ page }) => {
    await page.goto('/configuracion');
    await expect(
      page.getByText('Administración y configuración general', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Gestioná usuarios, roles y los catálogos vinculados/i),
    ).toBeVisible();

    const sections = page.getByRole('navigation', { name: 'Secciones de configuración' });
    await expect(sections.getByRole('button')).toHaveCount(3);
    await expect(sections.getByRole('button', { name: /Usuarios y roles/i })).toBeVisible();
    await expect(sections.getByRole('button', { name: /Catálogos generales/i })).toBeVisible();
    await expect(sections.getByRole('button', { name: /^Contable/i })).toBeVisible();

    await sections.getByRole('button', { name: /Catálogos generales/i }).click();
    await expect(page).toHaveURL(/\/configuracion\/catalogos$/);
    await expect(page.getByRole('heading', { name: 'Catálogos generales' })).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page).toHaveURL(/\/configuracion$/);

    await page
      .getByRole('navigation', { name: 'Secciones de configuración' })
      .getByRole('button', { name: /^Contable/i })
      .click();
    await expect(page).toHaveURL(/\/configuracion\/contable$/);
    await expect(page.getByRole('heading', { name: 'Configuración contable' })).toBeVisible();
    await page.getByRole('button', { name: 'Volver a configuración' }).click();

    await page
      .getByRole('navigation', { name: 'Secciones de configuración' })
      .getByRole('button', { name: /Usuarios y roles/i })
      .click();
    await expect(page).toHaveURL(/\/configuracion\/usuarios$/);
    await expect(page.getByRole('heading', { name: 'Configuración de usuarios' })).toBeVisible();
  });

  test('crea, busca, edita y elimina los dos catálogos generales', async ({ page, request }) => {
    for (const catalog of catalogs) {
      await cleanupCatalogByName(request, catalog.list, catalog.original).catch(() => false);
      await cleanupCatalogByName(request, catalog.list, catalog.edited).catch(() => false);
    }

    await page.goto('/configuracion/catalogos');
    await expect(page.getByRole('heading', { name: 'Catálogos generales' })).toBeVisible();

    for (const catalog of catalogs) {
      await page.getByRole('tab', { name: catalog.tab, exact: true }).click();
      await expect(
        page.getByRole('tab', { name: catalog.tab, exact: true }),
      ).toHaveAttribute('aria-selected', 'true');

      await page.getByRole('button', { name: `Nuevo ${catalog.label}` }).click();
      let dialog = page.getByRole('dialog', { name: `Agregar ${catalog.label}` });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Nombre *').fill(catalog.original);
      await dialog.getByRole('button', { name: 'Agregar' }).click();
      await expectToast(page, 'La opción se agregó correctamente.');

      const search = page.getByRole('textbox', { name: 'Buscar', exact: true });
      await search.fill(catalog.original);
      let row = catalogTableRow(page, catalog.tab, catalog.original);
      await expect(row).toContainText('Activo');
      await expect(row.getByRole('cell', { name: '0 registros asociados' })).toBeVisible();

      await row.getByRole('button', { name: `Editar ${catalog.original}` }).click();
      dialog = page.getByRole('dialog', { name: `Editar ${catalog.label}` });
      await dialog.getByLabel('Nombre *').fill(catalog.edited);
      await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
      await expectToast(page, 'La opción se modificó correctamente.');

      await search.fill(catalog.edited);
      row = catalogTableRow(page, catalog.tab, catalog.edited);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: `Eliminar definitivamente ${catalog.edited}` }).click();

      const deleteDialog = page.getByRole('dialog').filter({
        hasText: new RegExp(`Eliminar ${catalog.label}`, 'i'),
      });
      await expect(deleteDialog).toBeVisible();
      await deleteDialog.getByRole('button', { name: 'Eliminar' }).click();
      await expectToast(page, /opción se eliminó definitivamente/i);
      await expect(catalogTableRow(page, catalog.tab, catalog.edited)).toHaveCount(0);
    }
  });

  test('da de baja, reactiva y elimina definitivamente catálogos usados dejando la relación en null', async ({ page, request }) => {
    for (const definition of usedCatalogs) {
      await cleanupSocioByDocument(request, {
        tipo: definition.type,
        documento: definition.type === 'PERSONA'
          ? definition.owner.dni
          : definition.owner.cuit,
      }).catch(() => false);
      await cleanupCatalogByName(request, definition.list, definition.name).catch(() => false);

      const catalog = await createCatalog(request, definition.list, definition.name);
      let ownerRecord;
      if (definition.type === 'PERSONA') {
        ownerRecord = await createPerson(request, definition.owner, {
          id_medio_pago: catalog[definition.idField],
        });
      } else {
        ownerRecord = await createCompany(request, definition.owner, {
          id_condicion_iva: catalog[definition.idField],
        });
      }

      await page.goto('/configuracion/catalogos');
      await page.getByRole('tab', { name: definition.tab, exact: true }).click();
      const search = page.getByRole('textbox', { name: 'Buscar', exact: true });
      await search.fill(definition.name);

      let row = catalogTableRow(page, definition.tab, definition.name);
      const usageCell = row.locator('.config-catalogUsage');
      await expect(usageCell.getByText('1', { exact: true })).toBeVisible();
      await expect(usageCell.getByText('registro asociado', { exact: true })).toBeVisible();

      await row.getByRole('button', { name: `Dar de baja ${definition.name}` }).click();
      let stateDialog = page.getByRole('dialog', { name: `Dar de baja ${definition.label}` });
      await expect(stateDialog).toContainText(/dar de baja no elimina el historial y se puede revertir en cualquier momento/i);
      await stateDialog.getByRole('button', { name: 'Dar de baja' }).click();
      await expectToast(page, /opción se dio de baja correctamente/i);

      await search.fill(definition.name);
      row = catalogTableRow(page, definition.tab, definition.name);
      await expect(row).toContainText('Inactivo');
      await row.getByRole('button', { name: `Reactivar ${definition.name}` }).click();
      stateDialog = page.getByRole('dialog', { name: `Reactivar ${definition.label}` });
      await stateDialog.getByRole('button', { name: 'Reactivar' }).click();
      await expectToast(page, /opción se reactivó correctamente/i);

      await search.fill(definition.name);
      row = catalogTableRow(page, definition.tab, definition.name);
      await expect(row).toContainText('Activo');

      await row.getByRole('button', { name: `Eliminar definitivamente ${definition.name}` }).click();
      const deleteDialog = page.getByRole('dialog', { name: `Eliminar ${definition.label}` });
      await expect(deleteDialog).toContainText(/registro asociado se conservará/i);
      await expect(deleteDialog).toContainText(/quedará sin/i);
      await expect(deleteDialog).toContainText(/vacío y sin información/i);
      await deleteDialog.getByRole('button', { name: 'Eliminar' }).click();
      await expectToast(page, /opción se eliminó definitivamente/i);
      await expect(catalogTableRow(page, definition.tab, definition.name)).toHaveCount(0);

      const ownerAfterDelete = await apiCall(request, 'socios_obtener', {
        params: { id: ownerRecord.id_socio },
      });
      expect(ownerAfterDelete.item[definition.idField]).toBeNull();
    }
  });

  test('administra las cinco listas usadas por ingresos y egresos', async ({ page, request }) => {
    for (const list of contableLists) {
      await cleanupContableOptionByName(request, list.type, list.original).catch(() => false);
      await cleanupContableOptionByName(request, list.type, list.edited).catch(() => false);
    }

    await page.goto('/configuracion/contable');
    await expect(page.getByRole('heading', { name: 'Configuración contable' })).toBeVisible();

    for (const list of contableLists) {
      await page.getByRole('tab', { name: list.tab, exact: true }).click();
      await expect(page.getByRole('tab', { name: list.tab, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );

      await page.getByRole('button', { name: list.createLabel }).click();
      let dialog = page.getByRole('dialog', { name: `Agregar ${list.label}` });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Nombre *').fill(list.original);
      await dialog.getByRole('button', { name: 'Agregar' }).click();
      await expectToast(page, 'La opción se agregó correctamente.');

      const search = page.getByRole('textbox', { name: 'Buscar', exact: true });
      await search.fill(list.original);
      let row = contableOptionCard(page, list.original);
      await expect(row.getByText('Disponible', { exact: true })).toBeVisible();
      await expect(row.getByText('0 movimientos históricos', { exact: true })).toBeVisible();

      await row.getByRole('button', { name: `Editar ${list.original}` }).click();
      dialog = page.getByRole('dialog', { name: `Editar ${list.label}` });
      await dialog.getByLabel('Nombre *').fill(list.edited);
      await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
      await expectToast(page, 'La opción se modificó correctamente.');

      await search.fill(list.edited);
      row = contableOptionCard(page, list.edited);
      await expect(row).toBeVisible();

      await row.getByRole('button', { name: `Dar de baja ${list.edited}` }).click();
      let stateDialog = page.getByRole('dialog', { name: `Dar de baja ${list.label}` });
      await expect(stateDialog).toContainText(/la baja es reversible y no elimina ningún ingreso o egreso histórico/i);
      await stateDialog.getByRole('button', { name: 'Dar de baja' }).click();
      await expectToast(page, /la opción se dio de baja correctamente/i);

      await search.fill(list.edited);
      row = contableOptionCard(page, list.edited);
      await expect(row.getByText('Baja', { exact: true })).toBeVisible();
      await row.getByRole('button', { name: `Reactivar ${list.edited}` }).click();
      stateDialog = page.getByRole('dialog', { name: `Reactivar ${list.label}` });
      await stateDialog.getByRole('button', { name: 'Reactivar' }).click();
      await expectToast(page, /la opción se reactivó correctamente/i);

      await search.fill(list.edited);
      row = contableOptionCard(page, list.edited);
      await expect(row.getByText('Disponible', { exact: true })).toBeVisible();
      await row.getByRole('button', { name: `Eliminar definitivamente ${list.edited}` }).click();
      const deleteDialog = page.getByRole('dialog').filter({
        hasText: new RegExp(`Eliminar ${list.label}`, 'i'),
      });
      await expect(deleteDialog).toBeVisible();
      await deleteDialog.getByRole('button', { name: 'Eliminar' }).click();
      await expectToast(page, /la opción se eliminó correctamente/i);
      await expect(contableOptionCard(page, list.edited)).toHaveCount(0);
    }
  });
});
