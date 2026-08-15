const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const MODULES = ['auth', 'dashboard', 'socios', 'categorias', 'cuotas', 'configuracion', 'usuarios'];
const FRONTEND_API_DIRS = ['Dashboard', 'Socios', 'Categorias', 'Cuotas', 'Configuracion'];
const EXCLUDED_MODULES = ['contable', 'testing_cleanup'];

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

function registeredActions() {
  const root = backendRoot();
  const actions = new Set(['health']);
  for (const moduleName of MODULES) {
    const file = path.join(root, 'modules', moduleName, 'routes.php');
    expect(fs.existsSync(file), `No existe ${file}`).toBe(true);
    const source = read(file);
    for (const match of source.matchAll(/->register\(\s*['"]([^'"]+)['"]/g)) {
      actions.add(match[1]);
    }
  }
  return [...actions].sort();
}

function excludedActions() {
  const root = backendRoot();
  const actions = new Set();
  for (const moduleName of EXCLUDED_MODULES) {
    const file = path.join(root, 'modules', moduleName, 'routes.php');
    if (!fs.existsSync(file)) continue;
    for (const match of read(file).matchAll(/->register\(\s*['"]([^'"]+)['"]/g)) {
      actions.add(match[1]);
    }
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
      for (const match of source.matchAll(/api(?:Get|Post)\(\s*['"]([^'"]+)['"]/g)) {
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
    // Sólo cuenta una acción cuando el spec la pasa como argumento literal a
    // un helper que efectivamente dispara HTTP. Una mención en un array,
    // comentario o lista de permisos ya NO alcanza para aprobar el release gate.
    for (const match of source.matchAll(/(?:apiCall|apiResult|expectApiError)\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]/g)) {
      add(match[1], name, match[0]);
    }
    for (const match of source.matchAll(/actionUrl\s*\(\s*['"]([^'"]+)['"]/g)) {
      add(match[1], name, match[0]);
    }
    // Algunos tests de routing construyen la URL explícitamente.
    for (const match of source.matchAll(/[?&]action=([a-zA-Z0-9_]+)/g)) {
      add(match[1], name, match[0]);
    }
  }

  return evidence;
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
  test('toda ruta backend no-contable actual tiene evidencia de ejecución HTTP funcional', async () => {
    const actions = registeredActions();
    const moduleEvidence = operationalActionsBySpec({ includeTransversal: false });
    const allEvidence = operationalActionsBySpec({ includeTransversal: true });

    for (const action of actions) {
      const evidence = (action === 'health' ? allEvidence : moduleEvidence).get(action) || [];
      expect(
        evidence.length,
        `La acción ${action} existe en backend pero ningún spec la ejecuta mediante apiCall/apiResult/expectApiError/actionUrl. ` +
          'Una mera mención textual ya no cuenta como cobertura.',
      ).toBeGreaterThan(0);
    }
  });

  test('guardas defensivas críticas no forzables destructivamente siguen presentes en producción', async () => {
    // Estos caminos requieren una FK rota, corrupción de esquema, una carrera de
    // DELETE o dejar al sistema sin administradores. No se provocan contra una
    // base operativa; el gate sí impide que desaparezcan accidentalmente.
    const guards = {
      socios: [
        'RELACION_INVALIDA',
        'SOCIO_DELETE_RELACION_BLOQUEANTE',
        'SOCIO_DELETE_DB_ERROR',
        'SOCIO_DELETE_ERROR',
      ],
      categorias: ['ESQUEMA_DESCUENTOS_DESACTUALIZADO'],
      cuotas: ['CODIGO_BARRA_INVALIDO', 'CUOTAS_SCHEMA_INVALIDO', 'PAGO_NO_ELIMINADO'],
      usuarios: ['ULTIMO_ADMIN_ACTIVO'],
    };

    for (const [moduleName, codes] of Object.entries(guards)) {
      const source = backendModuleSources(moduleName);
      for (const code of codes) {
        expect(source, `Falta la guarda defensiva ${code} en ${moduleName}`).toContain(`'${code}'`);
      }
    }
  });

  test('todo action usado por los clientes API del frontend existe en el backend cubierto', async () => {
    const backendActions = new Set(registeredActions());
    const frontendActions = frontendApiActions();
    const missing = frontendActions.filter((action) => !backendActions.has(action));
    expect(missing, `Actions de frontend sin ruta backend: ${missing.join(', ')}`).toEqual([]);
  });

  test('Contabilidad y cleanup técnico no se mezclan con el alcance funcional solicitado', async () => {
    const excluded = excludedActions();
    const functional = new Set(registeredActions());
    const accidental = excluded.filter((action) => functional.has(action));
    expect(accidental).toEqual([]);
    expect([...functional].some((action) => action.startsWith('contable_'))).toBe(false);
  });
});
