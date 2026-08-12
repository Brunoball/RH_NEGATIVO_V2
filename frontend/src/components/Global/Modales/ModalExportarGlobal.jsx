import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileExcel, faFileImport, faFilePdf, faLayerGroup, faList, faSpinner, faTimes } from "@fortawesome/free-solid-svg-icons";
import "../Global_css/Global_Modals.css";
import useAnimatedModalSize from "./useAnimatedModalSize";
import "../Global_css/Global_Exportar.css";

const FORMATOS_EXPORTAR = [
  {
    value: "excel",
    label: "Excel",
    description: "Descarga directa en archivo .xlsx real.",
    icon: faFileExcel,
    tone: "excel",
  },
  {
    value: "pdf",
    label: "PDF",
    description: "Descarga directa en archivo .pdf con tabla ordenada.",
    icon: faFilePdf,
    tone: "pdf",
  },
];

const ALCANCE_ACTUAL = "actual";
const ALCANCE_TODOS = "todos";

function normalizarTexto(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";

  return String(value)
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return normalizarTexto(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return normalizarTexto(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(value, fallback = "exportacion") {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || fallback;
}

function fechaArchivo() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}


function leerJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function obtenerOrigenDesdeUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  try {
    return new URL(value, window.location.origin).origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

const LERNA_PROD_ORIGIN = "https://lerna.3devsnet.com";

function esHostLocal() {
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

function normalizarApiRoutesUrl(url) {
  let value = String(url || "").trim();
  if (!value) return "";

  value = value.replace(/\/+$/, "");

  if (/\/api\.php$/i.test(value)) return value;
  if (/\/routes$/i.test(value)) return `${value}/api.php`;
  if (/\/api\/routes$/i.test(value)) return `${value}/api.php`;

  return `${value}/api.php`;
}

function obtenerUrlAbsolutaDesdeStorage() {
  try {
    const urls = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const raw = key ? localStorage.getItem(key) : "";
      const matches = String(raw || "").match(/https?:\/\/[^\"'\s\\]+/gi) || [];
      urls.push(...matches);
    }

    return (
      urls.find((url) => /\/uploads\//i.test(url)) ||
      urls.find((url) => /lerna\.3devsnet\.com/i.test(url)) ||
      urls.find((url) => !/auth-db|phpmyadmin/i.test(url)) ||
      ""
    );
  } catch {
    return "";
  }
}

function resolverApiExportacionUrl() {
  const envUrl = String(
    process.env.REACT_APP_API_URL ||
      process.env.REACT_APP_API_BASE_URL ||
      process.env.REACT_APP_BASE_URL ||
      ""
  ).trim();

  if (envUrl) return normalizarApiRoutesUrl(envUrl);

  const storageUrl = obtenerUrlAbsolutaDesdeStorage();
  const storageOrigin = obtenerOrigenDesdeUrl(storageUrl);
  if (storageOrigin) return `${storageOrigin}/api/routes/api.php`;

  if (esHostLocal()) return `${LERNA_PROD_ORIGIN}/api/routes/api.php`;

  const origin = String(window.location.origin || LERNA_PROD_ORIGIN).replace(/\/+$/, "");
  return `${origin}/api/routes/api.php`;
}

function resolverPublicBaseUrl() {
  const publicEnvUrl = String(
    process.env.REACT_APP_PUBLIC_BASE_URL || process.env.REACT_APP_APP_URL || ""
  ).trim();

  if (publicEnvUrl) return publicEnvUrl.replace(/\/+$/, "");

  const storageUrl = obtenerUrlAbsolutaDesdeStorage();
  const storageOrigin = obtenerOrigenDesdeUrl(storageUrl);
  if (storageOrigin) return storageOrigin;

  if (esHostLocal()) return LERNA_PROD_ORIGIN;

  return String(window.location.origin || LERNA_PROD_ORIGIN).replace(/\/+$/, "");
}

function obtenerAuthTokenExportacion() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("auth_token") ||
    sessionStorage.getItem("auth_token") ||
    sessionStorage.getItem("session_key") ||
    sessionStorage.getItem("sessionKey") ||
    sessionStorage.getItem("token") ||
    ""
  );
}

function obtenerTenantIdExportacion() {
  return localStorage.getItem("idTenant") || sessionStorage.getItem("idTenant") || "";
}

async function apiGetExportacion(action, params = {}) {
  const apiUrl = resolverApiExportacionUrl();
  const idTenant = obtenerTenantIdExportacion();
  const query = new URLSearchParams({
    action,
    ...(idTenant ? { idTenant } : {}),
    ...(params || {}),
  }).toString();

  const token = obtenerAuthTokenExportacion();
  const res = await fetch(`${apiUrl}?${query}`, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const text = await res.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("La API no devolvió JSON válido al obtener el logo institucional.");
    }
  }

  if (!res.ok) {
    throw new Error(data?.mensaje || `Error HTTP ${res.status}`);
  }

  return data;
}

function normalizarLogoPdfUrl(url) {
  const value = String(url || "").trim();

  if (
    !value ||
    value.toLowerCase() === "null" ||
    value.toLowerCase() === "undefined" ||
    value === "-"
  ) {
    return "";
  }

  if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }

  const clean = value.replace(/\\/g, "/");
  const publicBase = resolverPublicBaseUrl();
  return clean.startsWith("/") ? `${publicBase}${clean}` : `${publicBase}/${clean}`;
}

function dataUrlToBytes(dataUrl) {
  const [, base64 = ""] = String(dataUrl || "").split(",");
  if (!base64) return new Uint8Array();

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBinaryString(bytes) {
  const chunks = [];
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + size)));
  }
  return chunks.join("");
}

function calcularCajaImagen(asset, maxWidth, maxHeight) {
  if (!asset?.width || !asset?.height) {
    return { width: maxWidth, height: maxHeight, offsetX: 0, offsetY: 0 };
  }

  const ratio = Math.min(maxWidth / asset.width, maxHeight / asset.height);
  const width = asset.width * ratio;
  const height = asset.height * ratio;

  return {
    width,
    height,
    offsetX: (maxWidth - width) / 2,
    offsetY: (maxHeight - height) / 2,
  };
}

function cargarImagenComoJpegAsset(url, name = "ImLogoExport") {
  return new Promise((resolve) => {
    const logoUrl = normalizarLogoPdfUrl(url);

    if (!logoUrl || typeof document === "undefined") {
      resolve(null);
      return;
    }

    const img = new Image();
    const esDataUrl = logoUrl.startsWith("data:");
    const esBlobUrl = logoUrl.startsWith("blob:");

    if (!esDataUrl && !esBlobUrl) {
      img.crossOrigin = "anonymous";
    }

    let resuelto = false;
    const finalizar = (asset) => {
      if (resuelto) return;
      resuelto = true;
      resolve(asset || null);
    };

    const timeout = window.setTimeout(() => finalizar(null), 8000);

    img.onload = () => {
      try {
        window.clearTimeout(timeout);

        const maxSize = 512;
        const widthOriginal = Math.max(1, img.naturalWidth || img.width || 1);
        const heightOriginal = Math.max(1, img.naturalHeight || img.height || 1);
        const ratio = Math.min(maxSize / widthOriginal, maxSize / heightOriginal, 1);
        const drawWidth = Math.max(1, Math.round(widthOriginal * ratio));
        const drawHeight = Math.max(1, Math.round(heightOriginal * ratio));

        const canvas = document.createElement("canvas");
        canvas.width = drawWidth;
        canvas.height = drawHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finalizar(null);
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, drawWidth, drawHeight);
        ctx.drawImage(img, 0, 0, drawWidth, drawHeight);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        const bytes = dataUrlToBytes(dataUrl);

        if (!bytes || bytes.length === 0) {
          finalizar(null);
          return;
        }

        finalizar({ name, width: drawWidth, height: drawHeight, bytes });
      } catch (_) {
        finalizar(null);
      }
    };

    img.onerror = () => {
      window.clearTimeout(timeout);
      finalizar(null);
    };

    img.src = logoUrl;
  });
}

function obtenerDatosInstitucionalesLocales() {
  const usuario = leerJsonStorage("usuario") || {};
  const tenant = usuario?.tenant || leerJsonStorage("tenant") || {};
  const logoUrl = normalizarLogoPdfUrl(
    tenant?.logo_icono_url ||
    tenant?.logo_url ||
    usuario?.tenant_logo_icono_url ||
    usuario?.tenant_logo_url ||
    usuario?.logo_icono_url ||
    usuario?.logo_url ||
    ""
  );
  const nombre = normalizarTexto(tenant?.nombre || usuario?.tenant_nombre || usuario?.institucion || "Institución");

  return { logoUrl, nombre };
}

async function obtenerDatosInstitucionalesExportacion() {
  const locales = obtenerDatosInstitucionalesLocales();

  try {
    const data = await apiGetExportacion("perfil_logo_institucional");
    const tenant = data?.tenant || {};
    const logoDataUrl = normalizarLogoPdfUrl(tenant?.logo_data_url || data?.logo_data_url || "");
    const logoUrl = normalizarLogoPdfUrl(
      logoDataUrl || tenant?.logo_icono_url || tenant?.logo_url || data?.logo_icono_url || data?.logo_url || ""
    );
    const nombre = normalizarTexto(tenant?.nombre || data?.nombre || data?.tenant_nombre || locales.nombre || "Institución");
    const logoAsset = await cargarImagenComoJpegAsset(logoUrl || locales.logoUrl);

    return { logoAsset, institucionNombre: nombre };
  } catch (_) {
    return {
      logoAsset: await cargarImagenComoJpegAsset(locales.logoUrl),
      institucionNombre: locales.nombre || "Institución",
    };
  }
}

function descargarBlob(blob, nombreArchivo) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nombreArchivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 500);
}

function resolverValor(columna, registro, index) {
  if (typeof columna?.value === "function") return columna.value(registro, index);
  if (columna?.key) return registro?.[columna.key];
  return "";
}

function normalizarColumnas(columnas = []) {
  return (Array.isArray(columnas) ? columnas : [])
    .filter(Boolean)
    .map((columna) => ({
      label: normalizarTexto(columna.label || columna.header || columna.key),
      key: columna.key,
      value: columna.value,
    }))
    .filter((columna) => columna.label);
}

function normalizarSecciones(secciones = []) {
  return (Array.isArray(secciones) ? secciones : [])
    .map((seccion) => ({
      titulo: normalizarTexto(seccion?.titulo || seccion?.title || "Registros"),
      subtitulo: normalizarTexto(seccion?.subtitulo || seccion?.subtitle || ""),
      columnas: normalizarColumnas(seccion?.columnas || seccion?.columns || []),
      registros: Array.isArray(seccion?.registros || seccion?.rows) ? (seccion.registros || seccion.rows) : [],
    }))
    .filter((seccion) => seccion.columnas.length > 0);
}

function contarRegistrosSecciones(secciones = []) {
  return normalizarSecciones(secciones).reduce((acc, seccion) => acc + seccion.registros.length, 0);
}

function crearSeccionUnica({ titulo, subtitulo, columnas, registros }) {
  return [{
    titulo: titulo || "Registros",
    subtitulo: subtitulo || "",
    columnas: columnas || [],
    registros: Array.isArray(registros) ? registros : [],
  }];
}

function crearTablaHtml({ columnas, registros }) {
  const cols = normalizarColumnas(columnas);

  const thead = cols
    .map((columna) => `<th>${escapeHtml(columna.label)}</th>`)
    .join("");

  const tbody = (Array.isArray(registros) ? registros : [])
    .map((registro, index) => {
      const celdas = cols
        .map((columna) => `<td>${escapeHtml(resolverValor(columna, registro, index))}</td>`)
        .join("");
      return `<tr>${celdas}</tr>`;
    })
    .join("");

  return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function crearCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
}

const CRC32_TABLE = crearCrc32Table();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toUtf8(value) {
  return new TextEncoder().encode(String(value));
}

function concatUint8(chunks) {
  const total = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function fechaDosZip() {
  const date = new Date();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function crearZipSinCompresion(archivos) {
  const chunksLocales = [];
  const chunksCentrales = [];
  const { dosTime, dosDate } = fechaDosZip();
  let offsetActual = 0;

  Object.entries(archivos).forEach(([ruta, contenido]) => {
    const nombreBytes = toUtf8(ruta);
    const contenidoBytes = contenido instanceof Uint8Array ? contenido : toUtf8(contenido);
    const crc = crc32(contenidoBytes);

    const localHeader = new Uint8Array(30 + nombreBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, contenidoBytes.length, true);
    localView.setUint32(22, contenidoBytes.length, true);
    localView.setUint16(26, nombreBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nombreBytes, 30);

    chunksLocales.push(localHeader, contenidoBytes);

    const centralHeader = new Uint8Array(46 + nombreBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, contenidoBytes.length, true);
    centralView.setUint32(24, contenidoBytes.length, true);
    centralView.setUint16(28, nombreBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offsetActual, true);
    centralHeader.set(nombreBytes, 46);

    chunksCentrales.push(centralHeader);
    offsetActual += localHeader.length + contenidoBytes.length;
  });

  const centralDir = concatUint8(chunksCentrales);
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, chunksCentrales.length, true);
  endView.setUint16(10, chunksCentrales.length, true);
  endView.setUint32(12, centralDir.length, true);
  endView.setUint32(16, offsetActual, true);
  endView.setUint16(20, 0, true);

  return new Blob([...chunksLocales, centralDir, endHeader], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function numeroColumnaAExcel(index) {
  let numero = index + 1;
  let letras = "";
  while (numero > 0) {
    const resto = (numero - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    numero = Math.floor((numero - 1) / 26);
  }
  return letras;
}

function celdaExcel(fila, columna) {
  return `${numeroColumnaAExcel(columna)}${fila}`;
}

function limpiarNombreHoja(value, fallback = "Registros") {
  const limpio = normalizarTexto(value)
    .replace(/[\\/?*:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);

  return limpio || fallback;
}

function nombresHojasUnicos(secciones) {
  const usados = new Set();
  return secciones.map((seccion, index) => {
    const base = limpiarNombreHoja(seccion.titulo, `Hoja ${index + 1}`);
    let nombre = base;
    let intento = 2;
    while (usados.has(nombre.toLowerCase())) {
      const sufijo = ` (${intento})`;
      nombre = `${base.slice(0, Math.max(1, 31 - sufijo.length))}${sufijo}`;
      intento += 1;
    }
    usados.add(nombre.toLowerCase());
    return nombre;
  });
}

function valorCeldaXml(value) {
  return `<is><t>${escapeXml(value || "-")}</t></is>`;
}

function crearCeldaXml(fila, columna, value, style = 4) {
  return `<c r="${celdaExcel(fila, columna)}" t="inlineStr" s="${style}">${valorCeldaXml(value)}</c>`;
}

function estimarAnchosExcel(columnas, registros) {
  return columnas.map((columna, colIndex) => {
    let maxLen = normalizarTexto(columna.label).length;
    (Array.isArray(registros) ? registros : []).slice(0, 500).forEach((registro, rowIndex) => {
      const valor = normalizarTexto(resolverValor(columna, registro, rowIndex));
      maxLen = Math.max(maxLen, Math.min(valor.length, 55));
    });
    return Math.max(10, Math.min(42, maxLen + (colIndex === 0 ? 4 : 2)));
  });
}

function crearDrawingLogoXml(logoAsset, name = "Logo institucional") {
  if (!logoAsset?.bytes?.length) return "";

  const box = calcularCajaImagen(logoAsset, 34, 34);
  const pxToEmu = (px) => Math.max(1, Math.round(Number(px || 0) * 9525));
  const colOff = pxToEmu(4 + box.offsetX);
  const rowOff = pxToEmu(3 + box.offsetY);
  const cx = pxToEmu(box.width);
  const cy = pxToEmu(box.height);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:colOff>${colOff}</xdr:colOff>
      <xdr:row>0</xdr:row>
      <xdr:rowOff>${rowOff}</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="${cx}" cy="${cy}"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="1" name="${escapeXml(name)}"/>
        <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rIdLogoImg"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${cx}" cy="${cy}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
}

function crearWorksheetRelsLogoXml(drawingIndex) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/>
</Relationships>`;
}

function crearDrawingRelsLogoXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdLogoImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo_exportacion.jpeg"/>
</Relationships>`;
}

function crearWorksheetXml({ titulo, subtitulo, columnas, registros, logoAsset = null }) {
  const cols = normalizarColumnas(columnas);
  const rows = Array.isArray(registros) ? registros : [];
  const cantidadColumnas = Math.max(cols.length, 1);
  const conLogo = Boolean(logoAsset?.bytes?.length);
  const anchos = estimarAnchosExcel(cols, rows);
  const sheetRows = [];
  const merges = [];
  let fila = 1;

  const agregarFila = (values, style = 4, options = {}) => {
    const startCol = Number(options.startCol || 0);
    const celdas = values
      .map((value, index) => crearCeldaXml(fila, index + startCol, value, style))
      .join("");
    const heightAttrs = options.height ? ` ht="${options.height}" customHeight="1"` : "";
    sheetRows.push(`<row r="${fila}"${heightAttrs}>${celdas}</row>`);
    fila += 1;
  };

  const tituloStartCol = conLogo && cantidadColumnas > 1 ? 1 : 0;
  const ultimaColumna = cantidadColumnas - 1;

  agregarFila([titulo || "Registros"], 1, { startCol: tituloStartCol, height: conLogo ? 30 : null });
  if (cantidadColumnas > 1 && tituloStartCol <= ultimaColumna) {
    merges.push(`<mergeCell ref="${celdaExcel(1, tituloStartCol)}:${celdaExcel(1, ultimaColumna)}"/>`);
  }

  if (subtitulo) {
    agregarFila([subtitulo], 2, { startCol: tituloStartCol });
    if (cantidadColumnas > 1 && tituloStartCol <= ultimaColumna) {
      merges.push(`<mergeCell ref="${celdaExcel(2, tituloStartCol)}:${celdaExcel(2, ultimaColumna)}"/>`);
    }
  }

  fila += 1;
  agregarFila(cols.map((columna) => columna.label), 3);

  if (rows.length === 0) {
    agregarFila(["Sin registros para exportar."], 4);
  } else {
    rows.forEach((registro, index) => {
      agregarFila(cols.map((columna) => normalizarTexto(resolverValor(columna, registro, index))), 4);
    });
  }

  const colsXml = anchos
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const drawingXml = conLogo ? `<drawing r:id="rIdLogo"/>` : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>${colsXml}</cols>
  <sheetData>${sheetRows.join("")}</sheetData>
  ${merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : ""}
  ${drawingXml}
</worksheet>`;
}

function crearXlsxBlob({ titulo, subtitulo, secciones, logoAsset = null }) {
  const seccionesNormalizadas = normalizarSecciones(secciones);
  const nombres = nombresHojasUnicos(seccionesNormalizadas);
  const archivos = {};
  const conLogo = Boolean(logoAsset?.bytes?.length);

  const overridesHojas = seccionesNormalizadas
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  const overridesDrawings = conLogo
    ? seccionesNormalizadas
      .map((_, index) => `<Override PartName="/xl/drawings/drawing${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`)
      .join("")
    : "";
  const defaultImagen = conLogo ? `<Default Extension="jpeg" ContentType="image/jpeg"/>` : "";

  archivos["[Content_Types].xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${defaultImagen}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${overridesHojas}
  ${overridesDrawings}
</Types>`;

  archivos["_rels/.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  archivos["docProps/core.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(titulo || "Exportación")}</dc:title>
  <dc:creator>LALCEC</dc:creator>
  <cp:lastModifiedBy>LALCEC</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`;

  archivos["docProps/app.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>LALCEC</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${seccionesNormalizadas.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${nombres.length}" baseType="lpstr">${nombres.map((nombre) => `<vt:lpstr>${escapeXml(nombre)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts>
</Properties>`;

  archivos["xl/workbook.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${nombres.map((nombre, index) => `<sheet name="${escapeXml(nombre)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;

  archivos["xl/_rels/workbook.xml.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${seccionesNormalizadas.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
  <Relationship Id="rId${seccionesNormalizadas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  archivos["xl/styles.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="15"/><name val="Calibri"/><color rgb="FF1F2937"/></font>
    <font><sz val="10"/><name val="Calibri"/><color rgb="FF4B5563"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF3A2E2B"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD0D7DE"/></left><right style="thin"><color rgb="FFD0D7DE"/></right><top style="thin"><color rgb="FFD0D7DE"/></top><bottom style="thin"><color rgb="FFD0D7DE"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  if (conLogo) {
    archivos["xl/media/logo_exportacion.jpeg"] = logoAsset.bytes;
  }

  seccionesNormalizadas.forEach((seccion, index) => {
    const sheetIndex = index + 1;
    archivos[`xl/worksheets/sheet${sheetIndex}.xml`] = crearWorksheetXml({
      titulo: seccion.titulo || titulo,
      subtitulo: seccion.subtitulo || subtitulo,
      columnas: seccion.columnas,
      registros: seccion.registros,
      logoAsset,
    });

    if (conLogo) {
      archivos[`xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`] = crearWorksheetRelsLogoXml(sheetIndex);
      archivos[`xl/drawings/drawing${sheetIndex}.xml`] = crearDrawingLogoXml(logoAsset, `Logo institucional ${sheetIndex}`);
      archivos[`xl/drawings/_rels/drawing${sheetIndex}.xml.rels`] = crearDrawingRelsLogoXml();
    }
  });

  return crearZipSinCompresion(archivos);
}

async function exportarExcel({ titulo, subtitulo, secciones, nombreArchivo }) {
  // El logo institucional queda solamente para PDF.
  // En Excel se exporta limpio, sin imágenes, para evitar errores de armado del .xlsx.
  const blob = crearXlsxBlob({ titulo, subtitulo, secciones, logoAsset: null });
  descargarBlob(
    blob,
    `${slugify(nombreArchivo || titulo)}_${fechaArchivo()}.xlsx`
  );
}

function pdfString(value) {
  const text = normalizarTexto(value)
    .replace(/\t/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += `\\${ch}`;
    } else if (code < 32) {
      out += " ";
    } else if (code > 126) {
      out += `\\${code.toString(8).padStart(3, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function dividirTextoPdf(texto, maxChars, maxLineas = 3) {
  const limpio = normalizarTexto(texto);
  if (!limpio) return ["-"];

  const palabras = limpio.split(" ");
  const lineas = [];
  let linea = "";

  palabras.forEach((palabra) => {
    const candidata = linea ? `${linea} ${palabra}` : palabra;
    if (candidata.length <= maxChars) {
      linea = candidata;
      return;
    }

    if (linea) lineas.push(linea);

    if (palabra.length > maxChars) {
      let resto = palabra;
      while (resto.length > maxChars) {
        lineas.push(resto.slice(0, maxChars));
        resto = resto.slice(maxChars);
      }
      linea = resto;
    } else {
      linea = palabra;
    }
  });

  if (linea) lineas.push(linea);

  if (lineas.length <= maxLineas) return lineas;

  const recortadas = lineas.slice(0, maxLineas);
  recortadas[maxLineas - 1] = `${recortadas[maxLineas - 1].slice(0, Math.max(0, maxChars - 3))}...`;
  return recortadas;
}

function calcularAnchosPdf(columnas, registros, usableWidth) {
  const desired = columnas.map((columna, index) => {
    const label = normalizarTexto(columna.label).toLowerCase();
    let maxLen = normalizarTexto(columna.label).length;

    (Array.isArray(registros) ? registros : []).slice(0, 250).forEach((registro, rowIndex) => {
      const valor = normalizarTexto(resolverValor(columna, registro, rowIndex));
      maxLen = Math.max(maxLen, Math.min(valor.length, 42));
    });

    let width = Math.max(44, Math.min(175, maxLen * 4.3 + 16));

    if (label.includes("dni")) width = 58;
    if (label.includes("año") || label.includes("ano")) width = 42;
    if (label.includes("inscrip")) width = 52;
    if (label.includes("curso")) width = 58;
    if (label.includes("condici")) width = 68;
    if (label.includes("materia")) width = Math.max(width, 138);
    if (index === 0 && (label.includes("alumno") || label.includes("docente") || label.includes("nombre"))) width = Math.max(width, 135);

    return width;
  });

  const totalDesired = desired.reduce((acc, width) => acc + width, 0) || usableWidth;
  return desired.map((width) => (width / totalDesired) * usableWidth);
}

function crearPaginasPdf({ titulo, subtitulo, secciones, logoAsset = null, institucionNombre = "Institución" }) {
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 24;
  const bottomMargin = 32;
  const usableWidth = pageWidth - margin * 2;
  const pages = [];
  let commands = [];
  let y = pageHeight - margin;
  let pageNumber = 0;

  const addText = (text, x, currentY, size = 8, bold = false) => {
    commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${currentY.toFixed(2)} Td (${pdfString(text)}) Tj ET`);
  };

  const addLine = (x1, y1, x2, y2) => {
    commands.push(`0.72 0.76 0.82 RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  };

  const drawRect = (x, topY, width, height, fill = false) => {
    if (fill) {
      commands.push(`0.23 0.18 0.17 rg ${x.toFixed(2)} ${(topY - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
    }
    commands.push(`0.72 0.76 0.82 RG ${x.toFixed(2)} ${(topY - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  };

  const addImage = (asset, x, currentY, width, height) => {
    if (!asset?.name) return;
    commands.push("q");
    commands.push(`${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${currentY.toFixed(2)} cm`);
    commands.push(`/${asset.name} Do`);
    commands.push("Q");
  };

  const startPage = () => {
    commands = [];
    y = pageHeight - margin;
    pageNumber += 1;

    const logoBox = 34;
    const textoX = logoAsset ? margin + 44 : margin;
    const textoWidth = usableWidth - (logoAsset ? 44 : 0);

    if (logoAsset) {
      const caja = calcularCajaImagen(logoAsset, logoBox, logoBox);
      addImage(logoAsset, margin + caja.offsetX, y - logoBox + caja.offsetY + 3, caja.width, caja.height);
    }

    addText(titulo, textoX, y, 14, true, textoWidth);
    y -= 13;

    const institucion = normalizarTexto(institucionNombre || "");
    if (institucion) {
      addText(institucion, textoX, y, 7.5, true, textoWidth);
      y -= 10;
    }

    if (subtitulo) {
      addText(subtitulo, textoX, y, 8, false, textoWidth);
      y -= 12;
    }

    addLine(margin, y + 4, pageWidth - margin, y + 4);
    y -= 10;
  };

  const finishPage = () => {
    addLine(margin, bottomMargin - 6, pageWidth - margin, bottomMargin - 6);
    addText(`Página ${pageNumber}`, pageWidth - margin - 54, bottomMargin - 20, 7, false);
    pages.push(commands.join("\n"));
  };

  const ensureSpace = (height) => {
    if (y - height >= bottomMargin) return false;
    finishPage();
    startPage();
    return true;
  };

  startPage();

  normalizarSecciones(secciones).forEach((seccion, sectionIndex) => {
    const columnas = normalizarColumnas(seccion.columnas);
    const registros = Array.isArray(seccion.registros) ? seccion.registros : [];
    const widths = calcularAnchosPdf(columnas, registros, usableWidth);
    const cantidadCols = Math.max(1, columnas.length);
    const fontSize = cantidadCols >= 8 ? 5.7 : cantidadCols >= 6 ? 6.3 : 7.2;
    const headerFontSize = Math.max(5.5, fontSize - 0.1);
    const lineHeight = fontSize + 2;
    const headerHeight = 21;

    const drawHeader = () => {
      ensureSpace(headerHeight + 4);
      let x = margin;
      columnas.forEach((columna, colIndex) => {
        const width = widths[colIndex];
        drawRect(x, y, width, headerHeight, true);
        const lineas = dividirTextoPdf(columna.label, Math.max(4, Math.floor((width - 6) / (headerFontSize * 0.48))), 2);
        lineas.forEach((linea, lineIndex) => {
          commands.push("1 1 1 rg");
          addText(linea, x + 3, y - 10 - lineIndex * (headerFontSize + 1), headerFontSize, true);
          commands.push("0 0 0 rg");
        });
        x += width;
      });
      y -= headerHeight;
    };

    ensureSpace(42);
    if (sectionIndex > 0) y -= 3;

    const tituloSeccionDuplicado = normalizarTexto(seccion.titulo).toLowerCase() === normalizarTexto(titulo).toLowerCase();
    if (!tituloSeccionDuplicado || normalizarSecciones(secciones).length > 1) {
      addText(seccion.titulo, margin, y, 11, true);
      y -= 12;
    }

    if (seccion.subtitulo) {
      addText(seccion.subtitulo, margin, y, 7.5, false);
      y -= 11;
    }

    drawHeader();

    if (registros.length === 0) {
      ensureSpace(20);
      drawRect(margin, y, usableWidth, 18, false);
      addText("Sin registros para exportar.", margin + 4, y - 12, 7, false);
      y -= 18;
      return;
    }

    registros.forEach((registro, rowIndex) => {
      const lineasPorCelda = columnas.map((columna, colIndex) => {
        const width = widths[colIndex];
        const maxChars = Math.max(4, Math.floor((width - 7) / (fontSize * 0.48)));
        return dividirTextoPdf(resolverValor(columna, registro, rowIndex), maxChars, 3);
      });
      const maxLineas = Math.max(1, ...lineasPorCelda.map((lineas) => lineas.length));
      const rowHeight = Math.max(15, maxLineas * lineHeight + 8);

      const pageChanged = ensureSpace(rowHeight + 2);
      if (pageChanged) {
        addText(`${seccion.titulo} (continuación)`, margin, y, 10, true);
        y -= 12;
        drawHeader();
      }

      let x = margin;
      lineasPorCelda.forEach((lineas, colIndex) => {
        const width = widths[colIndex];
        drawRect(x, y, width, rowHeight, false);
        lineas.forEach((linea, lineIndex) => {
          addText(linea, x + 3, y - 10 - lineIndex * lineHeight, fontSize, false);
        });
        x += width;
      });

      y -= rowHeight;
    });

    y -= 12;
  });

  finishPage();

  return { pages, pageWidth, pageHeight };
}

function construirPdf({ titulo, subtitulo, secciones, logoAsset = null, institucionNombre = "Institución" }) {
  const { pages, pageWidth, pageHeight } = crearPaginasPdf({ titulo, subtitulo, secciones, logoAsset, institucionNombre });
  const objects = [];
  const pageObjectNumbers = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  let nextObject = 5;
  let logoObjectNumber = null;

  if (logoAsset?.bytes?.length) {
    logoObjectNumber = nextObject;
    const imageStream = bytesToBinaryString(logoAsset.bytes);
    objects[logoObjectNumber] = `<< /Type /XObject /Subtype /Image /Width ${Math.max(1, Math.round(logoAsset.width))} /Height ${Math.max(1, Math.round(logoAsset.height))} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoAsset.bytes.length} >>
stream
${imageStream}
endstream`;
    nextObject += 1;
  }

  const xObjectResource = logoObjectNumber ? `/XObject << /${logoAsset.name} ${logoObjectNumber} 0 R >> ` : "";

  pages.forEach((stream) => {
    const pageObj = nextObject;
    const contentObj = nextObject + 1;
    nextObject += 2;
    pageObjectNumbers.push(pageObj);
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xObjectResource}>> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${stream.length} >>
stream
${stream}
endstream`;
  });

  objects[2] = `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`;

  let pdf = "%PDF-1.4\n% LALCEC - Exportacion\n";
  const offsets = [0];

  for (let i = 1; i < objects.length; i += 1) {
    if (!objects[i]) continue;
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i += 1) {
    const offset = offsets[i] || 0;
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

async function exportarPdf({ titulo, subtitulo, secciones, nombreArchivo }) {
  const datosInstitucionales = await obtenerDatosInstitucionalesExportacion();
  const pdf = construirPdf({ titulo, subtitulo, secciones, ...datosInstitucionales });
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) {
    bytes[i] = pdf.charCodeAt(i) & 0xff;
  }
  const blob = new Blob([bytes], { type: "application/pdf" });
  descargarBlob(blob, `${slugify(nombreArchivo || titulo)}_${fechaArchivo()}.pdf`);
}

async function exportarDesdeModalGlobal({ formato, titulo, subtitulo, secciones, nombreArchivo }) {
  const seccionesNormalizadas = normalizarSecciones(secciones);
  const totalRegistros = contarRegistrosSecciones(seccionesNormalizadas);

  if (seccionesNormalizadas.length === 0) {
    throw new Error("No hay columnas configuradas para exportar.");
  }

  if (totalRegistros <= 0) {
    throw new Error("No hay registros para exportar.");
  }

  if (formato === "pdf") {
    await exportarPdf({ titulo, subtitulo, secciones: seccionesNormalizadas, nombreArchivo });
    return;
  }

  await exportarExcel({ titulo, subtitulo, secciones: seccionesNormalizadas, nombreArchivo });
}

const pluralizar = (cantidad, singular, plural) => (
  Number(cantidad) === 1 ? singular : plural
);

const ModalExportarGlobal = ({
  abierto,
  open,
  loading = false,
  disabled = false,
  title = "Exportar registros",
  subtitle = "Elegí el formato y el alcance de la exportación.",
  tituloArchivo,
  subtituloArchivoActual = "",
  subtituloArchivoTodos = "",
  nombreArchivo = "exportacion",
  columnas = [],
  registrosActuales = [],
  registrosTodos = null,
  obtenerRegistrosTodos,
  seccionesActuales = null,
  seccionesTodos = null,
  obtenerSeccionesTodos,
  cantidadActual,
  totalActual,
  cantidad,
  cantidadTodos,
  totalTodos,
  total,
  totalLabelSingular = "registro disponible",
  totalLabelPlural = "registros disponibles",
  alcanceActualLabel = "Exportar solo actual",
  alcanceActualDescription = "Descarga los registros visibles en la página actual.",
  alcanceTodosLabel = "Exportar todos los registros",
  alcanceTodosDescription = "Descarga todos los registros que coinciden con los filtros actuales.",
  mostrarAlcanceTodos = true,
  defaultFormato = "excel",
  defaultAlcance = ALCANCE_TODOS,
  confirmLabel = "Exportar",
  cancelLabel = "Cancelar",
  loadingLabel = "Exportando...",
  note = "",
  importLabel = "Importar",
  importTitle = "Abrir importación",
  importDisabled = false,
  onImportarClick,
  onClose,
  onSuccess,
  onError,
}) => {
  const isOpen = Boolean(open ?? abierto);
  const modalRef = useRef(null);
  useAnimatedModalSize(modalRef, isOpen);
  const [formato, setFormato] = useState(defaultFormato);
  const [alcance, setAlcance] = useState(defaultAlcance);
  const [exportando, setExportando] = useState(false);

  const seccionesActualesNormalizadas = useMemo(() => {
    if (Array.isArray(seccionesActuales)) return normalizarSecciones(seccionesActuales);
    return normalizarSecciones(crearSeccionUnica({
      titulo: tituloArchivo || title,
      subtitulo: subtituloArchivoActual,
      columnas,
      registros: registrosActuales,
    }));
  }, [columnas, registrosActuales, seccionesActuales, subtituloArchivoActual, title, tituloArchivo]);

  const seccionesTodosNormalizadas = useMemo(() => {
    if (Array.isArray(seccionesTodos)) return normalizarSecciones(seccionesTodos);
    if (Array.isArray(registrosTodos)) {
      return normalizarSecciones(crearSeccionUnica({
        titulo: tituloArchivo || title,
        subtitulo: subtituloArchivoTodos,
        columnas,
        registros: registrosTodos,
      }));
    }
    return [];
  }, [columnas, registrosTodos, seccionesTodos, subtituloArchivoTodos, title, tituloArchivo]);

  const totalActualDisponible = Number(
    cantidadActual ??
    totalActual ??
    cantidad ??
    contarRegistrosSecciones(seccionesActualesNormalizadas)
  );

  const totalTodosDisponible = Number(
    cantidadTodos ??
    totalTodos ??
    total ??
    (seccionesTodosNormalizadas.length > 0 ? contarRegistrosSecciones(seccionesTodosNormalizadas) : totalActualDisponible)
  );

  const puedeExportarTodos = mostrarAlcanceTodos && (
    Boolean(obtenerRegistrosTodos) ||
    Boolean(obtenerSeccionesTodos) ||
    seccionesTodosNormalizadas.length > 0 ||
    Array.isArray(registrosTodos) ||
    totalTodosDisponible > totalActualDisponible
  );

  const opcionesAlcance = [
    {
      value: ALCANCE_ACTUAL,
      label: alcanceActualLabel,
      description: alcanceActualDescription,
      icon: faList,
      cantidad: totalActualDisponible,
    },
    ...(puedeExportarTodos ? [{
      value: ALCANCE_TODOS,
      label: alcanceTodosLabel,
      description: alcanceTodosDescription,
      icon: faLayerGroup,
      cantidad: totalTodosDisponible,
    }] : []),
  ];

  useEffect(() => {
    if (!isOpen) return;
    setFormato(defaultFormato || "excel");
    setAlcance(puedeExportarTodos ? (defaultAlcance || ALCANCE_TODOS) : ALCANCE_ACTUAL);
  }, [defaultAlcance, defaultFormato, isOpen, puedeExportarTodos]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!loading && !exportando) onClose?.();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [exportando, isOpen, loading, onClose]);

  if (!isOpen) return null;

  const portalTarget = typeof document !== "undefined" ? document.body : null;
  if (!portalTarget) return null;

  const opcionFormato = FORMATOS_EXPORTAR.find((opcion) => opcion.value === formato) || FORMATOS_EXPORTAR[0];
  const opcionAlcance = opcionesAlcance.find((opcion) => opcion.value === alcance) || opcionesAlcance[0];
  const totalSeleccionado = Number(opcionAlcance?.cantidad || 0);
  const submitDisabled = loading || exportando || disabled || totalSeleccionado <= 0;

  const resolverSecciones = async () => {
    if (alcance === ALCANCE_ACTUAL) return seccionesActualesNormalizadas;

    if (typeof obtenerSeccionesTodos === "function") {
      const resultado = await obtenerSeccionesTodos();
      return normalizarSecciones(resultado);
    }

    if (seccionesTodosNormalizadas.length > 0) return seccionesTodosNormalizadas;

    if (typeof obtenerRegistrosTodos === "function") {
      const registros = await obtenerRegistrosTodos();
      return normalizarSecciones(crearSeccionUnica({
        titulo: tituloArchivo || title,
        subtitulo: subtituloArchivoTodos,
        columnas,
        registros,
      }));
    }

    return seccionesActualesNormalizadas;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitDisabled) return;

    setExportando(true);
    try {
      const secciones = await resolverSecciones();
      const totalExportado = contarRegistrosSecciones(secciones);
      const subtitulo = alcance === ALCANCE_TODOS ? subtituloArchivoTodos : subtituloArchivoActual;
      const sufijoNombre = alcance === ALCANCE_TODOS ? "todos" : "actual";

      await exportarDesdeModalGlobal({
        formato,
        titulo: tituloArchivo || title,
        subtitulo,
        secciones,
        nombreArchivo: `${nombreArchivo}_${sufijoNombre}`,
      });

      onSuccess?.(
        formato === "pdf"
          ? `PDF descargado correctamente (${totalExportado} ${pluralizar(totalExportado, "registro", "registros")}).`
          : `Excel descargado correctamente (${totalExportado} ${pluralizar(totalExportado, "registro", "registros")}).`
      );
      onClose?.();
    } catch (error) {
      onError?.(error?.message || "No se pudo exportar la información.");
    } finally {
      setExportando(false);
    }
  };

  return createPortal((
    <div className="global-exportHistorial-overlay" role="dialog" aria-modal="true" aria-labelledby="global-exportHistorial-title">
      <form ref={modalRef} className="global-exportHistorial-modal" onSubmit={handleSubmit}>
        <header className="global-exportHistorial-header">
          <div>
            <h2 id="global-exportHistorial-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>

          <button
            type="button"
            className="global-exportHistorial-close"
            onClick={onClose}
            disabled={loading || exportando}
            aria-label="Cerrar"
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </header>

        <section className="global-exportHistorial-body">
          <div className="global-exportHistorial-info">
            <span className="global-exportHistorial-infoIcon" aria-hidden="true">
              <FontAwesomeIcon icon={faLayerGroup} />
            </span>
            <div className="global-exportHistorial-infoBody">
              <span>{pluralizar(totalSeleccionado, totalLabelSingular, totalLabelPlural)}</span>
              <strong>{totalSeleccionado}</strong>
            </div>
          </div>

          {note ? <p className="global-exportHistorial-note">{note}</p> : null}

          <div className="global-exportHistorial-groupTitle">Alcance</div>
          <div className="global-exportHistorial-options global-exportHistorial-options--scope" role="radiogroup" aria-label="Alcance de exportación">
            {opcionesAlcance.map((opcion) => {
              const isActive = alcance === opcion.value;
              return (
                <label
                  key={opcion.value}
                  className={`global-exportHistorial-option ${isActive ? "is-active" : ""}`}
                  data-tone="scope"
                >
                  <input
                    type="radio"
                    name="alcance_exportar_global"
                    value={opcion.value}
                    checked={isActive}
                    disabled={loading || exportando}
                    onChange={() => setAlcance(opcion.value)}
                  />
                  <span className="global-exportHistorial-icon is-scope">
                    <FontAwesomeIcon icon={opcion.icon} />
                  </span>
                  <span>
                    <b>{opcion.label}</b>
                    <small>{opcion.description}</small>
                    <small>{opcion.cantidad} {pluralizar(opcion.cantidad, "registro", "registros")}</small>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="global-exportHistorial-groupTitle">Formato</div>
          <div className="global-exportHistorial-options" role="radiogroup" aria-label="Formato de exportación">
            {FORMATOS_EXPORTAR.map((opcion) => {
              const isActive = formato === opcion.value;
              return (
                <label
                  key={opcion.value}
                  className={`global-exportHistorial-option ${isActive ? "is-active" : ""}`}
                  data-tone={opcion.tone}
                >
                  <input
                    type="radio"
                    name="formato_exportar_global"
                    value={opcion.value}
                    checked={isActive}
                    disabled={loading || exportando}
                    onChange={() => setFormato(opcion.value)}
                  />
                  <span className={`global-exportHistorial-icon is-${opcion.tone}`}>
                    <FontAwesomeIcon icon={opcion.icon} />
                  </span>
                  <span>
                    <b>{opcion.label}</b>
                    <small>{opcion.description}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <footer className="global-exportHistorial-footer">
          {typeof onImportarClick === "function" ? (
            <button
              type="button"
              className="global-exportHistorial-action global-exportHistorial-action--import"
              onClick={onImportarClick}
              disabled={loading || exportando || importDisabled}
              title={importTitle}
            >
              <FontAwesomeIcon icon={faFileImport} />
              {importLabel}
            </button>
          ) : null}

          <button
            type="button"
            className="global-exportHistorial-action global-exportHistorial-action--secondary"
            onClick={onClose}
            disabled={loading || exportando}
          >
            {cancelLabel}
          </button>

          <button
            type="submit"
            className="global-exportHistorial-action global-exportHistorial-action--primary"
            disabled={submitDisabled}
          >
            <FontAwesomeIcon icon={exportando ? faSpinner : opcionFormato.icon} spin={exportando} />
            {exportando ? loadingLabel : confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  ), portalTarget);
};

export default ModalExportarGlobal;
