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
  const api = vm.runInContext(`${source}\n({ paymentReceiptFileName, paymentReceiptHtml, downloadPaymentReceiptPdf });`, context);
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
