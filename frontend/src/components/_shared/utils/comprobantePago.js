import logoLalcec from "../../../imagenes/logo_lalcec_sf.png";

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

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
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

const compact = (value, limit = 92) => {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 3))}...` : text;
};

export const normalizePaymentReceipt = (source = {}) => {
  const safeSource = source && typeof source === "object" ? source : {};
  const operation =
    safeSource.operacion && typeof safeSource.operacion === "object"
      ? safeSource.operacion
      : safeSource;
  const rawLines = operation.lineas || safeSource.lineas || [];
  const lines = (Array.isArray(rawLines) ? rawLines : []).map((line, index) => ({
    id:
      line.id ||
      line.id_linea ||
      `${index}-${line.periodo || line.concepto || "linea"}`,
    socio:
      line.socio ||
      line.denominacion ||
      operation.socios_label ||
      operation.socio ||
      "—",
    categoria:
      line.categoria || operation.categorias_label || operation.categoria || "—",
    periodo: line.periodo || line.descripcion || line.concepto || "—",
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
      operation.direccion,
    ),
    cobrador: firstValue(line.cobrador, operation.cobrador),
    medio: firstValue(line.medio_pago, operation.medio_pago),
  }));

  const socios =
    operation.socios_label ||
    operation.socio ||
    safeSource.socios ||
    uniqueValues(lines.map((line) => line.socio)).join(" · ") ||
    "—";

  return {
    organizacion:
      safeSource.organizacion ||
      operation.organizacion ||
      "LALCEC San Francisco",
    codigo:
      operation.codigo_operacion ||
      safeSource.codigo_operacion ||
      safeSource.codigo ||
      "",
    titulo:
      operation.estado === "CONDONADO"
        ? "Comprobante de condonación"
        : "Comprobante de pago",
    estado: operation.estado || "PAGADO",
    fecha: operation.fecha_pago || operation.fecha || "",
    socios,
    modalidad:
      operation.modalidad_label ||
      operation.modalidad ||
      operation.concepto ||
      "Pago de cuotas",
    medio:
      operation.medio_pago ||
      (operation.estado === "CONDONADO" ? "CONDONACIÓN" : "—"),
    domicilio: firstValue(
      operation.domicilio_2,
      operation.domicilio,
      operation.direccion,
      lines[0]?.domicilio,
    ),
    cobrador: firstValue(operation.cobrador, lines[0]?.cobrador),
    tipoEntidad: String(
      operation.tipo_entidad || operation.tipo || safeSource.tipo_entidad || "",
    ).toUpperCase(),
    montoBase: Number(
      operation.monto_base ??
        lines.reduce((total, line) => total + line.montoBase, 0),
    ),
    monto: Number(
      operation.monto ?? lines.reduce((total, line) => total + line.monto, 0),
    ),
    observaciones: operation.observaciones || "",
    motivoCondonacion: operation.motivo_condonacion || "",
    lineas: lines,
  };
};

const receiptDisplayData = (source) => {
  const receipt = normalizePaymentReceipt(source);
  const categories = uniqueValues(receipt.lineas.map((line) => line.categoria));
  const periods = uniqueValues(receipt.lineas.map((line) => line.periodo));
  const amounts = uniqueValues(
    receipt.lineas.map((line) => Number(line.monto || line.montoBase || 0)),
  ).map(Number);
  const isCompany = receipt.tipoEntidad === "EMPRESA";
  const hasSeveralPeople = uniqueValues(
    receipt.lineas.map((line) => line.socio),
  ).length > 1;
  const unitAmount = amounts.length === 1 ? amounts[0] : 0;
  const amountDetail =
    unitAmount > 0 && unitAmount !== receipt.monto
      ? `${money(unitAmount)} · Total ${money(receipt.monto)}`
      : money(receipt.monto);

  return {
    receipt,
    entityLabel: isCompany
      ? "Empresa"
      : hasSeveralPeople
        ? "Socios"
        : "Afiliado",
    copyEntityLabel: isCompany
      ? "Empresa"
      : hasSeveralPeople
        ? "Socios"
        : "Nombre y Apellido",
    people: compact(receipt.socios, 116),
    address: compact(receipt.domicilio || "Domicilio no registrado", 94),
    category: compact(categories.join(" · ") || "—", 68),
    periods: compact(periods.join(", ") || receipt.modalidad, 112),
    amountDetail,
    paymentLabel: receipt.cobrador ? "Cobrador" : "Medio de pago",
    paymentValue: compact(receipt.cobrador || receipt.medio || "—", 54),
    state: receipt.estado || "PAGADO",
  };
};

const receiptBodyHtml = (source) => {
  const data = receiptDisplayData(source);
  const { receipt } = data;

  return `
    <div class="gcuotas-contenedor">
      <div class="gcuotas-comprobante" aria-label="${htmlEscape(receipt.titulo)}">
        <div class="gcuotas-talon-socio">
          <p><strong>${htmlEscape(data.entityLabel)}:</strong> ${htmlEscape(data.people)}</p>
          <p><strong>Domicilio:</strong> ${htmlEscape(data.address)}</p>
          <p><strong>Categoría / Monto:</strong> ${htmlEscape(data.category)} / ${htmlEscape(data.amountDetail)}</p>
          <p><strong>Período:</strong> ${htmlEscape(data.periods)}</p>
          <p><strong>${htmlEscape(data.paymentLabel)}:</strong> ${htmlEscape(data.paymentValue)}</p>
          <p><strong>Estado:</strong> ${htmlEscape(data.state)}</p>
          <p><strong>Fecha:</strong> ${htmlEscape(date(receipt.fecha))}</p>
          <p>Por consultas comunicarse al 03564-15205778</p>
          <p>Las cuotas adeudadas se cobrarán al valor actualizado al momento del pago.</p>
        </div>

        <div class="gcuotas-talon-cobrador">
          <p><strong>${htmlEscape(data.copyEntityLabel)}:</strong> ${htmlEscape(data.people)}</p>
          <p><strong>Categoría / Monto:</strong> ${htmlEscape(data.category)} / ${htmlEscape(data.amountDetail)}</p>
          <p><strong>Período:</strong> ${htmlEscape(data.periods)}</p>
          <p><strong>${htmlEscape(data.paymentLabel)}:</strong> ${htmlEscape(data.paymentValue)}</p>
          <p><strong>Estado:</strong> ${htmlEscape(data.state)}</p>
          <p><strong>Fecha:</strong> ${htmlEscape(date(receipt.fecha))}</p>
        </div>
      </div>
    </div>`;
};

export const paymentReceiptHtml = (source, options = {}) => {
  const receipt = normalizePaymentReceipt(source);
  const outputLabel = options.pdf
    ? "Guardar como PDF"
    : "Imprimir comprobante";

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${htmlEscape(receipt.titulo)}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 0;
        }
        * {
          box-sizing: border-box;
        }
        html {
          margin: 0;
          padding: 0;
        }
        body {
          width: 210mm;
          height: 297mm;
          margin: 0;
          padding: 0;
          font-family: Arial, sans-serif;
          font-size: 12px;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
          position: relative;
          transform: rotate(90deg);
          transform-origin: top left;
          left: 70%;
          top: 0;
          color: #000;
          background: #fff;
        }
        .gcuotas-contenedor {
          width: 210mm;
          margin: 10mm 0;
          page-break-after: always;
          box-sizing: border-box;
        }
        .gcuotas-comprobante {
          width: 100%;
          height: 100%;
          display: flex;
          box-sizing: border-box;
        }
        .gcuotas-talon-socio {
          width: 60%;
          padding-left: 12.5mm;
          padding-top: 13mm;
        }
        .gcuotas-talon-cobrador {
          width: 60mm;
          padding-left: 5.5mm;
          padding-top: 16mm;
        }
        p {
          margin-top: 5px;
          margin-bottom: 1em;
          font-size: 13px;
        }
        .print-actions {
          position: fixed;
          top: 8mm;
          left: 8mm;
          z-index: 10;
          transform: rotate(-90deg);
          transform-origin: top left;
        }
        .print-actions button {
          min-height: 40px;
          padding: 0 16px;
          border: 0;
          border-radius: 8px;
          color: #fff;
          background: #f97316;
          font-weight: 700;
          cursor: pointer;
        }
        @media print {
          .print-actions {
            display: none !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="print-actions">
        <button type="button" onclick="window.print()">${outputLabel}</button>
      </div>
      ${receiptBodyHtml(source)}
    </body>
  </html>`;
};

export const openPaymentReceipt = (source, options = {}) => {
  const popup = window.open("", "_blank", "width=980,height=760");
  if (!popup) return false;

  popup.document.open();
  popup.document.write(paymentReceiptHtml(source, options));
  popup.document.close();
  popup.focus();

  if (options.openPrintDialog) {
    window.setTimeout(() => popup.print(), 250);
  }
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
  result += `xref\n0 ${objects.length}\n`;
  result += "0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index += 1) {
    result += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  result += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Uint8Array(
    Array.from(result, (character) => character.charCodeAt(0) & 0xff),
  );
};

const pdfColor = {
  ink: "0.10 0.13 0.17",
  muted: "0.48 0.52 0.57",
  orange: "0.98 0.45 0.09",
  orangeDark: "0.76 0.22 0.04",
  green: "0.02 0.47 0.34",
  white: "1 1 1",
};

const pdfText = (
  x,
  y,
  size,
  value,
  { bold = false, color = pdfColor.ink } = {},
) =>
  `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg ${x} ${y} Td (${pdfSafeText(value)}) Tj ET`;

const pdfEstimatedWidth = (value, size, bold = false) =>
  String(value ?? "").length * size * (bold ? 0.58 : 0.53);

const pdfFittedText = (value, maxWidth, size = 9, bold = false) => {
  const text = String(value ?? "").trim() || "—";
  if (pdfEstimatedWidth(text, size, bold) <= maxWidth) return text;

  const averageCharacterWidth = size * (bold ? 0.58 : 0.53);
  const maxLength = Math.max(4, Math.floor(maxWidth / averageCharacterWidth));
  return compact(text, maxLength);
};

const pdfField = (
  commands,
  x,
  y,
  label,
  value,
  { width = 225, valueSize = 9.2 } = {},
) => {
  commands.push(
    pdfText(x, y, 7.1, String(label).toUpperCase(), {
      bold: true,
      color: pdfColor.muted,
    }),
  );
  commands.push(
    pdfText(
      x,
      y - 16,
      valueSize,
      pdfFittedText(value, width, valueSize, true),
      { bold: true },
    ),
  );
};

const bytesToBinaryString = (bytes) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return binary;
};

const dataUrlToBytes = (dataUrl) => {
  const base64 = String(dataUrl).split(",")[1] || "";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

let receiptLogoPromise = null;

const loadReceiptLogo = () => {
  if (receiptLogoPromise) return receiptLogoPromise;

  receiptLogoPromise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 220;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(null);
          return;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, size, size);
        const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(
          image,
          (size - width) / 2,
          (size - height) / 2,
          width,
          height,
        );

        resolve({
          bytes: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)),
          width: size,
          height: size,
        });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = logoLalcec;
  });

  return receiptLogoPromise;
};

const paymentReceiptPdfContent = (source, { hasLogo = false } = {}) => {
  const data = receiptDisplayData(source);
  const { receipt } = data;
  const commands = [];

  // Tarjeta principal centrada en A4 apaisado. Se mantiene lejos de los bordes
  // para evitar cortes en visores e impresoras con márgenes no imprimibles.
  commands.push("q 0.98 0.45 0.09 rg 30 482 782 8 re f Q");
  commands.push("q 0.86 0.88 0.91 RG 0.8 w 30 104 782 386 re S Q");
  commands.push("q 0.97 0.98 0.99 rg 584 104 228 310 re f Q");
  commands.push("q 0.77 0.80 0.84 RG [4 4] 0 d 584 104 m 584 414 l S Q");
  commands.push("q 0.90 0.91 0.93 RG 0.7 w 30 414 m 812 414 l S Q");

  if (hasLogo) {
    commands.push("q 44 0 0 44 48 428 cm /Logo Do Q");
    commands.push("q 24 0 0 24 602 356 cm /Logo Do Q");
  } else {
    commands.push("q 1.00 0.97 0.93 rg 48 428 44 44 re f Q");
    commands.push(pdfText(59, 445, 11, "L", { bold: true, color: pdfColor.orange }));
  }

  commands.push(
    pdfText(105, 458, 15, receipt.organizacion || "LALCEC San Francisco", {
      bold: true,
    }),
  );
  commands.push(
    pdfText(105, 438, 8.5, "Gestión de socios · Comprobante institucional", {
      color: pdfColor.muted,
    }),
  );
  commands.push(
    pdfText(650, 458, 9, String(receipt.titulo || "Comprobante").toUpperCase(), {
      bold: true,
      color: pdfColor.orangeDark,
    }),
  );
  if (receipt.codigo) {
    const code = pdfFittedText(`N.º ${receipt.codigo}`, 155, 9, true);
    commands.push(pdfText(650, 438, 9, code, { bold: true }));
  }

  commands.push(
    pdfText(48, 390, 7.5, "ORIGINAL", { bold: true, color: pdfColor.orange }),
  );
  commands.push(
    pdfText(602, 390, 7.5, "COPIA", { bold: true, color: pdfColor.orange }),
  );

  pdfField(commands, 48, 362, data.entityLabel, data.people, { width: 500, valueSize: 10 });
  pdfField(commands, 48, 314, "Domicilio", data.address, { width: 500 });
  pdfField(commands, 48, 266, "Categoría", data.category, { width: 238 });
  pdfField(commands, 306, 266, "Período", data.periods, { width: 244 });
  pdfField(commands, 48, 218, data.paymentLabel, data.paymentValue, { width: 238 });
  pdfField(commands, 306, 218, "Estado", data.state, { width: 244 });

  commands.push("q 1.00 0.97 0.93 rg 48 132 510 54 re f Q");
  commands.push("q 0.99 0.79 0.61 RG 0.7 w 48 132 510 54 re S Q");
  commands.push(
    pdfText(64, 162, 7.8, "TOTAL ABONADO", {
      bold: true,
      color: pdfColor.orangeDark,
    }),
  );
  commands.push(
    pdfText(438, 151, 18, money(receipt.monto), {
      bold: true,
      color: pdfColor.orange,
    }),
  );

  commands.push(pdfText(634, 365, 10.5, "LALCEC", { bold: true }));
  pdfField(commands, 602, 326, data.copyEntityLabel, data.people, { width: 188, valueSize: 8.2 });
  pdfField(commands, 602, 282, "Categoría", data.category, { width: 188, valueSize: 8.2 });
  pdfField(commands, 602, 238, "Período", data.periods, { width: 188, valueSize: 8.2 });
  pdfField(commands, 602, 194, data.paymentLabel, data.paymentValue, { width: 188, valueSize: 8.2 });

  commands.push("q 1.00 0.97 0.93 rg 602 126 188 42 re f Q");
  commands.push(
    pdfText(614, 151, 7.2, "TOTAL", { bold: true, color: pdfColor.orangeDark }),
  );
  commands.push(
    pdfText(692, 143, 12, money(receipt.monto), {
      bold: true,
      color: pdfColor.orange,
    }),
  );

  commands.push(
    pdfText(602, 112, 7, date(receipt.fecha), { color: pdfColor.muted }),
  );
  if (receipt.codigo) {
    commands.push(
      pdfText(
        706,
        112,
        7,
        pdfFittedText(`N.º ${receipt.codigo}`, 84, 7),
        { color: pdfColor.muted },
      ),
    );
  }

  return commands.join("\n");
};

export const downloadPaymentReceiptPdf = async (source) => {
  try {
    const receipt = normalizePaymentReceipt(source);
    const logo = await loadReceiptLogo();
    const content = paymentReceiptPdfContent(source, { hasLogo: Boolean(logo) });
    const imageObjectNumber = logo ? 7 : null;
    const resources = imageObjectNumber
      ? `/Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo ${imageObjectNumber} 0 R >>`
      : "/Font << /F1 3 0 R /F2 4 0 R >>";

    const objects = [
      null,
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [5 0 R] /Count 1 >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << ${resources} >> /Contents 6 0 R >>`,
      `<< /Length ${pdfByteLength(content)} >>\nstream\n${content}\nendstream`,
    ];

    if (logo) {
      const imageStream = bytesToBinaryString(logo.bytes);
      objects.push(
        `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n${imageStream}\nendstream`,
      );
    }

    const blob = new Blob([pdfBinary(objects)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeCode = String(receipt.codigo || receipt.fecha || "pago")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    anchor.href = url;
    anchor.download = `comprobante_pago_${safeCode || "pago"}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
};
