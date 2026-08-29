import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalculator,
  faFileExcel,
  faPeopleGroup,
  faTriangleExclamation,
  faUserMinus,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";
import GlobalDivTable from "../Global/GlobalDivTable";
import BotonExportarGlobal from "../Global/Botones/BotonExportarGlobal";
import {
  EntityFormPanel,
  EntityTabs,
  FloatingField,
} from "../Global/Formularios/TabbedForm";
import CrudModal from "../Global/Modales/CrudModal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import ModalMotivoGlobal, { MotivoPreviewGlobal } from "../Global/Modales/ModalMotivoGlobal";
import SummaryCards from "../Global/SummaryCards";
import { contableApi } from "./api/contableApi";
import "./IngresosSociosView.css";

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const collectionMoney = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
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

function balanceStatusTone(value) {
  const status = normalize(value).trim();
  if (!status) return "is-neutral";
  if (status.includes("pasiv") || status.includes("inactiv") || status === "baja") {
    return "is-passive";
  }
  if (status.includes("activ")) return "is-active";
  return "is-neutral";
}

function collectorTone(value) {
  const collector = normalize(value).trim();
  if (!collector) return "is-neutral";

  let hash = 0;
  for (let index = 0; index < collector.length; index += 1) {
    hash = ((hash << 5) - hash + collector.charCodeAt(index)) | 0;
  }

  return `is-tone-${Math.abs(hash) % 6}`;
}

function amountAdjustmentTone(value) {
  const type = String(value || "").toUpperCase();
  if (type === "DESCUENTO_FAMILIAR") return "is-family";
  if (type === "DESCUENTO_PERSONALIZADO") return "is-custom-discount";
  if (type === "MONTO_PERSONALIZADO") return "is-custom";
  return "is-neutral";
}

function BalanceStatusLegend() {
  return (
    <div className="ct-balance-statusLegend" aria-label="Referencia de estados de socios">
      <span className="ct-balance-statusLegend__title">Estado</span>
      <div className="ct-balance-statusLegend__items">
        <span className="ct-balance-statusLegend__item is-active"><i aria-hidden="true" />Activo</span>
        <span className="ct-balance-statusLegend__item is-passive"><i aria-hidden="true" />Pasivo</span>
      </div>
    </div>
  );
}

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

function BalanceSummary({ items }) {
  return (
    <SummaryCards
      title=""
      ariaLabel="Indicadores del balance"
      variant="dashboard"
      className="ct-balance-summary"
      items={items}
    />
  );
}

function IncomeSummary({ ariaLabel, items }) {
  return (
    <SummaryCards
      title=""
      ariaLabel={ariaLabel}
      variant="dashboard"
      className="ct-income-dashboard-summary"
      items={items}
    />
  );
}

function CollectionCategoryCards({ items = [] }) {
  const cards = (Array.isArray(items) ? items : []).map((item, index) => ({
    key: item.id_categoria || item.nombre || `categoria-${index}`,
    label: item.nombre || "Sin categoría",
    detail: `Anual: ${collectionMoney(item.anual)} · Monto por período`,
    value: collectionMoney(item.mensual),
  }));

  if (!cards.length) return null;

  return (
    <SummaryCards
      title=""
      ariaLabel="Categorías de monto"
      variant="footer"
      className="ct-summaryCards ct-collection-category-summary"
      items={cards}
    />
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <FloatingField
      label="Buscar"
      active={Boolean(value)}
      placeholderOnFloat
      className="ct-balance-search"
    >
      <input
        type="search"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
      />
    </FloatingField>
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
  supplementalContent = null,
  totalPages,
  totalRecords,
}) {
  if (!totalRecords && !actions && !supplementalContent) return null;

  const pageOptions = paginationItems(currentPage, totalPages);
  const paginationSummary = totalRecords ? (
    <>
      Mostrando <b className="ct-income-pagination__number">{firstRecord}</b>–
      <b className="ct-income-pagination__number">{lastRecord}</b> de{" "}
      <b className="ct-income-pagination__number">{totalRecords}</b> {noun}
    </>
  ) : null;

  return (
    <footer
      className="global-pagination ct-income-pagination"
      aria-label={`Paginación y acciones de ${noun}`}
    >
      {totalRecords ? (
        <div
          className="ct-income-pagination__navigation"
          role="navigation"
          aria-label={`Paginación de ${noun}`}
        >
          <p className="global-pagination__summary">
            {paginationSummary}
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
      {supplementalContent ? (
        <div className="ct-income-pagination__supplemental">
          {supplementalContent}
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

function IncomeDetail({ actions, section, onPageChange, loading }) {
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
      <IncomeSummary
        ariaLabel="Resumen de cobros recibidos"
        items={[
          {
            key: "payments",
            icon: faPeopleGroup,
            label: "Ingresos registrados",
            detail: "Cuotas e inscripciones cobradas",
            value: Number(section?.resumen?.registros || totalRecords).toLocaleString("es-AR"),
          },
          {
            key: "amount",
            icon: faCalculator,
            label: "Monto cobrado",
            detail: `${Number(section?.resumen?.registros || totalRecords).toLocaleString("es-AR")} ingresos`,
            tone: "success",
            value: money(section?.resumen?.importe),
          },
        ]}
      />
      <GlobalDivTable
        className="ct-income-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ct-income-grid ct-income-grid--detail"
        columns={[
          "Apellido y nombre",
          { label: "Tipo", align: "center" },
          "Categoría",
          { label: "Cobrador", align: "center" },
          "Fecha de pago",
          "Período pago",
          "Medio",
          { label: "Monto", align: "right" },
        ]}
        ariaLabel="Detalle de cobros recibidos"
        empty={!loading && !items.length}
        loading={loading}
        loadingLabel="Cargando ingresos de socios..."
        skeletonActionColumn={false}
        skeletonRows={4}
      >
        {!loading && !items.length ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faPeopleGroup} />
            <strong>Sin ingresos para mostrar</strong>
            <span>No hay cuotas ni inscripciones que coincidan con la búsqueda.</span>
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
            <div className="mov-gridCell is-center">
              <span className="mov-categoryChip">{item.tipo_ingreso || "CUOTA"}</span>
            </div>
            <div className="mov-gridCell"><span className="mov-categoryChip">{item.categoria_etiqueta || "Sin categoría"}</span></div>
            <div className="mov-gridCell is-center">
              <span className={`ct-collectorChip ${collectorTone(item.cobrador)}`}>
                {item.cobrador || "—"}
              </span>
            </div>
            <div className="mov-gridCell is-center">{dateText(item.fecha)}</div>
            <div className="mov-gridCell is-center">{item.periodo || "—"}</div>
            <div className="mov-gridCell is-center">{item.medio || "—"}</div>
            <div
              className={`mov-gridCell is-right is-strong ct-income-money${
                item.etiqueta_monto ? " has-adjustment" : ""
              }`}
              title={
                item.etiqueta_monto && item.monto_referencia
                  ? item.tipo_ajuste_monto === "DESCUENTO_FAMILIAR"
                    ? `${item.etiqueta_monto}. Monto de categoría: ${money(
                        item.categoria_monto_historico,
                      )}`
                    : `${item.etiqueta_monto}. Importe automático: ${money(
                        item.monto_referencia,
                      )}`
                  : undefined
              }
            >
              <strong>{money(item.monto)}</strong>
              {item.etiqueta_monto ? (
                <small
                  className={`ct-income-amountTag ${amountAdjustmentTone(
                    item.tipo_ajuste_monto,
                  )}`}
                >
                  {item.etiqueta_monto}
                </small>
              ) : null}
            </div>
          </div>
        ))}
      </GlobalDivTable>
      <IncomePagination
        actions={actions}
        currentPage={currentPage}
        firstRecord={firstRecord}
        lastRecord={lastRecord}
        loading={loading}
        noun="ingresos"
        onPageChange={(nextPage) => onPageChange?.(nextPage)}
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
      <IncomeSummary
        ariaLabel="Totales de socios por estado"
        items={[
          {
            key: "active",
            icon: faUserPlus,
            label: "Total activos",
            detail: `Año ${section?.anio || "—"}`,
            tone: "success",
            value: Number(summary.activos || 0).toLocaleString("es-AR"),
          },
          {
            key: "passive",
            icon: faUserMinus,
            label: "Total pasivos",
            detail: `Año ${section?.anio || "—"}`,
            tone: "danger",
            value: Number(summary.pasivos || 0).toLocaleString("es-AR"),
          },
          {
            key: "total",
            icon: faPeopleGroup,
            label: "Total general",
            detail: "Activos, pasivos y sin estado",
            value: Number(summary.total || 0).toLocaleString("es-AR"),
          },
        ]}
      />
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
        skeletonRows={4}
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
      const office = normalize(collector.nombre).includes("oficina");
      const tone = office ? "office" : "collector";
      flattenedRows.push({
        ...collector,
        depth: 0,
        rowKey: `collector-${collector.nombre}`,
        tone,
      });
      (collector.hijos || []).forEach((state) => {
        flattenedRows.push({
          ...state,
          depth: 1,
          rowKey: `state-${collector.nombre}-${state.nombre}`,
          tone,
        });

        // El informe histórico sólo abre los medios de pago dentro de OFICINA.
        // COBRADOR conserva el resumen necesario por ACTIVO/PASIVO.
        if (office) {
          (state.hijos || []).forEach((mean) => flattenedRows.push({
            ...mean,
            depth: 2,
            rowKey: `mean-${collector.nombre}-${state.nombre}-${mean.nombre}`,
            tone,
          }));
        }
      });
    });
    return flattenedRows;
  }, [section?.items]);
  const totalRecords = rows.length;
  const registrationPartners = Number(summary.inscripciones_socios || 0);
  const expectedPartners = Number(summary.socios_esperados || 0);
  const hasCollectionData = totalRecords > 0
    || registrationPartners > 0
    || Number(summary.total_ingresado || 0) !== 0
    || Number(summary.cuotas_esperadas || 0) !== 0;
  const yearLabel = period?.anio ? `Año ${period.anio}` : "Año seleccionado";
  const periodLabel = Number(period?.id_periodo) === 7
    ? "CONTADO ANUAL"
    : Number(period?.id_periodo) >= 1 && Number(period?.id_periodo) <= 6
      ? `PERÍODO ${Number(period.id_periodo) * 2 - 1} Y ${Number(period.id_periodo) * 2}`
      : period?.etiqueta || "PERÍODO";

  return (
    <>
      <section className="ct-collection-summary" aria-label="Totales de cobranza del período">
        <article>
          <span>Cuotas recaudadas</span>
          <strong>{collectionMoney(summary.cuotas_recaudadas)}</strong>
          <small>Solo pagos de cuotas</small>
        </article>
        <article>
          <span>Inscripciones recaudadas</span>
          <strong>{collectionMoney(summary.inscripciones_recaudadas)}</strong>
          <small>{registrationPartners.toLocaleString("es-AR")} socios · Total ingresado: {collectionMoney(summary.total_ingresado)}</small>
        </article>
        <article>
          <span>Cuotas esperadas</span>
          <strong>{collectionMoney(summary.cuotas_esperadas)}</strong>
          <small>{yearLabel}</small>
        </article>
        <article className={difference >= 0 ? "is-shortfall" : "is-surplus"}>
          <span>Faltante / Superávit de cuotas</span>
          <strong>{collectionMoney(Math.abs(difference))}</strong>
          <small>{difference >= 0 ? "Cuotas esperadas menos cuotas recaudadas" : "Cuotas recaudadas menos cuotas esperadas"}</small>
        </article>
      </section>

      <GlobalDivTable
        className="ct-income-table ct-collection-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ct-income-grid ct-income-grid--collection"
        columns={[
          "Período",
          { label: "Esperado", align: "right" },
          { label: "Recaudado", align: "right" },
          { label: "Socios", align: "center" },
          { label: "Dif. (Esp-Rec)", align: "right" },
        ]}
        ariaLabel="Detalle de cobranza"
        empty={!loading && !hasCollectionData}
        loading={loading}
        loadingLabel="Cargando detalle de cobranza..."
        skeletonActionColumn={false}
        skeletonRows={4}
      >
        {!loading && !hasCollectionData ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faPeopleGroup} />
            <strong>Sin cobranza para mostrar</strong>
            <span>No hay datos para el período seleccionado.</span>
          </div>
        ) : null}
        {hasCollectionData ? (
          <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--collection ct-income-period-row" role="row">
            <div className="mov-gridCell is-strong">{periodLabel}</div>
            <div className="mov-gridCell is-right">{collectionMoney(summary.cuotas_esperadas)}</div>
            <div className="mov-gridCell is-right">{collectionMoney(summary.cuotas_recaudadas)}</div>
            <div className="mov-gridCell is-center">{expectedPartners.toLocaleString("es-AR")}</div>
            <div className={`mov-gridCell is-right ct-income-difference ${difference < 0 ? "is-surplus" : ""}`}>{collectionMoney(Math.abs(difference))}</div>
          </div>
        ) : null}
        {rows.map((row) => (
          <div
            className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--collection ct-income-depth-${row.depth} ct-collection-row is-${row.tipo} is-${row.tone}`}
            role="row"
            key={row.rowKey}
          >
            <div className="mov-gridCell"><span className={`ct-old-badge is-${row.tipo}`}>{row.nombre}</span></div>
            <div className="mov-gridCell is-right">{row.esperado === null ? "—" : collectionMoney(row.esperado)}</div>
            <div className="mov-gridCell is-right">{collectionMoney(row.recaudado)}</div>
            <div className="mov-gridCell is-center">{Number(row.socios || 0).toLocaleString("es-AR")}</div>
            <div className={`mov-gridCell is-right ct-income-difference ${Number(row.diferencia || 0) < 0 ? "is-surplus" : ""}`}>{row.diferencia === null ? "—" : collectionMoney(Math.abs(Number(row.diferencia || 0)))}</div>
          </div>
        ))}

        {hasCollectionData ? (
          <>
            <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--collection ct-collection-registration-row" role="row">
              <div className="mov-gridCell"><span className="ct-old-badge is-registration"><FontAwesomeIcon icon={faUserPlus} /> Inscripciones</span></div>
              <div className="mov-gridCell is-right">—</div>
              <div className="mov-gridCell is-right">{collectionMoney(summary.inscripciones_recaudadas)}</div>
              <div className="mov-gridCell is-center">{registrationPartners.toLocaleString("es-AR")}</div>
              <div className="mov-gridCell is-right">—</div>
            </div>
            <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--collection ct-collection-total-row" role="row">
              <div className="mov-gridCell">TOTAL CUOTAS</div>
              <div className="mov-gridCell is-right">{collectionMoney(summary.cuotas_esperadas)}</div>
              <div className="mov-gridCell is-right">{collectionMoney(summary.cuotas_recaudadas)}</div>
              <div className="mov-gridCell is-center">{expectedPartners.toLocaleString("es-AR")}</div>
              <div className={`mov-gridCell is-right ct-income-difference ${difference < 0 ? "is-surplus" : ""}`}>{collectionMoney(Math.abs(difference))}</div>
            </div>
            <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--collection ct-collection-total-row is-registration" role="row">
              <div className="mov-gridCell">TOTAL INSCRIPCIONES</div>
              <div className="mov-gridCell is-right">—</div>
              <div className="mov-gridCell is-right">{collectionMoney(summary.inscripciones_recaudadas)}</div>
              <div className="mov-gridCell is-center">{registrationPartners.toLocaleString("es-AR")}</div>
              <div className="mov-gridCell is-right">—</div>
            </div>
            <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-income-grid ct-income-grid--collection ct-collection-total-row is-grand" role="row">
              <div className="mov-gridCell">TOTAL INGRESADO</div>
              <div className="mov-gridCell is-right">—</div>
              <div className="mov-gridCell is-right">{collectionMoney(summary.total_ingresado)}</div>
              <div className="mov-gridCell is-center">—</div>
              <div className="mov-gridCell is-right">—</div>
            </div>
          </>
        ) : null}
      </GlobalDivTable>
      <IncomePagination
        actions={actions}
        loading={loading}
        supplementalContent={(
          <CollectionCategoryCards
            items={section?.categorias_monto || []}
          />
        )}
        totalRecords={0}
      />
    </>
  );
}

function collectionPeriodLabel(period) {
  const id = Number(period?.id_periodo || 0);
  if (id === 7) return `CONTADO ANUAL ${period?.anio || ""}`.trim();
  if (id >= 1 && id <= 6) {
    return `PERÍODO ${id * 2 - 1} Y ${id * 2} ${period?.anio || ""}`.trim();
  }
  return [period?.etiqueta, period?.anio].filter(Boolean).join(" ") || "PERÍODO";
}

function collectionDifferenceText(value) {
  const amount = Number(value || 0);
  if (amount > 0) return `${collectionMoney(amount)} FALTANTE`;
  if (amount < 0) return `${collectionMoney(Math.abs(amount))} SUPERÁVIT`;
  return collectionMoney(0);
}

function collectionExportRows(section, period) {
  const summary = section?.resumen || {};
  const rows = [{
    detalle: collectionPeriodLabel(period),
    esperado: collectionMoney(summary.cuotas_esperadas),
    recaudado: collectionMoney(summary.cuotas_recaudadas),
    socios: Number(summary.socios_esperados || 0).toLocaleString("es-AR"),
    diferencia: collectionDifferenceText(summary.diferencia_cuotas),
    __estilo: "periodo",
  }];

  (section?.items || []).forEach((collector) => {
    const office = normalize(collector.nombre).includes("oficina");
    rows.push({
      detalle: collector.nombre || "SIN COBRADOR",
      esperado: collector.esperado === null ? "—" : collectionMoney(collector.esperado),
      recaudado: collectionMoney(collector.recaudado),
      socios: Number(collector.socios || 0).toLocaleString("es-AR"),
      diferencia: collector.diferencia === null ? "—" : collectionDifferenceText(collector.diferencia),
      __estilo: "cobrador",
    });

    (collector.hijos || []).forEach((state) => {
      rows.push({
        detalle: `   ${state.nombre || "SIN ESTADO"}`,
        esperado: state.esperado === null ? "—" : collectionMoney(state.esperado),
        recaudado: collectionMoney(state.recaudado),
        socios: Number(state.socios || 0).toLocaleString("es-AR"),
        diferencia: state.diferencia === null ? "—" : collectionDifferenceText(state.diferencia),
        __estilo: "estado",
      });

      // Replica el informe viejo: el detalle de medios se despliega dentro de OFICINA.
      if (office) {
        (state.hijos || []).forEach((mean) => rows.push({
          detalle: `      ${mean.nombre || "SIN MEDIO"}`,
          esperado: "—",
          recaudado: collectionMoney(mean.recaudado),
          socios: Number(mean.socios || 0).toLocaleString("es-AR"),
          diferencia: "—",
          __estilo: "medio",
        }));
      }
    });
  });

  rows.push(
    {
      detalle: "INSCRIPCIONES",
      esperado: "—",
      recaudado: collectionMoney(summary.inscripciones_recaudadas),
      socios: Number(summary.inscripciones_socios || 0).toLocaleString("es-AR"),
      diferencia: "—",
      __estilo: "inscripcion",
    },
    {
      detalle: "TOTAL CUOTAS",
      esperado: collectionMoney(summary.cuotas_esperadas),
      recaudado: collectionMoney(summary.cuotas_recaudadas),
      socios: Number(summary.socios_esperados || 0).toLocaleString("es-AR"),
      diferencia: collectionDifferenceText(summary.diferencia_cuotas),
      __estilo: "total",
    },
    {
      detalle: "TOTAL INSCRIPCIONES",
      esperado: "—",
      recaudado: collectionMoney(summary.inscripciones_recaudadas),
      socios: Number(summary.inscripciones_socios || 0).toLocaleString("es-AR"),
      diferencia: "—",
      __estilo: "inscripcion",
    },
    {
      detalle: "TOTAL INGRESADO",
      esperado: "—",
      recaudado: collectionMoney(summary.total_ingresado),
      socios: "—",
      diferencia: "—",
      __estilo: "total-general",
    },
  );

  return rows;
}

function incomeExportConfigForTab({ activeTab, data, period, detailRecords = null }) {
  const rangeSubtitle = `${dateText(period?.desde)} al ${dateText(period?.hasta)}`;
  const detailItems = Array.isArray(detailRecords) ? detailRecords : (data?.detalle?.items || []);

  if (activeTab === "partners") {
    const summary = data?.socios?.resumen || {};
    const detail = (data?.socios?.items || []).map((item) => ({
      estado: item.servicio || "SIN ESTADO",
      categoria: item.categoria || "Sin categoría",
      cantidad: Number(item.cantidad || 0).toLocaleString("es-AR"),
      __estilo: balanceStatusTone(item.servicio).replace("is-", ""),
    }));
    return {
      title: "Exportar detalle de socios",
      fileTitle: `Detalle de socios · ${period?.etiqueta || ""}`,
      fileName: `detalle_socios_${period?.anio || ""}_${period?.id_periodo || ""}`,
      sections: [
        {
          hoja: "Detalle de socios",
          titulo: "Resumen de socios",
          subtitulo: rangeSubtitle,
          columnas: [
            { label: "Estado", key: "estado" },
            { label: "Cantidad", key: "cantidad" },
          ],
          registros: [
            { estado: "ACTIVO", cantidad: Number(summary.activos || 0).toLocaleString("es-AR"), __estilo: "activo" },
            { estado: "PASIVO", cantidad: Number(summary.pasivos || 0).toLocaleString("es-AR"), __estilo: "pasivo" },
            ...(Number(summary.sin_estado || 0) > 0
              ? [{ estado: "SIN ESTADO", cantidad: Number(summary.sin_estado || 0).toLocaleString("es-AR"), __estilo: "neutral" }]
              : []),
            { estado: "TOTAL GENERAL", cantidad: Number(summary.total || 0).toLocaleString("es-AR"), __estilo: "total-general" },
          ],
        },
        {
          hoja: "Detalle de socios",
          titulo: "Detalle por estado y categoría",
          subtitulo: rangeSubtitle,
          columnas: [
            { label: "Estado", key: "estado" },
            { label: "Categoría", key: "categoria" },
            { label: "Cantidad", key: "cantidad" },
          ],
          registros: detail,
        },
      ],
      count: detail.length,
    };
  }

  if (activeTab === "collection") {
    const section = data?.cobranza || {};
    const summary = section.resumen || {};
    const difference = Number(summary.diferencia_cuotas || 0);
    const collectionRows = collectionExportRows(section, period);
    const categories = (section.categorias_monto || []).map((item) => ({
      categoria: item.nombre || "Sin categoría",
      periodo: collectionMoney(item.mensual),
      anual: collectionMoney(item.anual),
    }));
    return {
      title: "Exportar detalle de cobranza",
      fileTitle: `Detalle de cobranza · ${period?.etiqueta || ""}`,
      fileName: `detalle_cobranza_${period?.anio || ""}_${period?.id_periodo || ""}`,
      sections: [
        {
          hoja: "Detalle de cobranza",
          titulo: "Resumen de cobranza",
          subtitulo: rangeSubtitle,
          columnas: [
            { label: "Concepto", key: "concepto" },
            { label: "Importe", key: "importe" },
            { label: "Detalle", key: "detalle" },
          ],
          registros: [
            { concepto: "Cuotas recaudadas", importe: collectionMoney(summary.cuotas_recaudadas), detalle: "Solo pagos de cuotas", __estilo: "resumen" },
            { concepto: "Inscripciones recaudadas", importe: collectionMoney(summary.inscripciones_recaudadas), detalle: `${Number(summary.inscripciones_socios || 0).toLocaleString("es-AR")} socios`, __estilo: "inscripcion" },
            { concepto: "Total ingresado", importe: collectionMoney(summary.total_ingresado), detalle: "Cuotas + inscripciones", __estilo: "total-general" },
            { concepto: "Cuotas esperadas", importe: collectionMoney(summary.cuotas_esperadas), detalle: `${Number(summary.socios_esperados || 0).toLocaleString("es-AR")} socios esperados`, __estilo: "resumen" },
            {
              concepto: "Faltante / Superávit de cuotas",
              importe: collectionMoney(Math.abs(difference)),
              detalle: difference >= 0 ? "FALTANTE" : "SUPERÁVIT",
              __estilo: difference >= 0 ? "pasivo" : "activo",
            },
          ],
        },
        {
          hoja: "Detalle de cobranza",
          titulo: "Detalle de cobranza (Esperado vs Recaudado)",
          subtitulo: rangeSubtitle,
          columnas: [
            { label: "Período / Detalle", key: "detalle" },
            { label: "Esperado", key: "esperado" },
            { label: "Recaudado", key: "recaudado" },
            { label: "Socios", key: "socios" },
            { label: "Dif. (ESP-REC)", key: "diferencia" },
          ],
          registros: collectionRows,
        },
        {
          hoja: "Detalle de cobranza",
          titulo: "Montos por categoría",
          subtitulo: rangeSubtitle,
          columnas: [
            { label: "Categoría", key: "categoria" },
            { label: "Monto por período", key: "periodo" },
            { label: "Contado anual", key: "anual" },
          ],
          registros: categories,
        },
      ],
      count: (
        (section.items || []).length > 0
        || (section.categorias_monto || []).length > 0
        || Number(summary.total_ingresado || 0) !== 0
        || Number(summary.cuotas_esperadas || 0) !== 0
      ) ? collectionRows.length : 0,
    };
  }

  const detailSummary = data?.detalle?.resumen || {};
  return {
    title: "Exportar ingresos de socios",
    fileTitle: `Ingresos de socios · ${period?.etiqueta || ""}`,
    fileName: `ingresos_socios_${period?.anio || ""}_${period?.id_periodo || ""}`,
    sections: [
      {
        hoja: "Detalle",
        titulo: "Resumen de ingresos",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Ingresos registrados", key: "registros" },
          { label: "Socios distintos", key: "socios" },
          { label: "Monto cobrado", key: "importe" },
        ],
        registros: [{
          registros: Number(detailSummary.registros || detailItems.length).toLocaleString("es-AR"),
          socios: Number(detailSummary.socios_distintos || 0).toLocaleString("es-AR"),
          importe: money(detailSummary.importe),
          __estilo: "resumen",
        }],
      },
      {
        hoja: "Detalle",
        titulo: "Detalle de cobros recibidos",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Socio", key: "socio" },
          { label: "DNI", key: "dni" },
          { label: "Tipo", key: "tipo_ingreso" },
          { label: "Categoría", key: "categoria_etiqueta" },
          { label: "Cobrador", key: "cobrador" },
          { label: "Fecha de pago", value: (item) => dateText(item.fecha) },
          { label: "Período pago", key: "periodo" },
          { label: "Año aplicado", key: "anio_aplicado" },
          { label: "Medio", key: "medio" },
          {
            label: "Tipo de pago",
            value: (item) => item.tipo_ingreso === "INSCRIPCIÓN"
              ? "INSCRIPCIÓN"
              : (item.tipo_pago || "HISTÓRICO / SIN CLASIFICAR"),
          },
          {
            label: "Descuento familiar %",
            value: (item) => item.tipo_pago === "DESCUENTO_FAMILIAR"
              ? `${Number(item.porcentaje_descuento_familiar || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`
              : "—",
          },
          { label: "Monto", value: (item) => money(item.monto) },
          { label: "Detalle del monto", key: "etiqueta_monto" },
        ],
        registros: detailItems,
      },
    ],
    count: detailItems.length,
  };
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
        hoja: "Inscripciones",
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
        registros: [{ ...(balance.inscripciones?.resumen || {}), __estilo: "resumen" }],
      },
      {
        hoja: "Inscripciones",
        titulo: "Inscripciones · Resumen por período",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Período", key: "periodo" }, { label: "Meses incluidos", key: "meses" },
          { label: "Total", key: "total" }, { label: "Activos", key: "activos" }, { label: "Pasivos", key: "pasivos" },
          { label: "Sin estado", key: "sin_estado" }, { label: "Pagadas", key: "pagadas" },
          { label: "Sin importe", key: "sin_importe" }, { label: "Sin registro", key: "sin_registro" },
          { label: "Total cobrado", key: "total_cobrado" },
        ],
        registros: (balance.inscripciones?.por_periodo || []).map((item) => ({ ...item, __estilo: "periodo" })),
      },
      {
        hoja: "Inscripciones",
        titulo: "Inscripciones · Detalle completo",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "ID", key: "id_socio" }, { label: "Socio", key: "socio" }, { label: "DNI", key: "dni" }, { label: "Estado", key: "estado" },
          { label: "Fecha alta", key: "fecha_alta" }, { label: "Período", key: "periodo" }, { label: "Fecha pago", key: "fecha_pago" },
          { label: "Medio", key: "medio" }, { label: "Monto", key: "monto" }, { label: "Tipo", key: "tipo" },
        ],
        registros: (balance.inscripciones?.items || []).map((item) => ({
          ...item,
          __estilo: balanceStatusTone(item.estado).replace("is-", ""),
        })),
      },
    ],
    bajas: [
      {
        hoja: "Bajas",
        titulo: "Bajas · Resumen",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Total bajas", key: "total_bajas" }, { label: "Activos", key: "activos" }, { label: "Pasivos", key: "pasivos" },
          { label: "Sin estado", key: "sin_estado" }, { label: "Pagos", key: "pagos" }, { label: "Condonaciones", key: "condonaciones" },
          { label: "Total pagado", key: "total_pagado" },
        ],
        registros: [{ ...(balance.bajas?.resumen || {}), __estilo: "resumen" }],
      },
      {
        hoja: "Bajas",
        titulo: "Bajas · Resumen por período",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Grupo", key: "grupo" }, { label: "Estado", key: "estado" }, { label: "Período", key: "periodo" },
          { label: "Bajas", key: "bajas" }, { label: "Pagos", key: "pagos" }, { label: "Condonaciones", key: "condonaciones" },
          { label: "Monto pagado", key: "monto_pagado" },
        ],
        registros: (balance.bajas?.por_periodo || []).map((item) => ({ ...item, __estilo: "periodo" })),
      },
      {
        hoja: "Bajas",
        titulo: "Bajas · Detalle completo",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "ID", key: "id_socio" }, { label: "Socio", key: "socio" }, { label: "Estado", key: "estado" }, { label: "Fecha baja", key: "fecha_baja" },
          { label: "Período baja", key: "periodo_baja" }, { label: "Períodos cubiertos", value: (item) => (item.periodos_cubiertos || []).join(", ") },
          { label: "Pagos", key: "pagos" }, { label: "Condonaciones", key: "condonaciones" }, { label: "Total pagado", key: "total_pagado" }, { label: "Motivo", key: "motivo" },
        ],
        registros: (balance.bajas?.items || []).map((item) => ({
          ...item,
          __estilo: balanceStatusTone(item.estado).replace("is-", ""),
        })),
      },
    ],
    deudores: [
      {
        hoja: "Deudores",
        titulo: "Deudores · Resumen",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Total deudas", key: "total_deudas" }, { label: "Activos", key: "activos" }, { label: "Pasivos", key: "pasivos" },
          { label: "Sin estado", key: "sin_estado" }, { label: "Períodos analizados", key: "periodos_analizados" }, { label: "Total adeudado", key: "total_adeudado" },
        ],
        registros: [{ ...(balance.deudores?.resumen || {}), __estilo: "resumen" }],
      },
      {
        hoja: "Deudores",
        titulo: "Deudores · Resumen por período",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Período", key: "periodo" }, { label: "Deudores", key: "deudores" }, { label: "Activos", key: "activos" },
          { label: "Pasivos", key: "pasivos" }, { label: "Sin estado", key: "sin_estado" }, { label: "Monto adeudado", key: "monto_adeudado" },
        ],
        registros: (balance.deudores?.por_periodo || []).map((item) => ({ ...item, __estilo: "periodo" })),
      },
      {
        hoja: "Deudores",
        titulo: "Deudores · Detalle completo",
        subtitulo: rangeSubtitle,
        columnas: [
          { label: "Período", key: "periodo" }, { label: "ID", key: "id_socio" }, { label: "Socio", key: "socio" }, { label: "DNI", key: "dni" },
          { label: "Estado", key: "estado" }, { label: "Categoría", key: "categoria" }, { label: "Ingreso", key: "ingreso" },
          { label: "Domicilio", key: "domicilio" }, { label: "Teléfono", key: "telefono" }, { label: "Cobrador", key: "cobrador" },
          { label: "Monto base", key: "monto_base" }, { label: "Descuento familiar %", key: "descuento_familiar" }, { label: "Monto adeudado", key: "monto" },
        ],
        registros: (balance.deudores?.items || []).map((item) => ({
          ...item,
          __estilo: balanceStatusTone(item.estado).replace("is-", ""),
        })),
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
  const [reasonModal, setReasonModal] = useState(null);
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

  return (
    <>
      <CrudModal
        open={open}
        title={balance?.titulo || "Balance anual"}
        subtitle={balance ? `Del ${dateText(balance.desde)} al ${dateText(balance.hasta)}` : "Seleccioná el rango de fechas para generar el balance."}
        onClose={onClose}
        hideSubmit
        hideCancel
        closeOnBackdrop={false}
        modalClassName={`ct-balance-modal ${balance ? "is-generated" : "is-pending"}`}
        wide
      >
        <div className="entity-form ct-balance-form">
          <EntityFormPanel
            standalone
            title="Período del balance"
            icon={faCalculator}
            tag={balance ? `${dateText(balance.desde)} · ${dateText(balance.hasta)}` : "Rango anual"}
            bodyClassName="entity-form__grid ct-balance-period-grid"
          >
            <FloatingField label="Desde">
              <input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} />
            </FloatingField>
            <FloatingField label="Hasta">
              <input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} />
            </FloatingField>
            <div className="ct-balance-generate">
              <button
                type="button"
                className="mov-btn mov-btn--primary"
                onClick={generate}
                disabled={loading}
              >
                {loading ? "Generando..." : balance ? "Actualizar balance" : "Generar balance"}
              </button>
            </div>
          </EntityFormPanel>

          {!balance ? (
            <div className="module-empty ct-balance-empty">
              <FontAwesomeIcon icon={faCalculator} />
              <strong>Balance pendiente</strong>
              <span>Seleccioná el rango de fechas y presioná Generar balance.</span>
            </div>
          ) : (
            <div className="ct-balance-content">
              <div className="ct-balance-global-toolbar">
                <EntityTabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { value: "inscripciones", label: "Inscripciones", icon: faUserPlus },
                    { value: "bajas", label: "Bajas", icon: faUserMinus },
                    { value: "deudores", label: "Deudores por período", icon: faTriangleExclamation },
                  ]}
                  ariaLabel="Secciones del balance anual"
                  idPrefix="balance-anual"
                />
                <div className="ct-balance-export-actions">
                  <button type="button" className="mov-btn mov-btn--ghost" onClick={() => setExportMode("current")}><FontAwesomeIcon icon={faFileExcel} /> Exportar pestaña actual</button>
                  <button type="button" className="mov-btn mov-btn--ghost" onClick={() => setExportMode("all")}><FontAwesomeIcon icon={faFileExcel} /> Exportar todas las pestañas</button>
                </div>
              </div>
            {tab === "inscripciones" ? <>
              <BalanceSummary items={[
                { key: "inscripciones", label: "Inscripciones", value: ins.resumen?.inscripciones || 0 },
                { key: "pagadas", label: "Inscripciones pagadas", value: ins.resumen?.pagadas || 0, tone: "success" },
                { key: "sin-importe", label: "Registros sin importe", value: ins.resumen?.sin_importe || 0, tone: "warning" },
                { key: "sin-registro", label: "Sin registro de pago", value: ins.resumen?.sin_registro || 0, tone: "warning" },
                { key: "total-inscripcion", label: "Total inscripción", value: money(ins.resumen?.total_inscripcion), tone: "success" },
                { key: "activos", label: "Activos inscriptos", value: ins.resumen?.activos || 0, tone: "success" },
                { key: "pasivos", label: "Pasivos inscriptos", value: ins.resumen?.pasivos || 0, tone: "warning" },
                ...(Number(ins.resumen?.sin_estado || 0) > 0
                  ? [{ key: "sin-estado", label: "Inscriptos sin estado", value: ins.resumen?.sin_estado || 0, tone: "warning" }]
                  : []),
              ]} />
              <h4>Resumen de inscripciones por período de ingreso</h4>
              <GlobalDivTable
                className="ct-balance-table ct-balance-table--compact"
                bodyClassName="entity-table-wrap ct-balance-table__body"
                gridClassName="ct-balance-grid ct-balance-grid--ins-summary"
                columns={[
                  { label: "Período", align: "center" },
                  "Meses incluidos",
                  { label: "Total", align: "center" },
                  { label: "Activos", align: "center" },
                  { label: "Pasivos", align: "center" },
                  { label: "Pagadas", align: "center" },
                  { label: "Sin importe", align: "center" },
                  { label: "Sin registro", align: "center" },
                  { label: "Total cobrado", align: "right" },
                ]}
                ariaLabel="Resumen de inscripciones por período de ingreso"
                empty={!(ins.por_periodo || []).length}
                skeletonActionColumn={false}
              >
                {!(ins.por_periodo || []).length ? (
                  <div className="module-empty ct-balance-table-empty">
                    <strong>Sin períodos para mostrar</strong>
                    <span>No hay inscripciones para el rango seleccionado.</span>
                  </div>
                ) : null}
                {(ins.por_periodo || []).map((r) => (
                  <div
                    className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-balance-grid ct-balance-grid--ins-summary"
                    role="row"
                    key={r.periodo}
                  >
                    <div className="mov-gridCell is-center is-strong">{r.periodo}</div>
                    <div className="mov-gridCell">{r.meses}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.total}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.activos}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.pasivos}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.pagadas}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.sin_importe}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.sin_registro}</div>
                    <div className="mov-gridCell is-right is-strong ct-balance-number">{money(r.total_cobrado)}</div>
                  </div>
                ))}
              </GlobalDivTable>
              <div className="ct-old-pane-head"><div><strong>Detalle completo de socios inscriptos</strong><span>Mostrando {(ins.items || []).length} socios.</span></div><SearchBox value={search} onChange={setSearch} placeholder="Buscar por ID, socio, DNI, estado, ingreso..." /></div>
              <BalanceStatusLegend />
              <GlobalDivTable
                className="ct-balance-table ct-balance-table--detail"
                bodyClassName="entity-table-wrap ct-balance-table__body"
                gridClassName="ct-balance-grid ct-balance-grid--ins-detail"
                columns={[
                  "ID",
                  "Socio",
                  { label: "DNI", align: "center" },
                  { label: "Fecha alta", align: "center" },
                  { label: "Período", align: "center" },
                  { label: "Fecha pago", align: "center" },
                  { label: "Medio pago", align: "center" },
                  { label: "Monto", align: "right" },
                ]}
                ariaLabel="Detalle completo de socios inscriptos"
                empty={!filterItems(ins.items || []).length}
                skeletonActionColumn={false}
              >
                {!filterItems(ins.items || []).length ? (
                  <div className="module-empty ct-balance-table-empty">
                    <strong>Sin socios para mostrar</strong>
                    <span>No hay inscripciones que coincidan con la búsqueda.</span>
                  </div>
                ) : null}
                {filterItems(ins.items || []).map((r, i) => (
                  <div
                    className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-balance-grid ct-balance-grid--ins-detail ct-balance-statusRow ${balanceStatusTone(r.estado)}`}
                    role="row"
                    key={`${r.id_socio}-${r.id_inscripcion ?? i}`}
                  >
                    <div className="mov-gridCell ct-balance-number">{r.id_socio}</div>
                    <div className="mov-gridCell entity-main-cell"><strong>{r.socio}</strong></div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.dni || "—"}</div>
                    <div className="mov-gridCell is-center">{dateText(r.fecha_alta)}</div>
                    <div className="mov-gridCell is-center">{r.periodo || "—"}</div>
                    <div className="mov-gridCell is-center">{dateText(r.fecha_pago)}</div>
                    <div className="mov-gridCell is-center">{r.medio || "—"}</div>
                    <div className="mov-gridCell is-right is-strong ct-balance-number">{money(r.monto)}</div>
                  </div>
                ))}
              </GlobalDivTable>
            </> : null}
            {tab === "bajas" ? <>
              <BalanceSummary items={[
                { key: "total-bajas", label: "Total bajas", value: bajas.resumen?.total_bajas || 0 },
                { key: "bajas-pasivos", label: "Bajas pasivos", value: bajas.resumen?.pasivos || 0, tone: "warning" },
                { key: "bajas-activos", label: "Bajas activos", value: bajas.resumen?.activos || 0, tone: "success" },
                { key: "pagos-bajas", label: "Pagos bajas", value: bajas.resumen?.pagos || 0 },
                { key: "condonaciones", label: "Condonaciones", value: bajas.resumen?.condonaciones || 0, tone: "warning" },
                { key: "total-bajas-pagado", label: "Total bajas pagado", value: money(bajas.resumen?.total_pagado), tone: "success" },
                ...(Number(bajas.resumen?.sin_estado || 0) > 0
                  ? [{ key: "bajas-sin-estado", label: "Bajas sin estado", value: bajas.resumen?.sin_estado || 0, tone: "warning" }]
                  : []),
              ]} />
              <h4>Resumen por período de baja</h4>
              <GlobalDivTable
                className="ct-balance-table ct-balance-table--compact"
                bodyClassName="entity-table-wrap ct-balance-table__body"
                gridClassName="ct-balance-grid ct-balance-grid--bajas-summary"
                columns={[
                  "Grupo",
                  { label: "Período baja / año", align: "center" },
                  { label: "Bajas", align: "center" },
                  { label: "Pagos", align: "center" },
                  { label: "Condonaciones", align: "center" },
                  { label: "Monto pagado", align: "right" },
                ]}
                ariaLabel="Resumen por período de baja"
                empty={!(bajas.por_periodo || []).length}
                skeletonActionColumn={false}
              >
                {!(bajas.por_periodo || []).length ? (
                  <div className="module-empty ct-balance-table-empty">
                    <strong>Sin bajas para mostrar</strong>
                    <span>No hay bajas para el rango seleccionado.</span>
                  </div>
                ) : null}
                {(bajas.por_periodo || []).map((r, i) => (
                  <div
                    className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-balance-grid ct-balance-grid--bajas-summary"
                    role="row"
                    key={`${r.estado}-${r.periodo}-${i}`}
                  >
                    <div className="mov-gridCell"><span className="ct-old-badge is-estado">{r.grupo}</span></div>
                    <div className="mov-gridCell is-center is-strong">{r.periodo}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.bajas}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.pagos}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.condonaciones}</div>
                    <div className="mov-gridCell is-right is-strong ct-balance-number">{money(r.monto_pagado)}</div>
                  </div>
                ))}
              </GlobalDivTable>
              <div className="ct-old-pane-head"><div><strong>Detalle de socios dados de baja</strong><span>Mostrando {(bajas.items || []).length} socios.</span></div><SearchBox value={search} onChange={setSearch} placeholder="Buscar por ID, socio, estado, período, baja..." /></div>
              <BalanceStatusLegend />
              <GlobalDivTable
                className="ct-balance-table ct-balance-table--detail"
                bodyClassName="entity-table-wrap ct-balance-table__body"
                gridClassName="ct-balance-grid ct-balance-grid--bajas-detail"
                columns={[
                  "ID",
                  "Socio",
                  { label: "Fecha baja", align: "center" },
                  { label: "Período baja", align: "center" },
                  "Períodos cubiertos",
                  { label: "Total pagado", align: "right" },
                  "Motivo",
                ]}
                ariaLabel="Detalle de socios dados de baja"
                empty={!filterItems(bajas.items || []).length}
                skeletonActionColumn={false}
              >
                {!filterItems(bajas.items || []).length ? (
                  <div className="module-empty ct-balance-table-empty">
                    <strong>Sin socios dados de baja</strong>
                    <span>No hay registros que coincidan con la búsqueda.</span>
                  </div>
                ) : null}
                {filterItems(bajas.items || []).map((r) => (
                  <div
                    className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-balance-grid ct-balance-grid--bajas-detail ct-balance-statusRow ${balanceStatusTone(r.estado)}`}
                    role="row"
                    key={r.id_historial}
                  >
                    <div className="mov-gridCell ct-balance-number">{r.id_socio}</div>
                    <div className="mov-gridCell entity-main-cell"><strong>{r.socio}</strong></div>
                    <div className="mov-gridCell is-center">{dateText(r.fecha_baja)}</div>
                    <div className="mov-gridCell is-center">{r.periodo_baja || "—"}</div>
                    <div className="mov-gridCell ct-balance-cell-wrap">{(r.periodos_cubiertos || []).join(", ") || "—"}</div>
                    <div className="mov-gridCell is-right is-strong ct-balance-number">{money(r.total_pagado)}</div>
                    <div className="mov-gridCell ct-balance-cell-wrap">
                      <MotivoPreviewGlobal
                        text={r.motivo}
                        emptyText="SIN MOTIVO INFORMADO"
                        onOpen={() => setReasonModal(r)}
                        title="Ver motivo de baja completo"
                        ariaLabel={`Ver motivo de baja completo de ${r.socio || `socio ${r.id_socio}`}`}
                      />
                    </div>
                  </div>
                ))}
              </GlobalDivTable>
            </> : null}
            {tab === "deudores" ? <>
              <BalanceSummary items={[
                { key: "total-deudas", label: "Total deudas por período", value: deuda.resumen?.total_deudas || 0 },
                { key: "deudores-pasivos", label: "Socios pasivos deudores", value: deuda.resumen?.pasivos || 0, tone: "warning" },
                { key: "deudores-activos", label: "Socios activos deudores", value: deuda.resumen?.activos || 0, tone: "success" },
                { key: "periodos-analizados", label: "Períodos analizados", value: deuda.resumen?.periodos_analizados || 0 },
                { key: "total-adeudado", label: "Total adeudado", value: money(deuda.resumen?.total_adeudado), tone: "warning" },
                ...(Number(deuda.resumen?.sin_estado || 0) > 0
                  ? [{ key: "deudas-sin-estado", label: "Deudas sin estado", value: deuda.resumen?.sin_estado || 0, tone: "warning" }]
                  : []),
              ]} />
              <h4>Resumen de deudores por período</h4>
              <GlobalDivTable
                className="ct-balance-table ct-balance-table--compact"
                bodyClassName="entity-table-wrap ct-balance-table__body"
                gridClassName="ct-balance-grid ct-balance-grid--debt-summary"
                columns={[
                  "Período",
                  { label: "Deudores", align: "center" },
                  { label: "Activos", align: "center" },
                  { label: "Pasivos", align: "center" },
                  { label: "Sin estado", align: "center" },
                  { label: "Monto adeudado", align: "right" },
                ]}
                ariaLabel="Resumen de deudores por período"
                empty={!(deuda.por_periodo || []).length}
                skeletonActionColumn={false}
              >
                {!(deuda.por_periodo || []).length ? (
                  <div className="module-empty ct-balance-table-empty">
                    <strong>Sin deudas para mostrar</strong>
                    <span>No hay períodos con deuda para el rango seleccionado.</span>
                  </div>
                ) : null}
                {(deuda.por_periodo || []).map((r) => (
                  <div
                    className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-balance-grid ct-balance-grid--debt-summary"
                    role="row"
                    key={r.periodo}
                  >
                    <div className="mov-gridCell is-strong">{r.periodo}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.deudores}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.activos}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.pasivos}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.sin_estado}</div>
                    <div className="mov-gridCell is-right is-strong ct-balance-number">{money(r.monto_adeudado)}</div>
                  </div>
                ))}
              </GlobalDivTable>
              <div className="ct-old-pane-head"><div><strong>Detalle completo de deudores por período</strong><span>Mostrando {visibleDebtItems.length} de {debtItems.length} deudas por período.</span></div><SearchBox value={search} onChange={setSearch} placeholder="Buscar por ID, socio, DNI, estado, período..." /></div>
              <BalanceStatusLegend />
              <GlobalDivTable
                className="ct-balance-table ct-balance-table--detail ct-balance-table--debt-detail"
                bodyClassName="entity-table-wrap ct-balance-table__body"
                gridClassName="ct-balance-grid ct-balance-grid--debt-detail"
                columns={[
                  { label: "Período", align: "center" },
                  { label: "ID", align: "center" },
                  "Socio",
                  { label: "DNI", align: "center" },
                  { label: "Categoría", align: "center" },
                  { label: "Ingreso", align: "center" },
                  { label: "Domicilio", align: "center" },
                  { label: "Teléfono", align: "center" },
                  { label: "Cobrador", align: "center" },
                  { label: "Monto", align: "right" },
                ]}
                ariaLabel="Detalle completo de deudores por período"
                empty={!visibleDebtItems.length}
                skeletonActionColumn={false}
              >
                {!visibleDebtItems.length ? (
                  <div className="module-empty ct-balance-table-empty">
                    <strong>Sin deudores para mostrar</strong>
                    <span>No hay registros que coincidan con la búsqueda.</span>
                  </div>
                ) : null}
                {visibleDebtItems.map((r, i) => (
                  <div
                    className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ct-balance-grid ct-balance-grid--debt-detail ct-balance-statusRow ${balanceStatusTone(r.estado)}`}
                    role="row"
                    key={`${r.id_socio}-${r.anio}-${r.id_periodo}-${i}`}
                  >
                    <div className="mov-gridCell is-center is-strong">{r.periodo}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.id_socio}</div>
                    <div className="mov-gridCell entity-main-cell"><strong>{r.socio}</strong></div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.dni || "—"}</div>
                    <div className="mov-gridCell is-center"><span className="mov-categoryChip">{r.categoria || "Sin categoría"}</span></div>
                    <div className="mov-gridCell is-center">{dateText(r.ingreso)}</div>
                    <div className="mov-gridCell is-center ct-balance-cell-wrap">{r.domicilio || "—"}</div>
                    <div className="mov-gridCell is-center ct-balance-number">{r.telefono || "—"}</div>
                    <div className="mov-gridCell is-center">
                      <span className={`ct-collectorChip ${collectorTone(r.cobrador)}`}>
                        {r.cobrador || "—"}
                      </span>
                    </div>
                    <div className="mov-gridCell is-right is-strong ct-balance-number">
                      <strong>{money(r.monto)}</strong>
                      {Number(r.descuento_familiar) > 0 ? (
                        <small className="ct-old-discount">-{r.descuento_familiar}% familiar</small>
                      ) : null}
                    </div>
                  </div>
                ))}
              </GlobalDivTable>
              {!showAllDebts && debtItems.length > 100 ? <div className="ct-old-load-all"><span>Se muestran los primeros 100. Quedan {debtItems.length - 100} registros más.</span><button type="button" className="mov-btn mov-btn--ghost" onClick={() => setShowAllDebts(true)}>Cargar todos</button></div> : null}
            </> : null}
            </div>
          )}
        </div>
      </CrudModal>
      <ModalMotivoGlobal
        open={Boolean(reasonModal)}
        title="Motivo de baja"
        subtitle={
          reasonModal
            ? `Socio: ${reasonModal.socio || reasonModal.id_socio} · Baja: ${dateText(reasonModal.fecha_baja)}`
            : ""
        }
        label="Motivo registrado"
        text={reasonModal?.motivo}
        emptyText="SIN MOTIVO INFORMADO"
        onClose={() => setReasonModal(null)}
      />
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
    </>
  );
}

export default function IngresosSociosView({
  activeTab = "detail",
  data,
  loading,
  detailSearch = "",
  detailIdSearch = "",
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
      id_socio: detailIdSearch,
      pagina: 1,
    });
    const all = [...(first?.detalle?.items || [])];
    const totalPages = Number(first?.detalle?.paginacion?.total_paginas || 1);
    for (let current = 2; current <= totalPages; current += 1) {
      const response = await contableApi.ingresosSocios({
        anio: period.anio,
        periodo: period.id_periodo,
        buscar: detailSearch,
        id_socio: detailIdSearch,
        pagina: current,
      });
      all.push(...(response?.detalle?.items || []));
    }
    return all;
  }, [detailSearch, detailIdSearch, period?.anio, period?.id_periodo]);

  const exportConfig = useMemo(
    () => incomeExportConfigForTab({ activeTab, data, period }),
    [activeTab, data, period],
  );

  const obtainAllExportSections = useCallback(async () => {
    if (activeTab !== "detail") return exportConfig.sections || [];
    const records = await obtainAllDetailRecords();
    return incomeExportConfigForTab({
      activeTab,
      data,
      period,
      detailRecords: records,
    }).sections;
  }, [activeTab, data, exportConfig.sections, obtainAllDetailRecords, period]);

  const totalExportable = activeTab === "detail"
    ? Number(detailPagination.total || exportConfig.count || 0)
    : Number(exportConfig.count || 0);

  const tableActions = (
    <>
      <BotonExportarGlobal
        label="Exportar"
        className="ct-income-lower-action mov-btn--compact"
        onClick={() => setExportOpen(true)}
        disabled={loading || totalExportable <= 0}
        title={exportConfig.title}
      />
      <button
        type="button"
        className="mov-btn ct-income-lower-action ct-income-balance-button"
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
      <div className={`ct-income-body ${activeTab === "collection" ? "is-collection" : ""}`.trim()}>
        {activeTab === "detail" ? (
          <IncomeDetail
            actions={tableActions}
            section={data?.detalle}
            onPageChange={onDetailPageChange}
            loading={loading}
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
        subtituloArchivoTodos={`${dateText(period?.desde)} al ${dateText(period?.hasta)}`}
        nombreArchivo={exportConfig.fileName}
        seccionesActuales={exportConfig.sections || []}
        obtenerSeccionesTodos={activeTab === "detail" ? obtainAllExportSections : undefined}
        cantidadActual={Number(exportConfig.count || 0)}
        cantidadTodos={activeTab === "detail" ? Number(detailPagination.total || exportConfig.count || 0) : Number(exportConfig.count || 0)}
        mostrarAlcanceTodos={activeTab === "detail" && Number(detailPagination.total || 0) > Number(exportConfig.count || 0)}
        alcanceActualLabel={activeTab === "detail" && Number(detailPagination.total_paginas || 0) > 1 ? "Exportar esta página" : "Exportar registros visibles"}
        alcanceActualDescription={activeTab === "detail"
          ? "Exporta el resumen y los pagos visibles con la búsqueda actual."
          : "Exporta el resumen, la tabla principal y todos sus detalles en el mismo informe."}
        alcanceTodosLabel="Exportar detalle completo"
        alcanceTodosDescription="Exporta el resumen y todas las páginas de 100 registros que coinciden con la búsqueda y el período seleccionados."
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => onFeedback?.({ type: "success", message })}
        onError={(message) => onFeedback?.({ type: "error", message })}
      />
      <BalanceModal open={balanceOpen} onClose={() => setBalanceOpen(false)} onFeedback={onFeedback} />
    </section>
  );
}
