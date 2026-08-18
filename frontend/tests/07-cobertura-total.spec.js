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

  test('cleanup E2E queda aislado como infraestructura y no se confunde con funcionalidad del sistema', async () => {
    const technical = technicalActions();
    expect(technical).toEqual(['e2e_cleanup']);
    const functional = new Set(registeredActions());
    expect(functional.has('e2e_cleanup')).toBe(false);
  });
});
