import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalculator,
  faFileExcel,
  faMagnifyingGlass,
  faPeopleGroup,
  faTimes,
  faTriangleExclamation,
  faUserMinus,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";
import GlobalDivTable from "../Global/GlobalDivTable";
import BotonExportarGlobal from "../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import SummaryCards from "../Global/SummaryCards";
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

const PAGE_SIZE = 10;

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

function IncomePagination({
  actions,
  currentPage,
  firstRecord,
  lastRecord,
  loading = false,
  noun = "registros",
  onPageChange,
  pageSize,
  summaryAriaLabel,
  summaryItems = [],
  summaryTitle = "Resumen",
  totalPages,
  totalRecords,
}) {
  if (!totalRecords && !summaryItems.length) return null;

  const pageOptions = paginationItems(currentPage, totalPages);

  return (
    <footer
      className="global-pagination ct-income-pagination"
      aria-label={`Resumen, paginación y acciones de ${noun}`}
    >
      <SummaryCards
        title={summaryTitle}
        ariaLabel={summaryAriaLabel}
        className="ct-income-pagination__cards"
        items={summaryItems}
      />
      {totalRecords ? (
        <div
          className="ct-income-pagination__navigation"
          role="navigation"
          aria-label={`Paginación de ${noun}`}
        >
          <p className="global-pagination__summary">
            Mostrando <strong>{firstRecord}</strong>–<strong>{lastRecord}</strong> de{" "}
            <strong>{totalRecords}</strong> {noun}
            {pageSize ? <span>{pageSize} por página</span> : null}
          </p>
          <div className="global-pagination__right">
            <div className="global-pagination__controls">
              <button
                type="button"
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
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
                    onClick={() => onPageChange(item)}
                    disabled={loading}
                  >
                    {item}
                  </button>
                ) : (
                  <span className="global-pagination__ellipsis" key={item} aria-hidden="true">
                    …
                  </span>
                ),
              )}
              <button
                type="button"
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={loading || totalPages === 0 || currentPage >= totalPages}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {actions ? (
        <div
          className="global-tableActions ct-income-pagination__actions"
          aria-label="Acciones de ingresos de socios"
        >
          {actions}
        </div>
      ) : null}
    </footer>
  );
}

function IncomeDetail({ actions, section, onPageChange, loading, period }) {
  const items = section?.items || [];
  const pagination = section?.paginacion || {};
  const currentPage = Number(pagination.pagina || 1);
  const totalRecords = Number(pagination.total ?? section?.resumen?.registros ?? 0);
  const pageSize = Number(pagination.por_pagina || pagination.limite || items.length || 0);
  const totalPages = Number(
    pagination.total_paginas ||
      (totalRecords && pageSize ? Math.ceil(totalRecords / pageSize) : 0),
  );
  const firstRecord = Number(
    pagination.desde ?? (totalRecords ? (currentPage - 1) * pageSize + 1 : 0),
  );
  const lastRecord = Number(
    pagination.hasta ?? Math.min(currentPage * pageSize, totalRecords),
  );

  return (
    <>
      <GlobalDivTable
        className="ct-income-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ct-income-grid ct-income-grid--detail"
        columns={[
          "Apellido y nombre",
          "Categoría",
          "Cobrador",
          "Fecha de pago",
          "Período pago",
          "Medio",
          { label: "Monto", align: "right" },
        ]}
        ariaLabel="Detalle de cobros recibidos"
        empty={!loading && !items.length}
        loading={loading}
        loadingLabel="Cargando cobros de socios..."
        skeletonActionColumn={false}
        skeletonRows={7}
      >
        {!loading && !items.length ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faPeopleGroup} />
            <strong>Sin cobros para mostrar</strong>
            <span>No hay cobros que coincidan con la búsqueda.</span>
          </div>
        ) : null}
        {items.map((item) => (
          <div
            className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--detail"
            role="row"
            key={item.clave}
          >
            <div className="mov-gridCell entity-main-cell">
              <strong>{item.socio}</strong>
              <small>DNI: {item.dni || "—"}</small>
            </div>
            <div className="mov-gridCell"><span className="mov-categoryChip">{item.categoria_etiqueta || "Sin categoría"}</span></div>
            <div className="mov-gridCell">{item.cobrador || "—"}</div>
            <div className="mov-gridCell is-center">{dateText(item.fecha)}</div>
            <div className="mov-gridCell is-center">{item.periodo || "—"}</div>
            <div className="mov-gridCell is-center">{item.medio || "—"}</div>
            <div className="mov-gridCell is-right is-strong ct-income-money">{money(item.monto)}</div>
          </div>
        ))}
      </GlobalDivTable>
      <IncomePagination
        actions={actions}
        currentPage={currentPage}
        firstRecord={firstRecord}
        lastRecord={lastRecord}
        loading={loading}
        noun="pagos"
        onPageChange={(nextPage) => onPageChange?.(nextPage)}
        pageSize={pageSize}
        summaryAriaLabel="Resumen de cobros recibidos"
        summaryItems={[
          {
            key: "payments",
            label: "Detalle de cobros recibidos",
            detail: `${Number(section?.resumen?.registros || totalRecords).toLocaleString("es-AR")} pagos`,
            value: money(section?.resumen?.importe),
          },
          {
            key: "range",
            label: "Rango del período",
            detail: period?.anio ? `Año ${period.anio}` : "Año seleccionado",
            value: period?.desde && period?.hasta
              ? `${dateText(period.desde)}–${dateText(period.hasta)}`
              : "—",
          },
        ]}
        summaryTitle="Resumen del período"
        totalPages={totalPages}
        totalRecords={totalRecords}
      />
    </>
  );
}

function PartnerDetail({ actions, section, loading }) {
  const summary = section?.resumen || {};
  const items = section?.items || [];
  const [page, setPage] = useState(1);
  const totalRecords = items.length;
  const totalPages = totalRecords ? Math.ceil(totalRecords / PAGE_SIZE) : 0;
  const firstRecord = totalRecords ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastRecord = totalRecords ? Math.min(page * PAGE_SIZE, totalRecords) : 0;
  const visibleItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }, [items, page]);

  useEffect(() => {
    setPage(1);
  }, [section]);

  useEffect(() => {
    if (page > totalPages && totalPages > 0) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <>
      <GlobalDivTable
        className="ct-income-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ct-income-grid ct-income-grid--partners"
        columns={["Estado", "Categoría", { label: "Cantidad", align: "right" }]}
        ariaLabel="Detalle de socios por estado y categoría"
        empty={!loading && !totalRecords}
        loading={loading}
        loadingLabel="Cargando detalle de socios..."
        skeletonActionColumn={false}
        skeletonRows={7}
      >
        {!loading && !totalRecords ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faPeopleGroup} />
            <strong>Sin socios para mostrar</strong>
            <span>No hay datos para el período seleccionado.</span>
          </div>
        ) : null}
        {visibleItems.map((item, index) => (
          <div
            className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--partners"
            role="row"
            key={`${item.servicio}-${item.categoria}-${index}`}
          >
            <div className="mov-gridCell is-strong">{item.servicio}</div>
            <div className="mov-gridCell"><span className="mov-categoryChip">{item.categoria || "Sin categoría"}</span></div>
            <div className="mov-gridCell is-right is-strong ct-income-number">{Number(item.cantidad || 0).toLocaleString("es-AR")}</div>
          </div>
        ))}
      </GlobalDivTable>
      <IncomePagination
        actions={actions}
        currentPage={page}
        firstRecord={firstRecord}
        lastRecord={lastRecord}
        loading={loading}
        noun="categorías"
        onPageChange={setPage}
        pageSize={PAGE_SIZE}
        summaryAriaLabel="Totales de socios por estado"
        summaryItems={[
          {
            key: "active",
            label: "Total activos",
            detail: `Año ${section?.anio || "—"}`,
            value: Number(summary.activos || 0).toLocaleString("es-AR"),
          },
          {
            key: "passive",
            label: "Total pasivos",
            detail: `Año ${section?.anio || "—"}`,
            value: Number(summary.pasivos || 0).toLocaleString("es-AR"),
          },
          {
            key: "total",
            label: "Total general",
            detail: "Activos, pasivos y sin estado",
            value: Number(summary.total || 0).toLocaleString("es-AR"),
          },
        ]}
        summaryTitle="Resumen de socios"
        totalPages={totalPages}
        totalRecords={totalRecords}
      />
    </>
  );
}

function CollectionDetail({ actions, section, period, loading }) {
  const summary = section?.resumen || {};
  const difference = Number(summary.diferencia_cuotas || 0);
  const rows = useMemo(() => {
    const flattenedRows = [];
    (section?.items || []).forEach((collector) => {
      flattenedRows.push({ ...collector, depth: 0 });
      (collector.hijos || []).forEach((state) => {
        flattenedRows.push({ ...state, depth: 1 });
        (state.hijos || []).forEach((mean) => flattenedRows.push({ ...mean, depth: 2 }));
      });
    });
    return flattenedRows;
  }, [section?.items]);
  const [page, setPage] = useState(1);
  const totalRecords = rows.length;
  const totalPages = totalRecords ? Math.ceil(totalRecords / PAGE_SIZE) : 0;
  const firstRecord = totalRecords ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastRecord = totalRecords ? Math.min(page * PAGE_SIZE, totalRecords) : 0;
  const visibleRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [page, rows]);

  useEffect(() => {
    setPage(1);
  }, [section]);

  useEffect(() => {
    if (page > totalPages && totalPages > 0) setPage(totalPages);
  }, [page, totalPages]);

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
      <GlobalDivTable
        className="ct-income-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ct-income-grid ct-income-grid--collection"
        columns={[
          "Período / grupo",
          { label: "Esperado", align: "right" },
          { label: "Recaudado", align: "right" },
          { label: "Socios", align: "right" },
          { label: "Dif. (Esp-Rec)", align: "right" },
        ]}
        ariaLabel="Detalle de cobranza"
        empty={!loading && !totalRecords}
        loading={loading}
        loadingLabel="Cargando detalle de cobranza..."
        skeletonActionColumn={false}
        skeletonRows={7}
      >
        {!loading && !totalRecords ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faPeopleGroup} />
            <strong>Sin cobranza para mostrar</strong>
            <span>No hay datos para el período seleccionado.</span>
          </div>
        ) : null}
        {totalRecords ? (
          <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--collection ct-income-period-row" role="row">
            <div className="mov-gridCell is-strong">{period?.etiqueta || "PERÍODO"}</div>
            <div className="mov-gridCell is-right">{money(summary.cuotas_esperadas)}</div>
            <div className="mov-gridCell is-right">{money(summary.cuotas_recaudadas)}</div>
            <div className="mov-gridCell is-right">{Number(summary.socios_esperados || 0).toLocaleString("es-AR")}</div>
            <div className="mov-gridCell is-right ct-income-difference">{money(summary.diferencia_cuotas)}</div>
          </div>
        ) : null}
        {visibleRows.map((row, index) => (
          <div
            className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--collection ct-income-depth-${row.depth}`}
            role="row"
            key={`${row.tipo}-${row.nombre}-${index}`}
          >
            <div className="mov-gridCell"><span className={`ct-old-badge is-${row.tipo}`}>{row.nombre}</span></div>
            <div className="mov-gridCell is-right">{row.esperado === null ? "—" : money(row.esperado)}</div>
            <div className="mov-gridCell is-right">{money(row.recaudado)}</div>
            <div className="mov-gridCell is-right">{Number(row.socios || 0).toLocaleString("es-AR")}</div>
            <div className="mov-gridCell is-right ct-income-difference">{row.diferencia === null ? "—" : money(row.diferencia)}</div>
          </div>
        ))}
      </GlobalDivTable>
      <IncomePagination
        actions={actions}
        currentPage={page}
        firstRecord={firstRecord}
        lastRecord={lastRecord}
        loading={loading}
        noun="grupos"
        onPageChange={setPage}
        pageSize={PAGE_SIZE}
        summaryAriaLabel="Totales de cobranza del período"
        summaryItems={[
          {
            key: "fees",
            label: "Cuotas recaudadas",
            detail: "Sólo pagos de cuotas",
            value: money(summary.cuotas_recaudadas),
          },
          {
            key: "registrations",
            label: "Inscripciones recaudadas",
            detail: `${summary.inscripciones_socios || 0} socios`,
            value: money(summary.inscripciones_recaudadas),
          },
          {
            key: "expected",
            label: "Cuotas esperadas",
            detail: `${summary.socios_esperados || 0} socios · ${period?.etiqueta || "Período"}`,
            value: money(summary.cuotas_esperadas),
          },
          {
            key: "difference",
            label: difference >= 0 ? "Faltante" : "Superávit",
            detail: difference >= 0
              ? "Esperado menos recaudado"
              : "Recaudado sobre lo esperado",
            value: money(Math.abs(difference)),
          },
        ]}
        summaryTitle="Resumen de cobranza"
        totalPages={totalPages}
        totalRecords={totalRecords}
      />
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
  activeTab = "detail",
  data,
  loading,
  detailSearch = "",
  onDetailPageChange,
  onFeedback,
}) {
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

  const tableActions = (
    <>
      <BotonExportarGlobal
        label="Exportar"
        onClick={() => setExportOpen(true)}
        disabled={loading || !Number(detailPagination.total || data?.detalle?.items?.length || 0)}
        title="Exportar detalle de ingresos de socios"
      />
      <button
        type="button"
        className="mov-btn mov-btn--primary ct-income-balance-button"
        onClick={() => setBalanceOpen(true)}
        disabled={loading || !period}
      >
        <FontAwesomeIcon icon={faCalculator} />
        Balance anual
      </button>
    </>
  );

  return (
    <section className="ct-income">
      <div className="ct-income-body">
        {activeTab === "detail" ? (
          <IncomeDetail
            actions={tableActions}
            section={data?.detalle}
            onPageChange={onDetailPageChange}
            loading={loading}
            period={period}
          />
        ) : null}
        {activeTab === "partners" ? (
          <PartnerDetail actions={tableActions} section={data?.socios} loading={loading} />
        ) : null}
        {activeTab === "collection" ? (
          <CollectionDetail
            actions={tableActions}
            section={data?.cobranza}
            period={period}
            loading={loading}
          />
        ) : null}
      </div>
      <ModalExportarGlobal
        open={exportOpen}
        title={exportConfig.title}
        tituloArchivo={exportConfig.fileTitle}
        subtituloArchivoActual={`${dateText(period?.desde)} al ${dateText(period?.hasta)}`}
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
