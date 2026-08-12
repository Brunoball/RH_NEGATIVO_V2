const { test, expect } = require('@playwright/test');
const { companyData, familyData, personData } = require('./fixtures/socios.fixture');
const { userData } = require('./fixtures/usuarios.fixture');
const {
  apiCall,
  cleanupCatalogByName,
  cleanupFamilyByPrefix,
  cleanupSocioByDocument,
  cleanupUsersByPrefix,
  closeApiSession,
  createApiSession,
  expectApiError,
} = require('./helpers/api.helper');
const {
  createCatalog,
  createCompany,
  createFamily,
  createPerson,
  createUser,
} = require('./helpers/entities.helper');
const { SESSION_KEY } = require('./helpers/auth.helper');
const { loadTestEnv } = require('./helpers/env.helper');

loadTestEnv();

function rowByText(page, tableName, text) {
  return page
    .getByRole('table', { name: tableName })
    .getByRole('row')
    .filter({ hasText: text })
    .last();
}

test.describe('Permisos de usuario de solo lectura', () => {
  test('consulta todos los módulos actuales pero no puede ejecutar ninguna mutación', async ({ browser, request }) => {
    const person = personData();
    const company = companyData();
    const family = familyData();
    const user = userData();
    const catalogName = `PW E2E MEDIO VISTA ${person.suffix}`;
    let personItem;
    let companyItem;
    let familyItem;
    let catalogItem;
    let categoryItem;
    let userItem;
    let viewSession;
    let context;

    try {
      catalogItem = await createCatalog(request, 'medios_pago', catalogName);
      personItem = await createPerson(request, person, {
        id_medio_pago: catalogItem.id_medio_pago,
      });
      companyItem = await createCompany(request, company);
      familyItem = await createFamily(request, family, [personItem]);
      userItem = await createUser(request, user, { rol: 'vista' });
      const categories = await apiCall(request, 'categorias_listar', {
        params: { estado: 'activo' },
      });
      categoryItem = (categories.items || [])[0];
      expect(categoryItem).toBeTruthy();

      viewSession = await createApiSession(request, {
        username: user.username,
        password: user.password,
      });
      expect(viewSession.usuario.rol).toBe('vista');

      for (const [action, options = {}] of [
        ['auth_usuario_actual'],
        ['dashboard_resumen'],
        ['cuotas_listar', { params: { tipo: 'PERSONA', estado: 'DEUDORES' } }],
        ['cuotas_catalogos'],
        ['cuotas_contexto_pago', {
          params: {
            id_socio: personItem.id_socio,
            anio: new Date().getFullYear(),
            mes: new Date().getMonth() + 1,
          },
        }],
        ['cuotas_contextos_pago', {
          params: {
            id_socio: personItem.id_socio,
            anio: new Date().getFullYear(),
          },
        }],
        ['contable_resumen', {
          params: { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 },
        }],
        ['contable_catalogos'],
        ['contable_opciones_configuracion'],
        ['contable_ingresos_socios', {
          params: { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 },
        }],
        ['contable_ingresos_listar', {
          params: { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 },
        }],
        ['contable_egresos_listar', {
          params: { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 },
        }],
        ['socios_listar', { params: { tipo: 'PERSONA', estado: 'ACTIVO' } }],
        ['socios_obtener', { params: { id: personItem.id_socio } }],
        ['socios_historial', { params: { id: personItem.id_socio } }],
        ['familias_listar', { params: { estado: 'activo' } }],
        ['familias_obtener', { params: { id: familyItem.id_familia } }],
        ['categorias_listar', { params: { estado: 'activo' } }],
        ['categorias_obtener', { params: { id: categoryItem.id_categoria } }],
        ['categorias_historial', { params: { id: categoryItem.id_categoria } }],
        ['descuentos_familiares_listar'],
        ['configuracion_obtener'],
      ]) {
        const body = await apiCall(request, action, { ...options, session: viewSession });
        expect(body).toBeTruthy();
      }

      await expectApiError(
        request,
        'usuarios_listar',
        { session: viewSession },
        { status: 403, code: 'FORBIDDEN_ROLE' },
      );

      const mutationCases = [
        ['cuotas_registrar_pago', { id_socio: personItem.id_socio }],
        ['cuotas_registrar_pagos', { pagos: [{ id_socio: personItem.id_socio }] }],
        ['cuotas_condonar_pago', {
          id_socio: personItem.id_socio,
          anio: new Date().getFullYear(),
          mes: new Date().getMonth() + 1,
        }],
        ['cuotas_eliminar_pago', { id_pago: 1 }],
        ['contable_opcion_guardar', { tipo: 'PROVEEDOR', nombre: 'NO PERMITIDO' }],
        ['contable_opcion_cambiar_estado', { id_opcion: 1, activo: false }],
        ['contable_opcion_eliminar', { id_opcion: 1 }],
        ['contable_ingreso_guardar', { fecha: '2026-08-05', importe: 100 }],
        ['contable_ingreso_eliminar', { id_ingreso: 1 }],
        ['contable_egreso_guardar', { fecha: '2026-08-05', importe: 100 }],
        ['contable_egreso_eliminar', { id_egreso: 1 }],
        ['socios_guardar', { tipo_socio: 'PERSONA' }],
        ['socios_eliminar', { id: personItem.id_socio }],
        ['socios_eliminar_definitivo', { id: personItem.id_socio, confirmacion: 'ELIMINAR' }],
        ['socios_reactivar', { id: personItem.id_socio }],
        ['familias_guardar', { nombre: 'NO PERMITIDA', integrantes: [] }],
        ['familias_eliminar', { id: familyItem.id_familia }],
        ['familias_eliminar_definitivo', {
          id: familyItem.id_familia,
          confirmacion: 'ELIMINAR',
        }],
        ['familias_reactivar', { id: familyItem.id_familia }],
        ['categorias_guardar', { nombre: 'NO PERMITIDA', monto_actual: 1000, vigente_desde: '2026-08-04' }],
        ['categorias_eliminar', { id: categoryItem.id_categoria }],
        ['categorias_reactivar', { id: categoryItem.id_categoria }],
        ['descuentos_familiares_guardar', { cantidad_integrantes_desde: 49, cantidad_integrantes_hasta: 49, porcentaje_descuento: 10 }],
        ['descuentos_familiares_eliminar', { id: 1 }],
        ['configuracion_lista_guardar', { lista: 'medios_pago', nombre: 'NO PERMITIDO' }],
        ['configuracion_lista_eliminar', { lista: 'medios_pago', id: catalogItem.id_medio_pago }],
        ['configuracion_lista_baja', { lista: 'medios_pago', id: catalogItem.id_medio_pago }],
        ['configuracion_lista_reactivar', { lista: 'medios_pago', id: catalogItem.id_medio_pago }],
        ['configuracion_lista_eliminar_definitivo', { lista: 'medios_pago', id: catalogItem.id_medio_pago }],
        ['usuarios_guardar', { usuario: 'no_permitido' }],
        ['usuarios_cambiar_estado', { id: userItem.id, activo: false }],
        ['usuarios_eliminar', { id: userItem.id }],
      ];
      for (const [action, data] of mutationCases) {
        await expectApiError(
          request,
          action,
          { method: 'POST', data, session: viewSession },
          { status: 403, code: 'FORBIDDEN_ROLE' },
        );
      }

      context = await browser.newContext({
        baseURL: process.env.PW_BASE_URL || 'http://localhost:3000',
      });
      const appOrigin = new URL(process.env.PW_BASE_URL || 'http://localhost:3000').origin;
      await context.addInitScript(
        ({ origin, key, session }) => {
          if (window.location.origin === origin) {
            sessionStorage.setItem(key, JSON.stringify(session));
          }
        },
        { origin: appOrigin, key: SESSION_KEY, session: viewSession },
      );
      const page = await context.newPage();

      await page.goto('/cuotas');
      await expect(
        page.getByText(/permiso de consulta.*registrar.*condonar.*eliminar cuotas.*deshabilitado/i),
      ).toBeVisible();
      await expect(page.locator('.module-card__actions .mov-btn--primary')).toHaveCount(0);
      await expect(page.locator('.cuotas-pay-button:not(:disabled)')).toHaveCount(0);

      await page.goto('/contable/ingresos');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('table', { name: 'Listado de ingresos' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Registrar ingreso' })).toHaveCount(0);
      await page.getByRole('tab', { name: 'Otros ingresos' }).click();
      await expect(page.getByRole('button', { name: 'Registrar ingreso' })).toHaveCount(0);

      await page.goto('/contable/egresos');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('table', { name: 'Listado de egresos' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Registrar egreso' })).toHaveCount(0);

      await page.goto('/contable/resumen');
      await expect(page.getByText('Resumen contable', { exact: true })).toBeVisible();
      const periodTotals = page.getByLabel('Totales del período');
      await expect(periodTotals.getByText('Ingresos', { exact: true })).toBeVisible();
      await expect(periodTotals.getByText('Egresos', { exact: true })).toBeVisible();
      await expect(periodTotals.getByText('Resultado', { exact: true })).toBeVisible();

      await page.goto('/socios/personas');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nuevo socio' })).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(person.dni);
      let row = rowByText(page, 'Listado de socios', person.dni);
      await expect(row).toBeVisible();
      await expect(row.getByTitle('Ver ficha e historial')).toBeVisible();
      await expect(row.getByTitle('Editar')).toHaveCount(0);
      await expect(row.getByTitle('Dar de baja')).toHaveCount(0);
      await expect(row.getByTitle(/Eliminar definitivamente/i)).toHaveCount(0);

      await page.goto('/socios/empresas');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nueva empresa' })).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(company.cuit);
      row = rowByText(page, 'Listado de empresas', company.cuit);
      await expect(row).toBeVisible();
      await expect(row.getByTitle('Ver ficha e historial')).toBeVisible();
      await expect(row.locator('button')).toHaveCount(1);

      await page.goto('/socios/familias');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nueva familia' })).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(family.nombre);
      row = rowByText(page, 'Listado de familias', family.nombre);
      await expect(row).toBeVisible();
      await expect(row.getByTitle('Ver integrantes e historial')).toBeVisible();
      await expect(row.locator('button')).toHaveCount(1);

      await page.goto('/categorias');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nueva categoría' })).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Búsqueda', exact: true }).fill(categoryItem.nombre);
      row = rowByText(page, 'Listado de categorías', categoryItem.nombre);
      await expect(row).toBeVisible();
      await expect(row.getByTitle('Ver historial de precios')).toBeVisible();
      await expect(row.getByTitle('Editar')).toHaveCount(0);
      await expect(row.getByTitle('Dar de baja')).toHaveCount(0);

      await page.goto('/categorias/descuentos');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nuevo descuento' })).toHaveCount(0);
      await expect(
        page.getByRole('table', { name: 'Descuentos familiares' }).locator('button'),
      ).toHaveCount(0);

      await page.goto('/configuracion/catalogos');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /Nuevo medio de pago/i })).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Buscar', exact: true }).fill(catalogName);
      const catalogRow = rowByText(page, 'Medios de pago', catalogName);
      await expect(catalogRow).toBeVisible();
      await expect(catalogRow).toContainText('Solo lectura');
      await expect(catalogRow.locator('button')).toHaveCount(0);

      await page.goto('/configuracion/contable');
      await expect(page.getByText(/permiso de consulta.*modificaciones.*deshabilitadas/i)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Configuración contable' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Nueva persona o proveedor/i })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Personas / proveedores' })).toBeVisible();
      await expect(page.locator('.config-contableActions button')).toHaveCount(0);

      await page.goto('/configuracion/usuarios');
      await expect(page).toHaveURL(/\/configuracion$/);
      await expect(page.locator('.config-homePage')).toBeVisible();
      await expect(
        page.getByText('CONFIGURACIÓN DEL SISTEMA', { exact: true }),
      ).toBeVisible();
    } finally {
      if (context) await context.close().catch(() => undefined);
      await closeApiSession(request, viewSession).catch(() => undefined);
      try {
        cleanupFamilyByPrefix(family.prefix);
      } catch (_error) {
        // Puede no haberse creado.
      }
      await cleanupSocioByDocument(request, {
        tipo: 'PERSONA',
        documento: person.dni,
      }).catch(() => false);
      await cleanupSocioByDocument(request, {
        tipo: 'EMPRESA',
        documento: company.cuit,
      }).catch(() => false);
      await cleanupCatalogByName(request, 'medios_pago', catalogName).catch(() => false);
      try {
        cleanupUsersByPrefix(user.username);
      } catch (_error) {
        // La limpieza directa está limitada al entorno local.
      }
    }
  });
});
