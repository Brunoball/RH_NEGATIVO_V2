import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowTrendDown,
  faArrowTrendUp,
  faChartPie,
  faCircleInfo,
  faEye,
  faFileInvoiceDollar,
  faList,
  faMoneyBillTransfer,
  faPaperclip,
  faPen,
  faPlus,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";
import {
  ModulePage,
  useCompactModuleActions,
} from "../Global/ModulePage";
import GlobalDivTable from "../Global/GlobalDivTable";
import CrudModal from "../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../Global/Modales/ModalEliminarGlobal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import BotonExportarGlobal from "../Global/Botones/BotonExportarGlobal";
import ModuleFeedback from "../Global/ModuleFeedback";
import SummaryCards from "../Global/SummaryCards";
import {
  EntityFormPanel,
  EntityTabs,
  FloatingField,
} from "../Global/Formularios/TabbedForm";
import {
  decimalInput,
  preventInvalidDecimalKey,
} from "../Global/Formularios/inputSanitizers";
import { canWrite } from "../_shared/auth/session";
import { contableApi } from "./api/contableApi";
import "./Contable.css";

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const CURRENT_MONTH = now.getMonth() + 1;
const PAGE_SIZE = 10;
const MONTHS = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

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

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`),
      )
    : "—";

const localDate = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const upper = (value) => String(value ?? "").toLocaleUpperCase("es-AR");
const upperWithoutDigits = (value) => upper(String(value ?? "").replace(/[0-9]/g, ""));

const sanitizeOptionName = (type, value) =>
  type === "PROVEEDOR" ? upper(value) : upperWithoutDigits(value);

const emptyCatalogs = {
  opciones: {
    PROVEEDOR: [],
    CATEGORIA_INGRESO: [],
    CONCEPTO_INGRESO: [],
    CATEGORIA_EGRESO: [],
    CONCEPTO_EGRESO: [],
  },
  medios_pago: [],
  categorias_socios: [],
  anios: [CURRENT_YEAR],
};

const emptyIncomeForm = () => ({
  id_ingreso: "",
  fecha: localDate(),
  id_medio_pago: "",
  id_proveedor: "",
  id_categoria: "",
  id_concepto: "",
  importe: "",
  detalle: "",
});

const emptyExpenseForm = () => ({
  id_egreso: "",
  fecha: localDate(),
  id_medio_pago: "",
  id_proveedor: "",
  id_categoria: "",
  id_concepto: "",
  numero_comprobante: "",
  importe: "",
  detalle: "",
  archivo: null,
  archivo_nombre: "",
  eliminar_archivo: false,
});

function OptionSelect({
  label,
  value,
  options,
  optionType,
  onChange,
  onRequestCreate,
  required = true,
}) {
  return (
    <FloatingField label={label} active>
      <select
        value={value}
        required={required}
        onChange={(event) => {
          if (event.target.value === "__ADD__") {
            onRequestCreate(optionType, label, onChange);
            return;
          }
          onChange(event.target.value);
        }}
      >
        <option value="">SELECCIONE...</option>
        <option value="__ADD__">＋ AGREGAR NUEVA OPCIÓN</option>
        {(options || [])
          .filter(
            (option) =>
              option.activo !== false || String(option.id_opcion) === String(value),
          )
          .map((option) => (
            <option key={option.id_opcion} value={option.id_opcion}>
              {option.nombre}
              {option.activo === false ? " (INACTIVA)" : ""}
            </option>
          ))}
      </select>
    </FloatingField>
  );
}

function EmptyState({ message = "No hay registros para mostrar." }) {
  return (
    <div className="module-empty">
      <FontAwesomeIcon icon={faMoneyBillTransfer} />
      <strong>Sin movimientos para mostrar</strong>
      <span>{message}</span>
    </div>
  );
}

function MonthlyBarChart({ months = [] }) {
  const values = months.flatMap((item) => [
    Number(item.ingresos || 0),
    Number(item.egresos || 0),
  ]);
  const maxValue = Math.max(1, ...values);
  const scaleSteps = [1, 0.75, 0.5, 0.25, 0];
  const compactMoney = (value) =>
    new Intl.NumberFormat("es-AR", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value || 0));
  const barHeight = (value) => {
    const numericValue = Number(value || 0);
    if (numericValue <= 0) return "0%";
    return `${Math.max(3, (numericValue / maxValue) * 100)}%`;
  };

  return (
    <article className="ct-panel ct-month-chart-panel">
      <header>
        <FontAwesomeIcon icon={faFileInvoiceDollar} /> Movimientos por mes
      </header>

      <div className="ct-month-chart">
        <div
          className="ct-month-chart__legend"
          aria-label="Referencias del gráfico"
        >
          <span>
            <i className="is-income" /> Ingresos
          </span>
          <span>
            <i className="is-expense" /> Egresos
          </span>
        </div>

        <div
          className="ct-month-chart__plot"
          role="group"
          aria-label="Gráfico de barras de ingresos y egresos por mes"
        >
          <div className="ct-month-chart__scale" aria-hidden="true">
            {scaleSteps.map((step) => (
              <span key={step}>{compactMoney(maxValue * step)}</span>
            ))}
          </div>

          <div className="ct-month-chart__canvas">
            <div className="ct-month-chart__grid" aria-hidden="true">
              {scaleSteps.map((step) => (
                <i key={step} />
              ))}
            </div>

            <div className="ct-month-chart__months">
              {months.map((item) => {
                const result = Number(
                  item.resultado ??
                    Number(item.ingresos || 0) - Number(item.egresos || 0),
                );
                const monthLabel = String(
                  item.nombre || MONTHS[item.mes - 1] || item.mes,
                );

                return (
                  <div
                    className="ct-month-chart__month"
                    key={item.mes}
                    tabIndex={0}
                    aria-label={`${monthLabel}: ingresos ${money(item.ingresos)}, egresos ${money(item.egresos)}, resultado ${money(result)}`}
                  >
                    <div className="ct-month-chart__bars" aria-hidden="true">
                      <span
                        className="ct-month-chart__bar is-income"
                        style={{ height: barHeight(item.ingresos) }}
                      />
                      <span
                        className="ct-month-chart__bar is-expense"
                        style={{ height: barHeight(item.egresos) }}
                      />
                    </div>
                    <strong>{monthLabel.slice(0, 3)}</strong>
                    <div className="ct-month-chart__tooltip" aria-hidden="true">
                      <b>{monthLabel}</b>
                      <span>
                        Ingresos <strong>{money(item.ingresos)}</strong>
                      </span>
                      <span>
                        Egresos <strong>{money(item.egresos)}</strong>
                      </span>
                      <span
                        className={result >= 0 ? "ct-positive" : "ct-negative"}
                      >
                        Resultado <strong>{money(result)}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function SummaryView({ summary, loading, mode }) {
  const totals = summary?.totales || {};
  const selectedMonth = (summary?.meses || []).find(
    (item) => Number(item.mes) === Number(summary?.mes_seleccionado),
  );
  const visibleTotals =
    mode === "monthly" ? summary?.totales_mes || selectedMonth || {} : totals;
  const income = Number(visibleTotals.ingresos || 0);
  const expenses = Number(visibleTotals.egresos || 0);
  const result = Number(visibleTotals.resultado || income - expenses);
  const partnerIncome = Number(visibleTotals.ingresos_socios || 0);
  const otherIncome = Number(visibleTotals.otros_ingresos || 0);
  const sum = income + expenses;
  const incomeDegrees = sum > 0 ? (income / sum) * 360 : 0;
  const detail = summary?.detalle_mes || {};

  return (
    <section className={`ct-summary ct-summary--${mode}`}>
      {loading ? (
        <div className="module-empty">
          <FontAwesomeIcon icon={faMoneyBillTransfer} />
          <strong>Cargando información contable...</strong>
          <span>Consultando los movimientos del período seleccionado.</span>
        </div>
      ) : null}

      {!loading && mode === "annual" ? (
        <div className="ct-summary__annual">
          <article className="ct-panel ct-chart-panel">
            <header>
              <FontAwesomeIcon icon={faChartPie} /> Visualización anual
            </header>
            <div className="ct-donut-wrap">
              <div
                className="ct-donut"
                style={{
                  background: `conic-gradient(var(--balto-action) 0deg ${incomeDegrees}deg, var(--balto-midnight) ${incomeDegrees}deg 360deg)`,
                }}
              >
                <div>
                  <strong>{money(income - expenses)}</strong>
                  <span>Resultado</span>
                </div>
              </div>
              <div className="ct-legend">
                <span>
                  <i className="income" /> Ingresos <b>{money(income)}</b>
                </span>
                <span>
                  <i className="expense" /> Egresos <b>{money(expenses)}</b>
                </span>
              </div>
            </div>
          </article>

          <MonthlyBarChart months={summary?.meses || []} />
        </div>
      ) : null}

      {!loading && mode === "monthly" ? (
        <div className="ct-summary__monthly">
          <div className="ct-breakdowns">
            <Breakdown
              title="Categorías de ingresos"
              items={detail.categorias_ingresos}
            />
            <Breakdown
              title="Categorías de egresos"
              items={detail.categorias_egresos}
            />
            <Breakdown title="Medios de cobro" items={detail.medios} />
          </div>
        </div>
      ) : null}

      {!loading ? (
        <SummaryCards
          title="Resumen del período"
          ariaLabel="Totales del período"
          variant="footer"
          className={`ct-summaryCards ${result >= 0 ? "is-positive" : "is-negative"}`}
          items={[
            {
              key: "income",
              label: "Ingresos",
              detail: `Cuotas ${money(partnerIncome)} · Otros ${money(otherIncome)}`,
              value: money(income),
            },
            {
              key: "expenses",
              label: "Egresos",
              detail: "Gastos registrados manualmente",
              value: money(expenses),
            },
            {
              key: "result",
              label: "Resultado",
              detail:
                mode === "monthly"
                  ? selectedMonth?.nombre || "Mes seleccionado"
                  : `Año ${summary?.anio || ""}`,
              value: money(result),
            },
          ]}
        />
      ) : null}
    </section>
  );
}

function Breakdown({ title, items = [] }) {
  return (
    <article className="ct-panel ct-breakdown">
      <header>{title}</header>
      <div>
        {items.length ? (
          items.map((item) => (
            <p key={item.nombre}>
              <span>{item.nombre}</span>
              <b>{money(item.total)}</b>
            </p>
          ))
        ) : (
          <p className="ct-breakdown__empty">Sin movimientos en el mes.</p>
        )}
      </div>
    </article>
  );
}

function SummaryDetailModal({ open, onClose, summary, year }) {
  const monthlyRows = MONTHS.map((name, index) => {
    const monthNumber = index + 1;
    const source = (summary?.meses || []).find(
      (item) => Number(item.mes) === monthNumber,
    );
    const income = Number(source?.ingresos || 0);
    const expenses = Number(source?.egresos || 0);

    return {
      mes: monthNumber,
      nombre: source?.nombre || name,
      ingresos: income,
      egresos: expenses,
      resultado: Number(source?.resultado ?? income - expenses),
    };
  });
  const calculatedTotals = monthlyRows.reduce(
    (totals, item) => ({
      ingresos: totals.ingresos + item.ingresos,
      egresos: totals.egresos + item.egresos,
      resultado: totals.resultado + item.resultado,
    }),
    { ingresos: 0, egresos: 0, resultado: 0 },
  );
  const totals = {
    ingresos: Number(summary?.totales?.ingresos ?? calculatedTotals.ingresos),
    egresos: Number(summary?.totales?.egresos ?? calculatedTotals.egresos),
    resultado: Number(
      summary?.totales?.resultado ?? calculatedTotals.resultado,
    ),
  };

  return (
    <CrudModal
      open={open}
      title="Detalle mensual contable"
      subtitle={`Ingresos, egresos y resultado de cada mes del año ${year}.`}
      onClose={onClose}
      hideSubmit
      hideCancel
      modalClassName="contable-summary-detail-modal"
      closeOnBackdrop={false}
      wide
    >
      <SummaryCards
        title=""
        ariaLabel={`Totales contables del año ${year}`}
        variant="dashboard"
        className="contable-summary-detail-cards"
        items={[
          {
            key: "detail-income",
            icon: faArrowTrendUp,
            label: "Ingresos",
            value: money(totals.ingresos),
            detail: `Acumulado del año ${year}`,
            tone: "success",
          },
          {
            key: "detail-expenses",
            icon: faArrowTrendDown,
            label: "Egresos",
            value: money(totals.egresos),
            detail: `Acumulado del año ${year}`,
            tone: "danger",
          },
          {
            key: "detail-result",
            icon: faMoneyBillTransfer,
            label: "Resultado",
            value: money(totals.resultado),
            detail:
              totals.resultado >= 0 ? "Balance positivo" : "Balance negativo",
            tone: totals.resultado >= 0 ? "balance" : "danger",
          },
        ]}
      />

      <GlobalDivTable
        className="contable-summary-detail-table"
        bodyClassName="contable-summary-detail-table__body"
        gridClassName="contable-summary-detail-grid"
        columns={[
          "Mes",
          { label: "Ingresos", align: "right" },
          { label: "Egresos", align: "right" },
          { label: "Resultado", align: "right" },
        ]}
        skeletonActionColumn={false}
        ariaLabel={`Detalle mensual contable del año ${year}`}
      >
        {monthlyRows.map((item) => (
          <div
            className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row contable-summary-detail-grid ${Number(summary?.mes_seleccionado) === item.mes ? "is-selected-month" : ""}`.trim()}
            role="row"
            key={item.mes}
          >
            <div className="mov-gridCell entity-main-cell">
              <strong>{item.nombre}</strong>
              <small>{year}</small>
            </div>
            <div className="mov-gridCell is-right contable-money-cell contable-money-cell--income">
              {money(item.ingresos)}
            </div>
            <div className="mov-gridCell is-right contable-money-cell contable-money-cell--expense">
              {money(item.egresos)}
            </div>
            <div
              className={`mov-gridCell is-right is-strong contable-money-cell ${item.resultado >= 0 ? "ct-positive" : "ct-negative"}`}
            >
              {money(item.resultado)}
            </div>
          </div>
        ))}

      </GlobalDivTable>
    </CrudModal>
  );
}

export default function ContableModule({ view = "summary" }) {
  const compactActions = useCompactModuleActions();
  const writable = canWrite();

  const [catalogs, setCatalogs] = useState(emptyCatalogs);
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [month, setMonth] = useState(String(CURRENT_MONTH));
  const [summaryMode, setSummaryMode] = useState("annual");
  const [incomeTab, setIncomeTab] = useState("partners");
  const isFeeIncomeTab = incomeTab === "partners" || incomeTab === "companies";
  const feeEntityType = incomeTab === "companies" ? "EMPRESA" : "PERSONA";
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [mean, setMean] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], resumen: {} });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState(null);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [incomeForm, setIncomeForm] = useState(emptyIncomeForm());
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseFormTab, setExpenseFormTab] = useState("movement");
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm());
  const [saving, setSaving] = useState(false);
  const [optionModal, setOptionModal] = useState(null);
  const [optionName, setOptionName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [summaryDetailOpen, setSummaryDetailOpen] = useState(false);
  const requestId = useRef(0);
  const tableBodyRef = useRef(null);
  const pendingTableScrollRef = useRef(null);
  const expenseFileInputRef = useRef(null);

  const loadCatalogs = useCallback(async () => {
    const response = await contableApi.catalogos();
    setCatalogs({
      ...emptyCatalogs,
      ...response,
      opciones: { ...emptyCatalogs.opciones, ...(response.opciones || {}) },
    });
    return response;
  }, []);

  useEffect(() => {
    loadCatalogs().catch((error) =>
      setFeedback({ type: "error", message: error.message }),
    );
  }, [loadCatalogs]);

  useEffect(() => {
    pendingTableScrollRef.current = null;
    setCategory("");
    setMean("");
    setSearch("");
    setPage(1);
    // Evita mostrar datos de la pestaña anterior mientras se carga la nueva.
    // También evita mezclar filas de socios, empresas y otros ingresos al cambiar de pestaña.
    setData({ items: [], resumen: {} });
  }, [view, incomeTab]);

  useEffect(() => {
    pendingTableScrollRef.current = null;
    setPage(1);
  }, [year, month, search, category, mean]);

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      if (view === "summary") {
        const response = await contableApi.resumen({ anio: year, mes: month });
        if (requestId.current === currentRequest)
          setSummary(response.resumen || null);
      } else {
        const filters = {
          anio: year,
          mes: month,
          buscar: search,
          categoria: category,
          medio: mean,
        };
        let response;
        if (view === "income" && isFeeIncomeTab)
          response = await contableApi.ingresosSocios({
            ...filters,
            tipo: feeEntityType,
          });
        else if (view === "income")
          response = await contableApi.ingresos(filters);
        else response = await contableApi.egresos(filters);
        if (requestId.current === currentRequest)
          setData({
            items: response.items || [],
            resumen: response.resumen || {},
          });
      }
    } catch (error) {
      if (requestId.current === currentRequest)
        setFeedback({ type: "error", message: error.message });
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [
    view,
    incomeTab,
    isFeeIncomeTab,
    feeEntityType,
    year,
    month,
    search,
    category,
    mean,
  ]);

  const refreshKeepingTableScroll = useCallback(async () => {
    pendingTableScrollRef.current = tableBodyRef.current?.scrollTop || 0;
    return loadData();
  }, [loadData]);

  useEffect(() => {
    const timer = window.setTimeout(loadData, search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [loadData, search]);

  useEffect(() => {
    if (loading || pendingTableScrollRef.current == null) return undefined;

    const scrollTop = pendingTableScrollRef.current;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const body = tableBodyRef.current;
        if (body) {
          const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
          body.scrollTop = Math.min(scrollTop, maxScrollTop);
        }
        pendingTableScrollRef.current = null;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [loading, data.items?.length]);

  const requestOption = (type, label, onCreated) => {
    setOptionName("");
    setOptionModal({ type, label, onCreated });
  };

  const saveOption = async (event) => {
    event.preventDefault();
    if (!optionModal) return;

    const sanitizedName = sanitizeOptionName(optionModal.type, optionName).trim();
    if (!sanitizedName) {
      setFeedback({
        type: "error",
        message: "Ingresá un nombre válido para la opción.",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await contableApi.guardarOpcion({
        tipo: optionModal.type,
        nombre: sanitizedName,
      });
      await loadCatalogs();
      optionModal.onCreated(String(response.item.id_opcion));
      setOptionModal(null);
      setFeedback({ type: "success", message: response.mensaje });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const openIncome = (item = null) => {
    setIncomeForm(
      item
        ? {
            id_ingreso: String(item.id_ingreso),
            fecha: item.fecha,
            id_medio_pago: item.id_medio_pago ? String(item.id_medio_pago) : "",
            id_proveedor: item.id_proveedor ? String(item.id_proveedor) : "",
            id_categoria: item.id_categoria ? String(item.id_categoria) : "",
            id_concepto: item.id_concepto ? String(item.id_concepto) : "",
            importe: String(item.importe),
            detalle: item.detalle || "",
          }
        : emptyIncomeForm(),
    );
    setIncomeOpen(true);
  };

  const saveIncome = async (event) => {
    event.preventDefault();

    const sanitizedIncomeForm = {
      ...incomeForm,
      importe: decimalInput(incomeForm.importe),
      detalle: upper(incomeForm.detalle),
    };

    if (!(Number(sanitizedIncomeForm.importe) > 0)) {
      setFeedback({
        type: "error",
        message: "Ingresá un importe válido mayor a cero.",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await contableApi.guardarIngreso(sanitizedIncomeForm);
      setIncomeOpen(false);
      setFeedback({ type: "success", message: response.mensaje });
      await Promise.all([refreshKeepingTableScroll(), loadCatalogs()]);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const openExpense = (item = null) => {
    setExpenseForm(
      item
        ? {
            id_egreso: String(item.id_egreso),
            fecha: item.fecha,
            id_medio_pago: item.id_medio_pago ? String(item.id_medio_pago) : "",
            id_proveedor: item.id_proveedor ? String(item.id_proveedor) : "",
            id_categoria: item.id_categoria ? String(item.id_categoria) : "",
            id_concepto: item.id_concepto ? String(item.id_concepto) : "",
            numero_comprobante: item.numero_comprobante || "",
            importe: String(item.importe),
            detalle: item.detalle || "",
            archivo: null,
            archivo_nombre: item.archivo_nombre || "",
            eliminar_archivo: false,
          }
        : emptyExpenseForm(),
    );
    setExpenseFormTab("movement");
    setExpenseOpen(true);
  };

  const clearExpenseFileInput = () => {
    if (expenseFileInputRef.current) {
      expenseFileInputRef.current.value = "";
    }
  };

  const chooseFile = (file) => {
    if (!file) return;
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    if (!allowed.includes(file.type)) {
      setFeedback({
        type: "error",
        message: "Solo se permiten PDF, JPG, PNG, GIF o WEBP.",
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFeedback({
        type: "error",
        message: "El archivo no puede superar los 10 MB.",
      });
      return;
    }
    setExpenseForm((current) => ({
      ...current,
      archivo: file,
      archivo_nombre: file.name,
      eliminar_archivo: false,
    }));
  };

  const saveExpense = async (event) => {
    event.preventDefault();

    const sanitizedExpenseForm = {
      ...expenseForm,
      importe: decimalInput(expenseForm.importe),
      numero_comprobante: upper(expenseForm.numero_comprobante),
      detalle: upper(expenseForm.detalle),
    };

    if (
      !sanitizedExpenseForm.fecha ||
      !sanitizedExpenseForm.id_medio_pago ||
      !sanitizedExpenseForm.id_proveedor ||
      !sanitizedExpenseForm.id_categoria ||
      !sanitizedExpenseForm.id_concepto ||
      Number(sanitizedExpenseForm.importe) <= 0
    ) {
      setExpenseFormTab("movement");
      setFeedback({
        type: "error",
        message: "Completá los datos obligatorios del egreso.",
      });
      return;
    }
    setSaving(true);
    const formData = new FormData();
    Object.entries(sanitizedExpenseForm).forEach(([key, value]) => {
      if (key === "archivo") return;
      formData.append(
        key,
        typeof value === "boolean" ? (value ? "1" : "0") : (value ?? ""),
      );
    });
    if (sanitizedExpenseForm.archivo)
      formData.append("archivo", sanitizedExpenseForm.archivo);
    try {
      const response = await contableApi.guardarEgreso(formData);
      setExpenseOpen(false);
      setFeedback({ type: "success", message: response.mensaje });
      await Promise.all([refreshKeepingTableScroll(), loadCatalogs()]);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return { ok: false };
    const response =
      deleteTarget.type === "income"
        ? await contableApi.eliminarIngreso(deleteTarget.item.id_ingreso)
        : await contableApi.eliminarEgreso(deleteTarget.item.id_egreso);
    await Promise.all([refreshKeepingTableScroll(), loadCatalogs()]);
    setDeleteTarget(null);
    return response;
  };

  const viewFile = async (item) => {
    const popup = window.open("", "_blank");
    if (popup) {
      popup.document.title = "Comprobante";
      popup.document.body.innerHTML =
        '<p style="font-family:Arial,sans-serif;padding:24px">Cargando comprobante...</p>';
    }

    try {
      const blob = await contableApi.archivoEgreso(item.id_egreso);
      const url = URL.createObjectURL(blob);
      const isImage = /^image\//i.test(String(blob.type || ""));
      const preview = isImage
        ? `<img src="${url}" alt="Comprobante" style="display:block;max-width:100%;max-height:100vh;margin:auto;object-fit:contain" />`
        : `<iframe title="Vista previa del comprobante" src="${url}" style="width:100%;height:100vh;border:0" allow="fullscreen"></iframe>`;

      if (popup && !popup.closed) {
        popup.document.open();
        popup.document.write(`<!doctype html>
          <html lang="es">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width,initial-scale=1" />
              <title>Comprobante</title>
              <style>html,body{width:100%;height:100%;margin:0;background:#f5f5f5;overflow:auto}</style>
            </head>
            <body>${preview}</body>
          </html>`);
        popup.document.close();
        popup.focus?.();
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 300000);
    } catch (error) {
      popup?.close();
      setFeedback({ type: "error", message: error.message });
    }
  };

  const categoryOptions = useMemo(() => {
    if (view === "income" && isFeeIncomeTab)
      return catalogs.categorias_socios || [];
    if (view === "income") return catalogs.opciones.CATEGORIA_INGRESO || [];
    return catalogs.opciones.CATEGORIA_EGRESO || [];
  }, [catalogs, view, isFeeIncomeTab]);

  const accountingYears = useMemo(() => {
    const values = Array.isArray(catalogs.anios) ? catalogs.anios : [];
    return Array.from(
      new Set(
        [CURRENT_YEAR, ...values]
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item >= 2000 && item <= 2100),
      ),
    ).sort((a, b) => b - a);
  }, [catalogs.anios]);

  useEffect(() => {
    if (!accountingYears.length) return;
    const selected = Number(year);
    if (accountingYears.includes(selected)) return;
    setYear(String(accountingYears[0]));
  }, [accountingYears, year]);

  const exportConfig = useMemo(() => {
    const items = data.items || [];

    if (view === "income" && isFeeIncomeTab) {
      const isCompanyIncome = incomeTab === "companies";
      return {
        title: isCompanyIncome
          ? "Exportar ingresos de empresas"
          : "Exportar ingresos de socios",
        fileTitle: isCompanyIncome ? "Ingresos de empresas" : "Ingresos de socios",
        fileName: `${isCompanyIncome ? "ingresos_empresas" : "ingresos_socios"}_${year}_${month}`,
        columns: [
          { label: "Fecha de cobro", value: (item) => formatDate(item.fecha) },
          { label: isCompanyIncome ? "Empresa" : "Socio", key: "socio" },
          {
            label: isCompanyIncome ? "CUIT" : "DNI",
            value: (item) => item.documento || item.dni || "",
          },
          { label: "Categoría", key: "categoria" },
          { label: "Período pagado", key: "periodo" },
          { label: "Medio", key: "medio" },
          { label: "Monto", key: "monto" },
          {
            label: "Tipo de importe",
            value: (item) => item.monto_estimado ? "ESTIMADO" : "REGISTRADO",
          },
        ],
        records: items,
      };
    }

    if (view === "income") {
      return {
        title: "Exportar otros ingresos",
        fileTitle: "Otros ingresos",
        fileName: `otros_ingresos_${year}_${month}`,
        columns: [
          { label: "Fecha", value: (item) => formatDate(item.fecha) },
          { label: "Proveedor / Persona", key: "proveedor" },
          { label: "Categoría", key: "categoria" },
          { label: "Concepto", key: "concepto" },
          { label: "Medio", key: "medio" },
          { label: "Detalle", value: (item) => item.detalle || "" },
          { label: "Importe", key: "importe" },
        ],
        records: items,
      };
    }

    return {
      title: "Exportar egresos",
      fileTitle: "Egresos",
      fileName: `egresos_${year}_${month}`,
      columns: [
        { label: "Proveedor", key: "proveedor" },
        { label: "Categoría", key: "categoria" },
        { label: "Fecha", value: (item) => formatDate(item.fecha) },
        {
          label: "N.º comprobante",
          value: (item) => item.numero_comprobante || "",
        },
        { label: "Concepto", key: "concepto" },
        { label: "Medio", key: "medio" },
        { label: "Detalle", value: (item) => item.detalle || "" },
        { label: "Importe", key: "importe" },
      ],
      records: items,
    };
  }, [data.items, incomeTab, isFeeIncomeTab, month, view, year]);

  const totalRecords = data.items?.length || 0;
  const totalPages = totalRecords
    ? Math.ceil(totalRecords / PAGE_SIZE)
    : 0;
  const pageOptions = useMemo(
    () => paginationItems(page, totalPages),
    [page, totalPages],
  );
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return (data.items || []).slice(start, start + PAGE_SIZE);
  }, [data.items, page]);
  const firstVisibleRecord = totalRecords ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastVisibleRecord = totalRecords
    ? Math.min(page * PAGE_SIZE, totalRecords)
    : 0;

  useEffect(() => {
    if (page <= 1 || totalPages === 0 || page <= totalPages) return;
    setPage(totalPages);
  }, [page, totalPages]);

  const periodFilters = [
    {
      key: "anio",
      label: "Año",
      type: "select",
      className: "contable-filter--year",
      value: year,
      onChange: setYear,
      includeEmptyOption: false,
      options: accountingYears.map((item) => ({
        value: String(item),
        label: String(item),
      })),
    },
    {
      key: "mes",
      label: "Mes",
      type: "select",
      className: "contable-filter--month",
      value: month,
      onChange: setMonth,
      includeEmptyOption: false,
      options: MONTHS.map((name, index) => ({
        value: String(index + 1),
        label: name,
      })),
    },
  ];
  const detailFilters = [
    {
      key: "buscar",
      label: "Búsqueda",
      type: "search",
      placeholder: " ",
      value: search,
      onChange: setSearch,
    },
    ...periodFilters,
    {
      key: "categoria",
      label: "Categoría",
      type: "select",
      className: "contable-filter--category",
      placeholder: "Todas",
      value: category,
      onChange: setCategory,
      options: categoryOptions.map((item) => ({
        value: item.id_categoria ?? item.id_opcion,
        label: item.nombre,
      })),
    },
    {
      key: "medio",
      label: "Medio de pago",
      type: "select",
      className: "contable-filter--payment",
      placeholder: "Todos",
      value: mean,
      onChange: setMean,
      options: catalogs.medios_pago.map((item) => ({
        value: item.id_medio_pago,
        label: item.nombre,
      })),
    },
  ];
  const pageFilters =
    view === "summary"
      ? [
          {
            key: "modo",
            label: "Vista del resumen",
            type: "tabs",
            value: summaryMode,
            onChange: setSummaryMode,
            options: [
              { value: "annual", label: "Anual" },
              { value: "monthly", label: "Mensual" },
            ],
          },
          periodFilters[0],
          ...(summaryMode === "monthly" ? [periodFilters[1]] : []),
        ]
      : view === "income"
        ? [
            {
              key: "tipo-ingreso",
              label: "Tipo de ingreso",
              type: "tabs",
              value: incomeTab,
              onChange: setIncomeTab,
              options: [
                { value: "partners", label: "Socios" },
                { value: "companies", label: "Empresas" },
                { value: "manual", label: "Otros ingresos" },
              ],
            },
            ...detailFilters,
          ]
        : detailFilters;
  const canCreateMovement =
    writable &&
    ((view === "income" && incomeTab === "manual") || view === "expense");
  const openMovement =
    view === "income"
      ? () => openIncome()
      : view === "expense"
        ? () => openExpense()
        : undefined;
  const tableColumns =
    view === "income" && isFeeIncomeTab
      ? [
          incomeTab === "companies" ? "Empresa" : "Socio",
          "Fecha de cobro",
          "Período pagado",
          "Medio",
          { label: "Monto", align: "right" },
        ]
      : view === "income"
        ? [
            "Persona / Proveedor",
            "Fecha",
            "Medio",
            "Descripción / concepto",
            { label: "Importe", align: "right" },
            ...(writable ? ["Acciones"] : []),
          ]
        : [
            "Proveedor",
            "Fecha",
            "N.º comprobante",
            "Descripción",
            "Medio",
            { label: "Monto", align: "right" },
            "Acciones",
          ];
  const tableGridClassName =
    view === "income" && isFeeIncomeTab
      ? "contable-grid contable-grid--partners"
      : view === "income"
        ? `contable-grid ${writable ? "contable-grid--income" : "contable-grid--income-readonly"}`
        : "contable-grid contable-grid--expense";
  const selectedSummaryMonth = (summary?.meses || []).find(
    (item) => Number(item.mes) === Number(summary?.mes_seleccionado),
  );
  const summaryVisibleTotals =
    summaryMode === "monthly"
      ? summary?.totales_mes || selectedSummaryMonth || {}
      : summary?.totales || {};
  const summaryEstimatedPayments = Number(
    summaryVisibleTotals.pagos_estimados || 0,
  );
  const summaryEstimateMessage = `${summaryEstimatedPayments} cobro${
    summaryEstimatedPayments === 1
      ? " histórico tiene"
      : "s históricos tienen"
  } el importe estimado según la cuota de su categoría porque la base anterior no guardó el monto exacto.`;

  return (
    <>
      <ModulePage
        title={
          view === "summary" ? (
            <span className="ct-page-title">
              <span>Resumen contable</span>
              {!loading && summaryEstimatedPayments > 0 ? (
                <span className="ct-estimate-help">
                  <button
                    className="ct-estimate-help__button"
                    type="button"
                    aria-label={summaryEstimateMessage}
                    aria-describedby="ct-estimate-tooltip"
                  >
                    <FontAwesomeIcon icon={faCircleInfo} />
                  </button>
                  <span
                    className="ct-estimate-tooltip"
                    id="ct-estimate-tooltip"
                    role="tooltip"
                  >
                    {summaryEstimateMessage}
                  </span>
                </span>
              ) : null}
            </span>
          ) : view === "income" ? (
            "Ingresos"
          ) : (
            "Egresos"
          )
        }
        description={
          view === "expense" ? "Administración de gastos" : undefined
        }
        filters={pageFilters}
        tabsInTitle={view === "summary" || view === "income"}
        headFiltersClassName="contable-head-filters"
        primaryActionLabel={
          view === "income" ? "Registrar ingreso" : "Registrar egreso"
        }
        onPrimaryAction={openMovement}
        canCreate={canCreateMovement}
        primaryActionClassName={canCreateMovement ? "contable-create-top" : ""}
        headerActions={
          view === "summary" ? (
            <button
              className="mov-btn mov-btn--primary contable-summary-detail-btn"
              type="button"
              onClick={() => setSummaryDetailOpen(true)}
              disabled={loading || !summary}
            >
              <FontAwesomeIcon icon={faList} />
              Detalle
            </button>
          ) : !compactActions ? (
            <BotonExportarGlobal
              className="contable-export-top"
              onClick={() => setExportOpen(true)}
              disabled={!data.items?.length}
            />
          ) : null
        }
        notice={
          !writable
            ? "Tu usuario tiene permiso de consulta. Las modificaciones están deshabilitadas."
            : null
        }
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message}
          onClose={() => setFeedback(null)}
        />

        {view === "summary" ? (
          <SummaryView summary={summary} loading={loading} mode={summaryMode} />
        ) : (
          <div className="contable-table">
            <GlobalDivTable
              className={`contable-table__data ${totalRecords > 0 || compactActions ? "has-bottom-pagination" : ""}`.trim()}
              bodyClassName="entity-table-wrap"
              bodyRef={tableBodyRef}
              gridClassName={tableGridClassName}
              columns={tableColumns}
              loading={loading}
              loadingLabel="Cargando movimientos contables..."
              skeletonActionColumn={
                view === "income"
                  ? incomeTab === "manual" && writable
                  : true
              }
              ariaLabel={
                view === "income" ? "Listado de ingresos" : "Listado de egresos"
              }
            >
              {view === "income" && isFeeIncomeTab ? (
                <>
                  {!data.items?.length ? (
                    <EmptyState
                      message={
                        incomeTab === "companies"
                          ? "No hubo cobros de empresas en el mes seleccionado."
                          : "No hubo cobros de socios en el mes seleccionado."
                      }
                    />
                  ) : null}
                  {paginatedItems.map((item, index) => (
                    <div
                      className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row contable-grid contable-grid--partners"
                      role="row"
                      key={
                        item.clave ||
                        `${item.origen || "COBRO"}-${item.id_registro || index}`
                      }
                    >
                      <div className="mov-gridCell entity-main-cell">
                        <strong>{item.socio}</strong>
                        <small>
                          {incomeTab === "companies" ? "CUIT" : "DNI"}: {item.documento || item.dni || "—"}
                          {" · "}
                          Categoría: {item.categoria || "Sin categoría"}
                        </small>
                      </div>
                      <div className="mov-gridCell is-center">
                        {formatDate(item.fecha)}
                      </div>
                      <div className="mov-gridCell is-center">
                        {item.periodo}
                      </div>
                      <div className="mov-gridCell is-center">{item.medio}</div>
                      <div className="mov-gridCell is-right is-strong contable-money-cell">
                        <strong>{money(item.monto)}</strong>
                        {item.monto_estimado ? (
                          <small className="contable-estimated">
                            Importe histórico estimado
                          </small>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </>
              ) : null}

              {view === "income" && incomeTab === "manual" ? (
                <>
                  {!data.items?.length ? (
                    <EmptyState message="No hay otros ingresos registrados en el mes." />
                  ) : null}
                  {paginatedItems.map((item) => (
                    <div
                      className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row contable-grid ${writable ? "contable-grid--income" : "contable-grid--income-readonly"}`}
                      role="row"
                      key={item.id_ingreso}
                    >
                      <div className="mov-gridCell entity-main-cell">
                        <strong>{item.proveedor || "—"}</strong>
                        <small>Categoría: {item.categoria || "—"}</small>
                      </div>
                      <div className="mov-gridCell is-center">
                        {formatDate(item.fecha)}
                      </div>
                      <div className="mov-gridCell is-center">{item.medio}</div>
                      <div className="mov-gridCell entity-main-cell">
                        <strong>{item.concepto || "—"}</strong>
                        {item.detalle ? <small>{item.detalle}</small> : null}
                      </div>
                      <div className="mov-gridCell is-right is-strong contable-money-cell">
                        {money(item.importe)}
                      </div>
                      {writable ? (
                        <div className="mov-gridCell mov-gridCell--actions">
                          <div className="mov-actionsInline">
                            <button
                              className="mov-iconBtn"
                              type="button"
                              onClick={() => openIncome(item)}
                              title="Editar"
                            >
                              <FontAwesomeIcon icon={faPen} />
                            </button>
                            <button
                              className="mov-iconBtn mov-iconBtn--danger"
                              type="button"
                              onClick={() =>
                                setDeleteTarget({ type: "income", item })
                              }
                              title="Anular"
                            >
                              <FontAwesomeIcon icon={faTrashCan} />
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </>
              ) : null}

              {view === "expense" ? (
                <>
                  {!data.items?.length ? (
                    <EmptyState message="No hay egresos registrados en el mes." />
                  ) : null}
                  {paginatedItems.map((item) => (
                    <div
                      className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row contable-grid contable-grid--expense"
                      role="row"
                      key={item.id_egreso}
                    >
                      <div className="mov-gridCell entity-main-cell">
                        <strong>{item.proveedor || "—"}</strong>
                        <small>Categoría: {item.categoria || "—"}</small>
                      </div>
                      <div className="mov-gridCell is-center">
                        {formatDate(item.fecha)}
                      </div>
                      <div className="mov-gridCell is-center">
                        {item.numero_comprobante || "—"}
                      </div>
                      <div className="mov-gridCell entity-main-cell">
                        <strong>{item.concepto || "—"}</strong>
                        {item.detalle ? <small>{item.detalle}</small> : null}
                      </div>
                      <div className="mov-gridCell is-center">{item.medio}</div>
                      <div className="mov-gridCell is-right is-strong contable-money-cell">
                        {money(item.importe)}
                      </div>
                      <div className="mov-gridCell mov-gridCell--actions">
                        <div className="mov-actionsInline">
                          <button
                            className="mov-iconBtn"
                            type="button"
                            onClick={() => viewFile(item)}
                            disabled={!item.tiene_archivo}
                            title={
                              item.tiene_archivo
                                ? "Ver comprobante"
                                : "Sin comprobante"
                            }
                          >
                            <FontAwesomeIcon icon={faEye} />
                          </button>
                          {writable ? (
                            <>
                              <button
                                className="mov-iconBtn"
                                type="button"
                                onClick={() => openExpense(item)}
                                title="Editar"
                              >
                                <FontAwesomeIcon icon={faPen} />
                              </button>
                              <button
                                className="mov-iconBtn mov-iconBtn--danger"
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({ type: "expense", item })
                                }
                                title="Anular"
                              >
                                <FontAwesomeIcon icon={faTrashCan} />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : null}
            </GlobalDivTable>

            {totalRecords > 0 || compactActions ? (
              <nav
                className="global-pagination"
                aria-label={
                  view === "income"
                    ? "Paginación de ingresos"
                    : "Paginación de egresos"
                }
              >
                <p className="global-pagination__summary">
                  {totalRecords > 0 ? (
                    <>
                      Mostrando <strong>{firstVisibleRecord}</strong>–
                      <strong>{lastVisibleRecord}</strong> de{" "}
                      <strong>{totalRecords}</strong> registros
                    </>
                  ) : (
                    <>
                      <strong>0</strong> registros
                    </>
                  )}
                </p>

                <div className="global-pagination__right">
                  {totalRecords > 0 ? (
                    <div className="global-pagination__controls">
                      <button
                        type="button"
                        onClick={() =>
                          setPage((current) => Math.max(1, current - 1))
                        }
                        disabled={loading || page <= 1}
                      >
                        Anterior
                      </button>

                      {pageOptions.map((item) =>
                        typeof item === "number" ? (
                          <button
                            type="button"
                            key={item}
                            className={item === page ? "is-active" : ""}
                            aria-current={item === page ? "page" : undefined}
                            onClick={() => setPage(item)}
                            disabled={loading}
                          >
                            {item}
                          </button>
                        ) : (
                          <span
                            className="global-pagination__ellipsis"
                            key={item}
                            aria-hidden="true"
                          >
                            …
                          </span>
                        ),
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setPage((current) =>
                            Math.min(totalPages, current + 1),
                          )
                        }
                        disabled={
                          loading || totalPages === 0 || page >= totalPages
                        }
                      >
                        Siguiente
                      </button>
                    </div>
                  ) : null}

                  <div className="contable-lower-actions">
                    {compactActions ? (
                      <BotonExportarGlobal
                        className="mov-btn--compact"
                        onClick={() => setExportOpen(true)}
                        disabled={!data.items?.length}
                      />
                    ) : null}
                    {canCreateMovement ? (
                      <button
                        type="button"
                        className={
                          view === "expense"
                            ? "mov-btn contable-create-lower"
                            : "mov-btn mov-btn--primary"
                        }
                        onClick={openMovement}
                      >
                        <FontAwesomeIcon icon={faPlus} />
                        {view === "income"
                          ? "Registrar ingreso"
                          : "Registrar egreso"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </nav>
            ) : null}
          </div>
        )}
      </ModulePage>

      <SummaryDetailModal
        open={summaryDetailOpen}
        onClose={() => setSummaryDetailOpen(false)}
        summary={summary}
        year={year}
      />

      <CrudModal
        open={incomeOpen}
        title={incomeForm.id_ingreso ? "Editar ingreso" : "Registrar ingreso"}
        subtitle="Ingreso ajeno a cuotas o inscripciones de socios."
        onClose={() => setIncomeOpen(false)}
        onSubmit={saveIncome}
        saving={saving}
        submitLabel="Guardar ingreso"
        modalClassName="contable-modal"
        closeOnBackdrop={false}
        wide
      >
        <div className="entity-form contable-modal__form">
          <EntityFormPanel
            standalone
            eyebrow="Movimiento contable"
            title="Datos del ingreso"
            icon={faArrowTrendUp}
            tag="Campos obligatorios"
            bodyClassName="entity-form__grid"
          >
            <FloatingField label="Fecha *" active>
              <input
                type="date"
                required
                value={incomeForm.fecha}
                onChange={(event) =>
                  setIncomeForm((current) => ({
                    ...current,
                    fecha: event.target.value,
                  }))
                }
              />
            </FloatingField>
            <FloatingField label="Medio de pago *" active>
              <select
                required
                value={incomeForm.id_medio_pago}
                onChange={(event) =>
                  setIncomeForm((current) => ({
                    ...current,
                    id_medio_pago: event.target.value,
                  }))
                }
              >
                <option value="">SELECCIONE...</option>
                {catalogs.medios_pago.map((item) => (
                  <option key={item.id_medio_pago} value={item.id_medio_pago}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </FloatingField>
            <OptionSelect
              label="Persona / proveedor *"
              value={incomeForm.id_proveedor}
              options={catalogs.opciones.PROVEEDOR}
              optionType="PROVEEDOR"
              onChange={(value) =>
                setIncomeForm((current) => ({
                  ...current,
                  id_proveedor: value,
                }))
              }
              onRequestCreate={requestOption}
            />
            <OptionSelect
              label="Categoría *"
              value={incomeForm.id_categoria}
              options={catalogs.opciones.CATEGORIA_INGRESO}
              optionType="CATEGORIA_INGRESO"
              onChange={(value) =>
                setIncomeForm((current) => ({
                  ...current,
                  id_categoria: value,
                }))
              }
              onRequestCreate={requestOption}
            />
            <OptionSelect
              label="Descripción / concepto *"
              value={incomeForm.id_concepto}
              options={catalogs.opciones.CONCEPTO_INGRESO}
              optionType="CONCEPTO_INGRESO"
              onChange={(value) =>
                setIncomeForm((current) => ({ ...current, id_concepto: value }))
              }
              onRequestCreate={requestOption}
            />
            <FloatingField
              label="Importe (ARS) *"
              active={Boolean(incomeForm.importe)}
            >
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                onKeyDown={preventInvalidDecimalKey}
                required
                value={incomeForm.importe}
                placeholder=" "
                onChange={(event) =>
                  setIncomeForm((current) => ({
                    ...current,
                    importe: decimalInput(event.target.value),
                  }))
                }
              />
            </FloatingField>
            <FloatingField
              label="Detalle opcional"
              active={Boolean(incomeForm.detalle)}
              textarea
              wide
            >
              <textarea
                rows="3"
                maxLength="500"
                value={incomeForm.detalle}
                placeholder=" "
                onChange={(event) =>
                  setIncomeForm((current) => ({
                    ...current,
                    detalle: upper(event.target.value),
                  }))
                }
              />
            </FloatingField>
          </EntityFormPanel>
        </div>
      </CrudModal>

      <CrudModal
        open={expenseOpen}
        title={expenseForm.id_egreso ? "Editar egreso" : "Registrar egreso"}
        subtitle="Registrá el gasto y adjuntá su comprobante cuando corresponda."
        onClose={() => setExpenseOpen(false)}
        onSubmit={saveExpense}
        saving={saving}
        submitLabel="Guardar egreso"
        modalClassName="contable-modal contable-modal--expense"
        closeOnBackdrop={false}
        wide
      >
        <div className="entity-form contable-modal__form">
          <EntityTabs
            tabs={[
              {
                value: "movement",
                label: "Datos del egreso",
                icon: faFileInvoiceDollar,
              },
              {
                value: "receipt",
                label: "Comprobante",
                icon: faPaperclip,
                badge: expenseForm.archivo_nombre ? 1 : null,
              },
            ]}
            value={expenseFormTab}
            onChange={setExpenseFormTab}
            idPrefix="contable-expense-tab"
            ariaLabel="Secciones del egreso"
          />

          {expenseFormTab === "movement" ? (
            <EntityFormPanel
              tabValue="movement"
              idPrefix="contable-expense-tab"
              eyebrow="Movimiento contable"
              title="Datos del egreso"
              icon={faArrowTrendDown}
              tag="Campos obligatorios"
              bodyClassName="entity-form__grid"
            >
              <FloatingField label="Fecha *" active>
                <input
                  type="date"
                  required
                  value={expenseForm.fecha}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      fecha: event.target.value,
                    }))
                  }
                />
              </FloatingField>
              <FloatingField label="Medio de pago *" active>
                <select
                  required
                  value={expenseForm.id_medio_pago}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      id_medio_pago: event.target.value,
                    }))
                  }
                >
                  <option value="">SELECCIONE...</option>
                  {catalogs.medios_pago.map((item) => (
                    <option key={item.id_medio_pago} value={item.id_medio_pago}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </FloatingField>
              <OptionSelect
                label="Categoría *"
                value={expenseForm.id_categoria}
                options={catalogs.opciones.CATEGORIA_EGRESO}
                optionType="CATEGORIA_EGRESO"
                onChange={(value) =>
                  setExpenseForm((current) => ({
                    ...current,
                    id_categoria: value,
                  }))
                }
                onRequestCreate={requestOption}
              />
              <FloatingField
                label="N.º de comprobante"
                active={Boolean(expenseForm.numero_comprobante)}
              >
                <input
                  maxLength="120"
                  value={expenseForm.numero_comprobante}
                  placeholder=" "
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      numero_comprobante: upper(event.target.value),
                    }))
                  }
                />
              </FloatingField>
              <OptionSelect
                label="Proveedor *"
                value={expenseForm.id_proveedor}
                options={catalogs.opciones.PROVEEDOR}
                optionType="PROVEEDOR"
                onChange={(value) =>
                  setExpenseForm((current) => ({
                    ...current,
                    id_proveedor: value,
                  }))
                }
                onRequestCreate={requestOption}
              />
              <OptionSelect
                label="Descripción / concepto *"
                value={expenseForm.id_concepto}
                options={catalogs.opciones.CONCEPTO_EGRESO}
                optionType="CONCEPTO_EGRESO"
                onChange={(value) =>
                  setExpenseForm((current) => ({
                    ...current,
                    id_concepto: value,
                  }))
                }
                onRequestCreate={requestOption}
              />
              <FloatingField
                label="Importe (ARS) *"
                active={Boolean(expenseForm.importe)}
                wide
              >
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  onKeyDown={preventInvalidDecimalKey}
                  required
                  value={expenseForm.importe}
                  placeholder=" "
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      importe: decimalInput(event.target.value),
                    }))
                  }
                />
              </FloatingField>
              <FloatingField
                label="Detalle opcional"
                active={Boolean(expenseForm.detalle)}
                textarea
                wide
              >
                <textarea
                  rows="3"
                  maxLength="500"
                  value={expenseForm.detalle}
                  placeholder=" "
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      detalle: upper(event.target.value),
                    }))
                  }
                />
              </FloatingField>
            </EntityFormPanel>
          ) : (
            <EntityFormPanel
              tabValue="receipt"
              idPrefix="contable-expense-tab"
              eyebrow="Respaldo documental"
              title="Comprobante del egreso"
              icon={faPaperclip}
              tag="Opcional · máximo 10 MB"
              hint="Podés adjuntar PDF, JPG, PNG, GIF o WEBP. El archivo quedará asociado al movimiento."
            >
              <div
                className="contable-upload"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  chooseFile(event.dataTransfer.files?.[0]);
                }}
              >
                <span className="contable-upload__icon">
                  <FontAwesomeIcon icon={faPaperclip} />
                </span>
                <strong>
                  {expenseForm.archivo_nombre ||
                    "Adjuntar comprobante"}
                </strong>
                <span>Arrastrá una imagen o PDF, o elegí un archivo.</span>
                <label className="mov-btn mov-btn--ghost">
                  Elegir archivo
                  <input
                    ref={expenseFileInputRef}
                    type="file"
                    hidden
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                    onChange={(event) => chooseFile(event.target.files?.[0])}
                  />
                </label>
                {expenseForm.archivo_nombre ? (
                  <button
                    type="button"
                    className="mov-btn mov-btn--danger"
                    onClick={() => {
                      clearExpenseFileInput();
                      setExpenseForm((current) => ({
                        ...current,
                        archivo: null,
                        archivo_nombre: "",
                        eliminar_archivo: true,
                      }));
                    }}
                  >
                    Quitar comprobante
                  </button>
                ) : null}
              </div>
            </EntityFormPanel>
          )}
        </div>
      </CrudModal>

      <CrudModal
        open={Boolean(optionModal)}
        title={`Agregar ${optionModal?.label || "opción"}`}
        subtitle="La nueva opción quedará disponible inmediatamente en este selector."
        onClose={() => setOptionModal(null)}
        onSubmit={saveOption}
        saving={saving}
        submitLabel="Agregar opción"
        modalClassName="contable-option-modal"
        closeOnBackdrop={false}
      >
        <FloatingField label="Nombre *" active={Boolean(optionName)}>
          <input
            autoFocus
            required
            maxLength="160"
            value={optionName}
            onChange={(event) =>
              setOptionName(sanitizeOptionName(optionModal?.type, event.target.value))
            }
            placeholder=" "
          />
        </FloatingField>
      </CrudModal>


      <ModalExportarGlobal
        open={exportOpen}
        title={exportConfig.title}
        tituloArchivo={exportConfig.fileTitle}
        subtituloArchivoActual={`${MONTHS[Number(month) - 1] || ""} ${year}`}
        nombreArchivo={exportConfig.fileName}
        columnas={exportConfig.columns}
        registrosActuales={exportConfig.records}
        cantidadActual={exportConfig.records.length}
        mostrarAlcanceTodos={false}
        alcanceActualLabel="Exportar registros filtrados"
        alcanceActualDescription="Descarga todos los movimientos que coinciden con los filtros actuales."
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => setFeedback({ type: "success", message })}
        onError={(message) => setFeedback({ type: "error", message })}
      />
      <ModalEliminarGlobal
        open={Boolean(deleteTarget)}
        operacion="eliminar"
        row={deleteTarget?.item}
        title={
          deleteTarget?.type === "income" ? "Eliminar ingreso" : "Eliminar egreso"
        }
        message="El movimiento se eliminará definitivamente de Contabilidad. La acción quedará registrada en auditoría."
        warning="Esta acción no modifica cuotas ni cobros de socios."
        confirmLabel="Eliminar movimiento"
        successMessage="El movimiento se eliminó correctamente."
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        details={
          deleteTarget
            ? [
                { label: "Fecha", value: formatDate(deleteTarget.item.fecha) },
                { label: "Concepto", value: deleteTarget.item.concepto },
                { label: "Importe", value: money(deleteTarget.item.importe) },
              ]
            : []
        }
      />
    </>
  );
}
