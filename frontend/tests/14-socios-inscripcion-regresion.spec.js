const { test, expect } = require('./fixtures/auth.fixture');
const { apiCall, apiResult, expectApiError } = require('./helpers/api.helper');
const { todayIso, addDaysIso } = require('./helpers/data.helper');
const { createSocio } = require('./helpers/entities.helper');
const { socioData } = require('./fixtures/socios.fixture');
const {
  createQuotaCategory, createQuotaSocio, currentYear, quotaCatalogs,
} = require('./helpers/cuotas.helper');

const contextParams = (id) => ({ id_socio: id, anio: currentYear(), fecha_pago: todayIso() });
const condone = (request, id, extra = {}) => apiCall(request, 'cuotas_condonar_inscripcion', {
  method: 'POST', data: { id_socio: id, fecha_condonacion: todayIso(), ...extra },
});
const remove = (request, id) => apiCall(request, 'cuotas_eliminar_inscripcion', {
  method: 'POST', data: { id_inscripcion: id },
});
async function setup(request, label) {
  const category = await createQuotaCategory(request);
  const socio = await createQuotaSocio(request, label, category.item.id_categoria);
  const catalogs = await quotaCatalogs(request);
  const medium = catalogs.catalogos.medios_pago.find((item) =>
    item.activo !== false && /EFECTIVO|TRANSFERENCIA/i.test(item.nombre));
  if (!medium) throw new Error('Se requiere EFECTIVO o TRANSFERENCIA activo.');
  return { socio, medium, catalogs };
}
async function openRegistration(page, socio) {
  await page.goto('/cuotas');
  await page.getByLabel('Año').selectOption(String(currentYear()));
  await page.getByLabel('Mes', { exact: true }).selectOption('1');
  await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(socio.item.id_socio));
  const row = page.getByRole('row').filter({ hasText: socio.data.nombre }).last();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Registrar pago de ${socio.data.nombre}` }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: socio.data.nombre }).last();
  await dialog.getByRole('tab', { name: /^Inscripción/ }).click();
  await expect(dialog.getByRole('region', { name: 'Pago de inscripción' })).toBeVisible();
  return dialog;
}

test.describe('Regresión · nombre completo e inscripción condonable', () => {
  test('editar conserva nombre compuesto de más de 50 caracteres, orden y acentos', async ({ page, request }) => {
    const data = socioData('DE LA CRUZ MARÍA JOSÉ DEL CARMEN');
    const socio = await createSocio(request, data);
    expect(data.nombre.length).toBeGreaterThan(50);
    await page.goto('/socios/personas');
    await page.getByRole('textbox', { name: 'Socio', exact: true }).fill(data.dni);
    const row = page.getByRole('row').filter({ hasText: data.nombre }).last();
    await expect(row).toBeVisible();
    await row.getByTitle('Editar socio', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Editar socio' });
    const name = dialog.getByLabel('Nombre completo *', { exact: true });
    await expect(name).toHaveValue(data.nombre);
    await expect(name).toHaveAttribute('maxlength', '100');
    await expect(dialog.getByLabel('Apellido *', { exact: true })).toHaveCount(0);
    // Guardar otro campo no puede cortar ni reconstruir el nombre existente.
    await dialog.getByLabel('Domicilio', { exact: true }).fill('CALLE PRUEBA NOMBRE COMPLETO');
    await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(dialog).toBeHidden();
    const stored = await apiCall(request, 'socios_obtener', { params: { id: socio.id_socio } });
    expect(stored.item.nombre).toBe(data.nombre);
    expect(stored.item.domicilio).toBe('CALLE PRUEBA NOMBRE COMPLETO');
  });

  test('condonación persiste $0, sin medio, motivo y fecha; no aumenta ingresos ni condona cuotas', async ({ request }) => {
    const { socio, medium } = await setup(request, 'CONDONACION INTEGRAL');
    const id = socio.item.id_socio;
    const reportParams = { anio: currentYear(), periodo: Math.ceil(Number(todayIso().slice(5, 7)) / 2), id_socio: id };
    const beforeContext = await apiCall(request, 'cuotas_contextos_pago', { params: contextParams(id) });
    const beforeReport = await apiCall(request, 'contable_ingresos_socios', { params: reportParams });
    const beforeSummary = await apiCall(request, 'contable_resumen', {
      params: { anio: currentYear(), mes: Number(todayIso().slice(5, 7)) },
    });
    const waived = await condone(request, id, {
      motivo: 'PW E2E EXENCION DE INSCRIPCION', monto: 6000, id_medio_pago: medium.id_medio_pago,
    });
    expect(waived.item.estado).toBe('CONDONADO');
    expect(Number(waived.item.monto)).toBe(0);
    expect(waived.item.id_medio_pago).toBeNull();
    expect(waived.item.medio_pago).toBeNull();
    expect(waived.item.fecha_pago).toBe(todayIso());
    expect(waived.item.motivo_condonacion).toBe('PW E2E EXENCION DE INSCRIPCION');
    const afterContext = await apiCall(request, 'cuotas_contextos_pago', { params: contextParams(id) });
    expect(afterContext.inscripcion).toMatchObject({ registrada: true, condonada: true, pagada: false, estado: 'CONDONADO' });
    expect(afterContext.inscripcion.pago.motivo_condonacion).toBe(waived.item.motivo_condonacion);
    expect(afterContext.inscripcion.monto_sugerido).toBe(beforeContext.inscripcion.monto_sugerido);
    expect(afterContext.periodos).toEqual(beforeContext.periodos);
    const history = await apiCall(request, 'socios_historial', { params: { id } });
    const registration = history.pagos_inscripcion.find((item) => Number(item.id_inscripcion) === Number(waived.item.id_inscripcion));
    expect(registration).toMatchObject({ estado: 'CONDONADO', motivo_condonacion: waived.item.motivo_condonacion });
    const afterReport = await apiCall(request, 'contable_ingresos_socios', { params: reportParams });
    expect(afterReport.detalle.items.some((item) => Number(item.id_inscripcion) === Number(waived.item.id_inscripcion))).toBe(false);
    expect(afterReport.cobranza.resumen.inscripciones_recaudadas).toBe(beforeReport.cobranza.resumen.inscripciones_recaudadas);
    expect(afterReport.cobranza.resumen.inscripciones_socios).toBe(beforeReport.cobranza.resumen.inscripciones_socios);
    const afterSummary = await apiCall(request, 'contable_resumen', {
      params: { anio: currentYear(), mes: Number(todayIso().slice(5, 7)) },
    });
    expect(afterSummary.resumen.totales.ingresos).toBe(beforeSummary.resumen.totales.ingresos);
    const { balance } = await apiCall(request, 'contable_balance', {
      params: { desde: `${currentYear()}-01-01`, hasta: todayIso() },
    });
    const balanceRow = balance.inscripciones.items.find((item) => Number(item.id_socio) === Number(id));
    expect(balanceRow).toMatchObject({ tipo: 'CONDONADA', estado_inscripcion: 'CONDONADO', monto: '0.00' });
    const summary = balance.inscripciones.resumen;
    expect(Number(summary.inscripciones)).toBe(Number(summary.pagadas) + Number(summary.sin_importe) + Number(summary.sin_registro));
    await expectApiError(request, 'cuotas_condonar_inscripcion', {
      method: 'POST', data: { id_socio: id, fecha_condonacion: todayIso() },
    }, { status: 409, code: 'INSCRIPCION_YA_REGISTRADA' });
    await expectApiError(request, 'cuotas_registrar_inscripcion', {
      method: 'POST', data: { id_socio: id, fecha_pago: todayIso(), monto: 6000, id_medio_pago: medium.id_medio_pago },
    }, { status: 409, code: 'INSCRIPCION_YA_REGISTRADA' });
    const removed = await remove(request, waived.item.id_inscripcion);
    expect(removed.item.estado).toBe('CONDONADO');
    const pending = await apiCall(request, 'cuotas_contextos_pago', { params: contextParams(id) });
    expect(pending.inscripcion).toMatchObject({ registrada: false, pagada: false, condonada: false, estado: 'PENDIENTE', pago: null });
    const paid = await apiCall(request, 'cuotas_registrar_inscripcion', {
      method: 'POST', data: { id_socio: id, fecha_pago: todayIso(), monto: 6000, id_medio_pago: medium.id_medio_pago },
    });
    expect(paid.item.estado).toBe('PAGADO');
    await expectApiError(request, 'cuotas_condonar_inscripcion', {
      method: 'POST', data: { id_socio: id },
    }, { status: 409, code: 'INSCRIPCION_YA_REGISTRADA' });
    await remove(request, paid.item.id_inscripcion);
  });

  for (const race of ['condonar-condonar', 'pagar-condonar']) {
    test(`inscripción concurrente ${race}: sólo se registra una operación`, async ({ request }) => {
      const { socio, medium } = await setup(request, `CARRERA ${race.toUpperCase()}`);
      const base = { id_socio: socio.item.id_socio, fecha_pago: todayIso() };
      const results = await Promise.all([
        apiResult(request, race === 'pagar-condonar' ? 'cuotas_registrar_inscripcion' : 'cuotas_condonar_inscripcion', {
          method: 'POST', data: { ...base, monto: 6000, id_medio_pago: medium.id_medio_pago },
        }),
        apiResult(request, 'cuotas_condonar_inscripcion', { method: 'POST', data: base }),
      ]);
      expect(results.filter((item) => item.ok)).toHaveLength(1);
      expect(results.filter((item) => item.status === 409 && item.body.codigo === 'INSCRIPCION_YA_REGISTRADA')).toHaveLength(1);
      const winner = results.find((item) => item.ok).body.item;
      const history = await apiCall(request, 'socios_historial', { params: { id: socio.item.id_socio } });
      expect(history.pagos_inscripcion).toHaveLength(1);
      expect(Number(history.pagos_inscripcion[0].id_inscripcion)).toBe(Number(winner.id_inscripcion));
      await remove(request, winner.id_inscripcion);
    });
  }

  test('condonación valida fecha y socio activo; la baja definitiva conserva la trazabilidad', async ({ request }) => {
    const { socio } = await setup(request, 'VALIDACIONES CONDONACION');
    const id = socio.item.id_socio;
    await expectApiError(request, 'cuotas_condonar_inscripcion', {
      method: 'POST', data: { id_socio: id, fecha_condonacion: addDaysIso(1) },
    }, { code: 'FECHA_PAGO_FUTURA' });
    await apiCall(request, 'socios_eliminar', {
      method: 'POST', data: { id, fecha_baja: todayIso(), motivo_baja: 'PW E2E VALIDACION' },
    });
    await expectApiError(request, 'cuotas_condonar_inscripcion', {
      method: 'POST', data: { id_socio: id },
    }, { status: 409, code: 'SOCIO_INACTIVO' });
    await apiCall(request, 'socios_reactivar', {
      method: 'POST', data: { id, fecha_reactivacion: todayIso(), motivo_reactivacion: 'PW E2E REACTIVACION' },
    });
    const waived = await condone(request, id);
    expect(waived.item.motivo_condonacion).toBeNull();
    await apiCall(request, 'socios_eliminar_definitivo', { method: 'POST', data: { id } });
    await expectApiError(request, 'cuotas_eliminar_inscripcion', {
      method: 'POST', data: { id_inscripcion: waived.item.id_inscripcion },
    }, { status: 409, code: 'MOVIMIENTO_HISTORICO_PROTEGIDO' });
  });

  test('UI: condonar sin monto/medio, reabrir, ver motivo y anular la condonación', async ({ page, request }) => {
    const { socio } = await setup(request, 'CONDONACION UI');
    let dialog = await openRegistration(page, socio);
    const checkbox = dialog.getByRole('checkbox', { name: 'Condonar inscripción', exact: true });
    await checkbox.check();
    await expect(dialog.getByLabel('Monto de inscripción *')).toHaveCount(0);
    await expect(dialog.getByLabel('Medio de pago de inscripción *')).toHaveCount(0);
    await expect(dialog.getByLabel('Fecha de condonación de inscripción *')).toHaveValue(todayIso());
    await dialog.getByLabel('Motivo de condonación', { exact: true }).fill('PW E2E INSCRIPCION BONIFICADA');
    await checkbox.uncheck();
    await expect(dialog.getByLabel('Monto de inscripción *')).toBeVisible();
    await checkbox.check();
    await expect(dialog.getByLabel('Motivo de condonación', { exact: true })).toHaveValue('PW E2E INSCRIPCION BONIFICADA');
    await dialog.getByRole('button', { name: 'Condonar inscripción', exact: true }).click();
    await expect(page.getByText('Inscripción condonada correctamente.', { exact: true }).last()).toBeVisible();
    dialog = await openRegistration(page, socio);
    const region = dialog.getByRole('region', { name: 'Pago de inscripción' });
    await expect(region.getByText('Inscripción condonada', { exact: true })).toBeVisible();
    await expect(region).toContainText('PW E2E INSCRIPCION BONIFICADA');
    await expect(dialog.getByRole('button', { name: 'Inscripción condonada', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Eliminar condonación de inscripción', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: 'Eliminar condonación de inscripción' });
    await deletion.getByRole('button', { name: 'Eliminar condonación', exact: true }).click();
    await expect(page.getByText(/Condonación de inscripción eliminada correctamente/i).last()).toBeVisible();
    const pending = await apiCall(request, 'cuotas_contextos_pago', { params: contextParams(socio.item.id_socio) });
    expect(pending.inscripcion.registrada).toBe(false);
  });
});
