const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, expectApiError } = require('./helpers/api.helper');
const { createSocio } = require('./helpers/entities.helper');
const { todayIso } = require('./helpers/data.helper');
const { familyData, socioData } = require('./fixtures/socios.fixture');
const { createQuotaCategory, createQuotaSocio, currentYear, paymentPayload, quotaCatalogs } = require('./helpers/cuotas.helper');

test.describe('Socios y familias · contratos API complementarios', () => {
  test('próximo número de socio se reserva de forma explícita y nunca cambia silenciosamente', async ({ request }) => {
    const data = socioData('ID EXPLICITO API');
    let preview = null;
    let created = null;

    // Si una alta real concurrente consume el número entre GET y POST, el
    // contrato correcto es 409 + refrescar el próximo ID. Reintentamos sólo
    // esa carrera válida para que el test no sea frágil en producción.
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      preview = await apiCall(request, 'socios_proximo_id');
      const previewId = Number(preview.id_socio);
      expect(previewId).toBeGreaterThan(0);

      // Un número anterior al sugerido nunca debe poder reutilizarse sólo
      // porque el socio correspondiente haya sido eliminado físicamente. El
      // backend conserva la marca histórica real y rechaza IDs viejos.
      if (previewId > 1) {
        await expect(
          createSocio(request, socioData('ID HISTORICO NO REUTILIZABLE'), {
            id_socio_nuevo: previewId - 1,
          }),
        ).rejects.toMatchObject({ status: 409, code: 'ID_SOCIO_DESACTUALIZADO' });
      }

      try {
        created = await createSocio(request, data, { id_socio_nuevo: Number(preview.id_socio) });
      } catch (error) {
        if (error?.code !== 'ID_SOCIO_DESACTUALIZADO') throw error;
      }
    }

    expect(created).toBeTruthy();
    expect(Number(created.id_socio)).toBe(Number(preview.id_socio));

    const next = await apiCall(request, 'socios_proximo_id');
    expect(Number(next.id_socio)).toBeGreaterThan(Number(created.id_socio));

    await expect(
      createSocio(request, socioData('ID VIEJO API'), { id_socio_nuevo: Number(created.id_socio) }),
    ).rejects.toMatchObject({ status: 409, code: 'ID_SOCIO_DESACTUALIZADO' });

    await expectApiError(request, 'socios_guardar', {
      method: 'POST',
      data: { id_socio: created.id_socio, id_socio_nuevo: created.id_socio },
    }, { status: 422, code: 'VALIDATION_ERROR' });
  });

  test('obtener, historial, contacto y ciclo baja/reactivación mantienen persistencia', async ({ request }) => {
    const data = socioData('API COMPLEMENTO');
    const created = await createSocio(request, data);

    const detail = await apiCall(request, 'socios_obtener', { params: { id: created.id_socio } });
    expect(detail.item.id_socio).toBe(created.id_socio);
    expect(detail.item.nombre).toBe(data.nombre);

    let history = await apiCall(request, 'socios_historial', { params: { id: created.id_socio } });
    expect(Array.isArray(history.historial_estados)).toBe(true);

    const contact = await apiCall(request, 'socios_contacto_guardar', {
      method: 'POST',
      data: {
        id_socio: created.id_socio,
        fecha_contacto: todayIso(),
        estado_contacto: 'PENDIENTE',
        detalle_contacto: 'PW E2E CONTACTO API',
      },
    });
    expect(contact.contacto.estado_contacto).toBe('PENDIENTE');

    await expectApiError(request, 'socios_contacto_guardar', {
      method: 'POST', data: { id_socio: created.id_socio, estado_contacto: 'INVALIDO' },
    }, { status: 422, code: 'VALIDATION_ERROR' });

    const bajaReason = 'PW E2E BAJA API';
    const bajaDate = todayIso();
    const baja = await apiCall(request, 'socios_eliminar', {
      method: 'POST', data: { id: created.id_socio, fecha_baja: bajaDate, motivo_baja: bajaReason },
    });
    expect(baja.item.vigente).toBe(false);
    expect(baja.item.fecha_baja).toBe(bajaDate);
    expect(baja.item.motivo_baja).toBe(bajaReason);

    const detailAfterBaja = await apiCall(request, 'socios_obtener', { params: { id: created.id_socio } });
    expect(detailAfterBaja.item.fecha_baja).toBe(bajaDate);
    expect(detailAfterBaja.item.motivo_baja).toBe(bajaReason);

    await apiCall(request, 'socios_reactivar', {
      method: 'POST', data: { id: created.id_socio, fecha_reactivacion: todayIso(), motivo_reactivacion: 'PW E2E REACTIVACION API' },
    });

    history = await apiCall(request, 'socios_historial', { params: { id: created.id_socio } });
    const rows = history.historial_estados || [];
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Una única operación de reactivación debe producir exactamente un evento.
    // Esto protege instalaciones heredadas donde un trigger sobre socios.vigente
    // ya crea REACTIVACION y antes el backend insertaba una segunda fila.
    const reactivations = rows.filter((row) => row.tipo_evento === 'REACTIVACION');
    expect(reactivations).toHaveLength(1);
    expect(reactivations[0]).toMatchObject({
      vigente_anterior: false,
      vigente_nuevo: true,
      motivo: 'PW E2E REACTIVACION API',
    });
    expect(String(reactivations[0].fecha_evento || '')).toContain(todayIso());
  });

  test('listar y obtener rechazan filtros/IDs inválidos sin tocar datos', async ({ request }) => {
    await expectApiError(request, 'socios_obtener', { params: { id: 0 } }, { status: 422 });
    await expectApiError(request, 'socios_listar', { params: { pagina: -1 } }, { status: 422 });
  });

  test.describe('Familias API', () => {
    // En Windows se observó una salida nativa aislada del worker antes de ejecutar
    // el test (0 ms). Un único retry permite distinguir ese crash del sistema de
    // una falla funcional real: si la API está mal, el segundo intento también falla.
    test.describe.configure({ retries: process.platform === 'win32' ? 1 : 0 });

    test('familias: guardar/obtener/baja/reactivar/eliminar y validaciones directas', async ({ request }) => {
    const a = await createSocio(request, socioData('FAM API A'));
    const b = await createSocio(request, socioData('FAM API B'));
    const family = familyData();

    const saved = await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [
          { id_socio: a.id_socio, desde: todayIso() },
          { id_socio: b.id_socio, desde: todayIso() },
        ],
      },
    });
    const id = saved.item.id_familia;

    let detail = await apiCall(request, 'familias_obtener', { params: { id } });
    expect(detail.item.id_familia).toBe(id);
    expect(detail.item.integrantes).toHaveLength(2);

    await expectApiError(request, 'familias_guardar', {
      method: 'POST', data: { nombre: family.nombre, integrantes: [{ id_socio: a.id_socio }] },
    }, { status: 409, code: 'FAMILIA_DUPLICADA' });

    await expectApiError(request, 'familias_eliminar_definitivo', {
      method: 'POST', data: { id, confirmacion: 'ELIMINAR' },
    }, { status: 409, code: 'FAMILIA_ACTIVA_NO_ELIMINABLE' });

    await apiCall(request, 'familias_eliminar', {
      method: 'POST', data: { id, fecha_baja: todayIso(), motivo_baja: 'PW E2E BAJA FAMILIA API' },
    });
    detail = await apiCall(request, 'familias_obtener', { params: { id } });
    expect(detail.item.activo).toBe(false);
    expect(detail.item.integrantes).toHaveLength(0);
    expect(detail.item.historial_integrantes).toHaveLength(2);

    await apiCall(request, 'familias_reactivar', { method: 'POST', data: { id } });
    detail = await apiCall(request, 'familias_obtener', { params: { id } });
    expect(detail.item.activo).toBe(true);
    expect(detail.item.integrantes).toHaveLength(0);

    await expectApiError(request, 'familias_eliminar_definitivo', {
      method: 'POST', data: { id, confirmacion: 'ELIMINAR' },
    }, { status: 409, code: 'FAMILIA_ACTIVA_NO_ELIMINABLE' });

    await apiCall(request, 'familias_eliminar', {
      method: 'POST', data: { id, fecha_baja: todayIso(), motivo_baja: 'PW E2E BAJA FINAL' },
    });
    const deleted = await apiCall(request, 'familias_eliminar_definitivo', {
      method: 'POST', data: { id, confirmacion: 'ELIMINAR' },
    });
    expect(Number(deleted.id_familia)).toBe(Number(id));
    expect(Number(deleted.impacto_eliminacion.vinculos_eliminados)).toBe(2);
    expect(Number(deleted.impacto_eliminacion.vinculos_historicos_preservados)).toBe(2);
    expect(Number(deleted.impacto_eliminacion.socios_sin_familia)).toBe(0);

    await expectApiError(request, 'familias_obtener', {
      params: { id },
    }, { status: 404, code: 'FAMILIA_NO_ENCONTRADA' });
    await expectApiError(request, 'familias_reactivar', {
      method: 'POST', data: { id },
    }, { status: 404, code: 'FAMILIA_NO_ENCONTRADA' });
    const deletedSearch = await apiCall(request, 'familias_listar', {
      params: { estado: 'inactivo', buscar: family.nombre },
    });
    expect(
      deletedSearch.items.some((item) => Number(item.id_familia) === Number(id)),
    ).toBe(false);
    const stillA = await apiCall(request, 'socios_obtener', { params: { id: a.id_socio } });
    const stillB = await apiCall(request, 'socios_obtener', { params: { id: b.id_socio } });
    expect(Number(stillA.item.id_socio)).toBe(Number(a.id_socio));
    expect(Number(stillB.item.id_socio)).toBe(Number(b.id_socio));
    });
  });

  test('eliminación definitiva saca al socio del padrón y preserva pagos/inscripción en Contabilidad', async ({ request }) => {
    const category = await createQuotaCategory(request);
    const socio = await createQuotaSocio(request, 'DELETE CON TRAZABILIDAD', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const currentPeriodId = Math.ceil(Number(todayIso().slice(5, 7)) / 2);

    const paid = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: socio.item.id_socio,
        periodId,
        mediumId: catalogs.medium.id_medio_pago,
      }),
    });
    expect(paid.items).toHaveLength(1);

    const registrationMedium = (catalogs.catalogos.medios_pago || []).find((item) => {
      const name = String(item.nombre || '').toUpperCase();
      return item.activo !== false && (name.includes('EFECTIVO') || name.includes('TRANSFERENCIA'));
    });
    if (!registrationMedium) throw new Error('Cuotas E2E requiere EFECTIVO o TRANSFERENCIA para inscripción.');

    const registration = await apiCall(request, 'cuotas_registrar_inscripcion', {
      method: 'POST',
      data: {
        id_socio: socio.item.id_socio,
        fecha_pago: todayIso(),
        monto: '12345',
        id_medio_pago: registrationMedium.id_medio_pago,
      },
    });
    expect(Number(registration.item.id_socio)).toBe(Number(socio.item.id_socio));

    const before = await apiCall(request, 'contable_ingresos_socios', {
      params: {
        anio: currentYear(),
        periodo: currentPeriodId,
        pagina: 1,
        buscar: socio.data.dni,
      },
    });
    const beforeRows = before.detalle.items.filter(
      (item) => Number(item.id_socio) === Number(socio.item.id_socio),
    );
    expect(beforeRows.some((item) => item.tipo_ingreso === 'CUOTA')).toBe(true);
    expect(beforeRows.some((item) => item.tipo_ingreso === 'INSCRIPCIÓN')).toBe(true);

    const deleted = await apiCall(request, 'socios_eliminar_definitivo', {
      method: 'POST', data: { id: socio.item.id_socio },
    });
    expect(deleted.id_socio).toBe(socio.item.id_socio);
    expect(Number(deleted.preservados.pagos)).toBe(1);
    expect(Number(deleted.preservados.pagos_inscripcion)).toBe(1);

    // Para Socios el registro ya no existe.
    await expectApiError(request, 'socios_obtener', { params: { id: socio.item.id_socio } }, {
      status: 404, code: 'SOCIO_NO_ENCONTRADO',
    });
    const sociosList = await apiCall(request, 'socios_listar', {
      params: { vigente: '', buscar: socio.data.dni, pagina: 1 },
    });
    expect((sociosList.items || []).some((item) => Number(item.id_socio) === Number(socio.item.id_socio))).toBe(false);

    // Tampoco puede reaparecer ni reactivarse desde módulos operativos.
    await expectApiError(request, 'socios_reactivar', {
      method: 'POST',
      data: { id: socio.item.id_socio, fecha_reactivacion: todayIso() },
    }, { status: 404, code: 'SOCIO_NO_ENCONTRADO' });

    const paidList = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'PAGADOS', anio: currentYear(), mes: periodId, buscar: socio.data.dni },
    });
    expect((paidList.items || []).some((item) => Number(item.id_socio) === Number(socio.item.id_socio))).toBe(false);

    // Contabilidad conserva ambos movimientos y también el DNI original,
    // aunque socios.dni se libere para permitir una carga correcta posterior.
    const after = await apiCall(request, 'contable_ingresos_socios', {
      params: {
        anio: currentYear(),
        periodo: currentPeriodId,
        pagina: 1,
        buscar: socio.data.dni,
      },
    });
    const afterRows = after.detalle.items.filter(
      (item) => Number(item.id_socio) === Number(socio.item.id_socio),
    );
    expect(afterRows.some((item) => item.tipo_ingreso === 'CUOTA' && Number(item.id_pago) === Number(paid.items[0].id_pago))).toBe(true);
    expect(afterRows.some((item) => item.tipo_ingreso === 'INSCRIPCIÓN' && Number(item.id_inscripcion) === Number(registration.item.id_inscripcion))).toBe(true);
    expect(afterRows.every((item) => String(item.dni) === String(socio.data.dni))).toBe(true);

    // Una vez eliminado del padrón, esos movimientos pasan a ser historia contable:
    // ni Cuotas ni un cliente API directo pueden modificarlos o borrarlos.
    await expectApiError(request, 'cuotas_eliminar_pago', {
      method: 'POST', data: { id_pago: paid.items[0].id_pago },
    }, { status: 409, code: 'MOVIMIENTO_HISTORICO_PROTEGIDO' });
    await expectApiError(request, 'cuotas_eliminar_inscripcion', {
      method: 'POST', data: { id_inscripcion: registration.item.id_inscripcion },
    }, { status: 409, code: 'MOVIMIENTO_HISTORICO_PROTEGIDO' });

    // El DNI queda realmente liberado: un socio corregido puede darse de alta.
    const replacement = await createSocio(
      request,
      { ...socio.data, nombre: `${socio.data.nombre} REINGRESO` },
      { id_categoria: category.item.id_categoria, fecha_ingreso: todayIso() },
    );
    expect(replacement.dni).toBe(socio.data.dni);
    expect(Number(replacement.id_socio)).not.toBe(Number(socio.item.id_socio));
  });

});
