const ORGANIZATION = "CIRCULO Rh (-) · Asociación Civil";
const ORGANIZATION_ADDRESS =
  "Pje. Madre Teresa de Calcuta 48 · Tel: (03564) 436-366 · San Francisco (CBA)";
const ORGANIZATION_TAX =
  "IVA: EXENTO · CUIT: 30-71097653-4 · Inicio de actividades 2009";
const TREASURER = "Norberto Blesio";

const htmlEscape = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[character],
  );

const money = (value, decimals = 0) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value || 0));

const date = (value) => {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(parsed);
};

const firstValue = (...values) =>
  values.find((value) => String(value ?? "").trim() !== "") ?? "";

const uniqueValues = (values) =>
  Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );

const periodPair = (periodId) =>
  ({ 1: "1/2", 2: "3/4", 3: "5/6", 4: "7/8", 5: "9/10", 6: "11/12" })[
    Number(periodId)
  ] || "";

export const buildPaymentBarcode = ({ periodId, year, partnerId } = {}) => {
  const period = Number(periodId);
  const fullYear = Number(year);
  const partner = Number(partnerId);
  if (
    !Number.isInteger(period) ||
    period < 1 ||
    period > 7 ||
    !Number.isInteger(fullYear) ||
    fullYear < 2000 ||
    fullYear > 2099 ||
    !Number.isInteger(partner) ||
    partner <= 0
  ) {
    return "";
  }
  return `${period}${String(fullYear).slice(-2)}-${partner}`;
};

// Tabla oficial de módulos Code 128. El SVG se genera localmente para que el
// comprobante siga siendo escaneable sin Internet ni dependencias CDN.
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
];

const code128Values = (value) => {
  const text = String(value || "");
  if (
    !text ||
    [...text].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code > 126;
    })
  ) {
    return [];
  }
  const data = [...text].map((character) => character.charCodeAt(0) - 32);
  const checksum =
    (104 + data.reduce((total, code, index) => total + code * (index + 1), 0)) %
    103;
  return [104, ...data, checksum, 106];
};

export const paymentBarcodeSvg = (value, { height = 42 } = {}) => {
  const values = code128Values(value);
  if (!values.length) return "";
  const quietZone = 10;
  let cursor = quietZone;
  const rectangles = [];
  values.forEach((code) => {
    let drawBar = true;
    [...CODE128_PATTERNS[code]].forEach((moduleWidth) => {
      const width = Number(moduleWidth);
      if (drawBar) {
        rectangles.push(
          `<rect x="${cursor}" y="0" width="${width}" height="${height}" fill="#000"/>`,
        );
      }
      cursor += width;
      drawBar = !drawBar;
    });
  });
  const totalWidth = cursor + quietZone;
  return `<svg class="legacy-barcode" viewBox="0 0 ${totalWidth} ${height}" role="img" aria-label="Código ${htmlEscape(value)}" preserveAspectRatio="none">${rectangles.join("")}</svg>`;
};

export const normalizePaymentReceipt = (source = {}) => {
  const safeSource = source && typeof source === "object" ? source : {};
  const operation =
    safeSource.operacion && typeof safeSource.operacion === "object"
      ? safeSource.operacion
      : safeSource;
  const rawLines = operation.lineas || safeSource.lineas || [];
  const lines = (Array.isArray(rawLines) ? rawLines : []).map((line, index) => {
    const partnerId = Number(line.id_socio || line.idSocio || 0) || null;
    const periodId = Number(
      line.id_periodo_pago || line.id_periodo || line.mes || 0,
    ) || null;
    const year = Number(line.anio || line.anio_aplicado || 0) || null;
    return {
      id: line.id || line.id_pago || `${index}-${line.periodo || "linea"}`,
      idPago: Number(line.id_pago || 0) || null,
      partnerId,
      periodId,
      year,
      barcode:
        line.codigo_barra || buildPaymentBarcode({ periodId, year, partnerId }),
      socio:
        line.socio ||
        line.denominacion ||
        operation.socios_label ||
        operation.socio ||
        "—",
      categoria:
        line.categoria || operation.categorias_label || operation.categoria || "—",
      periodo: line.periodo_pago || line.periodo || line.descripcion || "—",
      montoBase: Number(line.monto_base ?? line.monto ?? 0),
      descuento: Number(
        line.porcentaje_descuento_familiar ?? line.porcentaje_descuento ?? 0,
      ),
      monto: Number(line.monto ?? 0),
      domicilio: firstValue(
        line.domicilio_2,
        line.domicilio,
        line.direccion,
        operation.domicilio_2,
        operation.domicilio,
      ),
      domicilioCobro: firstValue(
        line.domicilio_cobro,
        operation.domicilio_cobro,
      ),
      telefonoMovil: firstValue(line.telefono_movil, operation.telefono_movil),
      telefonoFijo: firstValue(line.telefono_fijo, operation.telefono_fijo),
      cobrador: firstValue(line.cobrador, operation.cobrador),
      medio: firstValue(line.medio_pago, operation.medio_pago),
      estado: line.estado || operation.estado || "PAGADO",
    };
  });

  return {
    organizacion: safeSource.organizacion || operation.organizacion || ORGANIZATION,
    codigo:
      operation.codigo_operacion || safeSource.codigo_operacion || safeSource.codigo || "",
    titulo:
      operation.estado === "CONDONADO"
        ? "Comprobante de condonación"
        : "Comprobante de pago",
    estado: operation.estado || lines[0]?.estado || "PAGADO",
    fecha: operation.fecha_pago || operation.fecha || "",
    socios:
      operation.socios_label ||
      operation.socio ||
      safeSource.socios ||
      uniqueValues(lines.map((line) => line.socio)).join(" · ") ||
      "—",
    modalidad:
      operation.modalidad_label || operation.modalidad || "Pago de cuotas",
    medio:
      operation.medio_pago ||
      (operation.estado === "CONDONADO"
        ? "CONDONACIÓN"
        : lines[0]?.medio || "—"),
    monto: Number(
      operation.monto ?? lines.reduce((total, line) => total + line.monto, 0),
    ),
    lineas: lines,
  };
};

const receiptLegacyEntries = (source) => {
  const receipt = normalizePaymentReceipt(source);
  const groups = new Map();
  receipt.lineas.forEach((line, index) => {
    const identity = line.partnerId || line.socio || `linea-${index}`;
    const key = `${identity}|${line.year || "sin-anio"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  });
  if (!groups.size) groups.set("sin-lineas", []);

  return Array.from(groups.values()).map((lines) => {
    const orderedLines = [...lines].sort(
      (left, right) => Number(left.periodId || 99) - Number(right.periodId || 99),
    );
    const first = orderedLines[0] || {};
    const people = uniqueValues(orderedLines.map((line) => line.socio));
    const categories = uniqueValues(orderedLines.map((line) => line.categoria));
    const periods = uniqueValues(
      orderedLines.map((line) => {
        if (Number(line.periodId) === 7) return "CONTADO ANUAL";
        return periodPair(line.periodId) || line.periodo;
      }),
    );
    const years = uniqueValues(orderedLines.map((line) => line.year));
    const singleYear = years.length === 1 ? years[0] : "";
    const isAnnual = orderedLines.some((line) => Number(line.periodId) === 7);
    const periodText = isAnnual
      ? `CONTADO ANUAL /${singleYear || first.year || "—"}`
      : `${periods.join(" - ") || receipt.modalidad}${singleYear ? ` /${singleYear}` : ""}`;
    const groupAmount = orderedLines.length
      ? orderedLines.reduce((total, line) => total + Number(line.monto || 0), 0)
      : receipt.monto;

    const collectionAddress = firstValue(
      ...orderedLines.map((line) => line.domicilioCobro),
    );
    const regularAddress = firstValue(
      ...orderedLines.map((line) => line.domicilio),
    );
    return {
      receipt,
      id: first.partnerId || "—",
      name: (people.join(" · ") || receipt.socios || "—").toUpperCase(),
      address: regularAddress || "",
      collectionAddress,
      phone: firstValue(
        ...orderedLines.map((line) => line.telefonoMovil),
        ...orderedLines.map((line) => line.telefonoFijo),
      ),
      category: categories.join(" · ") || "",
      state: String(receipt.estado || first.estado || "PAGADO").toUpperCase(),
      periodText,
      amount: money(groupAmount, 0),
      barcode: orderedLines.length === 1 ? first.barcode : "",
    };
  });
};

const receiptPanelHtml = (data, withBarcode) => `
  <div class="legacy-receipt-panel">
    <div class="legacy-receipt-row"><div class="legacy-receipt-cell legacy-receipt-cell--full"><strong>Socio:</strong>&nbsp;${htmlEscape(data.id)} - ${htmlEscape(data.name)}</div></div>
    <div class="legacy-receipt-row"><div class="legacy-receipt-cell legacy-receipt-cell--full"><strong>Domicilio:</strong>&nbsp;${htmlEscape(data.address)}</div></div>
    <div class="legacy-receipt-row"><div class="legacy-receipt-cell legacy-receipt-cell--full"><strong>Domicilio de cobro:</strong>&nbsp;${htmlEscape(data.collectionAddress)}</div></div>
    <div class="legacy-receipt-row">
      <div class="legacy-receipt-cell"><strong>Tel:</strong>&nbsp;${htmlEscape(data.phone)}</div>
      <div class="legacy-receipt-cell"><div class="legacy-receipt-amount">Importe: ${htmlEscape(data.amount)}</div></div>
    </div>
    <div class="legacy-receipt-row legacy-receipt-row--last">
      <div class="legacy-receipt-cell legacy-receipt-period">
        <div><strong>Período:</strong>&nbsp;${htmlEscape(data.periodText)}</div>
        <div><strong>Grupo:</strong>&nbsp;${htmlEscape(data.category)}&nbsp;<strong>Estado:</strong>&nbsp;${htmlEscape(data.state)}</div>
      </div>
      <div class="legacy-receipt-cell legacy-receipt-barcode-cell">
        ${
          withBarcode && data.barcode
            ? `<div class="legacy-barcode-container">${paymentBarcodeSvg(data.barcode)}</div><div class="legacy-barcode-text">${htmlEscape(data.barcode)}</div>`
            : `<div class="legacy-receipt-signature">${TREASURER} -<br/>Tesorero</div>`
        }
      </div>
    </div>
  </div>`;

export const paymentReceiptPreviewHtml = (source) => {
  const entries = receiptLegacyEntries(source);
  return `<div class="legacy-receipt-preview">${entries
    .map(
      (data) =>
        `${receiptPanelHtml(data, true)}${receiptPanelHtml(data, false)}`,
    )
    .join("")}</div>`;
};

const receiptStyles = `
  .legacy-receipt-panel { width:95mm; height:30mm; display:flex; justify-content:center; flex-direction:column; box-sizing:border-box; overflow:hidden; font-family:Arial,sans-serif; font-size:8pt; color:#000; background:#fff; }
  .legacy-receipt-row { padding:0 .2rem; display:flex; width:100%; justify-content:space-between; }
  .legacy-receipt-cell { margin:0; box-sizing:border-box; overflow:hidden; display:flex; white-space:nowrap; text-overflow:ellipsis; }
  .legacy-receipt-cell--full { flex:0 0 100%; }
  .legacy-receipt-row--last { min-height:7mm; }
  .legacy-receipt-period { display:flex; flex-direction:column; justify-content:center; flex:1; }
  .legacy-receipt-period div { flex:1; display:flex; align-items:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .legacy-receipt-barcode-cell { flex:1; padding:0; height:100%; min-height:6mm; display:flex; flex-direction:column; justify-content:center; align-items:center; }
  .legacy-barcode-container { display:flex; align-items:center; justify-content:center; width:100%; height:70%; }
  .legacy-barcode { width:100%; height:auto; max-height:24px; display:block; }
  .legacy-barcode-text { margin:0; height:30%; display:flex; align-items:center; justify-content:center; font-size:6pt; text-align:center; }
  .legacy-receipt-signature { width:100%; font-size:8pt; text-align:center; }
  .legacy-receipt-amount { width:100%; margin-right:.5rem; font-size:8pt; font-weight:bold; text-align:right; }
`;

export const paymentReceiptHtml = (source) => {
  const entries = receiptLegacyEntries(source);
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(entries.length / 6)) },
    (_, pageIndex) => {
      const pageEntries = entries.slice(pageIndex * 6, pageIndex * 6 + 6);
      const positions = [20, 68, 117, 166, 216, 264];
      return `<div class="legacy-page">${pageEntries
        .map(
          (data, index) => `
            <div class="legacy-receipt-area legacy-receipt-area--original" style="top:${positions[index]}mm">${receiptPanelHtml(data, true)}</div>
            <div class="legacy-receipt-area legacy-receipt-area--copy" style="top:${positions[index]}mm">${receiptPanelHtml(data, false)}</div>`,
        )
        .join("")}</div>`;
    },
  ).join("");
  const title = entries[0]?.receipt?.titulo || "Comprobante de pago";
  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${htmlEscape(title)}</title>
      <style>
        @page { size:A4 portrait; margin:0; }
        * { box-sizing:border-box; }
        html, body { margin:0; padding:0; background:#fff; }
        .legacy-page { width:210mm; height:297mm; position:relative; page-break-after:always; }
        .legacy-receipt-area { width:95mm; height:30mm; position:absolute; padding:.5rem 0 0; overflow:hidden; }
        .legacy-receipt-area--original { left:5mm; }
        .legacy-receipt-area--copy { left:110mm; }
        ${receiptStyles}
        .print-actions { position:fixed; top:8mm; right:8mm; z-index:10; }
        .print-actions button { min-height:40px; padding:0 16px; border:0; border-radius:8px; color:#fff; background:#2563eb; font-weight:700; cursor:pointer; }
        @media print { .print-actions { display:none !important; } }
      </style>
    </head>
    <body>
      <div class="print-actions"><button type="button" onclick="window.print()">Imprimir comprobante</button></div>
      ${pages}
    </body>
  </html>`;
};

export const openPaymentReceipt = (source, options = {}) => {
  const popup = window.open("", "_blank", "width=980,height=760");
  if (!popup) return false;
  popup.document.open();
  popup.document.write(paymentReceiptHtml(source));
  popup.document.close();
  popup.focus();
  if (options.openPrintDialog) window.setTimeout(() => popup.print(), 250);
  return true;
};

const pdfSafeText = (value) => {
  const replacements = {
    "\u00a0": " ",
    "–": "-",
    "—": "-",
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "…": "...",
  };
  return String(value ?? "")
    .replace(/[\u00a0–—‘’“”…]/g, (character) => replacements[character])
    .normalize("NFC")
    .split("")
    .map((character) => (character.charCodeAt(0) <= 255 ? character : "?"))
    .join("")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
};

const pdfByteLength = (value) => String(value).length;

const pdfBinary = (objects) => {
  let result = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdfByteLength(result);
    result += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdfByteLength(result);
  result += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    result += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  result += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array(
    Array.from(result, (character) => character.charCodeAt(0) & 0xff),
  );
};

const pdfText = (x, y, size, value, { bold = false } = {}) =>
  `BT /${bold ? "F2" : "F1"} ${size} Tf 0 0 0 rg ${x} ${y} Td (${pdfSafeText(value)}) Tj ET`;

const fitted = (value, limit) => {
  const text = String(value || "—");
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 3))}...` : text;
};

const paymentReceiptPdfContent = (data) => {
  const commands = [];
  commands.push(pdfText(56, 790, 16, ORGANIZATION, { bold: true }));
  commands.push(pdfText(56, 772, 10, ORGANIZATION_ADDRESS));
  commands.push(pdfText(56, 756, 10, ORGANIZATION_TAX));
  commands.push("0.82 0.82 0.82 RG 0.8 w 56 742 m 539 742 l S");
  commands.push(pdfText(74, 696, 11, `Socio: ${data.id} - ${fitted(data.name, 62)}`, { bold: true }));
  commands.push(pdfText(74, 666, 10, `Domicilio: ${fitted(data.address, 68)}`));
  commands.push(pdfText(74, 638, 10, `Tel: ${fitted(data.phone, 28)}`));
  commands.push(pdfText(74, 610, 10, `Periodo: ${fitted(data.periodText, 48)}`));
  commands.push(pdfText(74, 582, 10, `Grupo: ${fitted(data.category, 28)}   Estado: ${data.state}`));
  commands.push(pdfText(390, 666, 11, `Importe: ${data.amount}`, { bold: true }));
  commands.push("0.85 0.85 0.85 RG 0.7 w 382 652 m 520 652 l S");
  commands.push(pdfText(420, 590, 10, TREASURER));
  commands.push(pdfText(438, 574, 10, "Tesorero"));
  commands.push(pdfText(74, 510, 9, `Fecha: ${date(data.receipt.fecha)}`));
  if (data.barcode) commands.push(pdfText(390, 510, 9, `Codigo: ${data.barcode}`));
  return commands.join("\n");
};

export const downloadPaymentReceiptPdf = async (source) => {
  try {
    const receipt = normalizePaymentReceipt(source);
    const entries = receiptLegacyEntries(source);
    const pageCount = Math.max(1, entries.length);
    const firstPageId = 5;
    const firstContentId = firstPageId + pageCount;
    const pageIds = Array.from(
      { length: pageCount },
      (_, index) => firstPageId + index,
    );
    const objects = [
      null,
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${pageIds
        .map((id) => `${id} 0 R`)
        .join(" ")}] /Count ${pageCount} >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ];
    entries.forEach((entry, index) => {
      const contentId = firstContentId + index;
      objects[firstPageId + index] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`;
    });
    entries.forEach((entry, index) => {
      const content = paymentReceiptPdfContent(entry);
      objects[firstContentId + index] =
        `<< /Length ${pdfByteLength(content)} >>\nstream\n${content}\nendstream`;
    });
    const blob = new Blob([pdfBinary(objects)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeCode = String(receipt.codigo || receipt.fecha || "pago")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    anchor.href = url;
    anchor.download = `Comprobante-${safeCode || "pago"}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
};
