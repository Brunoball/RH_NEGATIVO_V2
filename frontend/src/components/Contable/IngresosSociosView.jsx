import React, { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalculator,
  faFileExcel,
  faLayerGroup,
  faMagnifyingGlass,
  faPeopleGroup,
  faTableCellsLarge,
  faTimes,
  faTriangleExclamation,
  faUserMinus,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import { contableApi } from "./api/contableApi";
import "./IngresosSociosView.css";

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const dateText = (value) => {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
};

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function paginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items = [1];
  if (currentPage > 4) items.push("ellipsis-left");
  const from = Math.max(2, currentPage - 1);
  const to = Math.min(totalPages - 1, currentPage + 1);
  for (let page = from; page <= to; page += 1) items.push(page);
  if (currentPage < totalPages - 3) items.push("ellipsis-right");
  items.push(totalPages);
  return items;
}

function SummaryBox({ label, value, tone = "default", sub }) {
  return (
    <article className={`ct-old-card is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </article>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="ct-old-search">
      <FontAwesomeIcon icon={faMagnifyingGlass} />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Tabs({ value, onChange, options }) {
  return (
    <div className="ct-old-tabs" role="tablist">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
        >
          <FontAwesomeIcon icon={option.icon} /> {option.label}
        </button>
      ))}
    </div>
  );
}

function IncomeDetail({ section, search, onSearchChange, onPageChange, loading }) {
  const items = section?.items || [];
  const pagination = section?.paginacion || {};
  const currentPage = Number(pagination.pagina || 1);
  const totalPages = Number(pagination.total_paginas || 0);
  const pageOptions = paginationItems(currentPage, totalPages);
  const totalRecords = Number(pagination.total ?? section?.resumen?.registros ?? 0);
  const firstRecord = Number(pagination.desde || 0);
  const lastRecord = Number(pagination.hasta || 0);

  return (
    <>
      <div className="ct-old-pane-head">
        <div>
          <strong>Detalle de cobros recibidos</strong>
          <span>
            {(section?.resumen?.registros || 0).toLocaleString("es-AR")} pagos · {money(section?.resumen?.importe)}
          </span>
        </div>
        <SearchBox
          value={search}
          onChange={onSearchChange}
          placeholder="Buscar por socio, categoría, cobrador, período..."
        />
      </div>
      <div className={`ct-old-table-wrap ${totalRecords > 0 ? "has-pagination" : ""}`.trim()}>
        <table className="ct-old-table">
          <thead>
            <tr>
              <th>Apellido y Nombre</th>
              <th>Categoría</th>
              <th>Cobrador</th>
              <th>Fecha de Pago</th>
              <th>Período pago</th>
              <th>Medio</th>
              <th className="is-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.clave}>
                <td><strong>{item.socio}</strong></td>
                <td>{item.categoria_etiqueta}</td>
                <td>{item.cobrador}</td>
                <td>{dateText(item.fecha)}</td>
                <td>{item.periodo}</td>
                <td>{item.medio}</td>
                <td className="is-right"><strong>{money(item.monto)}</strong></td>
              </tr>
            ))}
            {!items.length ? (
              <tr><td colSpan="7" className="ct-old-empty">No hay cobros que coincidan con la búsqueda.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {totalRecords > 0 ? (
        <nav className="global-pagination ct-old-pagination" aria-label="Paginación del detalle de cobros">
          <p className="global-pagination__summary">
            Mostrando <strong>{firstRecord}</strong>–<strong>{lastRecord}</strong> de <strong>{totalRecords}</strong> pagos
            <span>100 por página</span>
          </p>
          <div className="global-pagination__right">
            <div className="global-pagination__controls">
              <button
                type="button"
                onClick={() => onPageChange?.(Math.max(1, currentPage - 1))}
                disabled={loading || currentPage <= 1}
              >
                Anterior
              </button>
              {pageOptions.map((item) =>
                typeof item === "number" ? (
                  <button
                    type="button"
                    key={item}
                    className={item === currentPage ? "is-active" : ""}
                    aria-current={item === currentPage ? "page" : undefined}
                    onClick={() => onPageChange?.(item)}
                    disabled={loading}
                  >
                    {item}
                  </button>
                ) : (
                  <span className="global-pagination__ellipsis" key={item} aria-hidden="true">…</span>
                ),
              )}
              <button
                type="button"
                onClick={() => onPageChange?.(Math.min(totalPages, currentPage + 1))}
                disabled={loading || totalPages === 0 || currentPage >= totalPages}
              >
                Siguiente
              </button>
            </div>
          </div>
        </nav>
      ) : null}
    </>
  );
}

function PartnerDetail({ section }) {
  const summary = section?.resumen || {};
  return (
    <>
      <div className="ct-old-cards ct-old-cards--three">
        <SummaryBox label="Total ACTIVO" value={(summary.activos || 0).toLocaleString("es-AR")} sub={`Año ${section?.anio || ""}`} />
        <SummaryBox label="Total PASIVO" value={(summary.pasivos || 0).toLocaleString("es-AR")} sub={`Año ${section?.anio || ""}`} tone="warn" />
        <SummaryBox label="TOTAL GENERAL" value={(summary.total || 0).toLocaleString("es-AR")} sub="= Activo + Pasivo + Sin estado" tone="primary" />
      </div>
      <div className="ct-old-table-wrap">
        <table className="ct-old-table">
          <thead><tr><th>Estado</th><th>Categoría</th><th className="is-right">Cantidad</th></tr></thead>
          <tbody>
            {(section?.items || []).map((item, index) => (
              <tr key={`${item.servicio}-${item.categoria}-${index}`}>
                <td>{item.servicio}</td><td>{item.categoria}</td><td className="is-right">{item.cantidad.toLocaleString("es-AR")}</td>
              </tr>
            ))}
            <tr className="ct-old-total is-active"><td><strong>TOTAL ACTIVO</strong></td><td>—</td><td className="is-right"><strong>{(summary.activos || 0).toLocaleString("es-AR")}</strong></td></tr>
            <tr className="ct-old-total is-passive"><td><strong>TOTAL PASIVO</strong></td><td>—</td><td className="is-right"><strong>{(summary.pasivos || 0).toLocaleString("es-AR")}</strong></td></tr>
            {summary.sin_estado ? <tr className="ct-old-total"><td><strong>SIN ESTADO</strong></td><td>—</td><td className="is-right"><strong>{summary.sin_estado.toLocaleString("es-AR")}</strong></td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CollectionDetail({ section, period }) {
  const summary = section?.resumen || {};
  const difference = Number(summary.diferencia_cuotas || 0);
  const rows = [];
  (section?.items || []).forEach((collector) => {
    rows.push({ ...collector, depth: 0 });
    (collector.hijos || []).forEach((state) => {
      rows.push({ ...state, depth: 1 });
      (state.hijos || []).forEach((mean) => rows.push({ ...mean, depth: 2 }));
    });
  });

  return (
    <>
      <section className="ct-old-category-prices">
        <strong>CATEGORÍAS DE MONTO</strong>
        <div>
          {(section?.categorias_monto || []).map((item) => (
            <span key={item.id_categoria}>
              {item.nombre} <b>{money(item.mensual)}</b> <small>Anual: {money(item.anual)} · Monto por período</small>
            </span>
          ))}
        </div>
      </section>
      <div className="ct-old-cards ct-old-cards--four">
        <SummaryBox label="Cuotas recaudadas" value={money(summary.cuotas_recaudadas)} sub="Solo pagos de cuotas" />
        <SummaryBox label="Inscripciones recaudadas" value={money(summary.inscripciones_recaudadas)} sub={`${summary.inscripciones_socios || 0} socios · Total ingresado: ${money(summary.total_ingresado)}`} />
        <SummaryBox label="Cuotas esperadas" value={money(summary.cuotas_esperadas)} sub={`${summary.socios_esperados || 0} socios · ${period?.etiqueta || ""}`} />
        <SummaryBox label="Faltante / Superávit" value={money(Math.abs(difference))} sub={difference >= 0 ? "Cuotas esperadas menos cuotas recaudadas" : "Cuotas recaudadas por encima de lo esperado"} tone={difference >= 0 ? "danger" : "success"} />
      </div>
      <div className="ct-old-table-wrap">
        <table className="ct-old-table ct-old-table--collection">
          <thead><tr><th>Período / Grupo</th><th className="is-right">Esperado</th><th className="is-right">Recaudado</th><th className="is-right">Socios</th><th className="is-right">Dif. (Esp-Rec)</th></tr></thead>
          <tbody>
            <tr className="ct-old-period-row">
              <td><strong>{period?.etiqueta || "PERÍODO"}</strong></td>
              <td className="is-right">{money(summary.cuotas_esperadas)}</td>
              <td className="is-right">{money(summary.cuotas_recaudadas)}</td>
              <td className="is-right">{(summary.socios_esperados || 0).toLocaleString("es-AR")}</td>
              <td className="is-right ct-old-difference">{money(summary.diferencia_cuotas)}</td>
            </tr>
            {rows.map((row, index) => (
              <tr key={`${row.tipo}-${row.nombre}-${index}`} className={`ct-old-depth-${row.depth}`}>
                <td><span className={`ct-old-badge is-${row.tipo}`}>{row.nombre}</span></td>
                <td className="is-right">{row.esperado === null ? "—" : money(row.esperado)}</td>
                <td className="is-right">{money(row.recaudado)}</td>
                <td className="is-right">{Number(row.socios || 0).toLocaleString("es-AR")}</td>
                <td className="is-right ct-old-difference">{row.diferencia === null ? "—" : money(row.diferencia)}</td>
              </tr>
            ))}
            <tr className="ct-old-total"><td><strong>INSCRIPCIONES</strong></td><td className="is-right">—</td><td className="is-right"><strong>{money(summary.inscripciones_recaudadas)}</strong></td><td className="is-right"><strong>{summary.inscripciones_socios || 0}</strong></td><td className="is-right">—</td></tr>
            <tr className="ct-old-total"><td><strong>TOTAL CUOTAS</strong></td><td className="is-right"><strong>{money(summary.cuotas_esperadas)}</strong></td><td className="is-right"><strong>{money(summary.cuotas_recaudadas)}</strong></td><td className="is-right"><strong>{(summary.socios_esperados || 0).toLocaleString("es-AR")}</strong></td><td className="is-right ct-old-difference"><strong>{money(summary.diferencia_cuotas)}</strong></td></tr>
            <tr className="ct-old-total is-registration"><td><strong>TOTAL INSCRIPCIONES</strong></td><td className="is-right">—</td><td className="is-right"><strong>{money(summary.inscripciones_recaudadas)}</strong></td><td className="is-right"><strong>{summary.inscripciones_socios || 0}</strong></td><td className="is-right">—</td></tr>
            <tr className="ct-old-total is-grand"><td><strong>TOTAL INGRESADO</strong></td><td className="is-right">—</td><td className="is-right"><strong>{money(summary.total_ingresado)}</strong></td><td className="is-right">—</td><td className="is-right">—</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function defaultBalanceRange() {
  const now = new Date();
  const year = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const endYear = currentMonth >= 7 ? year : year - 1;
  const startYear = endYear - 1;
  return { desde: `${startYear}-07-01`, hasta: `${endYear}-06-30` };
}

function balanceExportConfig(balance, tab, all) {
  if (!balance) return { columns: [], records: [], sections: [] };

  const rangeSubtitle = `${dateText(balance.desde)} al ${dateText(balance.hasta)}`;
  const sectionsByTab = {
    inscripciones: [
      {
        titulo: "Inscripciones · Resumen",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Inscripciones", key: "inscripciones" },
          { label: "Pagadas", key: "pagadas" },
          { label: "Sin importe", key: "sin_importe" },
          { label: "Sin registro", key: "sin_registro" },
          { label: "Total inscripción", key: "total_inscripcion" },
          { label: "Activos", key: "activos" },
          { label: "Pasivos", key: "pasivos" },
          { label: "Sin estado", key: "sin_estado" },
        ],
        registros: [balance.inscripciones?.resumen || {}],
      },
      {
        titulo: "Inscripciones · Resumen por período",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Período", key: "periodo" }, { label: "Meses incluidos", key: "meses" },
          { label: "Total", key: "total" }, { label: "Activos", key: "activos" }, { label: "Pasivos", key: "pasivos" },
          { label: "Sin estado", key: "sin_estado" }, { label: "Pagadas", key: "pagadas" },
          { label: "Sin importe", key: "sin_importe" }, { label: "Sin registro", key: "sin_registro" },
          { label: "Total cobrado", key: "total_cobrado" },
        ],
        registros: balance.inscripciones?.por_periodo || [],
      },
      {
        titulo: "Inscripciones · Detalle completo",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "ID", key: "id_socio" }, { label: "Socio", key: "socio" }, { label: "DNI", key: "dni" }, { label: "Estado", key: "estado" },
          { label: "Fecha alta", key: "fecha_alta" }, { label: "Período", key: "periodo" }, { label: "Fecha pago", key: "fecha_pago" },
          { label: "Medio", key: "medio" }, { label: "Monto", key: "monto" }, { label: "Tipo", key: "tipo" },
        ],
        registros: balance.inscripciones?.items || [],
      },
    ],
    bajas: [
      {
        titulo: "Bajas · Resumen",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Total bajas", key: "total_bajas" }, { label: "Activos", key: "activos" }, { label: "Pasivos", key: "pasivos" },
          { label: "Sin estado", key: "sin_estado" }, { label: "Pagos", key: "pagos" }, { label: "Condonaciones", key: "condonaciones" },
          { label: "Total pagado", key: "total_pagado" },
        ],
        registros: [balance.bajas?.resumen || {}],
      },
      {
        titulo: "Bajas · Resumen por período",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Grupo", key: "grupo" }, { label: "Estado", key: "estado" }, { label: "Período", key: "periodo" },
          { label: "Bajas", key: "bajas" }, { label: "Pagos", key: "pagos" }, { label: "Condonaciones", key: "condonaciones" },
          { label: "Monto pagado", key: "monto_pagado" },
        ],
        registros: balance.bajas?.por_periodo || [],
      },
      {
        titulo: "Bajas · Detalle completo",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "ID", key: "id_socio" }, { label: "Socio", key: "socio" }, { label: "Estado", key: "estado" }, { label: "Fecha baja", key: "fecha_baja" },
          { label: "Período baja", key: "periodo_baja" }, { label: "Períodos cubiertos", value: (item) => (item.periodos_cubiertos || []).join(", ") },
          { label: "Pagos", key: "pagos" }, { label: "Condonaciones", key: "condonaciones" }, { label: "Total pagado", key: "total_pagado" }, { label: "Motivo", key: "motivo" },
        ],
        registros: balance.bajas?.items || [],
      },
    ],
    deudores: [
      {
        titulo: "Deudores · Resumen",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Total deudas", key: "total_deudas" }, { label: "Activos", key: "activos" }, { label: "Pasivos", key: "pasivos" },
          { label: "Sin estado", key: "sin_estado" }, { label: "Períodos analizados", key: "periodos_analizados" }, { label: "Total adeudado", key: "total_adeudado" },
        ],
        registros: [balance.deudores?.resumen || {}],
      },
      {
        titulo: "Deudores · Resumen por período",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Período", key: "periodo" }, { label: "Deudores", key: "deudores" }, { label: "Activos", key: "activos" },
          { label: "Pasivos", key: "pasivos" }, { label: "Sin estado", key: "sin_estado" }, { label: "Monto adeudado", key: "monto_adeudado" },
        ],
        registros: balance.deudores?.por_periodo || [],
      },
      {
        titulo: "Deudores · Detalle completo",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Período", key: "periodo" }, { label: "ID", key: "id_socio" }, { label: "Socio", key: "socio" }, { label: "DNI", key: "dni" },
          { label: "Estado", key: "estado" }, { label: "Categoría", key: "categoria" }, { label: "Ingreso", key: "ingreso" },
          { label: "Domicilio", key: "domicilio" }, { label: "Teléfono", key: "telefono" }, { label: "Cobrador", key: "cobrador" },
          { label: "Monto base", key: "monto_base" }, { label: "Descuento familiar %", key: "descuento_familiar" }, { label: "Monto adeudado", key: "monto" },
        ],
        registros: balance.deudores?.items || [],
      },
    ],
  };

  if (all) {
    return {
      title: "Exportar todas las pestañas del balance",
      fileTitle: balance.titulo,
      fileName: `balance_${balance.desde}_${balance.hasta}`,
      columns: [],
      records: [],
      sections: [
        ...sectionsByTab.inscripciones,
        ...sectionsByTab.bajas,
        ...sectionsByTab.deudores,
      ],
    };
  }

  const labels = {
    inscripciones: "Inscripciones",
    bajas: "Bajas",
    deudores: "Deudores",
  };
  return {
    title: `Exportar ${labels[tab] || "balance"}`,
    fileTitle: `${balance.titulo} · ${labels[tab] || "Balance"}`,
    fileName: `balance_${tab}_${balance.desde}_${balance.hasta}`,
    columns: [],
    records: [],
    sections: sectionsByTab[tab] || [],
  };
}

function BalanceModal({ open, onClose, onFeedback }) {
  const defaults = useMemo(defaultBalanceRange, []);
  const [desde, setDesde] = useState(defaults.desde);
  const [hasta, setHasta] = useState(defaults.hasta);
  const [balance, setBalance] = useState(null);
  const [tab, setTab] = useState("inscripciones");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showAllDebts, setShowAllDebts] = useState(false);
  const [exportMode, setExportMode] = useState(null);
  if (!open) return null;

  const generate = async () => {
    if (!desde || !hasta || desde > hasta) {
      onFeedback?.({ type: "error", message: "Seleccioná un rango de fechas válido." });
      return;
    }
    setLoading(true);
    try {
      const response = await contableApi.balance({ desde, hasta });
      setBalance(response.balance || null);
      setSearch("");
      setShowAllDebts(false);
    } catch (error) {
      onFeedback?.({ type: "error", message: error.message });
    } finally {
      setLoading(false);
    }
  };

  const q = normalize(search).trim();
  const filterItems = (items) => !q ? items : items.filter((item) => normalize(Object.values(item).flat().join(" ")).includes(q));
  const ins = balance?.inscripciones || {};
  const bajas = balance?.bajas || {};
  const deuda = balance?.deudores || {};
  const debtItems = filterItems(deuda.items || []);
  const visibleDebtItems = showAllDebts ? debtItems : debtItems.slice(0, 100);
  const exportConfig = balanceExportConfig(balance, tab, exportMode === "all");

  const content = (
    <div className="ct-balance-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ct-balance-modal" role="dialog" aria-modal="true" aria-label="Balance anual">
        <header className="ct-balance-header">
          <div><FontAwesomeIcon icon={faCalculator} /><span><strong>{balance?.titulo || "Balance anual"}</strong><small>{balance ? `Del ${dateText(balance.desde)} al ${dateText(balance.hasta)}` : "Seleccioná el rango de fechas para generar el balance"}</small></span></div>
          <button type="button" onClick={onClose} aria-label="Cerrar"><FontAwesomeIcon icon={faTimes} /></button>
        </header>
        <div className="ct-balance-range">
          <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <button type="button" className="ct-old-primary" onClick={generate} disabled={loading}>{loading ? "Generando..." : balance ? "Actualizar balance" : "Generar balance"}</button>
        </div>
        {!balance ? <div className="ct-balance-empty">Seleccioná el rango de fechas y presioná <strong>Generar balance</strong> para ver la información.</div> : (
          <div className="ct-balance-body">
            <div className="ct-balance-toolbar">
              <Tabs value={tab} onChange={setTab} options={[
                { value: "inscripciones", label: "Inscripciones", icon: faUserPlus },
                { value: "bajas", label: "Bajas", icon: faUserMinus },
                { value: "deudores", label: "Deudores por período", icon: faTriangleExclamation },
              ]} />
              <div className="ct-balance-export-actions">
                <button type="button" onClick={() => setExportMode("current")}><FontAwesomeIcon icon={faFileExcel} /> Exportar pestaña actual</button>
                <button type="button" onClick={() => setExportMode("all")}><FontAwesomeIcon icon={faFileExcel} /> Exportar todas las pestañas</button>
              </div>
            </div>
            {tab === "inscripciones" ? <>
              <div className="ct-old-cards ct-old-cards--seven">
                <SummaryBox label="Inscripciones" value={ins.resumen?.inscripciones || 0} />
                <SummaryBox label="Inscripciones pagadas" value={ins.resumen?.pagadas || 0} tone="success" />
                <SummaryBox label="Registros sin importe" value={ins.resumen?.sin_importe || 0} tone="warn" />
                <SummaryBox label="Sin registro de pago" value={ins.resumen?.sin_registro || 0} tone="warn" />
                <SummaryBox label="Total inscripción" value={money(ins.resumen?.total_inscripcion)} tone="success" />
                <SummaryBox label="Activos inscriptos" value={ins.resumen?.activos || 0} tone="success" />
                <SummaryBox label="Pasivos inscriptos" value={ins.resumen?.pasivos || 0} tone="warn" />
                {Number(ins.resumen?.sin_estado || 0) > 0 ? <SummaryBox label="Inscriptos sin estado" value={ins.resumen?.sin_estado || 0} tone="warn" /> : null}
              </div>
              <h4>Resumen de inscripciones por período de ingreso</h4>
              <div className="ct-old-table-wrap is-compact"><table className="ct-old-table"><thead><tr><th>Período</th><th>Meses incluidos</th><th className="is-right">Total</th><th className="is-right">Activos</th><th className="is-right">Pasivos</th><th className="is-right">Pagadas</th><th className="is-right">Sin importe</th><th className="is-right">Sin registro</th><th className="is-right">Total cobrado</th></tr></thead><tbody>{(ins.por_periodo || []).map((r) => <tr key={r.periodo}><td>{r.periodo}</td><td>{r.meses}</td><td className="is-right">{r.total}</td><td className="is-right">{r.activos}</td><td className="is-right">{r.pasivos}</td><td className="is-right">{r.pagadas}</td><td className="is-right">{r.sin_importe}</td><td className="is-right">{r.sin_registro}</td><td className="is-right"><strong>{money(r.total_cobrado)}</strong></td></tr>)}</tbody></table></div>
              <div className="ct-old-pane-head"><div><strong>Detalle completo de socios inscriptos</strong><span>Mostrando {(ins.items || []).length} socios.</span></div><SearchBox value={search} onChange={setSearch} placeholder="Buscar por ID, socio, DNI, estado, ingreso..." /></div>
              <div className="ct-old-table-wrap"><table className="ct-old-table"><thead><tr><th>ID</th><th>Socio</th><th>DNI</th><th>Estado</th><th>Fecha alta</th><th>Período</th><th>Fecha pago</th><th>Medio pago</th><th className="is-right">Monto</th></tr></thead><tbody>{filterItems(ins.items || []).map((r, i) => <tr key={`${r.id_socio}-${r.id_inscripcion ?? i}`}><td>{r.id_socio}</td><td><strong>{r.socio}</strong></td><td>{r.dni || "—"}</td><td>{r.estado}</td><td>{dateText(r.fecha_alta)}</td><td>{r.periodo}</td><td>{dateText(r.fecha_pago)}</td><td>{r.medio}</td><td className="is-right">{money(r.monto)}</td></tr>)}</tbody></table></div>
            </> : null}
            {tab === "bajas" ? <>
              <div className="ct-old-cards ct-old-cards--six">
                <SummaryBox label="Total bajas" value={bajas.resumen?.total_bajas || 0} />
                <SummaryBox label="Bajas pasivos" value={bajas.resumen?.pasivos || 0} tone="warn" />
                <SummaryBox label="Bajas activos" value={bajas.resumen?.activos || 0} tone="success" />
                <SummaryBox label="Pagos bajas" value={bajas.resumen?.pagos || 0} />
                <SummaryBox label="Condonaciones" value={bajas.resumen?.condonaciones || 0} tone="warn" />
                <SummaryBox label="Total bajas pagado" value={money(bajas.resumen?.total_pagado)} tone="success" />
                {Number(bajas.resumen?.sin_estado || 0) > 0 ? <SummaryBox label="Bajas sin estado" value={bajas.resumen?.sin_estado || 0} tone="warn" /> : null}
              </div>
              <h4>Resumen por período de baja</h4>
              <div className="ct-old-table-wrap is-compact"><table className="ct-old-table"><thead><tr><th>Grupo</th><th>Período baja / año</th><th className="is-right">Bajas</th><th className="is-right">Pagos</th><th className="is-right">Condonaciones</th><th className="is-right">Monto pagado</th></tr></thead><tbody>{(bajas.por_periodo || []).map((r, i) => <tr key={`${r.estado}-${r.periodo}-${i}`}><td><span className="ct-old-badge is-estado">{r.grupo}</span></td><td>{r.periodo}</td><td className="is-right">{r.bajas}</td><td className="is-right">{r.pagos}</td><td className="is-right">{r.condonaciones}</td><td className="is-right">{money(r.monto_pagado)}</td></tr>)}</tbody></table></div>
              <div className="ct-old-pane-head"><div><strong>Detalle de socios dados de baja</strong><span>Mostrando {(bajas.items || []).length} socios.</span></div><SearchBox value={search} onChange={setSearch} placeholder="Buscar por ID, socio, estado, período, baja..." /></div>
              <div className="ct-old-table-wrap"><table className="ct-old-table"><thead><tr><th>ID</th><th>Socio</th><th>Estado</th><th>Fecha baja</th><th>Período baja</th><th>Períodos cubiertos</th><th className="is-right">Total pagado</th><th>Motivo</th></tr></thead><tbody>{filterItems(bajas.items || []).map((r) => <tr key={r.id_historial}><td>{r.id_socio}</td><td><strong>{r.socio}</strong></td><td>{r.estado}</td><td>{dateText(r.fecha_baja)}</td><td>{r.periodo_baja}</td><td>{(r.periodos_cubiertos || []).join(", ") || "—"}</td><td className="is-right">{money(r.total_pagado)}</td><td>{r.motivo || "—"}</td></tr>)}</tbody></table></div>
            </> : null}
            {tab === "deudores" ? <>
              <div className="ct-old-cards ct-old-cards--five">
                <SummaryBox label="Total deudas por período" value={deuda.resumen?.total_deudas || 0} />
                <SummaryBox label="Socios pasivos deudores" value={deuda.resumen?.pasivos || 0} tone="warn" />
                <SummaryBox label="Socios activos deudores" value={deuda.resumen?.activos || 0} tone="success" />
                <SummaryBox label="Períodos analizados" value={deuda.resumen?.periodos_analizados || 0} />
                <SummaryBox label="Total adeudado" value={money(deuda.resumen?.total_adeudado)} tone="warn" />
                {Number(deuda.resumen?.sin_estado || 0) > 0 ? <SummaryBox label="Deudas sin estado" value={deuda.resumen?.sin_estado || 0} tone="warn" /> : null}
              </div>
              <h4>Resumen de deudores por período</h4>
              <div className="ct-old-table-wrap is-compact"><table className="ct-old-table"><thead><tr><th>Período</th><th className="is-right">Deudores</th><th className="is-right">Activos</th><th className="is-right">Pasivos</th><th className="is-right">Sin estado</th><th className="is-right">Monto adeudado</th></tr></thead><tbody>{(deuda.por_periodo || []).map((r) => <tr key={r.periodo}><td>{r.periodo}</td><td className="is-right">{r.deudores}</td><td className="is-right">{r.activos}</td><td className="is-right">{r.pasivos}</td><td className="is-right">{r.sin_estado}</td><td className="is-right">{money(r.monto_adeudado)}</td></tr>)}</tbody></table></div>
              <div className="ct-old-pane-head"><div><strong>Detalle completo de deudores por período</strong><span>Mostrando {visibleDebtItems.length} de {debtItems.length} deudas por período.</span></div><SearchBox value={search} onChange={setSearch} placeholder="Buscar por ID, socio, DNI, estado, período..." /></div>
              <div className="ct-old-table-wrap"><table className="ct-old-table"><thead><tr><th>Período</th><th>ID</th><th>Socio</th><th>DNI</th><th>Estado</th><th>Categoría</th><th>Ingreso</th><th>Domicilio</th><th>Teléfono</th><th>Cobrador</th><th className="is-right">Monto</th></tr></thead><tbody>{visibleDebtItems.map((r, i) => <tr key={`${r.id_socio}-${r.anio}-${r.id_periodo}-${i}`}><td>{r.periodo}</td><td>{r.id_socio}</td><td><strong>{r.socio}</strong></td><td>{r.dni || "—"}</td><td>{r.estado}</td><td>{r.categoria}</td><td>{dateText(r.ingreso)}</td><td>{r.domicilio || "—"}</td><td>{r.telefono || "—"}</td><td>{r.cobrador}</td><td className="is-right"><strong>{money(r.monto)}</strong>{Number(r.descuento_familiar) > 0 ? <small className="ct-old-discount">-{r.descuento_familiar}% familiar</small> : null}</td></tr>)}</tbody></table></div>
              {!showAllDebts && debtItems.length > 100 ? <div className="ct-old-load-all"><span>Se muestran los primeros 100. Quedan {debtItems.length - 100} registros más.</span><button type="button" onClick={() => setShowAllDebts(true)}>Cargar todos</button></div> : null}
            </> : null}
          </div>
        )}
      </section>
      <ModalExportarGlobal
        open={Boolean(exportMode)}
        title={exportConfig.title || "Exportar balance"}
        tituloArchivo={exportConfig.fileTitle || "Balance"}
        subtituloArchivoActual={balance ? `${dateText(balance.desde)} al ${dateText(balance.hasta)}` : ""}
        nombreArchivo={exportConfig.fileName || "balance"}
        columnas={exportConfig.columns || []}
        registrosActuales={exportConfig.records || []}
        seccionesActuales={exportConfig.sections || null}
        mostrarAlcanceTodos={false}
        alcanceActualLabel="Exportar información"
        alcanceActualDescription="Exporta todos los registros del alcance seleccionado, no sólo los visibles en pantalla."
        onClose={() => setExportMode(null)}
        onSuccess={(message) => onFeedback?.({ type: "success", message })}
        onError={(message) => onFeedback?.({ type: "error", message })}
      />
    </div>
  );
  return createPortal(content, document.body);
}

export default function IngresosSociosView({
  data,
  loading,
  detailSearch = "",
  onDetailSearchChange,
  onDetailPageChange,
  onFeedback,
}) {
  const [tab, setTab] = useState("detail");
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const period = data?.periodo;
  const detailPagination = data?.detalle?.paginacion || {};

  const obtainAllDetailRecords = useCallback(async () => {
    if (!period?.anio || !period?.id_periodo) return [];
    const first = await contableApi.ingresosSocios({
      anio: period.anio,
      periodo: period.id_periodo,
      buscar: detailSearch,
      pagina: 1,
    });
    const all = [...(first?.detalle?.items || [])];
    const totalPages = Number(first?.detalle?.paginacion?.total_paginas || 1);
    for (let current = 2; current <= totalPages; current += 1) {
      const response = await contableApi.ingresosSocios({
        anio: period.anio,
        periodo: period.id_periodo,
        buscar: detailSearch,
        pagina: current,
      });
      all.push(...(response?.detalle?.items || []));
    }
    return all;
  }, [detailSearch, period?.anio, period?.id_periodo]);

  const exportConfig = useMemo(() => {
    const items = data?.detalle?.items || [];
    return {
      title: "Exportar ingresos de socios",
      fileTitle: `Ingresos de socios · ${period?.etiqueta || ""}`,
      fileName: `ingresos_socios_${period?.anio || ""}_${period?.id_periodo || ""}`,
      columns: [
        { label: "Socio", key: "socio" }, { label: "DNI", key: "dni" }, { label: "Categoría", key: "categoria_etiqueta" },
        { label: "Cobrador", key: "cobrador" }, { label: "Fecha de pago", key: "fecha" }, { label: "Período pago", key: "periodo" }, { label: "Medio", key: "medio" }, { label: "Monto", key: "monto" },
      ],
      records: items,
    };
  }, [data?.detalle?.items, period]);

  if (loading) return <div className="ct-old-loading">Cargando información contable de socios...</div>;
  if (!data?.periodo) return <div className="ct-old-loading">No se pudo cargar la información del período.</div>;

  return (
    <section className="ct-old-income">
      <div className="ct-old-main-toolbar">
        <Tabs value={tab} onChange={setTab} options={[
          { value: "detail", label: "Detalle", icon: faTableCellsLarge },
          { value: "partners", label: "Detalle de Socios", icon: faPeopleGroup },
          { value: "collection", label: "Detalle de Cobranza", icon: faLayerGroup },
        ]} />
        <div className="ct-old-main-actions">
          <button type="button" onClick={() => setExportOpen(true)}><FontAwesomeIcon icon={faFileExcel} /> Exportar detalle</button>
          <button type="button" className="ct-old-primary" onClick={() => setBalanceOpen(true)}><FontAwesomeIcon icon={faCalculator} /> Balance anual</button>
        </div>
      </div>
      <div className="ct-old-income-body">
        {tab === "detail" ? (
          <IncomeDetail
            section={data.detalle}
            search={detailSearch}
            onSearchChange={onDetailSearchChange}
            onPageChange={onDetailPageChange}
            loading={loading}
          />
        ) : null}
        {tab === "partners" ? <PartnerDetail section={data.socios} /> : null}
        {tab === "collection" ? <CollectionDetail section={data.cobranza} period={period} /> : null}
      </div>
      <ModalExportarGlobal
        open={exportOpen}
        title={exportConfig.title}
        tituloArchivo={exportConfig.fileTitle}
        subtituloArchivoActual={`${dateText(period.desde)} al ${dateText(period.hasta)}`}
        nombreArchivo={exportConfig.fileName}
        columnas={exportConfig.columns}
        registrosActuales={exportConfig.records}
        obtenerRegistrosTodos={obtainAllDetailRecords}
        cantidadActual={exportConfig.records.length}
        cantidadTodos={Number(detailPagination.total || exportConfig.records.length)}
        mostrarAlcanceTodos={Number(detailPagination.total || 0) > exportConfig.records.length}
        alcanceActualLabel={Number(detailPagination.total_paginas || 0) > 1 ? "Exportar esta página" : "Exportar registros visibles"}
        alcanceActualDescription="Exporta los pagos visibles con la búsqueda actual."
        alcanceTodosLabel="Exportar detalle completo"
        alcanceTodosDescription="Exporta todas las páginas de 100 registros que coinciden con la búsqueda y el período seleccionados."
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => onFeedback?.({ type: "success", message })}
        onError={(message) => onFeedback?.({ type: "error", message })}
      />
      <BalanceModal open={balanceOpen} onClose={() => setBalanceOpen(false)} onFeedback={onFeedback} />
    </section>
  );
}
