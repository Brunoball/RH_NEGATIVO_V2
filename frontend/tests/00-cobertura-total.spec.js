const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(FRONTEND_ROOT, 'src');
const BACKEND_ROOT = path.resolve(FRONTEND_ROOT, '..', 'backend');

function walk(root, predicate = () => true) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walk(fullPath, predicate));
    else if (predicate(fullPath)) output.push(fullPath);
  }
  return output;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function testSources() {
  return walk(__dirname, (file) => file.endsWith('.js') && path.basename(file) !== path.basename(__filename))
    .map(read)
    .join('\n');
}

function backendActions() {
  const modulesRoot = path.join(BACKEND_ROOT, 'modules');
  const routeFiles = walk(
    modulesRoot,
    (file) => file.endsWith(`${path.sep}routes.php`) && !file.includes(`${path.sep}whatsapp${path.sep}`),
  );
  const moduleActions = routeFiles.flatMap((file) =>
    [...read(file).matchAll(/register\('([^']+)'/g)].map((match) => match[1]),
  );
  const rootApiFile = path.join(BACKEND_ROOT, 'routes', 'api.php');
  const rootActions = fs.existsSync(rootApiFile)
    ? [...read(rootApiFile).matchAll(/register\('([^']+)'/g)].map((match) => match[1])
    : [];
  return [...new Set([...moduleActions, ...rootActions])].sort();
}

function frontendApiActions() {
  const frontendFiles = walk(
    SRC_ROOT,
    (file) => /\.(?:js|jsx)$/i.test(file) && !file.includes(`${path.sep}BotPanel${path.sep}`),
  );
  const backend = new Set(backendActions());
  return [...new Set(frontendFiles.flatMap((file) =>
    [...read(file).matchAll(/["']([a-z][a-z0-9_]+)["']/g)]
      .map((match) => match[1])
      .filter((action) => backend.has(action)),
  ))].sort();
}


function botFrontendEndpoints() {
  // El contador verde/rojo del botón del bot vive en Principal, fuera de BotPanel.
  // Escanear todo src evita que panel_unread_total (u otro uso futuro del API del bot)
  // quede invisible para el contrato de cobertura.
  const botFiles = walk(SRC_ROOT, (file) => /\.(?:js|jsx)$/i.test(file));
  const source = botFiles.map(read).join('\n');
  return [...new Set(
    [...source.matchAll(/bot(?:Panel|Management)(?:Get|Post|FormPost)\s*\(\s*["']([^"']+)/g)]
      .map((match) => match[1]),
  )].sort();
}

function applicationRoutes() {
  const appSource = read(path.join(SRC_ROOT, 'App.js'));
  const routes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((route) => route !== '*');

  // El Panel Bot usa una constante en App.js, por eso no entra en el regex literal.
  // Resolverla desde config evita que /panel-bot quede fuera de la cobertura de navegación.
  if (appSource.includes('path={BOT_PANEL_ROUTE}')) {
    const configPath = path.join(SRC_ROOT, 'config', 'config.jsx');
    if (fs.existsSync(configPath)) {
      const configSource = read(configPath);
      const match = configSource.match(/export const BOT_PANEL_ROUTE\s*=\s*["']([^"']+)/);
      if (match?.[1]) routes.push(match[1]);
    }
  }

  return [...new Set(routes)].sort();
}

const REQUIRED_UI_ACTION_MARKERS = [
  'Abrir menú',
  'Un clic para desplegar; doble clic para ingresar',
  'Abrir configuración',
  'Limpiar búsqueda',
  'Anterior',
  'Siguiente',
  'Exportar',
  'Excel',
  'PDF',
  'Nuevo socio',
  'Nueva empresa',
  'Nueva familia',
  'Ver ficha e historial',
  'Ver integrantes e historial',
  'Editar',
  'Dar de baja',
  'Reactivar',
  'Eliminar definitivamente',
  'Nueva categoría',
  'Nuevo descuento',
  'Ver historial de precios',
  'Nuevo usuario',
  'Registrar ingreso',
  'Registrar egreso',
  'Agregar opción',
  'Anular',
  'Elegir archivo',
  'Quitar comprobante',
  'Ver comprobante',
  'Selección múltiple',
  'Registrar pago',
  'Condonar cuota',
  'Condonados',
  'Eliminar condonación',
  'Registrar 2 pagos',
  'Aplicar pago a todo el grupo familiar',
  'Ver integrantes',
  'Hay cuotas ya pagadas en la selección.',
  'Monto personalizado',
  '+ Agregar',
  'Imprimir',
  'Comprobante',
  'PDF',
  'Eliminar pago',
  // Cabecera/perfil.
  'Abrir perfil',
  'Cerrar perfil',
  'Perfil de usuario',
  // Cobertura de ramas que antes quedaban fuera del recorrido E2E.
  'Quitar integrante',
  'Motivo de desvinculación',
  'Exportar cuotas',
  'Exportar todas las cuotas filtradas',
  'Paginación de ingresos',
  'Paginación de egresos',
  'Detalle mensual contable',
  'health',
  // Panel Bot WhatsApp.
  'Panel Bot WhatsApp',
  'Buscar por nombre, número, mensaje…',
  'Abrir reportes del bot',
  'Reportes del Bot',
  'Período del reporte',
  'Resumen',
  'Actividad',
  'Pagos',
  'Costos WhatsApp',
  'Filtrar por etiqueta',
  'Modo Bot',
  'Modo Manual',
  'Opciones del chat',
  'Editar nombre',
  'Cambiar etiqueta',
  'Ver galería',
  'Marcar como no leído',
  'Marcar como leído',
  'Vaciar chat',
  'Eliminar contacto',
  'Cambiar tema',
  'Adjuntar imagen/PDF',
  'Emojis',
  'Enviar',
  'Mensajes de prioridad alta',
  'Consultas atendidas',
  'Notificaciones normales:',
  'Notificaciones urgentes:',
  'Ventana 24 horas',
];

// Alcance intencional: sistema administrativo completo + Panel Bot.
// La lógica conversacional interna del chatbot se valida manualmente fuera de Playwright.
test.describe('Contrato de cobertura total del sistema y del Panel Bot', () => {
  test('el arranque del frontend no vuelve a envolver la aplicación en React.StrictMode', () => {
    const indexSource = read(path.join(SRC_ROOT, 'index.js'));
    expect(indexSource).not.toContain('<React.StrictMode>');
    expect(indexSource).not.toContain('</React.StrictMode>');
  });

  test('conserva las optimizaciones de respuesta de modales y Cuotas', () => {
    const modalSizeHook = read(
      path.join(SRC_ROOT, 'components', 'Global', 'Modales', 'useAnimatedModalSize.js'),
    );
    const cuotasSource = read(path.join(SRC_ROOT, 'components', 'Cuotas', 'Cuotas.jsx'));
    const cuotasApiSource = read(
      path.join(SRC_ROOT, 'components', 'Cuotas', 'api', 'cuotasApi.js'),
    );
    const cuotasModalCss = read(
      path.join(SRC_ROOT, 'components', 'Cuotas', 'modales', 'CuotasModal.css'),
    );

    expect(modalSizeHook).not.toContain('.animate(');
    expect(cuotasSource).toContain('React.memo(function CuotasTableRows');
    expect(cuotasSource).toContain('cuotasApi.contextosPago');
    expect(cuotasApiSource).toContain('cuotas_contextos_pago');
    expect(cuotasModalCss).toContain('.cuotas-modal--payment.entity-modal');
    expect(cuotasModalCss).toContain('width: min(920px, 100%)');
  });

  test('cada acción registrada por el backend administrativo, incluido health, aparece cubierta por la suite', () => {
    expect(fs.existsSync(BACKEND_ROOT), `No se encontró el backend en ${BACKEND_ROOT}`).toBe(true);
    const source = testSources();
    const missing = backendActions().filter((action) => !source.includes(action));
    expect(missing, `Acciones backend sin cobertura declarada: ${missing.join(', ')}`).toEqual([]);
  });

  test('cada acción usada por el frontend administrativo existe en el backend y está cubierta', () => {
    const backend = backendActions();
    const frontend = frontendApiActions();
    const source = testSources();
    expect(frontend.filter((action) => !backend.includes(action))).toEqual([]);
    expect(frontend.filter((action) => !source.includes(action))).toEqual([]);
  });

  test('cada endpoint usado por el Panel Bot tiene cobertura declarada', () => {
    const source = testSources();
    const missing = botFrontendEndpoints().filter((endpoint) => !source.includes(endpoint));
    expect(missing, `Endpoints del Panel Bot sin cobertura declarada: ${missing.join(', ')}`).toEqual([]);
  });

  test('todas las rutas de la aplicación, incluido el Panel Bot, están recorridas', () => {
    const source = testSources();
    const missing = applicationRoutes().filter((route) => !source.includes(route));
    expect(missing, `Rutas sin prueba: ${missing.join(', ')}`).toEqual([]);
  });

  test('las acciones visibles principales tienen un recorrido E2E declarado', () => {
    const source = testSources();
    const missing = REQUIRED_UI_ACTION_MARKERS.filter((marker) => !source.includes(marker));
    expect(missing, `Acciones visuales sin prueba: ${missing.join(', ')}`).toEqual([]);
  });
});
