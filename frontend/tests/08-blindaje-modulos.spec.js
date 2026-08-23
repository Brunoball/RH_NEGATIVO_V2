const { test, expect } = require('./fixtures/auth.fixture');
const {
  apiCall,
  apiResult,
  closeApiSession,
  createApiSession,
  expectApiError,
} = require('./helpers/api.helper');
const { createSocio } = require('./helpers/entities.helper');
const { familyData, socioData } = require('./fixtures/socios.fixture');
const { configValues, userData } = require('./fixtures/configuracion.fixture');
const { cuotaFamilyData } = require('./fixtures/cuotas.fixture');
const {
  createQuotaCategory,
  createQuotaSocio,
  currentYear,
  paymentPayload,
  quotaCatalogs,
} = require('./helpers/cuotas.helper');
const { addDaysIso, todayIso } = require('./helpers/data.helper');

function rowByText(page, text) {
  return page.getByRole('row').filter({ hasText: text }).last();
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createConfigItem(request, list, definition) {
  const response = await apiCall(request, 'configuracion_lista_guardar', {
    method: 'POST',
    data: { lista: list, nombre: definition.nombre, ...definition.payload },
  });
  return response.item;
}

function configItemId(item, definition) {
  return Number(item[definition.idField]);
}

async function openAdvancedSection(page, title) {
  const trigger = page.getByRole('button', { name: /Aplicar Filtros/ });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();

  const sectionButton = page.getByRole('button', { name: title, exact: true });
  const section = sectionButton.locator('xpath=..');
  const isOpen = await section.evaluate((element) => element.classList.contains('is-open'));
  if (!isOpen) await sectionButton.click();
}

async function resetAdvancedFilters(page) {
  const trigger = page.getByRole('button', { name: /Aplicar Filtros/ });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await page.getByRole('button', { name: 'Mostrar Todos', exact: true }).click();
}

function ruleCovers(rule, value) {
  const from = Number(rule.cantidad_integrantes_desde);
  const to = rule.cantidad_integrantes_hasta == null ? 50 : Number(rule.cantidad_integrantes_hasta);
  return value >= from && value <= to;
}

async function safeOverlapSlot(request) {
  const response = await apiCall(request, 'descuentos_familiares_listar', {
    params: { estado: 'todos' },
  });
  const active = (response.items || []).filter((rule) => Boolean(rule.activo));
  const today = todayIso();

  // Necesitamos tres tamaños consecutivos para poder crear 10-11 y después
  // intentar 11-12: es un solapamiento parcial real, no un duplicado exacto.
  for (let startSize = 48; startSize >= 2; startSize -= 1) {
    const sizes = [startSize, startSize + 1, startSize + 2];
    const conflicts = active.filter((rule) => sizes.some((size) => ruleCovers(rule, size)));
    if (conflicts.some((rule) => rule.vigencia_hasta == null)) continue;

    let startDate = addDays(today, 2);
    for (const rule of conflicts) {
      if (rule.vigencia_hasta && String(rule.vigencia_hasta) >= startDate) {
        startDate = addDays(String(rule.vigencia_hasta), 1);
      }
    }
    if (startDate <= '2099-12-30') {
      return {
        firstFrom: startSize,
        firstTo: startSize + 1,
        secondFrom: startSize + 1,
        secondTo: startSize + 2,
        date: startDate,
      };
    }
  }

  throw new Error('No se encontró una ventana segura para probar solapamiento parcial de descuentos familiares.');
}

async function deleteConfigItem(request, list, id, action = 'configuracion_lista_eliminar_definitivo') {
  await apiCall(request, action, { method: 'POST', data: { lista: list, id } });
}

test.describe('Blindaje adicional · Socios y familias', () => {
  test('formulario de socio filtra caracteres inválidos y conserva datos al cambiar de pestaña', async ({ page }) => {
    await page.goto('/socios/personas');
    await page.getByRole('button', { name: 'Nuevo socio' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo socio' });
    await expect(dialog).toBeVisible();

    const name = dialog.getByLabel('Nombre *', { exact: true });
    const lastName = dialog.getByLabel('Apellido *', { exact: true });
    const dni = dialog.getByLabel('DNI');
    const number = dialog.getByRole('textbox', { name: 'Número', exact: true });
    const mobile = dialog.getByLabel('Teléfono móvil');
    const address = dialog.getByLabel('Domicilio', { exact: true });

    await name.fill('Bruno123_!?');
    await lastName.fill('Playwright456');
    // Con maxlength=8 el navegador trunca antes del onChange; primero probamos
    // saneo dentro de ocho caracteres y luego el límite con sólo números.
    await dni.fill('12AB3456');
    await expect(dni).toHaveValue('123456');
    await dni.fill('1234567890');
    await number.fill('12A-34/56');
    // Igual que con DNI, maxlength se aplica antes del onChange. Separamos
    // saneo de caracteres y límite máximo para probar ambos comportamientos.
    await mobile.fill('351-ABC123456');
    await expect(mobile).toHaveValue('351123456');
    await mobile.fill('351123456789012345');
    await address.fill('calle test @@@ 123 # 4');

    await expect(name).toHaveValue('BRUNO');
    await expect(lastName).toHaveValue('PLAYWRIGHT');
    await expect(dni).toHaveValue('12345678');
    await expect(number).toHaveValue('123456');
    await expect(mobile).toHaveValue('351123456789012');
    await expect(address).toHaveValue('CALLE TEST  123 # 4');

    await dialog.getByRole('tab', { name: 'Gestión' }).click();
    const observations = dialog.getByLabel('Observaciones');
    await observations.fill('dato de gestión que no debe perderse');
    await expect(observations).toHaveValue('DATO DE GESTIÓN QUE NO DEBE PERDERSE');

    await dialog.getByRole('tab', { name: 'Datos personales' }).click();
    await expect(name).toHaveValue('BRUNO');
    await expect(lastName).toHaveValue('PLAYWRIGHT');
    await expect(dni).toHaveValue('12345678');
    await expect(number).toHaveValue('123456');
    await expect(mobile).toHaveValue('351123456789012');

    await dialog.getByRole('tab', { name: 'Gestión' }).click();
    await expect(observations).toHaveValue('DATO DE GESTIÓN QUE NO DEBE PERDERSE');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    const discardDialog = page.getByRole('dialog', { name: '¿Salir sin guardar?' });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole('button', { name: 'Sí, salir' }).click();
    await expect(dialog).toHaveCount(0);
  });
  test('filtros avanzados realmente incluyen/excluyen por letra, sangre, estado, deuda, contacto y fecha', async ({ page, request }) => {
    const definitions = configValues();
    const bloodA = await createConfigItem(request, 'grupo_sanguineo', definitions.grupo_sanguineo);
    const bloodBDefinition = configValues().grupo_sanguineo;
    const bloodB = await createConfigItem(request, 'grupo_sanguineo', bloodBDefinition);
    const stateA = await createConfigItem(request, 'estado', definitions.estado);
    const stateBDefinition = configValues().estado;
    const stateB = await createConfigItem(request, 'estado', stateBDefinition);

    const data = socioData('FILTROS REALES');
    const created = await createSocio(request, data, {
      fecha_ingreso: `${currentYear()}-01-01`,
      id_grupo_sanguineo: configItemId(bloodA, definitions.grupo_sanguineo),
      id_estado: configItemId(stateA, definitions.estado),
    });

    // Dimensiones backend adicionales del listado: ID exacto, categoría y cobrador.
    // Son filtros soportados por la API aunque algunos se activen desde controles distintos del front.
    for (const params of [
      { id_socio: created.id_socio },
      { categoria: created.id_categoria },
      { cobrador: created.id_cobrador },
    ]) {
      const filtered = await apiCall(request, 'socios_listar', {
        params: { vigente: 'VIGENTE', buscar: data.dni, pagina: 1, ...params },
      });
      expect(filtered.items.some((item) => Number(item.id_socio) === Number(created.id_socio))).toBe(true);
    }
    for (const params of [
      { id_socio: 2147483647 },
      { categoria: 2147483647 },
      { cobrador: 2147483647 },
    ]) {
      const filtered = await apiCall(request, 'socios_listar', {
        params: { vigente: 'VIGENTE', buscar: data.dni, pagina: 1, ...params },
      });
      expect(filtered.items).toHaveLength(0);
    }

    await page.goto('/socios/personas');
    const search = page.getByLabel('Socio', { exact: true });
    await search.fill(data.dni);
    await expect(rowByText(page, data.nombre)).toBeVisible();

    // Letra: P coincide con el prefijo seguro de Playwright; A debe excluirlo.
    await openAdvancedSection(page, 'Filtrar de la A a la Z');
    await page.locator('.socios-letterGrid').getByRole('button', { name: 'P', exact: true }).click();
    await expect(rowByText(page, data.nombre)).toBeVisible();
    await page.locator('.socios-letterGrid').getByRole('button', { name: 'A', exact: true }).click();
    await expect(rowByText(page, data.nombre)).toHaveCount(0);
    await resetAdvancedFilters(page);

    // Sangre: opción correcta incluye; una opción distinta creada por E2E excluye.
    await openAdvancedSection(page, 'Tipo de sangre');
    await page.locator('.socios-filterChoices').getByRole('button', { name: bloodA.nombre, exact: true }).click();
    await expect(rowByText(page, data.nombre)).toBeVisible();
    await page.locator('.socios-filterChoices').getByRole('button', { name: bloodB.nombre, exact: true }).click();
    await expect(rowByText(page, data.nombre)).toHaveCount(0);
    await resetAdvancedFilters(page);

    // Estado: mismo principio, usando dos opciones E2E controladas.
    await openAdvancedSection(page, 'Estado');
    await page.locator('.socios-filterChoices').getByRole('button', { name: stateA.nombre, exact: true }).click();
    await expect(rowByText(page, data.nombre)).toBeVisible();

    await page.locator('.socios-filterChoices').getByRole('button', { name: stateB.nombre, exact: true }).click();
    await expect(rowByText(page, data.nombre)).toHaveCount(0);
    await resetAdvancedFilters(page);

    // Deuda: verificamos primero el dato real del backend y elegimos el filtro
    // que corresponde. Así el caso sigue siendo válido en cualquier mes del año.
    const backendRow = await apiCall(request, 'socios_listar', {
      params: { vigente: 'VIGENTE', buscar: data.dni, pagina: 1 },
    });
    const persisted = (backendRow.items || []).find((item) => Number(item.id_socio) === Number(created.id_socio));
    const debt = Number(persisted?.meses_adeudados || 0);
    const expectedDebtLabel = debt === 0 ? 'Al día' : debt <= 2 ? 'Debe 1 o 2 meses' : 'Debe 3 meses o más';
    const wrongDebtLabel = expectedDebtLabel === 'Al día' ? 'Debe 3 meses o más' : 'Al día';

    await openAdvancedSection(page, 'Pagos');
    await page.locator('.socios-filterChoices').getByRole('button', { name: expectedDebtLabel, exact: true }).click();
    await expect(rowByText(page, data.nombre)).toBeVisible();
    await page.locator('.socios-filterChoices').getByRole('button', { name: wrongDebtLabel, exact: true }).click();
    await expect(rowByText(page, data.nombre)).toHaveCount(0);
    await resetAdvancedFilters(page);

    // Contacto: primero SIN GESTIÓN; luego persistimos CONTACTADO y exigimos que
    // el filtro cambie de resultado.
    await openAdvancedSection(page, 'Último contacto');
    await page.locator('.socios-filterChoices').getByRole('button', { name: 'Sin gestión', exact: true }).click();
    await expect(rowByText(page, data.nombre)).toBeVisible();
    await resetAdvancedFilters(page);

    await apiCall(request, 'socios_contacto_guardar', {
      method: 'POST',
      data: {
        id_socio: created.id_socio,
        fecha_contacto: todayIso(),
        estado_contacto: 'CONTACTADO',
        detalle_contacto: 'PW E2E FILTRO CONTACTADO',
      },
    });
    await page.reload();
    await search.fill(data.dni);
    await openAdvancedSection(page, 'Último contacto');
    await page.locator('.socios-filterChoices').getByRole('button', { name: 'Contactados', exact: true }).click();
    await expect(rowByText(page, data.nombre)).toBeVisible();
    await page.locator('.socios-filterChoices').getByRole('button', { name: 'Sin gestión', exact: true }).click();
    await expect(rowByText(page, data.nombre)).toHaveCount(0);
    await resetAdvancedFilters(page);

    // Fecha: 1/1 exacto debe incluir; un rango posterior debe excluir.
    await openAdvancedSection(page, 'Fecha de ingreso');
    let dateSection = page.locator('.socios-dateFilter');
    await dateSection.getByLabel(/Desde/).fill(`${currentYear()}-01-01`);
    await dateSection.getByLabel(/Hasta/).fill(`${currentYear()}-01-01`);
    await dateSection.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await expect(rowByText(page, data.nombre)).toBeVisible();

    await openAdvancedSection(page, 'Fecha de ingreso');
    dateSection = page.locator('.socios-dateFilter');
    await dateSection.getByLabel(/Desde/).fill(`${currentYear()}-02-01`);
    await dateSection.getByLabel(/Hasta/).fill(todayIso());
    await dateSection.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await expect(rowByText(page, data.nombre)).toHaveCount(0);
  });

  test('limpiar búsqueda y quitar un chip de Estado ejecutan sus acciones sin alterar el resto de filtros', async ({ page, request }) => {
    const stateDefinition = configValues().estado;
    const state = await createConfigItem(request, 'estado', stateDefinition);
    const data = socioData('MICROACCIONES FILTROS');
    await createSocio(request, data, {
      fecha_ingreso: `${currentYear()}-01-01`,
      id_estado: configItemId(state, stateDefinition),
    });

    await page.goto('/socios/personas');
    const search = page.getByLabel('Socio', { exact: true });
    await search.fill(data.dni);
    await expect(rowByText(page, data.nombre)).toBeVisible();

    const clearSearch = page.getByRole('button', { name: 'Limpiar búsqueda', exact: true });
    await expect(clearSearch).toBeVisible();
    await clearSearch.click();
    await expect(search).toHaveValue('');

    await search.fill(data.dni);
    await expect(rowByText(page, data.nombre)).toBeVisible();
    await openAdvancedSection(page, 'Estado');
    await page.locator('.socios-filterChoices').getByRole('button', { name: state.nombre, exact: true }).click();
    await expect(rowByText(page, data.nombre)).toBeVisible();

    // Cerramos el desplegable antes de pulsar el chip: la prueba cubre la acción
    // real del chip y evita que el menú flotante intercepte el click en viewports
    // donde ambos elementos pueden superponerse.
    const filterTrigger = page.getByRole('button', { name: /Aplicar Filtros/ });
    if ((await filterTrigger.getAttribute('aria-expanded')) === 'true') await filterTrigger.click();

    const stateChipRemove = page.getByRole('button', {
      name: `Eliminar filtro Estado: ${state.nombre}`,
      exact: true,
    });
    await expect(stateChipRemove).toBeVisible();
    await stateChipRemove.click();
    await expect(stateChipRemove).toHaveCount(0);
    await expect(search).toHaveValue(data.dni);
    await expect(rowByText(page, data.nombre)).toBeVisible();
  });

  test('cumpleaños se gestiona desde la UI y el cierre queda persistido en backend', async ({ page, request }) => {
    const data = socioData('CUMPLE UI FORZADO');
    const birthYear = currentYear() - 18;
    const created = await createSocio(request, data, {
      fecha_nacimiento: `${birthYear}-01-01`,
    });

    // La consulta real limita avisos a 100. Inyectamos únicamente el mismo socio
    // E2E en la primera respuesta visual para garantizar que la acción de UI se
    // ejecute aunque una base real tenga más de 100 jóvenes. El POST de cierre
    // sigue siendo real y la siguiente carga vuelve a ser 100% backend.
    let injected = false;
    await page.route(/api\.php\?[^#]*action=socios_listar/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (!injected) {
        const current = Array.isArray(body.avisos_cumpleanios) ? body.avisos_cumpleanios : [];
        body.avisos_cumpleanios = [
          {
            id_socio: created.id_socio,
            nombre: data.nombre,
            dni: data.dni,
            fecha_nacimiento: `${birthYear}-01-01`,
            edad: 18,
            telefono_movil: data.movil,
            grupo_sanguineo: created.grupo_sanguineo || null,
          },
          ...current.filter((item) => Number(item.id_socio) !== Number(created.id_socio)),
        ];
        injected = true;
      }
      await route.fulfill({ response, json: body });
    });

    await page.goto('/socios/personas');
    const drawer = page.getByLabel('Socios para contactar de 18 a 23 años');
    await expect(drawer).toBeVisible();
    const open = drawer.getByRole('button', { name: 'Abrir avisos de cumpleaños' });
    if (await open.isVisible().catch(() => false)) await open.click();
    await expect(drawer.locator('.socios-birthdayCard__name')).toHaveText(data.nombre);
    await drawer.getByTitle('Marcar aviso como gestionado este año').click();

    await expect(drawer.locator('.socios-birthdayCard__name').filter({ hasText: data.nombre })).toHaveCount(0);
    const persisted = await apiCall(request, 'socios_cumpleanios_cerrar', {
      method: 'POST', data: { id: created.id_socio },
    });
    expect(persisted.cierre.ya_cerrado).toBe(true);
  });

  test('transiciones inválidas y cumpleaños fuera de regla fallan sin corromper el socio', async ({ request }) => {
    const outside = await createSocio(request, socioData('ESTADOS INVALIDOS'), {
      fecha_nacimiento: '1990-01-01',
    });
    const noBirth = await createSocio(request, socioData('SIN NACIMIENTO'), {
      fecha_nacimiento: null,
    });

    await expectApiError(request, 'socios_reactivar', {
      method: 'POST', data: { id: outside.id_socio, fecha_reactivacion: todayIso() },
    }, { status: 409, code: 'SOCIO_YA_VIGENTE' });

    await expectApiError(request, 'socios_cumpleanios_cerrar', {
      method: 'POST', data: { id: outside.id_socio },
    }, { status: 409, code: 'FUERA_RANGO_CUMPLEANIOS' });

    await expectApiError(request, 'socios_cumpleanios_cerrar', {
      method: 'POST', data: { id: noBirth.id_socio },
    }, { status: 409, code: 'SIN_FECHA_NACIMIENTO' });

    await apiCall(request, 'socios_eliminar', {
      method: 'POST',
      data: { id: outside.id_socio, fecha_baja: todayIso(), motivo_baja: 'PW E2E BAJA CONTROLADA' },
    });
    await expectApiError(request, 'socios_eliminar', {
      method: 'POST',
      data: { id: outside.id_socio, fecha_baja: todayIso(), motivo_baja: 'PW E2E BAJA REPETIDA' },
    }, { status: 409, code: 'SOCIO_YA_BAJA' });
    await expectApiError(request, 'socios_cumpleanios_cerrar', {
      method: 'POST', data: { id: outside.id_socio },
    }, { status: 409, code: 'SOCIO_NO_VIGENTE' });

    await apiCall(request, 'socios_reactivar', {
      method: 'POST',
      data: { id: outside.id_socio, fecha_reactivacion: todayIso(), motivo_reactivacion: 'PW E2E REACTIVACION CONTROLADA' },
    });
    await expectApiError(request, 'socios_reactivar', {
      method: 'POST', data: { id: outside.id_socio, fecha_reactivacion: todayIso() },
    }, { status: 409, code: 'SOCIO_YA_VIGENTE' });

    const detail = await apiCall(request, 'socios_obtener', { params: { id: outside.id_socio } });
    expect(detail.item.vigente).toBe(true);
  });

  test('familias rechazan fechas imposibles, edición estando inactivas, integrantes inexistentes y IDs inexistentes', async ({ request }) => {
    const member = await createSocio(request, socioData('FAMILIA BORDES'));
    const family = familyData();
    const saved = await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [{ id_socio: member.id_socio, desde: todayIso() }],
      },
    });
    const familyId = saved.item.id_familia;

    await expectApiError(request, 'familias_eliminar', {
      method: 'POST',
      data: { id: familyId, fecha_baja: addDays(todayIso(), -1), motivo_baja: 'PW E2E FECHA INVALIDA' },
    }, { status: 422, code: 'FECHA_INVALIDA' });

    // El fallo anterior debe ser atómico: la familia sigue activa y puede darse
    // de baja correctamente con una fecha válida.
    let detail = await apiCall(request, 'familias_obtener', { params: { id: familyId } });
    expect(detail.item.activo).toBe(true);
    await apiCall(request, 'familias_eliminar', {
      method: 'POST',
      data: { id: familyId, fecha_baja: todayIso(), motivo_baja: 'PW E2E BAJA VALIDA' },
    });

    await expectApiError(request, 'familias_guardar', {
      method: 'POST',
      data: {
        id_familia: familyId,
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [{ id_socio: member.id_socio, desde: todayIso() }],
      },
    }, { status: 409, code: 'FAMILIA_INACTIVA' });

    await apiCall(request, 'familias_reactivar', { method: 'POST', data: { id: familyId } });
    detail = await apiCall(request, 'familias_obtener', { params: { id: familyId } });
    expect(detail.item.activo).toBe(true);

    const invalidFamily = familyData();
    await expectApiError(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: invalidFamily.nombre,
        observaciones: invalidFamily.descripcion,
        integrantes: [{ id_socio: 2147483647, desde: todayIso() }],
      },
    }, { status: 422, code: 'SOCIO_INVALIDO' });

    await expectApiError(request, 'familias_obtener', {
      params: { id: 2147483647 },
    }, { status: 404, code: 'FAMILIA_NO_ENCONTRADA' });
  });

  test('un socio no puede pertenecer simultáneamente a dos familias activas', async ({ request }) => {
    const member = await createSocio(request, socioData('FAMILIA EXCLUSIVA'));
    const first = familyData();
    const second = familyData();

    await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: first.nombre,
        observaciones: first.descripcion,
        integrantes: [{ id_socio: member.id_socio, desde: todayIso() }],
      },
    });

    await expectApiError(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: second.nombre,
        observaciones: second.descripcion,
        integrantes: [{ id_socio: member.id_socio, desde: todayIso() }],
      },
    }, { status: 409, code: 'SOCIO_YA_TIENE_FAMILIA' });

    const firstDetail = await apiCall(request, 'familias_listar', {
      params: { estado: 'activo', buscar: first.nombre },
    });
    expect((firstDetail.items || []).filter((item) => item.nombre === first.nombre)).toHaveLength(1);

    const failedSecond = await apiCall(request, 'familias_listar', {
      params: { estado: 'activo', buscar: second.nombre },
    });
    expect((failedSecond.items || []).some((item) => item.nombre === second.nombre)).toBe(false);
  });
});

test.describe('Blindaje adicional · Categorías y descuentos familiares', () => {
  test('solapamiento parcial real, rangos y vigencias inválidas son rechazados', async ({ request }) => {
    const slot = await safeOverlapSlot(request);
    const firstDescription = `PW E2E DESC SOLAPE A ${Date.now()}`;

    const first = await apiCall(request, 'descuentos_familiares_guardar', {
      method: 'POST',
      data: {
        cantidad_integrantes_desde: slot.firstFrom,
        cantidad_integrantes_hasta: slot.firstTo,
        porcentaje_descuento: '11.50',
        vigencia_desde: slot.date,
        vigencia_hasta: slot.date,
        descripcion: firstDescription,
      },
    });
    expect(first.item).toBeTruthy();

    await expectApiError(request, 'descuentos_familiares_guardar', {
      method: 'POST',
      data: {
        cantidad_integrantes_desde: slot.secondFrom,
        cantidad_integrantes_hasta: slot.secondTo,
        porcentaje_descuento: '9.25',
        vigencia_desde: slot.date,
        vigencia_hasta: slot.date,
        descripcion: `PW E2E DESC SOLAPE PARCIAL ${Date.now()}`,
      },
    }, { status: 409, code: 'DESCUENTO_FAMILIAR_DUPLICADO' });

    await expectApiError(request, 'descuentos_familiares_guardar', {
      method: 'POST',
      data: {
        cantidad_integrantes_desde: 6,
        cantidad_integrantes_hasta: 5,
        porcentaje_descuento: '10',
        vigencia_desde: addDaysIso(20),
        descripcion: `PW E2E DESC RANGO INVALIDO ${Date.now()}`,
      },
    }, { status: 422, code: 'RANGO_INTEGRANTES_INVALIDO' });

    await expectApiError(request, 'descuentos_familiares_guardar', {
      method: 'POST',
      data: {
        cantidad_integrantes_desde: 49,
        cantidad_integrantes_hasta: 49,
        porcentaje_descuento: '10',
        vigencia_desde: addDaysIso(30),
        vigencia_hasta: addDaysIso(29),
        descripcion: `PW E2E DESC VIGENCIA INVALIDA ${Date.now()}`,
      },
    }, { status: 422, code: 'VIGENCIA_DESCUENTO_INVALIDA' });


    const firstId = first.item.id_descuento_familiar;
    await apiCall(request, 'descuentos_familiares_eliminar', {
      method: 'POST', data: { id: firstId },
    });

    // Regresión: una regla que ya fue enviada al historial (activo=0) no puede
    // bloquear una regla nueva aunque conserve exactamente el mismo rango y
    // la misma fecha de vigencia. Este era el falso "solapamiento activo".
    const replacement = await apiCall(request, 'descuentos_familiares_guardar', {
      method: 'POST',
      data: {
        cantidad_integrantes_desde: slot.firstFrom,
        cantidad_integrantes_hasta: slot.firstTo,
        porcentaje_descuento: '7.75',
        vigencia_desde: slot.date,
        vigencia_hasta: slot.date,
        descripcion: `PW E2E DESC REEMPLAZO HISTORICO ${Date.now()}`,
      },
    });
    expect(replacement.item).toBeTruthy();
    expect(replacement.item.activo).toBe(true);
    await apiCall(request, 'descuentos_familiares_eliminar', {
      method: 'POST', data: { id: replacement.item.id_descuento_familiar },
    });

    await expectApiError(request, 'descuentos_familiares_guardar', {
      method: 'POST',
      data: {
        id_descuento_familiar: firstId,
        cantidad_integrantes_desde: slot.firstFrom,
        cantidad_integrantes_hasta: slot.firstTo,
        porcentaje_descuento: '12.00',
        vigencia_desde: slot.date,
        vigencia_hasta: slot.date,
        descripcion: `${firstDescription} HISTORICO`,
      },
    }, { status: 409, code: 'DESCUENTO_FAMILIAR_HISTORICO' });

    await expectApiError(request, 'descuentos_familiares_eliminar', {
      method: 'POST', data: { id: 2147483647 },
    }, { status: 404, code: 'DESCUENTO_FAMILIAR_NO_ENCONTRADO' });
    await expectApiError(request, 'categorias_obtener', {
      params: { id: 2147483647 },
    }, { status: 404, code: 'CATEGORIA_NO_ENCONTRADA' });
  });
});

test.describe('Blindaje adicional · Cuotas', () => {
  test('errores de negocio: socio inactivo, categoría inactiva, período anterior, monto sin configurar y pago inexistente', async ({ request }) => {
    const catalogs = await quotaCatalogs(request);
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const mediumId = Number(catalogs.medium.id_medio_pago);

    // Socio inactivo.
    const inactiveCategory = await createQuotaCategory(request);
    const inactiveSocio = await createQuotaSocio(request, 'ERROR SOCIO INACTIVO', inactiveCategory.item.id_categoria);
    await apiCall(request, 'socios_eliminar', {
      method: 'POST',
      data: { id: inactiveSocio.item.id_socio, fecha_baja: todayIso(), motivo_baja: 'PW E2E BAJA PARA CUOTAS' },
    });
    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: inactiveSocio.item.id_socio, periodId, mediumId }),
    }, { status: 409, code: 'SOCIO_INACTIVO' });

    // Categoría inactiva: una categoría que se desactiva hoy sigue siendo
    // válida para períodos históricos, pero NO para el período actual.
    const categoryInactive = await createQuotaCategory(request);
    const socioCategoryInactive = await createQuotaSocio(request, 'ERROR CATEGORIA INACTIVA', categoryInactive.item.id_categoria);
    await apiCall(request, 'categorias_eliminar', {
      method: 'POST', data: { id: categoryInactive.item.id_categoria },
    });
    const currentPeriodId = Math.min(6, Math.max(1, Math.ceil(Number(todayIso().slice(5, 7)) / 2)));
    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: socioCategoryInactive.item.id_socio, periodId: currentPeriodId, mediumId }),
    }, { status: 409, code: 'CATEGORIA_INACTIVA' });

    // Período anterior al ingreso: socio entra hoy pero intentamos enero del mismo año.
    const categoryLate = await createQuotaCategory(request);
    const late = await createQuotaSocio(request, 'ERROR PERIODO ANTERIOR', categoryLate.item.id_categoria);
    await apiCall(request, 'socios_guardar', {
      method: 'POST',
      data: {
        id_socio: late.item.id_socio,
        nombre: late.data.nombre,
        dni: late.data.dni,
        fecha_nacimiento: '1999-05-15',
        domicilio: 'CALLE PLAYWRIGHT',
        numero: '123',
        telefono_movil: late.data.movil,
        telefono_fijo: late.data.fijo,
        domicilio_cobro: 'DOMICILIO DE COBRO PLAYWRIGHT',
        fecha_ingreso: todayIso(),
        id_categoria: categoryLate.item.id_categoria,
        id_cobrador: late.item.id_cobrador,
        id_estado: late.item.id_estado,
        id_grupo_sanguineo: late.item.id_grupo_sanguineo,
        observaciones: late.data.observaciones,
      },
    });
    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: late.item.id_socio, periodId: 1, mediumId }),
    }, { status: 409, code: 'CUOTA_NO_CORRESPONDE' });

    // Categoría con importe cero: es válida como configuración, pero no cobrable.
    const zeroDefinition = configValues().categoria;
    zeroDefinition.payload = { monto_mensual: '0', monto_anual: '0' };
    const zeroCategory = await createConfigItem(request, 'categoria', zeroDefinition);
    const zeroSocio = await createQuotaSocio(request, 'ERROR MONTO CERO', configItemId(zeroCategory, zeroDefinition));
    await expectApiError(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: zeroSocio.item.id_socio, periodId, mediumId }),
    }, { status: 409, code: 'MONTO_NO_CONFIGURADO' });

    await expectApiError(request, 'cuotas_eliminar_pago', {
      method: 'POST', data: { id_pago: 2147483647 },
    }, { status: 404, code: 'PAGO_NO_ENCONTRADO' });
  });

  test('UI aplica pago a todo el grupo familiar, muestra integrantes y persiste una fila por integrante', async ({ page, request }) => {
    const category = await createQuotaCategory(request);
    const a = await createQuotaSocio(request, 'UI FAMILIA A', category.item.id_categoria);
    const b = await createQuotaSocio(request, 'UI FAMILIA B', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const family = cuotaFamilyData();
    await apiCall(request, 'familias_guardar', {
      method: 'POST',
      data: {
        nombre: family.nombre,
        observaciones: family.descripcion,
        integrantes: [
          { id_socio: a.item.id_socio, desde: `${currentYear()}-01-01` },
          { id_socio: b.item.id_socio, desde: `${currentYear()}-01-01` },
        ],
      },
    });

    const periodId = String(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    await page.goto('/cuotas');
    await page.getByLabel('Año').selectOption(String(currentYear()));
    await page.getByLabel('Mes', { exact: true }).selectOption(periodId);
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(String(a.item.id_socio));
    const row = rowByText(page, a.data.nombre);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Registrar pago de ${a.data.nombre}` }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: a.data.nombre }).last();

    // La información familiar está encapsulada en la pestaña Familia.
    await dialog.getByRole('tab', { name: /Familia/ }).click();
    await expect(dialog.getByLabel('Grupo familiar del socio')).toContainText(family.nombre);
    await dialog.getByRole('button', { name: 'Ver integrantes', exact: true }).click();
    await expect(dialog).toContainText(a.data.nombre);
    await expect(dialog).toContainText(b.data.nombre);

    const familyToggle = dialog.getByRole('checkbox', { name: 'Aplicar pago a todo el grupo familiar' });
    await expect(familyToggle).toBeChecked();
    await familyToggle.uncheck();
    await expect(familyToggle).not.toBeChecked();
    await familyToggle.check();

    // Medio de pago se completa en la pestaña principal, manteniendo activa
    // la elección de aplicar la operación a la familia completa.
    await dialog.getByRole('tab', { name: /Meses a pagar/ }).click();
    await dialog.getByLabel('Medio de pago *').selectOption(String(catalogs.medium.id_medio_pago));
    await dialog.getByRole('button', { name: /Registrar pago familiar/ }).click();

    const receipt = page.getByRole('dialog', { name: 'Registro de pagos' });
    await expect(receipt).toContainText(a.data.nombre);
    await expect(receipt).toContainText(b.data.nombre);
    await receipt.locator('.payment-receipt-actions__close').click();

    for (const member of [a, b]) {
      const paid = await apiCall(request, 'cuotas_listar', {
        params: { estado: 'PAGADOS', anio: currentYear(), mes: periodId, buscar: member.data.dni },
      });
      expect((paid.items || []).some((item) => Number(item.id_socio) === Number(member.item.id_socio))).toBe(true);
    }
  });

  test('aliases públicos cuotas_anular y cuotas_eliminar_pago ejecutan eliminación real', async ({ request }) => {
    const category = await createQuotaCategory(request);
    const first = await createQuotaSocio(request, 'ALIAS ANULAR', category.item.id_categoria);
    const second = await createQuotaSocio(request, 'ALIAS ELIMINAR', category.item.id_categoria);
    const catalogs = await quotaCatalogs(request);
    const periodA = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const periodB = Number(catalogs.bimonthly[1].id_periodo ?? catalogs.bimonthly[1].id_mes);

    const paidA = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: first.item.id_socio, periodId: periodA, mediumId: catalogs.medium.id_medio_pago }),
    });
    await apiCall(request, 'cuotas_anular', {
      method: 'POST', data: { id_pago: paidA.items[0].id_pago },
    });

    const paidB = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({ socioId: second.item.id_socio, periodId: periodB, mediumId: catalogs.medium.id_medio_pago }),
    });
    await apiCall(request, 'cuotas_eliminar_pago', {
      method: 'POST', data: { id_pago: paidB.items[0].id_pago },
    });

    const debtA = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'DEUDORES', anio: currentYear(), mes: periodA, buscar: first.data.dni },
    });
    const debtB = await apiCall(request, 'cuotas_listar', {
      params: { estado: 'DEUDORES', anio: currentYear(), mes: periodB, buscar: second.data.dni },
    });
    expect((debtA.items || []).some((item) => Number(item.id_socio) === Number(first.item.id_socio))).toBe(true);
    expect((debtB.items || []).some((item) => Number(item.id_socio) === Number(second.item.id_socio))).toBe(true);
  });
});

test.describe('Blindaje adicional · Configuración', () => {
  test('UI ejecuta ciclo completo en los cinco catálogos editables y protege Períodos estructurales', async ({ page }) => {
    // Son cinco CRUD UI completos en serie. En la corrida real llegó a Períodos
    // pero agotó el timeout global de 60 s; este test necesita margen propio.
    test.setTimeout(120_000);

    const definitions = configValues();
    const catalogs = [
      { key: 'categoria', tab: 'Categorías', singular: 'categoría', fields: [['Nombre *', 'nombre'], ['Monto mensual *', 'monto_mensual'], ['Monto anual *', 'monto_anual']] },
      { key: 'cobrador', tab: 'Cobradores', singular: 'cobrador', fields: [['Nombre *', 'nombre']] },
      { key: 'estado', tab: 'Estados', singular: 'estado', fields: [['Nombre *', 'nombre']] },
      { key: 'grupo_sanguineo', tab: 'Grupos sanguíneos', singular: 'grupo sanguíneo', fields: [['Nombre *', 'nombre']] },
      { key: 'medios_pago', tab: 'Medios de pago', singular: 'medio de pago', fields: [['Nombre *', 'nombre']] },
    ];

    await page.goto('/configuracion/catalogos?lista=categoria');
    for (const meta of catalogs) {
      await test.step(meta.tab, async () => {
        const definition = definitions[meta.key];
        await page.getByRole('tab', { name: meta.tab, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`lista=${meta.key}`));

        await page.getByRole('button', { name: `Nuevo ${meta.singular}`, exact: true }).click();
        let dialog = page.getByRole('dialog', { name: `Agregar ${meta.singular}` });
        for (const [label, key] of meta.fields) {
          const value = key === 'nombre' ? definition.nombre : definition.payload[key];
          await dialog.getByLabel(label, { exact: true }).fill(String(value));
        }

        // El frontend sanea cada catálogo con reglas distintas (por ejemplo,
        // Estado admite sólo letras). Tomamos el valor realmente aceptado por
        // el input para verificar exactamente lo que la UI envía y renderiza.
        const createdName = await dialog.getByLabel('Nombre *', { exact: true }).inputValue();
        expect(createdName.trim()).not.toBe('');
        await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();

        const search = page.getByRole('textbox', { name: 'Buscar' });
        await search.fill(createdName);
        let row = rowByText(page, createdName);
        await expect(row).toBeVisible();

        await row.getByRole('button', { name: `Editar ${createdName}` }).click();
        dialog = page.getByRole('dialog', { name: `Editar ${meta.singular}` });
        for (const [label, key] of meta.fields) {
          const value = key === 'nombre'
            ? definition.editado
            : (definition.editPayload[key] ?? definition.payload[key]);
          await dialog.getByLabel(label, { exact: true }).fill(String(value));
        }

        const editedName = await dialog.getByLabel('Nombre *', { exact: true }).inputValue();
        expect(editedName.trim()).not.toBe('');
        await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();

        await search.fill(editedName);
        row = rowByText(page, editedName);
        await expect(row).toBeVisible();
        if (meta.key === 'categoria') {
          await expect(row).toContainText(/2[.,]200/);
          await expect(row).toContainText(/19[.,]000/);
        }
        await row.getByRole('button', { name: `Dar de baja ${editedName}` }).click();
        let stateDialog = page.getByRole('dialog', { name: `Dar de baja ${meta.singular}` });
        await stateDialog.getByRole('button', { name: 'Dar de baja', exact: true }).click();
        row = rowByText(page, editedName);
        await expect(row).toContainText('Inactivo');

        await row.getByRole('button', { name: `Reactivar ${editedName}` }).click();
        stateDialog = page.getByRole('dialog', { name: `Reactivar ${meta.singular}` });
        await stateDialog.getByRole('button', { name: 'Reactivar', exact: true }).click();
        row = rowByText(page, editedName);
        await expect(row).toContainText('Activo');

        await row.getByRole('button', { name: `Eliminar definitivamente ${editedName}` }).click();
        const deleteDialog = page.getByRole('dialog', { name: `Eliminar ${meta.singular}` });
        await deleteDialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
        await expect(rowByText(page, editedName)).toHaveCount(0);
      });
    }

    // Estados también tiene un aviso contextual propio. Se prueba por hover
    // y por foco para cubrir mouse y teclado/touch accesible.
    await page.getByRole('tab', { name: 'Estados', exact: true }).click();
    await expect(page).toHaveURL(/lista=estado/);
    const stateInfo = page.getByRole('button', { name: 'Información sobre Estados', exact: true });
    await stateInfo.hover();
    await expect(page.getByRole('tooltip')).toContainText(/ACTIVO y PASIVO.*estructurales/i);
    await stateInfo.focus();
    await expect(page.getByRole('tooltip')).toContainText(/estados auxiliares/i);

    await page.getByRole('tab', { name: 'Períodos', exact: true }).click();
    await expect(page).toHaveURL(/lista=periodo/);
    await expect(page.getByRole('button', { name: 'Nuevo período', exact: true })).toHaveCount(0);
    const periodInfo = page.getByRole('button', { name: 'Información sobre Períodos', exact: true });
    await periodInfo.hover();
    await expect(page.getByRole('tooltip')).toContainText(/7 períodos.*estructurales/i);
    const firstPeriodRow = page.getByRole('table', { name: 'Períodos' }).getByRole('row').filter({ hasText: /PERÍODO 1/i }).first();
    await expect(firstPeriodRow).toBeVisible();
    await expect(firstPeriodRow.getByRole('button', { name: /Editar/i })).toBeDisabled();
    await expect(firstPeriodRow.getByRole('button', { name: /Dar de baja/i })).toBeDisabled();
    await expect(firstPeriodRow.getByRole('button', { name: /Eliminar definitivamente/i })).toBeDisabled();
  });

  test('categoría, cobrador, estado, sangre y medio de pago no pueden borrarse mientras están referenciados', async ({ request }) => {
    const defs = configValues();
    const quotaCategory = await createQuotaCategory(request);
    const category = quotaCategory.item;
    const collector = await createConfigItem(request, 'cobrador', defs.cobrador);
    const state = await createConfigItem(request, 'estado', defs.estado);
    const blood = await createConfigItem(request, 'grupo_sanguineo', defs.grupo_sanguineo);
    const medium = await createConfigItem(request, 'medios_pago', defs.medios_pago);

    const socio = await createSocio(request, socioData('CONFIG REFERENCIAS'), {
      id_categoria: configItemId(category, defs.categoria),
      id_cobrador: configItemId(collector, defs.cobrador),
      id_estado: configItemId(state, defs.estado),
      id_grupo_sanguineo: configItemId(blood, defs.grupo_sanguineo),
      fecha_ingreso: `${currentYear()}-01-01`,
    });
    const catalogs = await quotaCatalogs(request);
    const periodId = Number(catalogs.bimonthly[0].id_periodo ?? catalogs.bimonthly[0].id_mes);
    const payment = await apiCall(request, 'cuotas_registrar_pago', {
      method: 'POST',
      data: paymentPayload({
        socioId: socio.id_socio,
        periodId,
        mediumId: configItemId(medium, defs.medios_pago),
      }),
    });

    for (const [list, item, def] of [
      ['categoria', category, defs.categoria],
      ['cobrador', collector, defs.cobrador],
      ['estado', state, defs.estado],
      ['grupo_sanguineo', blood, defs.grupo_sanguineo],
      ['medios_pago', medium, defs.medios_pago],
    ]) {
      await expectApiError(request, 'configuracion_lista_eliminar_definitivo', {
        method: 'POST', data: { lista: list, id: configItemId(item, def) },
      }, { status: 409, code: 'OPCION_EN_USO' });
    }

    // Ejecuta de forma directa el alias legacy de eliminación de configuración,
    // primero verificando que también respeta la protección EN USO.
    await expectApiError(request, 'configuracion_lista_eliminar', {
      method: 'POST', data: { lista: 'cobrador', id: configItemId(collector, defs.cobrador) },
    }, { status: 409, code: 'OPCION_EN_USO' });

    await apiCall(request, 'cuotas_eliminar_pago', {
      method: 'POST', data: { id_pago: payment.items[0].id_pago },
    });
    await apiCall(request, 'socios_eliminar_definitivo', {
      method: 'POST', data: { id: socio.id_socio },
    });

    // El medio deja de tener movimientos actuales porque el pago E2E fue eliminado.
    // Categoría, cobrador, estado y grupo siguen protegidos: la eliminación del socio
    // lo saca del padrón operativo, pero conserva un tombstone + historial para que
    // la trazabilidad contable no pierda las etiquetas usadas originalmente.
    await deleteConfigItem(request, 'medios_pago', configItemId(medium, defs.medios_pago));

    for (const [list, item, def] of [
      ['categoria', category, defs.categoria],
      ['cobrador', collector, defs.cobrador],
      ['estado', state, defs.estado],
      ['grupo_sanguineo', blood, defs.grupo_sanguineo],
    ]) {
      await expectApiError(request, 'configuracion_lista_eliminar_definitivo', {
        method: 'POST', data: { lista: list, id: configItemId(item, def) },
      }, { status: 409, code: 'OPCION_EN_USO' });
    }
  });

  test('operaciones de configuración sobre IDs inexistentes devuelven OPCION_NO_ENCONTRADA sin efectos laterales', async ({ request }) => {
    await expectApiError(request, 'configuracion_lista_guardar', {
      method: 'POST',
      data: { lista: 'cobrador', id: 2147483647, nombre: 'PW E2E COB INEXISTENTE' },
    }, { status: 404, code: 'OPCION_NO_ENCONTRADA' });
    await expectApiError(request, 'configuracion_lista_baja', {
      method: 'POST',
      data: { lista: 'cobrador', id: 2147483647 },
    }, { status: 404, code: 'OPCION_NO_ENCONTRADA' });
    await expectApiError(request, 'configuracion_lista_reactivar', {
      method: 'POST',
      data: { lista: 'cobrador', id: 2147483647 },
    }, { status: 404, code: 'OPCION_NO_ENCONTRADA' });
    await expectApiError(request, 'configuracion_lista_eliminar_definitivo', {
      method: 'POST',
      data: { lista: 'cobrador', id: 2147483647 },
    }, { status: 404, code: 'OPCION_NO_ENCONTRADA' });
  });

  test('UI de usuarios cambia rol y contraseña y las nuevas credenciales son las únicas válidas', async ({ page, request }) => {
    const user = userData('vista');
    const newPassword = `${user.contrasena}Z7`;

    await page.goto('/configuracion/usuarios');
    await page.getByRole('button', { name: 'Nuevo usuario', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Nuevo usuario' });
    await dialog.getByLabel('Usuario *', { exact: true }).fill(user.usuario);
    await dialog.getByLabel('Email', { exact: true }).fill(user.email);
    await dialog.locator('label.config-usersForm__roleOption').filter({ hasText: 'Solo lectura' }).click();
    await expect(dialog.getByRole('radio', { name: 'Solo lectura' })).toBeChecked();
    await dialog.getByLabel('Contraseña *', { exact: true }).fill(user.contrasena);
    await dialog.getByLabel('Confirmar contraseña *', { exact: true }).fill(user.contrasena);
    await dialog.getByRole('button', { name: 'Crear usuario', exact: true }).click();

    const search = page.getByRole('textbox', { name: 'Buscar' });
    await search.fill(user.usuario);
    let row = rowByText(page, user.usuario);
    await expect(row).toContainText('Solo lectura');
    await row.getByRole('button', { name: `Editar ${user.usuario}` }).click();

    dialog = page.getByRole('dialog', { name: 'Editar usuario' });
    await dialog.locator('label.config-usersForm__roleOption').filter({ hasText: 'Administrador' }).click();
    await expect(dialog.getByRole('radio', { name: 'Administrador' })).toBeChecked();
    await dialog.getByLabel('Nueva contraseña', { exact: true }).fill(newPassword);
    await dialog.getByLabel('Confirmar nueva contraseña', { exact: true }).fill(newPassword);
    await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();

    row = rowByText(page, user.usuario);
    await expect(row).toContainText('Administrador');

    const oldLogin = await apiResult(request, 'auth_login', {
      method: 'POST',
      data: { usuario: user.usuario, contrasena: user.contrasena },
      session: null,
    });
    expect(oldLogin.ok).toBe(false);
    expect(oldLogin.status).toBe(401);

    const renewed = await createApiSession(request, {
      username: user.usuario,
      password: newPassword,
    });
    expect(renewed.usuario.rol).toBe('admin');
    await closeApiSession(request, renewed);

    row = rowByText(page, user.usuario);
    await row.getByRole('button', { name: `Eliminar ${user.usuario}` }).click();
    const remove = page.getByRole('dialog', { name: 'Eliminar usuario' });
    await remove.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(rowByText(page, user.usuario)).toHaveCount(0);
  });
});
