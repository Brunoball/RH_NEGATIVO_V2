const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const MODULES = [
  'auth',
  'dashboard',
  'socios',
  'categorias',
  'cuotas',
  'configuracion',
  'usuarios',
  'contable',
];
const FRONTEND_API_DIRS = [
  'Dashboard',
  'Socios',
  'Categorias',
  'Cuotas',
  'Configuracion',
  'Contable',
];
const TECHNICAL_MODULES = ['testing_cleanup'];

const EXPORT_SURFACE_MANIFEST = {
  'src/components/Socios/Socios.jsx': 1,
  'src/components/Socios/secciones/Familias.jsx': 1,
  'src/components/Cuotas/Cuotas.jsx': 1,
  'src/components/Contable/Contable.jsx': 1,
  'src/components/Contable/IngresosSociosView.jsx': 2,
};


const MODAL_SURFACE_MANIFEST = {
  'src/components/Categorias/secciones/CategoriasModule.jsx': { CrudModal: 2, ModalEliminarGlobal: 2, InfoModal: 1 },
  'src/components/Configuracion/secciones/ConfiguracionModule.jsx': { CrudModal: 1, ModalEliminarGlobal: 2 },
  'src/components/Configuracion/secciones/ContableConfiguracion.jsx': { CrudModal: 1, ModalEliminarGlobal: 2 },
  'src/components/Configuracion/secciones/UsuariosConfiguracion.jsx': { CrudModal: 1, ModalEliminarGlobal: 2 },
  'src/components/Contable/Contable.jsx': { CrudModal: 4, SummaryDetailModal: 1, ModalExportarGlobal: 1, ModalEliminarGlobal: 1 },
  'src/components/Contable/IngresosSociosView.jsx': { CrudModal: 1, ModalExportarGlobal: 2, BalanceModal: 1 },
  'src/components/Cuotas/Cuotas.jsx': { ModalExportarGlobal: 1, ModalPagoCuota: 1, ModalComprobantePago: 1, ModalCodigoBarras: 1, ModalEliminarGlobal: 3 },
  'src/components/Cuotas/modales/ModalCodigoBarras.jsx': { CrudModal: 1, ModalEliminarGlobal: 1 },
  'src/components/Cuotas/modales/ModalPagoCuota.jsx': { CrudModal: 1 },
  'src/components/Principal/Principal.jsx': { ModalPerfil: 1, LogoutModal: 1 },
  'src/components/Socios/Socios.jsx': { ModalExportarGlobal: 1, CrudModal: 1, InfoModal: 1, ModalMotivoGlobal: 1, ModalEliminarGlobal: 2 },
  'src/components/Socios/secciones/Familias.jsx': { ModalExportarGlobal: 1, CrudModal: 1, InfoModal: 1, ModalEliminarGlobal: 2 },
};


const RAW_DIALOG_SURFACE_MANIFEST = {
  'src/components/Principal/Principal.jsx': 1,
  'src/components/Perfil/ModalPerfil.jsx': 1,
  'src/components/Socios/Socios.jsx': 1,
};

const UI_COVERAGE_EVIDENCE = {
  socios_id_motivo_paginacion: {
    spec: '10-cobertura-ui-total.spec.js',
    tokens: ['búsqueda exacta por ID', 'Paginación de socios', 'Referencia de último contacto', 'Motivo de baja', 'Ver motivo de baja completo'],
  },
  cuotas_contado_anual_ui: {
    spec: '10-cobertura-ui-total.spec.js',
    tokens: ['Contado Anual se registra desde UI', 'Eliminar Contado Anual', 'modalidad exclusiva', 'Paginación de cuotas'],
  },
  exportaciones_alcances_reales: {
    spec: '10-cobertura-ui-total.spec.js',
    tokens: ['registros visibles', 'detalle completo'],
  },
  contable_opciones_inline: {
    spec: '10-cobertura-ui-total.spec.js',
    tokens: ['AGREGAR NUEVA OPCIÓN', 'CATEGORIA_INGRESO', 'CONCEPTO_INGRESO', 'CATEGORIA_EGRESO', 'CONCEPTO_EGRESO'],
  },
  contable_comprobante_ui: {
    spec: '10-cobertura-ui-total.spec.js',
    tokens: ['Ver comprobante', 'contable_egreso_archivo', 'Vista previa del comprobante'],
  },
  balance_tres_pestanas: {
    spec: '10-cobertura-ui-total.spec.js',
    tokens: ['Inscripciones', 'Bajas', 'Deudores por período', 'Secciones del balance anual'],
  },
  configuracion_contable_cinco_listas: {
    spec: '10-cobertura-ui-total.spec.js',
    tokens: ['Personas / proveedores', 'Categorías de ingresos', 'Conceptos de ingresos', 'Categorías de egresos', 'Conceptos de egresos'],
  },
  errores_seguros_adicionales: {
    spec: '10-cobertura-ui-total.spec.js',
    tokens: ['ESTADO_ESTRUCTURAL', 'FILTRO_PERIODO_INVALIDO', 'TIPO_OPCION_INVALIDO', 'ESTADO_OPCION_INVALIDO', 'OPCION_CONTABLE_INVALIDA'],
  },
};

const FUNCTIONAL_FILTER_EVIDENCE = {
  socios_principales: {
    spec: '02-socios.spec.js',
    tokens: ["getByLabel('Socio / ID'", "getByLabel('Categoría')", "name: 'Vigentes'", "name: 'Bajas'"],
  },
  socios_avanzados: {
    spec: '08-blindaje-modulos.spec.js',
    tokens: ['Tipo de sangre', 'Pagos', 'Último contacto', 'Fecha de ingreso', 'Mostrar Todos'],
  },
  familias: {
    spec: '02-socios.spec.js',
    tokens: ['familias_listar', 'firstData.dni', "name: 'Bajas'", "name: 'Activas'"],
  },
  categorias: {
    spec: '03-categorias.spec.js',
    tokens: ["name: 'Activas'", "name: 'Dadas de baja'", "name: 'Historial'", "name: 'Búsqueda'"],
  },
  cuotas: {
    spec: '05-cuotas.spec.js',
    tokens: ['Seleccionar todo lo filtrado', 'Mostrar Todos', "'Estado'", "'Cobrador'", "'Medio de pago'", "name: 'Socio / ID'"],
  },
  configuracion: {
    spec: '06-configuracion.spec.js',
    tokens: ["name: 'Buscar'", 'Catálogos generales'],
  },
  usuarios: {
    spec: '06-configuracion.spec.js',
    tokens: ['Configuración de usuarios', "name: 'Dados de baja'", "name: 'Activos'", "name: 'Buscar'"],
  },
  contable: {
    spec: '09-contable.spec.js',
    tokens: ["getByLabel('Categoría'", "getByLabel('Medio de pago'", "getByLabel('Mes'", 'contable_ingresos_socios', 'contable_balance', 'balanceSearch'],
  },
};

function frontendRoot() {
  return path.resolve(__dirname, '..');
}

function backendRoot() {
  const configured = String(process.env.PW_BACKEND_DIR || '').trim();
  if (configured) return path.resolve(frontendRoot(), configured);
  return path.resolve(frontendRoot(), '..', 'backend');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function actionsFromRouteFile(file) {
  const actions = new Set();
  if (!fs.existsSync(file)) return [];
  for (const match of read(file).matchAll(/->register\(\s*['"]([^'"]+)['"]/g)) {
    actions.add(match[1]);
  }
  return [...actions].sort();
}

function registeredActions() {
  const root = backendRoot();
  const actions = new Set(['health']);
  for (const moduleName of MODULES) {
    const file = path.join(root, 'modules', moduleName, 'routes.php');
    expect(fs.existsSync(file), `No existe ${file}`).toBe(true);
    for (const action of actionsFromRouteFile(file)) actions.add(action);
  }
  return [...actions].sort();
}

function technicalActions() {
  const root = backendRoot();
  const actions = new Set();
  for (const moduleName of TECHNICAL_MODULES) {
    const file = path.join(root, 'modules', moduleName, 'routes.php');
    for (const action of actionsFromRouteFile(file)) actions.add(action);
  }
  return [...actions].sort();
}

function frontendApiActions() {
  const root = path.join(frontendRoot(), 'src', 'components');
  const actions = new Set();
  for (const componentName of FRONTEND_API_DIRS) {
    const apiDir = path.join(root, componentName, 'api');
    if (!fs.existsSync(apiDir)) continue;
    for (const entry of fs.readdirSync(apiDir)) {
      if (!entry.endsWith('.js')) continue;
      const source = read(path.join(apiDir, entry));
      for (const match of source.matchAll(/api(?:Get|Post|Put|Delete|FormPost|Download)\(\s*['"]([^'"]+)['"]/g)) {
        actions.add(match[1]);
      }
    }
  }
  return [...actions].sort();
}


function frontendExportModalOccurrences() {
  const root = frontendRoot();
  const actual = {};
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.jsx')) {
        const source = read(full);
        const count = [...source.matchAll(/<ModalExportarGlobal\b/g)].length;
        if (count) actual[path.relative(root, full).replace(/\\/g, '/')] = count;
      }
    }
  };
  visit(path.join(root, 'src', 'components'));
  return actual;
}


function frontendModalOccurrences() {
  const root = frontendRoot();
  const componentRoot = path.join(root, 'src', 'components');
  const modalNames = [
    'CrudModal',
    'InfoModal',
    'ModalEliminarGlobal',
    'ModalMotivoGlobal',
    'ModalExportarGlobal',
    'ModalComprobantePago',
    'ModalCodigoBarras',
    'ModalPagoCuota',
    'BalanceModal',
    'SummaryDetailModal',
    'ModalPerfil',
    'LogoutModal',
  ];
  const expression = new RegExp(`<(${modalNames.join('|')})\\b`, 'g');
  const actual = {};

  for (const relative of Object.keys(MODAL_SURFACE_MANIFEST)) {
    const file = path.join(root, relative);
    expect(fs.existsSync(file), `Falta superficie modal inventariada: ${relative}`).toBe(true);
    const counts = {};
    for (const match of read(file).matchAll(expression)) {
      counts[match[1]] = (counts[match[1]] || 0) + 1;
    }
    if (Object.keys(counts).length) actual[relative] = counts;
  }

  // Si aparece un modal de aplicación en un archivo que no está en el manifiesto,
  // también debe bloquear el release. Excluimos implementaciones Global: allí se
  // define la infraestructura, no una apertura de negocio concreta.
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.jsx')) {
        const relative = path.relative(root, full).replace(/\\/g, '/');
        if (relative.includes('/Global/')) continue;
        const matches = [...read(full).matchAll(expression)];
        if (matches.length && !Object.prototype.hasOwnProperty.call(MODAL_SURFACE_MANIFEST, relative)) {
          actual[relative] = matches.reduce((counts, match) => {
            counts[match[1]] = (counts[match[1]] || 0) + 1;
            return counts;
          }, {});
        }
      }
    }
  };
  visit(componentRoot);
  return actual;
}


function frontendRawDialogOccurrences() {
  const root = frontendRoot();
  const componentRoot = path.join(root, 'src', 'components');
  const actual = {};
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.jsx')) {
        const relative = path.relative(root, full).replace(/\\/g, '/');
        if (relative.includes('/Global/')) continue;
        const source = read(full);
        const count = [...source.matchAll(/role\s*=\s*["']dialog["']/g)].length;
        if (count) actual[relative] = count;
      }
    }
  };
  visit(componentRoot);
  return actual;
}

function specSources({ includeTransversal = true } = {}) {
  return fs.readdirSync(__dirname)
    .filter((name) => name.endsWith('.spec.js'))
    .filter((name) => name !== path.basename(__filename))
    .filter((name) => includeTransversal || name !== '00-contratos-seguridad.spec.js')
    .map((name) => ({ name, source: read(path.join(__dirname, name)) }));
}

function operationalActionsBySpec({ includeTransversal = true } = {}) {
  const evidence = new Map();
  const add = (action, specName, expression) => {
    if (!evidence.has(action)) evidence.set(action, []);
    evidence.get(action).push({ specName, expression });
  };

  for (const { name, source } of specSources({ includeTransversal })) {
    // Sólo cuenta cuando el spec pasa el action literal a una función que
    // efectivamente dispara HTTP. Arrays de permisos o comentarios no cuentan.
    for (const match of source.matchAll(/(?:apiCall|apiResult|expectApiError|apiMultipartCall|apiBinaryResult)\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]/g)) {
      add(match[1], name, match[0]);
    }
    for (const match of source.matchAll(/actionUrl\s*\(\s*['"]([^'"]+)['"]/g)) {
      add(match[1], name, match[0]);
    }
    for (const match of source.matchAll(/[?&]action=([a-zA-Z0-9_]+)/g)) {
      add(match[1], name, match[0]);
    }
  }

  return evidence;
}


function securityMatrixActions() {
  const source = read(path.join(__dirname, '00-contratos-seguridad.spec.js'));
  return [...new Set(
    [...source.matchAll(/\[\s*['"]([a-zA-Z0-9_]+)['"]\s*,\s*['"](?:GET|POST|PUT|DELETE)['"]\s*\]/g)]
      .map((match) => match[1]),
  )].sort();
}

function backendModuleSources(moduleName) {
  const moduleDir = path.join(backendRoot(), 'modules', moduleName);
  const chunks = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.php')) chunks.push(read(full));
    }
  };
  visit(moduleDir);
  return chunks.join('\n');
}

test.describe('Release gate · cobertura funcional total', () => {
  test('toda ruta funcional backend, incluida Contabilidad, tiene ejecución HTTP real en algún spec', async () => {
    const actions = registeredActions();
    const moduleEvidence = operationalActionsBySpec({ includeTransversal: false });
    const allEvidence = operationalActionsBySpec({ includeTransversal: true });

    for (const action of actions) {
      const evidence = (action === 'health' ? allEvidence : moduleEvidence).get(action) || [];
      expect(
        evidence.length,
        `La acción ${action} existe en backend pero ningún spec la ejecuta mediante un helper HTTP. ` +
          'Una mera mención textual no cuenta como cobertura.',
      ).toBeGreaterThan(0);
    }
  });

  test('la matriz transversal de autenticación y métodos incluye cada action funcional y técnica', async () => {
    const expected = [...new Set([...registeredActions(), ...technicalActions()])].sort();
    const matrix = securityMatrixActions();
    const missing = expected.filter((action) => !matrix.includes(action));
    const unknown = matrix.filter((action) => !expected.includes(action));
    expect(missing, `Actions sin prueba transversal de seguridad: ${missing.join(', ')}`).toEqual([]);
    expect(unknown, `Actions en la matriz de seguridad que ya no existen: ${unknown.join(', ')}`).toEqual([]);
  });

  test('guardas defensivas críticas no forzables destructivamente siguen presentes en producción', async () => {
    // Estos caminos requieren corrupción, carreras o estados peligrosos que no
    // se provocan contra una base operativa. El gate sí evita que desaparezcan.
    const guards = {
      socios: [
        'RELACION_INVALIDA',
        'SOCIO_DELETE_RELACION_BLOQUEANTE',
        'SOCIO_DELETE_DB_ERROR',
        'SOCIO_DELETE_ERROR',
      ],
      categorias: ['ESQUEMA_DESCUENTOS_DESACTUALIZADO'],
      cuotas: [
        'CODIGO_BARRA_INVALIDO',
        'CUOTAS_SCHEMA_INVALIDO',
        'PAGO_NO_ELIMINADO',
        'MEDIO_PAGO_INSCRIPCION_INVALIDO',
        'MONTO_INSCRIPCION_INVALIDO',
        'INSCRIPCION_YA_REGISTRADA',
        'INSCRIPCION_NO_ELIMINADA',
      ],
      usuarios: ['ULTIMO_ADMIN_ACTIVO'],
      contable: [
        'CONTABLE_DESCUADRE_INGRESOS',
        'CONTABLE_DESCUADRE_COBRANZA',
        'CONTABLE_DESCUADRE_DETALLE_COBROS',
        'CONTABLE_DESCUADRE_PADRON',
        'CONTABLE_DESCUADRE_JERARQUIA',
        'CONTABLE_DESCUADRE_ESTADOS',
        'CONTABLE_DESCUADRE_ANUAL',
        'CONTABLE_DESCUADRE_MEDIOS',
        'CONTABLE_DESCUADRE_MEDIOS_RESUMEN',
        'CONTABLE_DESCUADRE_CATEGORIAS_INGRESOS',
        'CONTABLE_DESCUADRE_CATEGORIAS_EGRESOS',
        'CONTABLE_DESCUADRE_RESULTADO_MENSUAL',
        'BALANCE_DESCUADRE_INSCRIPCIONES',
        'BALANCE_DESCUADRE_ESTADOS_INSCRIPCION',
        'BALANCE_DESCUADRE_PERIODOS_INSCRIPCION',
        'BALANCE_DESCUADRE_BAJAS',
        'BALANCE_DESCUADRE_PERIODOS_BAJAS',
        'BALANCE_DESCUADRE_DEUDORES',
        'BALANCE_DESCUADRE_PERIODOS_DEUDORES',
        'TIPO_ARCHIVO_INVALIDO',
        'ARCHIVO_FORBIDDEN',
      ],
    };

    for (const [moduleName, codes] of Object.entries(guards)) {
      const source = backendModuleSources(moduleName);
      for (const code of codes) {
        expect(source, `Falta la guarda defensiva ${code} en ${moduleName}`).toContain(`'${code}'`);
      }
    }
  });

  test('todo action usado por clientes API del frontend existe en el backend y está dentro del gate', async () => {
    const backendActions = new Set(registeredActions());
    const frontendActions = frontendApiActions();
    const missing = frontendActions.filter((action) => !backendActions.has(action));
    expect(missing, `Actions de frontend sin ruta backend funcional: ${missing.join(', ')}`).toEqual([]);
  });


  test('cada superficie de exportación del frontend está inventariada y Excel/PDF tienen ejecución E2E', async () => {
    const actualSurfaces = frontendExportModalOccurrences();
    expect(
      actualSurfaces,
      'Cambió la cantidad o ubicación de ModalExportarGlobal: agregá/actualizá su E2E antes de liberar.',
    ).toEqual(EXPORT_SURFACE_MANIFEST);

    const modalSource = read(path.join(frontendRoot(), 'src', 'components', 'Global', 'Modales', 'ModalExportarGlobal.jsx'));
    expect(modalSource).toContain('value: "excel"');
    expect(modalSource).toContain('value: "pdf"');

    const sociosSpec = read(path.join(__dirname, '02-socios.spec.js'));
    const cuotasSpec = read(path.join(__dirname, '05-cuotas.spec.js'));
    const contableSpec = read(path.join(__dirname, '09-contable.spec.js'));
    for (const [name, source] of Object.entries({ sociosSpec, cuotasSpec, contableSpec })) {
      expect(source, `${name} debe ejecutar exportación Excel`).toContain("format: 'Excel'");
      expect(source, `${name} debe ejecutar exportación PDF`).toContain("format: 'PDF'");
    }
    expect(contableSpec).toContain('Exportar pestaña actual');
    expect(contableSpec).toContain('Exportar todas las pestañas');
    expect(contableSpec).toContain('Otros ingresos UI');
    expect(contableSpec).toContain('Egresos UI');

    const extendedUiSpec = read(path.join(__dirname, '10-cobertura-ui-total.spec.js'));
    expect(extendedUiSpec, 'Socios debe probar explícitamente el alcance de registros visibles').toContain('registros visibles');
    expect(extendedUiSpec, 'Contabilidad debe probar explícitamente Exportar detalle completo').toContain('detalle completo');
    expect(cuotasSpec, 'Cuotas debe conservar la exportación de todas las cuotas filtradas mediante el alcance por defecto').toContain("test('exporta la vista filtrada de cuotas en Excel y PDF'");
  });

  test('cada superficie modal de negocio está inventariada y conserva evidencia E2E', async () => {
    const actual = frontendModalOccurrences();
    expect(
      actual,
      'Cambió la cantidad o ubicación de modales de negocio: agregá/actualizá su E2E y el manifiesto antes de liberar.',
    ).toEqual(MODAL_SURFACE_MANIFEST);

    const rawDialogs = frontendRawDialogOccurrences();
    expect(
      rawDialogs,
      'Apareció o desapareció un role=dialog directo fuera de Global: inventarialo y agregá su apertura E2E antes de liberar.',
    ).toEqual(RAW_DIALOG_SURFACE_MANIFEST);

    const modalEvidenceByModule = {
      socios: ['02-socios.spec.js', ['Nuevo socio', 'Información del socio', 'Dar de baja al socio', 'Reactivar socio', 'Eliminar socio definitivamente', 'Nueva familia', 'Ficha de la familia', 'Eliminar definitivamente la familia']],
      categorias: ['03-categorias.spec.js', ['Nueva categoría', 'Historial de valores', 'Nuevo descuento familiar', 'Enviar descuento al historial']],
      cuotas: ['05-cuotas.spec.js', ['Registro por código de barras', 'Registro de pagos', 'Eliminar pago', 'Condonar cuota', 'Eliminar pago de inscripción']],
      configuracion: ['06-configuracion.spec.js', ['Agregar cobrador', 'Nuevo usuario', 'Eliminar usuario']],
      contable: ['09-contable.spec.js', ['Registrar ingreso', 'Editar ingreso', 'Registrar egreso', 'Editar egreso', 'Detalle mensual contable', 'Agregar persona o proveedor']],
      shell: ['01-navegacion.spec.js', ['Perfil de usuario']],
      logout: ['01-login.spec.js', ['Confirmar cierre de sesión']],
    };

    for (const [moduleName, [specName, tokens]] of Object.entries(modalEvidenceByModule)) {
      const source = read(path.join(__dirname, specName));
      for (const token of tokens) {
        expect(source, `Falta evidencia de apertura modal ${token} en ${moduleName}`).toContain(token);
      }
    }

    const extended = read(path.join(__dirname, '10-cobertura-ui-total.spec.js'));
    expect(extended).toContain('Motivo de baja');
    expect(extended).toContain('Eliminar Contado Anual');
    expect(extended).toContain('Secciones del balance anual');
  });

  test('los huecos UI críticos detectados por auditoría quedan fijados al release gate', async () => {
    for (const [area, evidence] of Object.entries(UI_COVERAGE_EVIDENCE)) {
      const file = path.join(__dirname, evidence.spec);
      expect(fs.existsSync(file), `Falta spec extendido para ${area}: ${evidence.spec}`).toBe(true);
      const source = read(file);
      for (const token of evidence.tokens) {
        expect(source, `Falta evidencia extendida ${token} en ${area}`).toContain(token);
      }
    }
  });

  test('los filtros funcionales críticos tienen evidencia E2E explícita y no sólo presencia visual', async () => {
    for (const [moduleName, evidence] of Object.entries(FUNCTIONAL_FILTER_EVIDENCE)) {
      const file = path.join(__dirname, evidence.spec);
      expect(fs.existsSync(file), `Falta spec de filtros para ${moduleName}: ${evidence.spec}`).toBe(true);
      const source = read(file);
      for (const token of evidence.tokens) {
        expect(source, `Falta evidencia del filtro/acción ${token} en ${moduleName}`).toContain(token);
      }
    }
  });

  test('cleanup E2E queda aislado como infraestructura y no se confunde con funcionalidad del sistema', async () => {
    const technical = technicalActions();
    expect(technical).toEqual(['e2e_cleanup']);
    const functional = new Set(registeredActions());
    expect(functional.has('e2e_cleanup')).toBe(false);
  });
});
