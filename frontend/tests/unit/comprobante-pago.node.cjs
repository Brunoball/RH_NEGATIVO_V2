// Ejecutar desde frontend: node --test tests/unit/comprobante-pago.node.cjs
// Usa el código real de src; no necesita servidor, sesión, dependencias ni base de datos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function receiptModule() {
  const file = path.resolve(__dirname, '../..', 'src/components/_shared/utils/comprobantePago.js');
  const source = fs.readFileSync(file, 'utf8').replace(/^export const /gm, 'const ');
  let anchor;
  let blob;
  let clicks = 0;
  const context = vm.createContext({
    Blob, btoa,
    URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement() { anchor = { click() { clicks++; }, remove() {} }; return anchor; }, body: { appendChild() {} } },
    window: { setTimeout(callback) { callback(); } },
  });
  const api = vm.runInContext(`${source}\n({ paymentReceiptFileName, paymentReceiptHtml, paymentReceiptPreviewHtml, normalizePaymentReceipt, downloadPaymentReceiptPdf });`, context);
  return { api, download: () => ({ anchor, blob, clicks }) };
}

const cases = [
  ['socio individual', { operacion: { codigo_operacion: 'PAGO-13886', socios_label: 'Juan Pérez' }, lineas: [{ socio: 'Juan Pérez', id_socio: 1 }] }, 'Comprobante - Juan Pérez - PAGO-13886.pdf'],
  ['períodos del mismo socio sin repetir nombre', { codigo_operacion: 'PAGO-2', lineas: [{ socio: 'Ana López', id_socio: 1, id_periodo: 1 }, { socio: 'Ana López', id_socio: 1, id_periodo: 2 }] }, 'Comprobante - Ana López - PAGO-2.pdf'],
  ['familia con dos socios', { codigo_operacion: 'PAGO-3', lineas: [{ socio: 'Ana López', id_socio: 1 }, { socio: 'Juan Pérez', id_socio: 2 }] }, 'Comprobante - Ana López · Juan Pérez - PAGO-3.pdf'],
  ['apellido y nombre del RH viejo', { codigo_operacion: 'PAGO-4', apellido: 'Pérez', nombre: 'Juan' }, 'Comprobante - Pérez Juan - PAGO-4.pdf'],
  ['nombre_socio con tildes y eñe', { codigo_operacion: 'PAGO-5', lineas: [{ nombre_socio: 'María Ñúñez' }] }, 'Comprobante - María Ñúñez - PAGO-5.pdf'],
  ['caracteres no válidos en Windows', { codigo_operacion: 'PAGO-6', socio: 'Ana / López:*?"<>|' }, 'Comprobante - Ana López - PAGO-6.pdf'],
  ['condonación conserva identificador', { codigo_operacion: 'COND-7', socio: 'Juan Pérez', estado: 'CONDONADO' }, 'Comprobante - Juan Pérez - COND-7.pdf'],
  ['ausencia de nombre no inventa un socio', { codigo_operacion: 'PAGO-8' }, 'Comprobante - PAGO-8.pdf'],
];

for (const [label, source, expected] of cases) {
  test(label, async () => {
    const { api, download } = receiptModule();
    assert.equal(api.paymentReceiptFileName(source), expected);
    assert.equal(await api.downloadPaymentReceiptPdf(source), true);
    const saved = download();
    assert.equal(saved.anchor.download, expected);
    assert.equal(saved.clicks, 1);
    const bytes = Buffer.from(await saved.blob.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
    assert.ok(bytes.toString('latin1').endsWith('%%EOF'));
    const html = api.paymentReceiptHtml(source);
    assert.ok(html.includes(`<title>${expected.slice(0, -4)}</title>`));
    const link = html.match(/href="data:application\/pdf;base64,([^"]+)" download="([^"]+)"/);
    assert.ok(link, 'La ventana debe tener enlace descargable, además del título');
    assert.equal(link[2], expected);
    assert.deepEqual(Buffer.from(link[1], 'base64'), bytes, 'Ambas descargas deben producir el mismo PDF');
  });
}

test('nombres extensos conservan el código y un nombre de archivo acotado', () => {
  const { api } = receiptModule();
  const name = api.paymentReceiptFileName({ codigo_operacion: 'PAGO-999', socio: 'Á'.repeat(250) });
  assert.ok(name.startsWith('Comprobante - Á'));
  assert.ok(name.endsWith(' - PAGO-999.pdf'));
  assert.ok(name.length < 180);
});

// Regresión: antes, la tabla de Cuotas priorizaba domicilio_cobro y ese valor
// terminaba tanto en Domicilio como en Domicilio de cobro del cupón.
test('domicilio particular y de cobro distintos se imprimen separados en las dos copias y en el PDF', async () => {
  const { api, download } = receiptModule();
  const source = {
    operacion: { codigo_operacion: 'PAGO-2086', estado: 'PAGADO' },
    lineas: [{
      id_socio: 2086, socio: 'JUAN PRUEBA', id_periodo: 6, anio: 2026,
      domicilio: 'CALLE PARTICULAR 123',
      domicilio_cobro: 'DIARIO LA VOZ DE SAN JUSTO',
    }],
  };
  const normalized = api.normalizePaymentReceipt(source);
  assert.equal(normalized.lineas[0].domicilio, 'CALLE PARTICULAR 123');
  assert.equal(normalized.lineas[0].domicilioCobro, 'DIARIO LA VOZ DE SAN JUSTO');

  for (const html of [api.paymentReceiptPreviewHtml(source), api.paymentReceiptHtml(source)]) {
    assert.equal((html.match(/<strong>Domicilio:<\/strong>&nbsp;CALLE PARTICULAR 123/g) || []).length, 2);
    assert.equal((html.match(/<strong>Domicilio de cobro:<\/strong>&nbsp;DIARIO LA VOZ DE SAN JUSTO/g) || []).length, 2);
    assert.ok(!html.includes('<strong>Domicilio:</strong>&nbsp;DIARIO LA VOZ DE SAN JUSTO'));
  }

  assert.equal(await api.downloadPaymentReceiptPdf(source), true);
  const pdf = Buffer.from(await download().blob.arrayBuffer()).toString('latin1');
  assert.ok(pdf.includes('(Domicilio: CALLE PARTICULAR 123)'), 'PDF: domicilio particular');
  assert.ok(pdf.includes('(Domicilio de cobro: DIARIO LA VOZ DE SAN JUSTO)'), 'PDF: domicilio de cobro');
});

test('si falta el domicilio particular, no se copia allí la dirección de cobro', () => {
  const { api } = receiptModule();
  const source = { lineas: [{ id_socio: 1, socio: 'PRUEBA', domicilio_cobro: 'SOLO DOMICILIO COBRO' }] };
  const normalized = api.normalizePaymentReceipt(source);
  assert.equal(normalized.lineas[0].domicilio, '');
  assert.equal(normalized.lineas[0].domicilioCobro, 'SOLO DOMICILIO COBRO');
  const html = api.paymentReceiptPreviewHtml(source);
  assert.ok(html.includes('<strong>Domicilio:</strong>&nbsp;</div>'));
  assert.ok(html.includes('<strong>Domicilio de cobro:</strong>&nbsp;SOLO DOMICILIO COBRO'));
});

test('domicilios propios de cada socio no se mezclan en los cupones familiares', () => {
  const { api } = receiptModule();
  const html = api.paymentReceiptPreviewHtml({
    lineas: [
      { id_socio: 91, socio: 'SOCIO A', domicilio: 'PARTICULAR A 10', domicilio_cobro: 'COBRO A 15' },
      { id_socio: 92, socio: 'SOCIO B', domicilio: 'PARTICULAR B 20', domicilio_cobro: 'COBRO B 25' },
    ],
  });
  assert.ok(html.includes('<strong>Domicilio:</strong>&nbsp;PARTICULAR A 10'));
  assert.ok(html.includes('<strong>Domicilio de cobro:</strong>&nbsp;COBRO A 15'));
  assert.ok(html.includes('<strong>Domicilio:</strong>&nbsp;PARTICULAR B 20'));
  assert.ok(html.includes('<strong>Domicilio de cobro:</strong>&nbsp;COBRO B 25'));
});
