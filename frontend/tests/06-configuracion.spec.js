const { test, expect } = require('./fixtures/auth.fixture');
const {
  apiCall,
  apiResult,
  closeApiSession,
  createApiSession,
  expectApiError,
  readAuthSession,
} = require('./helpers/api.helper');
const { SESSION_KEY } = require('./helpers/auth.helper');
const { todayIso } = require('./helpers/data.helper');
const { createQuotaCategory, createQuotaSocio, currentYear, deletePayment, paymentPayload, quotaCatalogs } = require('./helpers/cuotas.helper');
const { configValues, userData } = require('./fixtures/configuracion.fixture');
const { socioData } = require('./fixtures/socios.fixture');
const { createSocio } = require('./helpers/entities.helper');

async function createConfigItem(request, list, definition) {
  const result = await apiCall(request, 'configuracion_lista_guardar', {
    method: 'POST',
    data: { lista: list, nombre: definition.nombre, ...definition.payload },
  });
  return result.item;
}

function itemId(item, definition) {
  return Number(item[definition.idField]);
}

function rowByText(page, text) {
  return page.getByRole('row').filter({ hasText: text }).last();
}

test.describe('Configuración · navegación', () => {
  test('home permite entrar a usuarios y catálogos y volver sin depender de Contabilidad', async ({ page }) => {
    await page.goto('/configuracion');
    await expect(page.getByText('Administración y configuración general')).toBeVisible();

    await page.getByRole('button', { name: /Usuarios y roles/i }).click();
    await expect(page).toHaveURL(/\/configuracion\/usuarios$/);
    await expect(page.getByRole('heading', { name: 'Configuración de usuarios' })).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page).toHaveURL(/\/configuracion$/);

    await page.getByRole('button', { name: /Catálogos y parámetros/i }).click();
    await expect(page).toHaveURL(/\/configuracion\/catalogos\?lista=categoria/);
    await expect(page.getByRole('heading', { name: 'Catálogos generales' })).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page).toHaveURL(/\/configuracion$/);
  });
});

test.describe('Configuración · catálogos', () => {
  test('obtener expone los seis catálogos y sus resúmenes', async ({ request }) => {
    const data = await apiCall(request, 'configuracion_obtener');
    for (const key of ['categoria', 'cobrador', 'estado', 'grupo_sanguineo', 'medios_pago', 'periodo']) {
      expect(Array.isArray(data.listas?.[key]), key).toBe(true);
      expect(data.resumen).toHaveProperty(`${key}_activos`);
    }
  });

  test('Uso actual de catálogos no suma auditorías ni historial como si fueran asociaciones duplicadas', async ({ request, page }) => {
    const definitions = configValues();
    const category = await createConfigItem(request, 'categoria', definitions.categoria);
    const collector = await createConfigItem(request, 'cobrador', definitions.cobrador);
    const state = await createConfigItem(request, 'estado', definitions.estado);
    const blood = await createConfigItem(request, 'grupo_sanguineo', definitions.grupo_sanguineo);

    await createSocio(request, socioData('CONFIG USO ACTUAL'), {
      id_categoria: itemId(category, definitions.categoria),
      id_cobrador: itemId(collector, definitions.cobrador),
      id_estado: itemId(state, definitions.estado),
      id_grupo_sanguineo: itemId(blood, definitions.grupo_sanguineo),
      fecha_ingreso: `${currentYear()}-01-01`,
    });

    const data = await apiCall(request, 'configuracion_obtener');
    for (const [list, created, definition] of [
      ['categoria', category, definitions.categoria],
      ['cobrador', collector, definitions.cobrador],
      ['estado', state, definitions.estado],
      ['grupo_sanguineo', blood, definitions.grupo_sanguineo],
    ]) {
      const item = (data.listas?.[list] || []).find(
        (row) => Number(row[definition.idField]) === itemId(created, definition),
      );
      expect(item, list).toBeTruthy();
      expect(Number(item.cantidad_usos), `${list} debe contar sólo el socio actual`).toBe(1);
      expect(Number(item.cantidad_usos_protegidos), `${list} debe conservar la protección histórica`).toBeGreaterThanOrEqual(1);
    }

    await page.goto('/configuracion/catalogos?lista=categoria');
    const search = page.getByRole('textbox', { name: 'Buscar' });
    await search.fill(category.nombre);
    const row = rowByText(page, category.nombre);
    await expect(row).toBeVisible();
    await expect(row).toContainText(/1\s*socio asociado/);
  });

  test('CRUD, duplicados y estados funcionan en los cinco catálogos editables; Períodos queda estructural', async ({ request }) => {
    const definitions = configValues();
    for (const [list, definition] of Object.entries(definitions).filter(([key]) => key !== 'periodo')) {
      const created = await createConfigItem(request, list, definition);
      const id = itemId(created, definition);
      expect(id).toBeGreaterThan(0);
      expect(created.nombre).toBe(definition.nombre);
      expect(created.activo).toBe(true);

      await expectApiError(request, 'configuracion_lista_guardar', {
        method: 'POST', data: { lista: list, nombre: definition.nombre, ...definition.payload },
      }, { status: 409, code: 'NOMBRE_DUPLICADO' });

      const updated = await apiCall(request, 'configuracion_lista_guardar', {
        method: 'POST',
        data: { lista: list, id, nombre: definition.editado, ...definition.payload, ...definition.editPayload },
      });
      expect(updated.item.nombre).toBe(definition.editado);

      await apiCall(request, 'configuracion_lista_baja', { method: 'POST', data: { lista: list, id } });
      await expectApiError(request, 'configuracion_lista_baja', {
        method: 'POST', data: { lista: list, id },
      }, { status: 409, code: 'ESTADO_SIN_CAMBIOS' });
      await apiCall(request, 'configuracion_lista_reactivar', { method: 'POST', data: { lista: list, id } });
      await expectApiError(request, 'configuracion_lista_reactivar', {
        method: 'POST', data: { lista: list, id },
      }, { status: 409, code: 'ESTADO_SIN_CAMBIOS' });

      const action = list === 'cobrador' ? 'configuracion_lista_eliminar' : 'configuracion_lista_eliminar_definitivo';
      const deleted = await apiCall(request, action, { method: 'POST', data: { lista: list, id } });
      expect(deleted.eliminado_definitivo).toBe(true);
    }

    const config = await apiCall(request, 'configuracion_obtener');
    const structuralPeriod = (config.listas?.periodo || []).find((item) => Number(item.id_periodo) === 1);
    expect(structuralPeriod).toBeTruthy();

    // Crear un período adicional usa un nombre E2E seguro, por lo que puede
    // llegar al contrato funcional tanto en LOCAL como en Hostinger.
    await expectApiError(request, 'configuracion_lista_guardar', {
      method: 'POST',
      data: { lista: 'periodo', nombre: definitions.periodo.nombre, ...definitions.periodo.payload },
    }, { status: 409, code: 'PERIODO_ESTRUCTURAL' });

    // En cambio, tocar los IDs estructurales reales 1..7 sólo se ejercita
    // contra la copia LOCAL. En Hostinger el guard E2E los corta antes.
    const structuralWriteError = process.env.PW_ENVIRONMENT === 'hostinger'
      ? { status: 409, code: 'E2E_SCOPE_BLOCKED' }
      : { status: 409, code: 'PERIODO_ESTRUCTURAL' };
    await expectApiError(request, 'configuracion_lista_guardar', {
      method: 'POST',
      data: {
        lista: 'periodo',
        id: structuralPeriod.id_periodo,
        nombre: `${structuralPeriod.nombre} X`,
        meses: structuralPeriod.meses,
      },
    }, structuralWriteError);
    for (const action of ['configuracion_lista_baja', 'configuracion_lista_eliminar_definitivo']) {
      await expectApiError(request, action, {
        method: 'POST', data: { lista: 'periodo', id: structuralPeriod.id_periodo },
      }, structuralWriteError);
    }

    const catalogs = await apiCall(request, 'cuotas_catalogos', { params: { anio: currentYear(), mes: 1 } });
    const quotaPeriodIds = (catalogs.catalogos?.periodos || catalogs.periodos || []).map((item) => Number(item.id_periodo));
    expect(quotaPeriodIds.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const invalidConfigError = process.env.PW_ENVIRONMENT === 'hostinger'
      ? { status: 409, code: 'E2E_SCOPE_BLOCKED' }
      : { status: 422, code: 'LISTA_CONFIGURACION_INVALIDA' };
    await expectApiError(request, 'configuracion_lista_guardar', {
      method: 'POST', data: { lista: 'inventada', nombre: 'X' },
    }, invalidConfigError);

    const emptyConfigNameError = process.env.PW_ENVIRONMENT === 'hostinger'
      ? { status: 409, code: 'E2E_SCOPE_BLOCKED' }
      : { status: 422, code: 'VALIDATION_ERROR' };
    await expectApiError(request, 'configuracion_lista_guardar', {
      method: 'POST', data: { lista: 'cobrador', nombre: '' },
    }, emptyConfigNameError);
  });

  test('IDs manuales no se reutilizan después de una eliminación definitiva', async ({ request }) => {
    const firstDefinition = configValues().cobrador;
    const first = await createConfigItem(request, 'cobrador', firstDefinition);
    const firstId = itemId(first, firstDefinition);
    await apiCall(request, 'configuracion_lista_eliminar_definitivo', {
      method: 'POST', data: { lista: 'cobrador', id: firstId },
    });

    const secondDefinition = configValues().cobrador;
    const second = await createConfigItem(request, 'cobrador', secondDefinition);
    const secondId = itemId(second, secondDefinition);
    expect(secondId).toBeGreaterThan(firstId);
    expect(Number(second.cantidad_usos || 0)).toBe(0);

    await apiCall(request, 'configuracion_lista_eliminar_definitivo', {
      method: 'POST', data: { lista: 'cobrador', id: secondId },
    });
  });

  test('eliminación definitiva queda bloqueada mientras una opción está en uso', async ({ request }) => {
    const definition = configValues().medios_pago;
    const medium = await createConfigItem(request, 'medios_pago', definition);
    const mediumId = itemId(medium, definition);
    const category = await createQuotaCategory(request);
    const socio = await createQuotaSocio(request, 'CONFIG MEDIO EN USO', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);

    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: socio.item.id_socio, periodId, mediumId }),
    });
    await expectApiError(request, 'configuracion_lista_eliminar_definitivo', {
      method: 'POST', data: { lista: 'medios_pago', id: mediumId },
    }, { status: 409, code: 'OPCION_EN_USO' });

    await deletePayment(request, paid.items[0].id_pago);
    await apiCall(request, 'configuracion_lista_eliminar_definitivo', {
      method: 'POST', data: { lista: 'medios_pago', id: mediumId },
    });
  });

  test('UI permite recorrer los seis catálogos y conserva cada selector en la URL', async ({ page }) => {
    const tabs = [
      ['Categorías', 'categoria'],
      ['Cobradores', 'cobrador'],
      ['Estados', 'estado'],
      ['Grupos sanguíneos', 'grupo_sanguineo'],
      ['Medios de pago', 'medios_pago'],
      ['Períodos', 'periodo'],
    ];
    await page.goto('/configuracion/catalogos?lista=categoria');
    for (const [label, key] of tabs) {
      await page.getByRole('tab', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`lista=${key}`));
      await expect(page.getByRole('table', { name: label })).toBeVisible();
    }
  });

  test('UI de catálogos ejecuta alta, edición, baja, reactivación y eliminación definitiva', async ({ page }) => {
    const definition = configValues().cobrador;
    await page.goto('/configuracion/catalogos?lista=cobrador');
    await expect(page.getByRole('heading', { name: 'Catálogos generales' })).toBeVisible();
    await page.getByRole('tab', { name: 'Cobradores' }).click();
    await page.getByRole('button', { name: 'Nuevo cobrador' }).click();
    let dialog = page.getByRole('dialog', { name: 'Agregar cobrador' });
    await dialog.getByLabel('Nombre *').fill(definition.nombre);
    await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();

    const search = page.getByRole('textbox', { name: 'Buscar' });
    await search.fill(definition.nombre);
    let row = rowByText(page, definition.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Editar ${definition.nombre}` }).click();
    dialog = page.getByRole('dialog', { name: 'Editar cobrador' });
    await dialog.getByLabel('Nombre *').fill(definition.editado);
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

    await search.fill(definition.editado);
    row = rowByText(page, definition.editado);
    await row.getByRole('button', { name: `Dar de baja ${definition.editado}` }).click();
    let state = page.getByRole('dialog', { name: 'Dar de baja cobrador' });
    await state.getByRole('button', { name: 'Dar de baja', exact: true }).click();
    row = rowByText(page, definition.editado);
    await row.getByRole('button', { name: `Reactivar ${definition.editado}` }).click();
    state = page.getByRole('dialog', { name: 'Reactivar cobrador' });
    await state.getByRole('button', { name: 'Reactivar', exact: true }).click();

    row = rowByText(page, definition.editado);
    await row.getByRole('button', { name: `Eliminar definitivamente ${definition.editado}` }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Eliminar cobrador' });
    await deleteDialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(rowByText(page, definition.editado)).toHaveCount(0);
  });
});

test.describe('Configuración · usuarios y permisos', () => {
  test('API usuarios: alta, listar, validaciones, edición, contraseña, baja/reactivar y eliminación', async ({ request }) => {
    const user = userData('vista');
    const created = await apiCall(request, 'usuarios_guardar', { method: 'POST', data: user });
    const id = created.usuario.id;
    expect(created.usuario.rol).toBe('vista');

    let list = await apiCall(request, 'usuarios_listar');
    expect(list.usuarios.some((item) => item.id === id)).toBe(true);

    await expectApiError(request, 'usuarios_guardar', { method: 'POST', data: user }, { status: 409, code: 'USUARIO_DUPLICADO' });
    const sameEmail = userData('vista');
    await expectApiError(request, 'usuarios_guardar', {
      method: 'POST', data: { ...sameEmail, email: user.email },
    }, { status: 409, code: 'EMAIL_DUPLICADO' });
    await expectApiError(request, 'usuarios_guardar', {
      method: 'POST', data: { ...userData('vista'), email: 'NO-EMAIL' },
    }, { status: 422, code: 'VALIDATION_ERROR' });
    await expectApiError(request, 'usuarios_guardar', {
      method: 'POST', data: { ...userData('vista'), rol: 'superadmin' },
    }, { status: 422, code: 'VALIDATION_ERROR' });
    await expectApiError(request, 'usuarios_guardar', {
      method: 'POST', data: { ...userData('vista'), contrasena: '123', confirmar_contrasena: '123' },
    }, { status: 422, code: 'VALIDATION_ERROR' });
    const mismatch = userData('vista');
    await expectApiError(request, 'usuarios_guardar', {
      method: 'POST', data: { ...mismatch, confirmar_contrasena: `${mismatch.contrasena}X` },
    }, { status: 422, code: 'VALIDATION_ERROR' });
    await expectApiError(request, 'usuarios_guardar', {
      method: 'POST', data: { id: 2147483647, ...userData('vista') },
    }, { status: 404, code: 'USUARIO_NO_ENCONTRADO' });
    await expectApiError(request, 'usuarios_cambiar_estado', {
      method: 'POST', data: { id, activo: 'NO_ES_BOOLEANO' },
    }, { status: 422, code: 'VALIDATION_ERROR' });

    const session = await createApiSession(request, { username: user.usuario, password: user.contrasena });
    const newPassword = `${user.contrasena}X9`;
    await apiCall(request, 'usuarios_guardar', {
      method: 'POST',
      data: {
        id,
        usuario: user.usuarioEditado,
        email: user.emailEditado,
        rol: 'vista',
        contrasena: newPassword,
        confirmar_contrasena: newPassword,
      },
    });
    const oldSession = await apiResult(request, 'auth_usuario_actual', { session });
    expect(oldSession.status).toBe(401);
    const renewed = await createApiSession(request, { username: user.usuarioEditado, password: newPassword });
    await closeApiSession(request, renewed);

    await apiCall(request, 'usuarios_cambiar_estado', { method: 'POST', data: { id, activo: false } });
    await expectApiError(request, 'auth_login', {
      method: 'POST', data: { usuario: user.usuarioEditado, contrasena: newPassword }, session: null,
    }, { status: 403, code: 'USER_DISABLED' });
    await apiCall(request, 'usuarios_cambiar_estado', { method: 'POST', data: { id, activo: true } });
    await apiCall(request, 'usuarios_eliminar', { method: 'POST', data: { id } });
    list = await apiCall(request, 'usuarios_listar');
    expect(list.usuarios.some((item) => item.id === id)).toBe(false);
  });

  test('protecciones de la propia sesión impiden cambiar rol, darse de baja o eliminarse', async ({ request }) => {
    const current = readAuthSession();
    const list = await apiCall(request, 'usuarios_listar');
    const me = list.usuarios.find((item) => item.sesion_actual);
    expect(me).toBeTruthy();

    await expectApiError(request, 'usuarios_guardar', {
      method: 'POST',
      data: { id: me.id, usuario: me.usuario, email: me.email, rol: 'vista', contrasena: '', confirmar_contrasena: '' },
    }, { status: 409, code: 'USUARIO_ACTUAL_ROL' });
    await expectApiError(request, 'usuarios_cambiar_estado', {
      method: 'POST', data: { id: me.id, activo: false },
    }, { status: 409, code: 'USUARIO_ACTUAL_BAJA' });
    await expectApiError(request, 'usuarios_eliminar', {
      method: 'POST', data: { id: me.id },
    }, { status: 409, code: 'USUARIO_ACTUAL_ELIMINAR' });
    expect(current.token).toBeTruthy();
  });

  test('rol vista puede consultar módulos pero recibe 403 en todas las escrituras y usuarios', async ({ request, browser }) => {
    const user = userData('vista');
    const created = await apiCall(request, 'usuarios_guardar', { method: 'POST', data: user });
    const id = created.usuario.id;
    const viewSession = await createApiSession(request, { username: user.usuario, password: user.contrasena });

    const reads = [
      ['dashboard_resumen', {}],
      ['socios_listar', { vigente: 'VIGENTE' }],
      ['familias_listar', { estado: 'activo' }],
      ['categorias_listar', { estado: 'activo' }],
      ['descuentos_familiares_listar', { estado: 'todos' }],
      ['cuotas_catalogos', { anio: currentYear(), mes: 1 }],
      ['cuotas_totales_estado', { anio: currentYear(), mes: 1 }],
      ['contable_resumen', { anio: currentYear(), mes: 1 }],
      ['contable_catalogos', {}],
      ['contable_ingresos_socios', { anio: currentYear(), periodo: 1, pagina: 1 }],
      ['contable_balance', { desde: `${currentYear()}-01-01`, hasta: `${currentYear()}-02-28` }],
      ['contable_ingresos_listar', { anio: currentYear(), mes: 1 }],
      ['contable_egresos_listar', { anio: currentYear(), mes: 1 }],
    ];
    for (const [action, params] of reads) {
      const result = await apiResult(request, action, { params, session: viewSession });
      expect(result.status, action).toBe(200);
    }
    // Configuración está completamente fuera del alcance del rol Vista:
    // no aparece en la UI y tampoco se expone su catálogo por API.
    await expectApiError(request, 'configuracion_obtener', { session: viewSession }, { status: 403, code: 'FORBIDDEN_ROLE' });
    await expectApiError(request, 'usuarios_listar', { session: viewSession }, { status: 403, code: 'FORBIDDEN_ROLE' });
    await expectApiError(request, 'contable_opciones_configuracion', { session: viewSession }, { status: 403, code: 'FORBIDDEN_ROLE' });
    // Un comprobante inexistente debe llegar al 404 funcional, no quedar
    // bloqueado por rol: Vista puede consultar/descargar adjuntos contables.
    await expectApiError(request, 'contable_egreso_archivo', {
      params: { id: 2147483647 }, session: viewSession,
    }, { status: 404, code: 'ARCHIVO_NO_ENCONTRADO' });

    const writes = [
      'socios_guardar', 'socios_eliminar', 'socios_eliminar_definitivo', 'socios_reactivar', 'socios_contacto_guardar', 'socios_cumpleanios_cerrar',
      'familias_guardar', 'familias_eliminar', 'familias_eliminar_definitivo', 'familias_reactivar',
      'categorias_guardar', 'categorias_eliminar', 'categorias_reactivar', 'descuentos_familiares_guardar', 'descuentos_familiares_eliminar',
      'cuotas_registrar_inscripcion', 'cuotas_eliminar_inscripcion',
      'cuotas_registrar_pago', 'cuotas_registrar_pagos', 'cuotas_condonar_pago', 'cuotas_eliminar_pago', 'cuotas_registrar_cobro', 'cuotas_anular',
      'configuracion_lista_guardar', 'configuracion_lista_eliminar', 'configuracion_lista_baja', 'configuracion_lista_reactivar', 'configuracion_lista_eliminar_definitivo',
      'usuarios_guardar', 'usuarios_cambiar_estado', 'usuarios_eliminar',
      'contable_opcion_guardar', 'contable_opcion_cambiar_estado', 'contable_opcion_eliminar',
      'contable_ingreso_guardar', 'contable_ingreso_eliminar', 'contable_egreso_guardar', 'contable_egreso_eliminar',
    ];
    for (const action of writes) {
      await expectApiError(request, action, { method: 'POST', data: {}, session: viewSession }, { status: 403, code: 'FORBIDDEN_ROLE' });
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    const appOrigin = new URL(process.env.PW_BASE_URL || 'http://localhost:3000').origin;
    await page.addInitScript(({ origin, key, value }) => {
      if (window.location.origin === origin) sessionStorage.setItem(key, JSON.stringify(value));
    }, { origin: appOrigin, key: SESSION_KEY, value: viewSession });

    await page.goto('/socios/personas');
    await expect(page.getByRole('button', { name: 'Nuevo socio' })).toHaveCount(0);
    await page.goto('/categorias');
    await expect(page.getByRole('button', { name: 'Nueva categoría' })).toHaveCount(0);
    await page.goto('/cuotas');
    await expect(page.getByRole('button', { name: 'Cód. barras', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Seleccionar', exact: true })).toHaveCount(0);
    await expect(page.getByText(/permiso de consulta/i).first()).toBeVisible();

    await page.goto('/contable/ingresos');
    await expect(page.getByRole('heading', { name: 'Ingresos' })).toBeVisible();
    await page.getByRole('tab', { name: 'Otros ingresos', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Registrar ingreso' })).toHaveCount(0);
    await expect(page.getByText(/modificaciones están deshabilitadas/i).first()).toBeVisible();

    await page.goto('/contable/egresos');
    await expect(page.getByRole('heading', { name: 'Egresos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar egreso' })).toHaveCount(0);
    await expect(page.locator('button[title="Editar"]')).toHaveCount(0);
    await expect(page.locator('button[title="Anular"]')).toHaveCount(0);

    await page.goto('/contable/resumen');
    await expect(page.getByText('Resumen contable', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Detalle', exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Abrir configuración' })).toHaveCount(0);
    await page.goto('/configuracion');
    await expect(page).toHaveURL(/\/panel$/);
    await context.close();

    await closeApiSession(request, viewSession);
    await apiCall(request, 'usuarios_eliminar', { method: 'POST', data: { id } });
  });

  test('UI usuarios cubre alta, edición, baja, reactivación y eliminación definitiva', async ({ page }) => {
    const user = userData('vista');
    await page.goto('/configuracion/usuarios');
    await expect(page.getByRole('heading', { name: 'Configuración de usuarios' })).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo usuario' }).click();
    let dialog = page.getByRole('dialog', { name: 'Nuevo usuario' });
    await dialog.getByLabel('Usuario *').fill(user.usuario);
    await dialog.getByLabel('Email').fill(user.email);
    await dialog.getByRole('radio', { name: 'Solo lectura' }).check();
    await dialog.getByLabel('Contraseña *', { exact: true }).fill(user.contrasena);
    await dialog.getByLabel('Confirmar contraseña *', { exact: true }).fill(user.contrasena);
    await dialog.getByRole('button', { name: 'Crear usuario' }).click();

    const search = page.getByRole('textbox', { name: 'Buscar' });
    await search.fill(user.usuario);
    let row = rowByText(page, user.usuario);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Editar ${user.usuario}` }).click();
    dialog = page.getByRole('dialog', { name: 'Editar usuario' });
    await dialog.getByLabel('Email').fill(user.emailEditado);
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

    row = rowByText(page, user.usuario);
    await row.getByRole('button', { name: `Dar de baja ${user.usuario}` }).click();
    let state = page.getByRole('dialog', { name: 'Dar de baja usuario' });
    await state.getByRole('button', { name: 'Dar de baja', exact: true }).click();
    await page.getByRole('tab', { name: 'Dados de baja' }).click();
    row = rowByText(page, user.usuario);
    await row.getByRole('button', { name: `Reactivar ${user.usuario}` }).click();
    state = page.getByRole('dialog', { name: 'Reactivar usuario' });
    await state.getByRole('button', { name: 'Reactivar', exact: true }).click();
    await page.getByRole('tab', { name: 'Activos' }).click();
    row = rowByText(page, user.usuario);
    await row.getByRole('button', { name: `Eliminar ${user.usuario}` }).click();
    const remove = page.getByRole('dialog', { name: 'Eliminar usuario' });
    await remove.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(rowByText(page, user.usuario)).toHaveCount(0);
  });
});
