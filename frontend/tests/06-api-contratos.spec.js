const { test, expect } = require('@playwright/test');
const { companyData, familyData, personData } = require('./fixtures/socios.fixture');
const { userData } = require('./fixtures/usuarios.fixture');
const {
  apiCall,
  apiResult,
  cleanupCatalogByName,
  cleanupFamilyByPrefix,
  cleanupSocioByDocument,
  cleanupUsersByPrefix,
  closeApiSession,
  createApiSession,
  expectApiError,
  readAuthSession,
} = require('./helpers/api.helper');
const {
  createCatalog,
  createCompany,
  createFamily,
  createPerson,
  createUser,
  findCatalogByName,
} = require('./helpers/entities.helper');
const { todayIso, uniqueSuffix } = require('./helpers/data.helper');
const { loadTestEnv } = require('./helpers/env.helper');

loadTestEnv();

test.describe.configure({ mode: 'serial' });

test.describe('Contratos, validaciones y seguridad de la API actual', () => {
  test('health responde sin sesión y confirma disponibilidad de la API', async ({ request }) => {
    const health = await apiCall(request, 'health', { session: null });
    expect(health).toBeTruthy();
    expect(health.exito).not.toBe(false);
  });

  test('el proxy local del Panel Bot rechaza orígenes externos antes de reenviar datos', async ({ request }) => {
    const result = await apiResult(request, 'bot_panel_proxy', {
      method: 'POST',
      session: null,
      headers: { Origin: 'https://origen-externo.example.test' },
      data: {
        section: 'panel',
        endpoint: 'panel_health',
        method: 'GET',
        params: {},
      },
    });

    expect(result.status).toBe(403);
    expect(result.body?.codigo).toBe('BOT_PROXY_LOCAL_ONLY');
  });

  test('todas las rutas privadas rechazan una solicitud sin sesión', async ({ request }) => {
    const endpoints = [
      ['auth_usuario_actual', 'GET'],
      ['auth_logout', 'POST'],
      ['dashboard_resumen', 'GET'],
      ['cuotas_listar', 'GET'],
      ['cuotas_catalogos', 'GET'],
      ['cuotas_contexto_pago', 'GET', { params: { id_socio: 1, anio: 2026, mes: 8 } }],
      ['cuotas_contextos_pago', 'GET', { params: { id_socio: 1, anio: 2026 } }],
      ['cuotas_registrar_pago', 'POST', { data: {} }],
      ['cuotas_registrar_pagos', 'POST', { data: {} }],
      ['cuotas_condonar_pago', 'POST', { data: {} }],
      ['cuotas_eliminar_pago', 'POST', { data: {} }],
      ['cuotas_registrar_cobro', 'POST', { data: {} }],
      ['cuotas_anular', 'POST', { data: {} }],
      ['contable_resumen', 'GET'],
      ['contable_catalogos', 'GET'],
      ['contable_opciones_configuracion', 'GET'],
      ['contable_ingresos_socios', 'GET'],
      ['contable_ingresos_listar', 'GET'],
      ['contable_egresos_listar', 'GET'],
      ['contable_egreso_archivo', 'GET', { params: { id: 1 } }],
      ['contable_opcion_guardar', 'POST', { data: {} }],
      ['contable_opcion_cambiar_estado', 'POST', { data: {} }],
      ['contable_opcion_eliminar', 'POST', { data: {} }],
      ['contable_ingreso_guardar', 'POST', { data: {} }],
      ['contable_ingreso_eliminar', 'POST', { data: {} }],
      ['contable_egreso_guardar', 'POST', { data: {} }],
      ['contable_egreso_eliminar', 'POST', { data: {} }],
      ['socios_listar', 'GET'],
      ['socios_obtener', 'GET', { params: { id: 1 } }],
      ['socios_historial', 'GET', { params: { id: 1 } }],
      ['socios_guardar', 'POST', { data: {} }],
      ['socios_eliminar', 'POST', { data: {} }],
      ['socios_eliminar_definitivo', 'POST', { data: {} }],
      ['socios_reactivar', 'POST', { data: {} }],
      ['familias_listar', 'GET'],
      ['familias_obtener', 'GET', { params: { id: 1 } }],
      ['familias_guardar', 'POST', { data: {} }],
      ['familias_eliminar', 'POST', { data: {} }],
      ['familias_eliminar_definitivo', 'POST', { data: {} }],
      ['familias_reactivar', 'POST', { data: {} }],
      ['categorias_listar', 'GET'],
      ['categorias_obtener', 'GET', { params: { id: 1 } }],
      ['categorias_historial', 'GET', { params: { id: 1 } }],
      ['categorias_guardar', 'POST', { data: {} }],
      ['categorias_eliminar', 'POST', { data: {} }],
      ['categorias_reactivar', 'POST', { data: {} }],
      ['descuentos_familiares_listar', 'GET'],
      ['descuentos_familiares_guardar', 'POST', { data: {} }],
      ['descuentos_familiares_eliminar', 'POST', { data: {} }],
      ['configuracion_obtener', 'GET'],
      ['configuracion_lista_guardar', 'POST', { data: {} }],
      ['configuracion_lista_eliminar', 'POST', { data: {} }],
      ['configuracion_lista_baja', 'POST', { data: {} }],
      ['configuracion_lista_reactivar', 'POST', { data: {} }],
      ['configuracion_lista_eliminar_definitivo', 'POST', { data: {} }],
      ['usuarios_listar', 'GET'],
      ['usuarios_guardar', 'POST', { data: {} }],
      ['usuarios_cambiar_estado', 'POST', { data: {} }],
      ['usuarios_eliminar', 'POST', { data: {} }],
    ];

    for (const [action, method, extra = {}] of endpoints) {
      await expectApiError(
        request,
        action,
        { method, session: null, ...extra },
        { status: 401, code: 'SESSION_REQUIRED' },
      );
    }
  });

  test('la sesión autenticada expone el perfil actual y queda invalidada al cerrar sesión', async ({ request }) => {
    const session = await createApiSession(request, {
      username: process.env.PW_USER,
      password: process.env.PW_PASSWORD,
    });

    const current = await apiCall(request, 'auth_usuario_actual', { session });
    expect(current.usuario.id).toBe(session.usuario.id);
    expect(current.usuario.nombre).toBe(session.usuario.nombre);
    expect(current.usuario.rol).toBe('admin');
    expect(current.organizacion).toBeTruthy();

    await closeApiSession(request, session);
    await expectApiError(
      request,
      'auth_usuario_actual',
      { session },
      { status: 401, code: 'SESSION_REQUIRED' },
    );
  });

  test('contabilidad valida período, catálogos y datos obligatorios', async ({ request }) => {
    await expectApiError(
      request,
      'contable_resumen',
      { params: { anio: 'NO_VALIDO', mes: 8 } },
      { status: 422, code: 'FILTRO_INVALIDO', message: /año/i },
    );
    await expectApiError(
      request,
      'contable_ingresos_socios',
      { params: { anio: 2026, mes: 13 } },
      { status: 422, code: 'FILTRO_INVALIDO', message: /mes/i },
    );
    await expectApiError(
      request,
      'contable_opcion_guardar',
      { method: 'POST', data: { tipo: 'TIPO_INEXISTENTE', nombre: 'PRUEBA' } },
      { status: 422, code: 'TIPO_OPCION_INVALIDO' },
    );
    await expectApiError(
      request,
      'contable_opcion_cambiar_estado',
      { method: 'POST', data: { id_opcion: 1, activo: 'tal vez' } },
      { status: 422, code: 'ESTADO_OPCION_INVALIDO' },
    );
    await expectApiError(
      request,
      'contable_opcion_eliminar',
      { method: 'POST', data: { id_opcion: 2147483647 } },
      { status: 404, code: 'OPCION_CONTABLE_NO_ENCONTRADA' },
    );
    await expectApiError(
      request,
      'contable_ingreso_guardar',
      { method: 'POST', data: {} },
      { status: 422, code: 'VALIDATION_ERROR' },
    );
    await expectApiError(
      request,
      'contable_egreso_guardar',
      { method: 'POST', data: {} },
      { status: 422, code: 'VALIDATION_ERROR' },
    );
  });

  test('socios valida filtros, campos, duplicados, tipo inmutable y confirmación destructiva', async ({ request }) => {
    const person = personData();
    const company = companyData();

    try {
      await expectApiError(
        request,
        'socios_listar',
        { params: { tipo: 'OTRO' } },
        { status: 422, code: 'FILTRO_INVALIDO' },
      );
      await expectApiError(
        request,
        'socios_listar',
        { params: { estado: 'BORRADO' } },
        { status: 422, code: 'FILTRO_INVALIDO' },
      );
      await expectApiError(
        request,
        'socios_obtener',
        { params: { id: 0 } },
        { status: 422, code: 'VALIDATION_ERROR' },
      );
      await expectApiError(
        request,
        'socios_obtener',
        { params: { id: 2147483647 } },
        { status: 404, code: 'SOCIO_NO_ENCONTRADO' },
      );
      await expectApiError(
        request,
        'socios_historial',
        { params: { id: 2147483647 } },
        { status: 404, code: 'SOCIO_NO_ENCONTRADO' },
      );
      await expectApiError(
        request,
        'socios_guardar',
        { method: 'POST', data: { tipo_socio: 'OTRO' } },
        { status: 422, code: 'VALIDATION_ERROR' },
      );
      await expectApiError(
        request,
        'socios_guardar',
        {
          method: 'POST',
          data: {
            tipo_socio: 'PERSONA',
            apellido: 'PRUEBA',
            nombre: 'DNI',
            dni: '123',
            fecha_alta: todayIso(),
          },
        },
        { status: 422, code: 'VALIDATION_ERROR', message: /DNI/i },
      );
      await expectApiError(
        request,
        'socios_guardar',
        {
          method: 'POST',
          data: {
            tipo_socio: 'EMPRESA',
            razon_social: 'EMPRESA INVÁLIDA',
            cuit: '2030',
            fecha_alta: todayIso(),
          },
        },
        { status: 422, code: 'VALIDATION_ERROR', message: /CUIT/i },
      );
      await expectApiError(
        request,
        'socios_guardar',
        {
          method: 'POST',
          data: {
            tipo_socio: 'PERSONA',
            apellido: 'PRUEBA',
            nombre: 'EMAIL',
            dni: person.dni,
            email: 'correo-invalido',
            fecha_alta: todayIso(),
          },
        },
        { status: 422, code: 'VALIDATION_ERROR', message: /correo|email/i },
      );

      const saved = await createPerson(request, person);
      expect(saved.id_socio).toBeGreaterThan(0);

      await expectApiError(
        request,
        'socios_guardar',
        {
          method: 'POST',
          data: {
            tipo_socio: 'PERSONA',
            apellido: `${person.apellido} DUPLICADO`,
            nombre: person.nombre,
            dni: person.dni,
            fecha_alta: todayIso(),
          },
        },
        { status: 409, code: 'DNI_DUPLICADO' },
      );
      await expectApiError(
        request,
        'socios_guardar',
        {
          method: 'POST',
          data: {
            id_socio: saved.id_socio,
            tipo_socio: 'EMPRESA',
            razon_social: company.razonSocial,
            cuit: company.cuit,
            fecha_alta: todayIso(),
          },
        },
        { status: 409, code: 'TIPO_SOCIO_INMUTABLE' },
      );
      await expectApiError(
        request,
        'socios_eliminar',
        { method: 'POST', data: { id: saved.id_socio, fecha_baja: todayIso(), motivo_baja: '' } },
        { status: 422, code: 'VALIDATION_ERROR' },
      );
      await expectApiError(
        request,
        'socios_eliminar_definitivo',
        { method: 'POST', data: { id: saved.id_socio, confirmacion: 'NO' } },
        { status: 422, code: 'CONFIRMACION_ELIMINACION_INVALIDA' },
      );
    } finally {
      await cleanupSocioByDocument(request, {
        tipo: 'PERSONA',
        documento: person.dni,
      }).catch(() => false);
      // También limpia una empresa que pudiera haberse creado si una versión
      // anterior del test envió el identificador de edición con una clave incorrecta.
      await cleanupSocioByDocument(request, {
        tipo: 'EMPRESA',
        documento: company.cuit,
      }).catch(() => false);
    }
  });

  test('familias valida integrantes, titular, duplicados, conflictos y estados', async ({ request }) => {
    const memberA = personData();
    const memberB = personData();
    const memberForDelete = personData();
    const family = familyData();
    let personA;
    let personB;
    let personForDelete;

    try {
      await expectApiError(
        request,
        'familias_listar',
        { params: { estado: 'borrada' } },
        { status: 422, code: 'FILTRO_INVALIDO' },
      );
      await expectApiError(
        request,
        'familias_obtener',
        { params: { id: 2147483647 } },
        { status: 404, code: 'FAMILIA_NO_ENCONTRADA' },
      );
      await expectApiError(
        request,
        'familias_guardar',
        { method: 'POST', data: { nombre: family.nombre, integrantes: [] } },
        { status: 422, code: 'VALIDATION_ERROR', message: /integrante/i },
      );

      personA = await createPerson(request, memberA);
      personB = await createPerson(request, memberB);
      personForDelete = await createPerson(request, memberForDelete);

      const memberPayload = (person, titular) => ({
        id_socio: person.id_socio,
        parentesco: titular ? 'TITULAR' : 'INTEGRANTE',
        es_titular: titular,
        fecha_incorporacion: todayIso(),
        observaciones: 'CONTRATO E2E',
      });

      await expectApiError(
        request,
        'familias_guardar',
        {
          method: 'POST',
          data: {
            nombre: `${family.nombre} TITULARES`,
            integrantes: [memberPayload(personA, true), memberPayload(personB, true)],
          },
        },
        { status: 409, code: 'TITULAR_DUPLICADO' },
      );

      const saved = await createFamily(request, family, [personA, personB]);
      expect(saved.id_familia).toBeGreaterThan(0);

      await expectApiError(
        request,
        'familias_guardar',
        {
          method: 'POST',
          data: {
            nombre: family.nombre,
            integrantes: [memberPayload(personB, true)],
          },
        },
        { status: 409, code: 'FAMILIA_DUPLICADA' },
      );
      await expectApiError(
        request,
        'familias_guardar',
        {
          method: 'POST',
          data: {
            nombre: `${family.nombre} OTRA`,
            integrantes: [memberPayload(personA, true)],
          },
        },
        { status: 409, code: 'SOCIO_YA_TIENE_FAMILIA' },
      );
      await expectApiError(
        request,
        'familias_guardar',
        {
          method: 'POST',
          data: {
            id_familia: saved.id_familia,
            nombre: family.nombre,
            integrantes: [memberPayload(personA, true)],
          },
        },
        { status: 422, code: 'MOTIVO_DESVINCULACION_REQUERIDO' },
      );

      await apiCall(request, 'familias_eliminar', {
        method: 'POST',
        data: { id: saved.id_familia, fecha_baja: todayIso(), motivo_baja: 'BAJA E2E' },
      });
      await expectApiError(
        request,
        'familias_eliminar',
        { method: 'POST', data: { id: saved.id_familia } },
        { status: 409, code: 'ESTADO_SIN_CAMBIOS' },
      );
      await expectApiError(
        request,
        'familias_guardar',
        {
          method: 'POST',
          data: {
            id_familia: saved.id_familia,
            nombre: `${family.nombre} EDITADA`,
            integrantes: [memberPayload(personA, true)],
          },
        },
        { status: 409, code: 'FAMILIA_INACTIVA' },
      );
      await apiCall(request, 'familias_reactivar', {
        method: 'POST',
        data: { id: saved.id_familia },
      });
      await expectApiError(
        request,
        'familias_reactivar',
        { method: 'POST', data: { id: saved.id_familia } },
        { status: 409, code: 'ESTADO_SIN_CAMBIOS' },
      );

      // Reactivar conserva el historial, pero no reconstruye los vínculos. Se
      // incorpora un tercer socio sin vínculo histórico para probar el borrado
      // de una familia activa sin duplicar el par familia-socio conservado.
      await apiCall(request, 'familias_guardar', {
        method: 'POST',
        data: {
          id_familia: saved.id_familia,
          nombre: family.nombre,
          descripcion: family.descripcion,
          integrantes: [memberPayload(personForDelete, true)],
        },
      });
      await expectApiError(
        request,
        'familias_eliminar_definitivo',
        {
          method: 'POST',
          data: { id: saved.id_familia, confirmacion: 'NO' },
        },
        { status: 422, code: 'CONFIRMACION_ELIMINACION_INVALIDA' },
      );

      const deletedActive = await apiCall(request, 'familias_eliminar_definitivo', {
        method: 'POST',
        data: { id: saved.id_familia, confirmacion: 'ELIMINAR' },
      });
      expect(deletedActive.id_familia).toBe(saved.id_familia);
      expect(deletedActive.impacto_eliminacion).toEqual({
        socios_sin_familia: 1,
        vinculos_eliminados: 3,
      });
      await expectApiError(
        request,
        'familias_obtener',
        { params: { id: saved.id_familia } },
        { status: 404, code: 'FAMILIA_NO_ENCONTRADA' },
      );

      for (const person of [personA, personB, personForDelete]) {
        const preserved = await apiCall(request, 'socios_obtener', {
          params: { id: person.id_socio },
        });
        expect(preserved.item.id_socio).toBe(person.id_socio);
        expect(preserved.item.id_familia).toBeNull();
        expect(preserved.item.familia).toBeNull();
      }

      const inactiveFamily = await createFamily(
        request,
        {
          ...family,
          nombre: `${family.nombre} BAJA DEFINITIVA`,
          descripcion: `${family.descripcion} BAJA DEFINITIVA`,
        },
        [personB],
      );
      await apiCall(request, 'familias_eliminar', {
        method: 'POST',
        data: {
          id: inactiveFamily.id_familia,
          fecha_baja: todayIso(),
          motivo_baja: 'BAJA PREVIA A ELIMINACIÓN DEFINITIVA E2E',
        },
      });
      const deletedInactive = await apiCall(request, 'familias_eliminar_definitivo', {
        method: 'POST',
        data: { id: inactiveFamily.id_familia, confirmacion: 'ELIMINAR' },
      });
      expect(deletedInactive.impacto_eliminacion).toEqual({
        socios_sin_familia: 0,
        vinculos_eliminados: 1,
      });
      await expectApiError(
        request,
        'familias_obtener',
        { params: { id: inactiveFamily.id_familia } },
        { status: 404, code: 'FAMILIA_NO_ENCONTRADA' },
      );
      const preservedAfterInactiveDelete = await apiCall(request, 'socios_obtener', {
        params: { id: personB.id_socio },
      });
      expect(preservedAfterInactiveDelete.item.id_familia).toBeNull();
    } finally {
      try {
        cleanupFamilyByPrefix(family.prefix);
      } catch (_error) {
        // La familia puede no haberse creado.
      }
      for (const target of [memberA, memberB, memberForDelete]) {
        await cleanupSocioByDocument(request, {
          tipo: 'PERSONA',
          documento: target.dni,
        }).catch(() => false);
      }
    }
  });

  test('los dos catálogos validan altas, duplicados, baja, reactivación y eliminación definitiva con desvinculación', async ({ request }) => {
    const suffix = uniqueSuffix();
    const definitions = [
      {
        list: 'medios_pago',
        idField: 'id_medio_pago',
        name: `PW E2E MEDIO API ${suffix}`,
        usedName: `PW E2E MEDIO USADO ${suffix}`,
        owner: personData(),
        type: 'PERSONA',
      },
      {
        list: 'condiciones_iva',
        idField: 'id_condicion_iva',
        name: `PW E2E IVA API ${suffix}`,
        usedName: `PW E2E IVA USADA ${suffix}`,
        owner: companyData(),
        type: 'EMPRESA',
      },
    ];

    try {
      await expectApiError(
        request,
        'configuracion_lista_guardar',
        { method: 'POST', data: { lista: 'otra', nombre: 'X' } },
        { status: 422, code: 'LISTA_CONFIGURACION_INVALIDA' },
      );
      await expectApiError(
        request,
        'configuracion_lista_guardar',
        { method: 'POST', data: { lista: 'medios_pago', nombre: '' } },
        { status: 422, code: 'VALIDATION_ERROR' },
      );

      for (const definition of definitions) {
        const unused = await createCatalog(request, definition.list, definition.name);
        expect(unused[definition.idField]).toBeGreaterThan(0);
        await expectApiError(
          request,
          'configuracion_lista_guardar',
          { method: 'POST', data: { lista: definition.list, nombre: definition.name } },
          { status: 409, code: 'NOMBRE_DUPLICADO' },
        );

        // Conservamos también la ruta histórica configuracion_lista_eliminar como
        // contrato de compatibilidad: hoy equivale a eliminación definitiva.
        const removedUnused = await apiCall(request, 'configuracion_lista_eliminar', {
          method: 'POST',
          data: { lista: definition.list, id: unused[definition.idField] },
        });
        expect(removedUnused.eliminado_definitivo).toBe(true);
        expect(removedUnused.cantidad_usos).toBe(0);
        expect(removedUnused.registros_desvinculados).toBe(0);
        expect(await findCatalogByName(request, definition.list, definition.name)).toBeNull();

        const used = await createCatalog(request, definition.list, definition.usedName);
        let owner;
        if (definition.type === 'PERSONA') {
          owner = await createPerson(request, definition.owner, {
            id_medio_pago: used[definition.idField],
          });
        } else {
          owner = await createCompany(request, definition.owner, {
            id_condicion_iva: used[definition.idField],
          });
        }

        const disabled = await apiCall(request, 'configuracion_lista_baja', {
          method: 'POST',
          data: { lista: definition.list, id: used[definition.idField] },
        });
        expect(disabled.eliminado_definitivo).toBe(false);
        expect(disabled.item.activo).toBe(false);

        const stillLinkedWhileInactive = await apiCall(request, 'socios_obtener', {
          params: { id: owner.id_socio },
        });
        expect(stillLinkedWhileInactive.item[definition.idField]).toBe(used[definition.idField]);

        const reactivated = await apiCall(request, 'configuracion_lista_reactivar', {
          method: 'POST',
          data: { lista: definition.list, id: used[definition.idField] },
        });
        expect(reactivated.item.activo).toBe(true);

        const removedUsed = await apiCall(request, 'configuracion_lista_eliminar_definitivo', {
          method: 'POST',
          data: { lista: definition.list, id: used[definition.idField] },
        });
        expect(removedUsed.eliminado_definitivo).toBe(true);
        expect(removedUsed.cantidad_usos).toBeGreaterThanOrEqual(1);
        expect(removedUsed.registros_desvinculados).toBeGreaterThanOrEqual(1);
        expect(await findCatalogByName(request, definition.list, definition.usedName)).toBeNull();

        const ownerAfterDelete = await apiCall(request, 'socios_obtener', {
          params: { id: owner.id_socio },
        });
        expect(ownerAfterDelete.item[definition.idField]).toBeNull();
      }
    } finally {
      for (const definition of definitions) {
        await cleanupSocioByDocument(request, {
          tipo: definition.type,
          documento: definition.type === 'PERSONA'
            ? definition.owner.dni
            : definition.owner.cuit,
        }).catch(() => false);
        await cleanupCatalogByName(request, definition.list, definition.name).catch(() => false);
        await cleanupCatalogByName(request, definition.list, definition.usedName).catch(() => false);
      }
    }
  });

  test('usuarios valida formato, autoprotección, baja y eliminación definitiva aun con historial', async ({ request }) => {
    const user = userData();
    const currentSession = readAuthSession();
    let created;
    let userSession;

    try {
      await expectApiError(
        request,
        'usuarios_guardar',
        {
          method: 'POST',
          data: {
            usuario: 'ab',
            rol: 'vista',
            contrasena: 'Password123',
            confirmar_contrasena: 'Password123',
          },
        },
        { status: 422, code: 'VALIDATION_ERROR', message: /3 caracteres/i },
      );
      await expectApiError(
        request,
        'usuarios_guardar',
        {
          method: 'POST',
          data: {
            usuario: `pw e2e ${uniqueSuffix()}`,
            rol: 'vista',
            contrasena: 'Password123',
            confirmar_contrasena: 'Password123',
          },
        },
        { status: 422, code: 'VALIDATION_ERROR' },
      );
      await expectApiError(
        request,
        'usuarios_guardar',
        {
          method: 'POST',
          data: {
            usuario: `${user.username}_mail`,
            email: 'correo-invalido',
            rol: 'vista',
            contrasena: user.password,
            confirmar_contrasena: user.password,
          },
        },
        { status: 422, code: 'VALIDATION_ERROR', message: /email/i },
      );
      await expectApiError(
        request,
        'usuarios_guardar',
        {
          method: 'POST',
          data: {
            usuario: `${user.username}_rol`,
            rol: 'superadmin',
            contrasena: user.password,
            confirmar_contrasena: user.password,
          },
        },
        { status: 422, code: 'VALIDATION_ERROR', message: /rol/i },
      );
      await expectApiError(
        request,
        'usuarios_guardar',
        {
          method: 'POST',
          data: {
            usuario: `${user.username}_pass`,
            rol: 'vista',
            contrasena: 'corta',
            confirmar_contrasena: 'corta',
          },
        },
        { status: 422, code: 'VALIDATION_ERROR', message: /8 y 128/i },
      );

      created = await createUser(request, user);
      expect(created.id).toBeGreaterThan(0);

      await expectApiError(
        request,
        'usuarios_guardar',
        {
          method: 'POST',
          data: {
            usuario: user.username,
            email: `otro.${user.email}`,
            rol: 'vista',
            contrasena: user.password,
            confirmar_contrasena: user.password,
          },
        },
        { status: 409, code: 'USUARIO_DUPLICADO' },
      );
      await expectApiError(
        request,
        'usuarios_guardar',
        {
          method: 'POST',
          data: {
            usuario: `${user.username}_otro`,
            email: user.email,
            rol: 'vista',
            contrasena: user.password,
            confirmar_contrasena: user.password,
          },
        },
        { status: 409, code: 'EMAIL_DUPLICADO' },
      );

      const users = await apiCall(request, 'usuarios_listar');
      const current = users.usuarios.find((item) => item.id === currentSession.usuario.id);
      expect(current).toBeTruthy();
      await expectApiError(
        request,
        'usuarios_guardar',
        {
          method: 'POST',
          data: {
            id: current.id,
            usuario: `pw_self_${uniqueSuffix().toLowerCase()}`.slice(0, 80),
            email: current.email,
            rol: 'vista',
            contrasena: '',
            confirmar_contrasena: '',
          },
        },
        { status: 409, code: 'USUARIO_ACTUAL_ROL' },
      );
      await expectApiError(
        request,
        'usuarios_cambiar_estado',
        { method: 'POST', data: { id: current.id, activo: false } },
        { status: 409, code: 'USUARIO_ACTUAL_BAJA' },
      );
      await expectApiError(
        request,
        'usuarios_eliminar',
        { method: 'POST', data: { id: current.id } },
        { status: 409, code: 'USUARIO_ACTUAL_ELIMINAR' },
      );
      await expectApiError(
        request,
        'usuarios_cambiar_estado',
        { method: 'POST', data: { id: created.id, activo: 'tal vez' } },
        { status: 422, code: 'VALIDATION_ERROR' },
      );

      await apiCall(request, 'usuarios_cambiar_estado', {
        method: 'POST',
        data: { id: created.id, activo: false },
      });
      await expectApiError(
        request,
        'auth_login',
        {
          method: 'POST',
          session: null,
          data: { usuario: user.username, contrasena: user.password },
        },
        { status: 403, code: 'USER_DISABLED' },
      );
      await apiCall(request, 'usuarios_cambiar_estado', {
        method: 'POST',
        data: { id: created.id, activo: true },
      });

      userSession = await createApiSession(request, {
        username: user.username,
        password: user.password,
      });
      await closeApiSession(request, userSession);
      userSession = null;

      const usersWithHistory = await apiCall(request, 'usuarios_listar');
      const userWithHistory = usersWithHistory.usuarios.find(
        (item) => Number(item.id) === Number(created.id),
      );
      expect(userWithHistory).toBeTruthy();
      expect(Number(userWithHistory.cantidad_accesos)).toBeGreaterThan(0);
      expect(userWithHistory.puede_eliminar).toBe(true);

      const deleted = await apiCall(request, 'usuarios_eliminar', {
        method: 'POST',
        data: { id: created.id },
      });
      expect(Number(deleted.id)).toBe(Number(created.id));

      const usersAfterDelete = await apiCall(request, 'usuarios_listar');
      expect(
        usersAfterDelete.usuarios.some((item) => Number(item.id) === Number(created.id)),
      ).toBe(false);
      created = null;
    } finally {
      await closeApiSession(request, userSession).catch(() => undefined);
      try {
        cleanupUsersByPrefix(user.username);
      } catch (_error) {
        // La limpieza protegida puede estar deshabilitada fuera del entorno local.
      }
    }
  });
});
