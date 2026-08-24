import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBan,
  faBarcode,
  faCheck,
  faChevronDown,
  faDollarSign,
  faFilter,
  faPrint,
  faReceipt,
  faTimes,
  faUserGroup,
  faWallet,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../Global/ModulePage";
import GlobalDivTable from "../Global/GlobalDivTable";
import ModalEliminarGlobal from "../Global/Modales/ModalEliminarGlobal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import ModalComprobantePago from "../Global/Modales/ModalComprobantePago";
import ModuleFeedback from "../Global/ModuleFeedback";
import BotonExportarGlobal from "../Global/Botones/BotonExportarGlobal";
import Toast from "../Global/Toast";
import { canWrite } from "../_shared/auth/session";
import {
  downloadPaymentReceiptPdf,
  openPaymentReceipt,
  paymentReceiptHtml,
} from "../_shared/utils/comprobantePago";
import { cuotasApi } from "./api/cuotasApi";
import { useCuotas } from "./hooks/useCuotas";
import ModalPagoCuota from "./modales/ModalPagoCuota";
import ModalCodigoBarras from "./modales/ModalCodigoBarras";
import "./Cuotas.css";

const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const currentDate = new Date();
const currentYear = currentDate.getFullYear();
// RH Negativo cobra seis períodos bimestrales. El frontend base trabajaba
// con meses calendario; se conserva el nombre de la variable para no alterar
// el resto del flujo, pero su valor es el período vigente (1 a 6).
const currentMonth = Math.ceil((currentDate.getMonth() + 1) / 2);
const PAGE_SIZE = 100;
const BULK_SELECTION_PAGE_SIZE = 200;

const integerInput = (value, maxDigits = 10) =>
  String(value ?? "").replace(/[^0-9]/g, "").slice(0, maxDigits);

const decimalInput = (value, maxIntegerDigits = 12, maxDecimals = 2) => {
  const normalized = String(value ?? "")
    .replace(/,/g, ".")
    .replace(/[^0-9.]/g, "");
  const [rawInteger = "", ...decimalParts] = normalized.split(".");
  const integer = rawInteger.slice(0, maxIntegerDigits);
  if (!decimalParts.length) return integer;

  const decimals = decimalParts.join("").slice(0, maxDecimals);
  return `${integer || "0"}.${decimals}`;
};

const CUOTAS_EXPORT_COLUMNS = [
  { key: "denominacion", label: "Socio" },
  { key: "documento", label: "DNI" },
  { key: "categoria", label: "Categoría" },
  { key: "periodo", label: "Período" },
  { key: "estado_exportacion", label: "Estado" },
  { key: "fecha_pago", label: "Fecha" },
  { key: "medio_pago", label: "Medio de pago" },
  {
    key: "importe_exportacion",
    label: "Importe",
    align: "right",
  },
];

const DEFAULT_MONTHS = [
  { id_mes: 1, nombre: "PERÍODO 1 Y 2" },
  { id_mes: 2, nombre: "PERÍODO 3 Y 4" },
  { id_mes: 3, nombre: "PERÍODO 5 Y 6" },
  { id_mes: 4, nombre: "PERÍODO 7 Y 8" },
  { id_mes: 5, nombre: "PERÍODO 9 Y 10" },
  { id_mes: 6, nombre: "PERÍODO 11 Y 12" },
  { id_mes: 7, nombre: "CONTADO ANUAL" },
];

const paginationItems = (currentPage, totalPages) => {
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
};

const MONEY_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});
const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" });

const money = (value) => MONEY_FORMATTER.format(Number(value || 0));

const formatDate = (value) =>
  value ? DATE_FORMATTER.format(new Date(`${value}T00:00:00Z`)) : "—";

const collectorTone = (value) => {
  const name = String(value || "").trim();
  if (!name) return "is-empty";

  const hash = Array.from(name).reduce(
    (accumulator, character) => accumulator + character.charCodeAt(0),
    0,
  );

  return `is-tone-${(hash % 5) + 1}`;
};

const preferredAddress = (item = {}) => {
  const collectionAddress = String(item.domicilio_cobro || "").trim();
  if (collectionAddress) return collectionAddress;

  const regularAddress = String(
    item.domicilio || item.domicilio_2 || item.direccion || "",
  ).trim();
  return regularAddress || "—";
};

const isTruthyFlag = (value) =>
  value === true ||
  value === 1 ||
  ["1", "SI", "SÍ", "TRUE", "PAGADO"].includes(
    String(value || "")
      .trim()
      .toUpperCase(),
  );

const isPaidPrincipal = (principal) =>
  Boolean(principal?.id_pago) ||
  isTruthyFlag(principal?.pagado) ||
  isTruthyFlag(principal?.ya_pagado) ||
  String(principal?.estado || "").toUpperCase() === "PAGADO";

const isUnavailablePrincipal = (principal) =>
  !principal ||
  principal.puede_pagar === false ||
  principal.puede_pagar === 0 ||
  principal.puede_pagar === "0" ||
  principal.disponible === false;

const isAnnualPaymentAvailable = (periodMap, options = DEFAULT_MONTHS) => {
  const bimonthlyIds = options
    .map((item) => String(item.id_mes ?? item.id_periodo ?? ""))
    .filter((id) => Number(id) >= 1 && Number(id) <= 6);

  return (
    bimonthlyIds.length === 6 &&
    bimonthlyIds.every((monthId) => {
      const period = periodMap[String(monthId)];
      return Boolean(period) && !period.paid && !period.unavailable;
    })
  );
};

const familyTargetsForMonths = (periodMap, monthIds) =>
  monthIds.reduce((targets, monthId) => {
    const context = periodMap[String(monthId)]?.context;
    const members = Array.isArray(context?.familia?.integrantes)
      ? context.familia.integrantes
      : [];

    members.forEach((member) => {
      if (member?.puede_pagar) {
        targets.push({
          id_socio: Number(member.id_socio),
          mes: Number(monthId),
          id_familia: Number(context.familia.id_familia),
          monto: Number(member.monto_sugerido || 0),
        });
      }
    });

    return targets;
  }, []);

const hasAdditionalFamilyTargets = (periodMap, monthIds) =>
  monthIds.some((monthId) => {
    const context = periodMap[String(monthId)]?.context;
    const principalId = Number(context?.principal?.id_socio || 0);
    const members = Array.isArray(context?.familia?.integrantes)
      ? context.familia.integrantes
      : [];
    return members.some(
      (member) =>
        member?.puede_pagar && Number(member.id_socio) !== principalId,
    );
  });

const selectionKey = (item) =>
  `${item.id_socio}-${item.anio || currentYear}-${item.mes || currentMonth}`;

const emptyForm = () => ({
  id_socio: "",
  anio: String(currentYear),
  mes: String(currentMonth),
  meses: [],
  fecha_pago: localToday(),
  monto: "",
  monto_inscripcion: "",
  montos_por_mes: {},
  id_medio_pago: "",
  aplicar_familia: false,
  pagos: [],
});

const defaultAmountOption = (principal) => {
  const options = Array.isArray(principal?.opciones_monto)
    ? principal.opciones_monto
    : [];
  // El backend marca como recomendado el importe que correspondía al período
  // aplicado. Para períodos actuales coincide con el vigente; para cuotas
  // retroactivas conserva categoría/precio históricos.
  return (
    options.find((option) => option.recomendado) ||
    options.find((option) => option.actual) ||
    options[0] ||
    null
  );
};

const currentBatchAmountOption = (item) => {
  const options = Array.isArray(item?.opciones_monto) ? item.opciones_monto : [];
  return (
    options.find((option) => option?.recomendado) ||
    options.find((option) => option?.actual) ||
    options[0] ||
    null
  );
};

const defaultMonthAmountState = (principal) => {
  const option = defaultAmountOption(principal);
  const fallback =
    option?.monto ??
    principal?.monto_sugerido ??
    principal?.monto_base ??
    "";
  return {
    personalizado: false,
    opcion_id: option?.id || "actual",
    monto: String(fallback ?? ""),
  };
};

const reconcileMonthAmountStates = (periodMap, previous = {}) =>
  Object.fromEntries(
    Object.entries(periodMap).map(([monthId, period]) => {
      const principal = period?.context?.principal || null;
      const options = Array.isArray(principal?.opciones_monto)
        ? principal.opciones_monto
        : [];
      const prior = previous?.[monthId];

      if (prior?.personalizado) {
        return [
          monthId,
          {
            personalizado: true,
            opcion_id: prior.opcion_id || defaultAmountOption(principal)?.id || "actual",
            monto: String(prior.monto ?? ""),
          },
        ];
      }

      const option =
        options.find((item) => String(item.id) === String(prior?.opcion_id)) ||
        defaultAmountOption(principal);

      return [
        monthId,
        {
          personalizado: false,
          opcion_id: option?.id || "actual",
          monto: String(
            option?.monto ??
              principal?.monto_sugerido ??
              principal?.monto_base ??
              "",
          ),
        },
      ];
    }),
  );

const enrichPaymentReceipt = (source, context = {}) => {
  if (!source || typeof source !== "object") return source || null;

  const operation =
    source.operacion && typeof source.operacion === "object"
      ? source.operacion
      : source;
  const sourceLines = Array.isArray(source.lineas)
    ? source.lineas
    : Array.isArray(operation.lineas)
      ? operation.lineas
      : [];
  const fallbackLines = Array.isArray(context.lineas) ? context.lineas : [];
  const lineas = (sourceLines.length ? sourceLines : fallbackLines).map(
    (line, index) => ({
      ...(fallbackLines[index] || {}),
      ...line,
      domicilio:
        line.domicilio ||
        line.domicilio_2 ||
        fallbackLines[index]?.domicilio ||
        context.domicilio ||
        "",
      cobrador:
        line.cobrador ||
        fallbackLines[index]?.cobrador ||
        context.cobrador ||
        "",
      medio_pago:
        line.medio_pago ||
        fallbackLines[index]?.medio_pago ||
        context.medio ||
        "",
      domicilio_cobro:
        line.domicilio_cobro ||
        fallbackLines[index]?.domicilio_cobro ||
        "",
      telefono_movil:
        line.telefono_movil || fallbackLines[index]?.telefono_movil || "",
      telefono_fijo:
        line.telefono_fijo || fallbackLines[index]?.telefono_fijo || "",
    }),
  );

  return {
    ...source,
    organizacion:
      source.organizacion ||
      operation.organizacion ||
      "CIRCULO Rh (-) · Asociación Civil",
    operacion: {
      ...operation,
      socios_label: operation.socios_label || context.socios || "—",
      domicilio:
        operation.domicilio ||
        operation.domicilio_2 ||
        context.domicilio ||
        "",
      cobrador: operation.cobrador || context.cobrador || "",
      medio_pago: operation.medio_pago || context.medio || "—",
      tipo_entidad: operation.tipo_entidad || context.tipoEntidad || "",
      cantidad_socios:
        Number(operation.cantidad_socios || context.cantidadSocios || 0) || undefined,
      cantidad_registros:
        Number(operation.cantidad_registros || context.cantidadRegistros || 0) ||
        lineas.length ||
        undefined,
      lineas,
    },
    lineas,
  };
};


function CuotasFilterSection({ title, active, children, onToggle }) {
  return (
    <section className={`cuotas-filterSection ${active ? "is-open" : ""}`.trim()}>
      <button type="button" className="cuotas-filterSection__head" onClick={onToggle}>
        <span>{title}</span>
        <FontAwesomeIcon icon={faChevronDown} />
      </button>
      {active ? <div className="cuotas-filterSection__body">{children}</div> : null}
    </section>
  );
}

function CuotasFilterChoices({ options, value, onChange }) {
  return (
    <div className="cuotas-filterChoices">
      {options.map((option) => {
        const selected = String(value || "") === String(option.value);
        return (
          <button
            type="button"
            key={option.value}
            className={selected ? "is-selected" : ""}
            onClick={() => onChange(selected ? "" : String(option.value))}
          >
            <span>{option.label}</span>
            {selected ? <FontAwesomeIcon icon={faCheck} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function findCuotasFilterLabel(items, value, valueKey) {
  return (
    (items || []).find((item) => String(item?.[valueKey]) === String(value))
      ?.nombre || String(value)
  );
}

function CuotasActiveFilterChips({ chips, onRemove }) {
  if (!chips.length) return null;

  return (
    <section className="cuotas-activeFilters" aria-label="Filtros activos">
      <div className="cuotas-activeFilters__list">
        {chips.map((chip) => (
          <span className="cuotas-activeFilterChip" key={chip.key}>
            <span>
              <strong>{chip.value}</strong>
            </span>
            <button
              type="button"
              onClick={() => onRemove(chip.key)}
              aria-label={`Eliminar filtro ${chip.label}: ${chip.value}`}
              title={`Eliminar filtro ${chip.label}`}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}

function CuotasAdvancedFilters({
  estadoPersona,
  cobrador,
  medioPago,
  catalogos,
  showPaymentMedium,
  onEstadoPersona,
  onCobrador,
  onMedioPago,
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("");
  const rootRef = useRef(null);
  const activeCount = [
    estadoPersona,
    cobrador,
    showPaymentMedium ? medioPago : "",
  ].filter((value) => String(value || "").trim()).length;

  useEffect(() => {
    if (!open) return undefined;

    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (key) => setSection((current) => (current === key ? "" : key));
  const reset = () => {
    onEstadoPersona("");
    onCobrador("");
    onMedioPago("");
    setSection("");
    setOpen(false);
  };

  return (
    <div className="cuotas-filterRoot" ref={rootRef}>
      <button
        type="button"
        className={`cuotas-filterTrigger ${open ? "is-open" : ""}`.trim()}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <FontAwesomeIcon icon={faFilter} />
        <span>Filtros</span>
        {activeCount ? <strong>{activeCount}</strong> : null}
        <FontAwesomeIcon icon={faChevronDown} className="cuotas-filterTrigger__arrow" />
      </button>

      {open ? (
        <div className="cuotas-filterMenu">
          <CuotasFilterSection
            title="Estado"
            active={section === "state"}
            onToggle={() => toggle("state")}
          >
            <CuotasFilterChoices
              options={(catalogos.estados || []).map((item) => ({
                value: item.id_estado,
                label: item.nombre,
              }))}
              value={estadoPersona}
              onChange={onEstadoPersona}
            />
          </CuotasFilterSection>

          <CuotasFilterSection
            title="Cobrador"
            active={section === "collector"}
            onToggle={() => toggle("collector")}
          >
            <CuotasFilterChoices
              options={(catalogos.cobradores || []).map((item) => ({
                value: item.id_cobrador,
                label: item.nombre,
              }))}
              value={cobrador}
              onChange={onCobrador}
            />
          </CuotasFilterSection>

          {showPaymentMedium ? (
            <CuotasFilterSection
              title="Medio de pago"
              active={section === "medium"}
              onToggle={() => toggle("medium")}
            >
              <CuotasFilterChoices
                options={(catalogos.medios_pago || []).map((item) => ({
                  value: item.id_medio_pago,
                  label: item.nombre,
                }))}
                value={medioPago}
                onChange={onMedioPago}
              />
            </CuotasFilterSection>
          ) : null}

          <button type="button" className="cuotas-filterReset" onClick={reset}>
            Mostrar Todos
          </button>
        </div>
      ) : null}
    </div>
  );
}

const CuotasTableRows = React.memo(function CuotasTableRows({
  items,
  selectedPayments,
  isResolved,
  isCondoned,
  multiMode,
  writable,
  tipo,
  debtRowClass,
  actionsRef,
}) {
  return items.map((item) => {
    const selected = Boolean(selectedPayments[selectionKey(item)]);
    const address = preferredAddress(item);
    return (
      <div
        className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row cuotas-grid ${isResolved ? "cuotas-grid--paid" : debtRowClass} ${selected ? "is-selected" : ""}`}
        role="row"
        key={item.id_pago || `${item.id_socio}-${item.anio}-${item.mes}`}
        onClick={(event) => actionsRef.current.selectRow(event, item)}
        onKeyDown={(event) => actionsRef.current.selectRowWithKeyboard(event, item)}
        tabIndex={!isResolved && multiMode && writable ? 0 : undefined}
        aria-selected={!isResolved && multiMode ? selected : undefined}
      >
        {!isResolved && multiMode ? (
          <div className="mov-gridCell cuotas-select-cell">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => actionsRef.current.toggleSelection(item)}
              aria-label={`Seleccionar cuota de ${item.denominacion}`}
            />
          </div>
        ) : null}
        <div className="mov-gridCell is-strong is-center cuotas-id-cell">
          {item.id_socio}
        </div>
        <div className="mov-gridCell entity-main-cell">
          <strong>{item.denominacion || "SIN DENOMINACIÓN"}</strong>
          <small>
            {[
              item.documento ? `DNI ${item.documento}` : null,
              item.familia || null,
              item.estado_socio === "INACTIVO" ? "REGISTRO DADO DE BAJA" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </div>
        <div
          className="mov-gridCell cuotas-address-cell"
          title={address === "—" ? undefined : address}
        >
          {address}
        </div>
        <div className="mov-gridCell is-center">
          <span
            className={`cuotas-person-state ${(() => {
              const estadoPersona = String(item.estado_persona || "")
                .trim()
                .toUpperCase();
              if (estadoPersona === "ACTIVO") return "is-active";
              if (
                estadoPersona.includes("PASIV") ||
                estadoPersona.includes("INACTIV") ||
                estadoPersona === "BAJA"
              ) {
                return "is-passive";
              }
              return "is-empty";
            })()}`}
          >
            {item.estado_persona || "—"}
          </span>
        </div>
        <div className="mov-gridCell is-center cuotas-collector-cell">
          <span className={`cuotas-collector-chip ${collectorTone(item.cobrador)}`}>
            {item.cobrador || "—"}
          </span>
        </div>
        <div className="mov-gridCell cuotas-money-cell">
          {isResolved ? (
            <>
              {money(item.monto)}
              {!isCondoned &&
              Number(item.id_periodo_pago || item.id_periodo || item.mes) === 7 ? (
                <small className="cuotas-annual-note">
                  CONTADO ANUAL {item.anio || ""}
                </small>
              ) : null}
            </>
          ) : Number(item.monto_sugerido || 0) > 0 ? (
            <>
              {money(item.monto_sugerido)}
              {Number(item.porcentaje_descuento_familiar || 0) > 0 ? (
                <small className="cuotas-discount-note">
                  Base {money(item.monto_base)}
                </small>
              ) : null}
            </>
          ) : (
            "A DEFINIR"
          )}
        </div>
        {!multiMode ? (
          <div className="mov-gridCell mov-gridCell--actions">
            <div className="mov-actionsInline">
              <button
                type="button"
                className="mov-iconBtn"
                title="Imprimir comprobante"
                aria-label={`Imprimir comprobante de ${item.denominacion}`}
                onClick={() => actionsRef.current.printPaymentRow(item)}
              >
                <FontAwesomeIcon icon={faPrint} />
              </button>
              {writable ? (
                isResolved ? (
                  <button
                    type="button"
                    className="mov-iconBtn mov-iconBtn--danger"
                    title={isCondoned ? "Eliminar condonación" : "Eliminar pago"}
                    aria-label={`${isCondoned ? "Eliminar condonación" : "Eliminar pago"} de ${item.denominacion}`}
                    onClick={() => actionsRef.current.setDeleteRow(item)}
                  >
                    <FontAwesomeIcon icon={faTimes} />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="mov-iconBtn cuotas-condone-btn"
                      title="Condonar cuota"
                      aria-label={`Condonar cuota de ${item.denominacion}`}
                      onClick={() => actionsRef.current.setCondoneRow(item)}
                    >
                      <FontAwesomeIcon icon={faBan} />
                    </button>
                    <button
                      type="button"
                      className="mov-iconBtn"
                      title="Registrar pago"
                      aria-label={`Registrar pago de ${item.denominacion}`}
                      onClick={() => actionsRef.current.openPayment(item)}
                    >
                      <FontAwesomeIcon icon={faDollarSign} />
                    </button>
                  </>
                )
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  });
});

export default function Cuotas() {
  const writable = canWrite();
  const contextRequestId = useRef(0);
  const rowActionsRef = useRef({});
  const tableBodyRef = useRef(null);
  const pendingTableScrollRef = useRef(null);
  const totalsRequestId = useRef(0);
  const tipo = "PERSONA";
  const [estado, setEstado] = useState("DEUDORES");
  const [estadoPersona, setEstadoPersona] = useState("");
  const [cobrador, setCobrador] = useState("");
  const [medioPago, setMedioPago] = useState("");
  const [buscarSocio, setBuscarSocio] = useState("");
  const [buscarId, setBuscarId] = useState("");
  const [debouncedBuscarSocio, setDebouncedBuscarSocio] = useState("");
  const [debouncedBuscarId, setDebouncedBuscarId] = useState("");
  const [anio, setAnio] = useState(String(currentYear));
  const [mes, setMes] = useState(String(currentMonth));
  const [pagina, setPagina] = useState(1);
  const [feedback, setFeedback] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState("single");
  const [paymentForm, setPaymentForm] = useState(emptyForm());
  const [paymentContext, setPaymentContext] = useState(null);
  const [registrationContext, setRegistrationContext] = useState(null);
  const [registrationDeleteRow, setRegistrationDeleteRow] = useState(null);
  const [paymentPeriods, setPaymentPeriods] = useState({});
  const [contextLoading, setContextLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [condoneRow, setCondoneRow] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [multiMode, setMultiMode] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState({});
  const [selectingFiltered, setSelectingFiltered] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [printingAll, setPrintingAll] = useState(false);
  const [estadoTotales, setEstadoTotales] = useState({
    DEUDORES: null,
    PAGADOS: null,
    CONDONADOS: null,
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedBuscarSocio(buscarSocio.trim());
      setDebouncedBuscarId(String(buscarId || "").replace(/^0+(?=\d)/, ""));
      setPagina(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [buscarSocio, buscarId]);

  const filtroBuscar = debouncedBuscarSocio.trim();
  const filtroIdSocio = debouncedBuscarId.trim();

  const filtros = useMemo(
    () => ({
      tipo,
      estado,
      estado_persona: estadoPersona,
      cobrador,
      medio_pago: medioPago,
      buscar: filtroBuscar,
      id_socio: filtroIdSocio,
      anio,
      mes,
      pagina,
      por_pagina: PAGE_SIZE,
    }),
    [
      tipo,
      estado,
      estadoPersona,
      cobrador,
      medioPago,
      filtroBuscar,
      filtroIdSocio,
      anio,
      mes,
      pagina,
    ],
  );
  const {
    items,
    catalogos,
    paginacion,
    loading,
    error,
    cargar,
    cargarCatalogos,
  } = useCuotas(filtros);

  const filtrosTotales = useMemo(
    () => ({
      tipo,
      estado_persona: estadoPersona,
      cobrador,
      medio_pago: medioPago,
      buscar: filtroBuscar,
      id_socio: filtroIdSocio,
      anio,
      mes,
    }),
    [
      tipo,
      estadoPersona,
      cobrador,
      medioPago,
      filtroBuscar,
      filtroIdSocio,
      anio,
      mes,
    ],
  );

  const cargarTotalesEstado = useCallback(async () => {
    const currentRequest = ++totalsRequestId.current;

    setEstadoTotales({
      DEUDORES: null,
      PAGADOS: null,
      CONDONADOS: null,
    });

    try {
      // Un único endpoint calcula los tres estados en una sola pasada. Antes
      // se ejecutaba cuotas_listar tres veces y se repetía toda la lógica de
      // socios/pagos/historia sólo para obtener estos contadores.
      const response = await cuotasApi.totalesEstado(filtrosTotales);
      if (currentRequest !== totalsRequestId.current) return;

      setEstadoTotales({
        DEUDORES: Number(response?.totales?.DEUDORES ?? 0),
        PAGADOS: Number(response?.totales?.PAGADOS ?? 0),
        CONDONADOS: Number(response?.totales?.CONDONADOS ?? 0),
      });
    } catch {
      if (currentRequest !== totalsRequestId.current) return;
      // Los contadores son informativos: la tabla principal debe continuar
      // funcionando aun si este resumen no estuviera disponible.
      setEstadoTotales({
        DEUDORES: null,
        PAGADOS: null,
        CONDONADOS: null,
      });
    }
  }, [filtrosTotales]);

  useEffect(() => {
    void cargarTotalesEstado();
    return () => {
      totalsRequestId.current += 1;
    };
  }, [cargarTotalesEstado]);

  const usaPaginacionRemota = Boolean(
    paginacion &&
      (paginacion.total != null ||
        paginacion.total_paginas != null ||
        paginacion.pagina != null),
  );
  const totalRegistros = usaPaginacionRemota
    ? Number(paginacion.total || 0)
    : items.length;
  const paginaRemota = Number(paginacion?.pagina || pagina);
  const porPaginaRemota = Number(paginacion?.por_pagina || PAGE_SIZE);
  const totalPaginas = usaPaginacionRemota
    ? Number(
        paginacion.total_paginas || Math.ceil(totalRegistros / porPaginaRemota),
      )
    : Math.ceil(items.length / PAGE_SIZE);
  const opcionesPagina = useMemo(
    () => paginationItems(pagina, totalPaginas),
    [pagina, totalPaginas],
  );
  const itemsPagina = useMemo(() => {
    if (usaPaginacionRemota) return items;
    const inicio = (pagina - 1) * PAGE_SIZE;
    return items.slice(inicio, inicio + PAGE_SIZE);
  }, [items, pagina, usaPaginacionRemota]);
  const registroDesde = usaPaginacionRemota
    ? Number(
        paginacion.desde ||
          (totalRegistros ? (paginaRemota - 1) * porPaginaRemota + 1 : 0),
      )
    : totalRegistros
      ? (pagina - 1) * PAGE_SIZE + 1
      : 0;
  const registroHasta = usaPaginacionRemota
    ? Number(
        paginacion.hasta ||
          Math.min(paginaRemota * porPaginaRemota, totalRegistros),
      )
    : Math.min(pagina * PAGE_SIZE, totalRegistros);

  useEffect(() => {
    setPagina(1);
  }, [
    tipo,
    estado,
    estadoPersona,
    cobrador,
    medioPago,
    debouncedBuscarSocio,
    debouncedBuscarId,
    anio,
    mes,
  ]);

  useEffect(() => {
    if (loading || pagina <= 1) return;
    if (totalPaginas === 0 || pagina > totalPaginas) {
      setPagina(Math.max(1, totalPaginas));
    }
  }, [loading, pagina, totalPaginas]);

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
  }, [loading, itemsPagina.length]);

  const visibleYearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (catalogos.anios?.length ? catalogos.anios : [currentYear])
            .filter(Boolean)
            .map(String),
        ),
      ).sort((left, right) => Number(right) - Number(left)),
    [catalogos.anios],
  );

  useEffect(() => {
    if (!catalogos.anios?.length || visibleYearOptions.includes(String(anio))) {
      return;
    }

    // Si se eliminó el último pago de un año futuro, ese año deja de ser
    // visible en Cuotas y volvemos automáticamente al año actual.
    setAnio(
      visibleYearOptions.includes(String(currentYear))
        ? String(currentYear)
        : visibleYearOptions[0] || String(currentYear),
    );
  }, [anio, catalogos.anios, visibleYearOptions]);

  const partners = catalogos.socios || [];
  const selectedPartner = partners.find(
    (partner) => String(partner.id_socio) === String(paymentForm.id_socio),
  );
  const monthOptions = catalogos.meses?.length
    ? catalogos.meses
    : DEFAULT_MONTHS;
  const isPaid = estado === "PAGADOS";
  const isCondoned = estado === "CONDONADOS";
  const isResolved = isPaid || isCondoned;
  const activeAdvancedFilters = useMemo(
    () =>
      [
        estadoPersona
          ? {
              key: "estadoPersona",
              label: "Estado",
              value: findCuotasFilterLabel(
                catalogos.estados,
                estadoPersona,
                "id_estado",
              ),
            }
          : null,
        cobrador
          ? {
              key: "cobrador",
              label: "Cobrador",
              value: findCuotasFilterLabel(
                catalogos.cobradores,
                cobrador,
                "id_cobrador",
              ),
            }
          : null,
        isPaid && medioPago
          ? {
              key: "medioPago",
              label: "Medio",
              value: findCuotasFilterLabel(
                catalogos.medios_pago,
                medioPago,
                "id_medio_pago",
              ),
            }
          : null,
      ].filter(Boolean),
    [catalogos, cobrador, estadoPersona, isPaid, medioPago],
  );

  const removeAdvancedFilter = useCallback((key) => {
    if (key === "estadoPersona") setEstadoPersona("");
    if (key === "cobrador") setCobrador("");
    if (key === "medioPago") setMedioPago("");
  }, []);
  const exportRecords = useCallback(
    (records) =>
      (records || []).map((item) => ({
        ...item,
        estado_exportacion: isResolved
          ? item.estado || (isCondoned ? "CONDONADO" : "PAGADO")
          : "PENDIENTE",
        fecha_pago: isResolved ? formatDate(item.fecha_pago) : "—",
        medio_pago: isPaid ? item.medio_pago || "—" : isCondoned ? "—" : "PENDIENTE",
        importe_exportacion: money(
          isResolved
            ? item.monto || 0
            : item.monto_sugerido || item.monto_base || 0,
        ),
      })),
    [isCondoned, isPaid, isResolved],
  );

  const obtenerTodosFiltrados = useCallback(async () => {
    const porPagina = BULK_SELECTION_PAGE_SIZE;
    const primeraRespuesta = await cuotasApi.listar({
      ...filtros,
      pagina: 1,
      por_pagina: porPagina,
      incluir_catalogos: 0,
    });
    const registros = [...(primeraRespuesta.items || [])];
    const total = Number(
      primeraRespuesta.paginacion?.total || registros.length,
    );
    const paginas = Number(
      primeraRespuesta.paginacion?.total_paginas ||
        Math.max(1, Math.ceil(total / porPagina)),
    );

    for (let paginaActual = 2; paginaActual <= paginas; paginaActual += 1) {
      const respuesta = await cuotasApi.listar({
        ...filtros,
        pagina: paginaActual,
        por_pagina: porPagina,
        incluir_catalogos: 0,
      });
      registros.push(...(respuesta.items || []));
    }

    return registros;
  }, [filtros]);

  const obtenerTodosParaExportar = useCallback(async () => {
    const registros = await obtenerTodosFiltrados();
    return exportRecords(registros);
  }, [exportRecords, obtenerTodosFiltrados]);

  const exportFilterDescription = [
    "Socios",
    isPaid ? "Pagados" : isCondoned ? "Condonados" : "Adeudados",
    `Período: ${mes}/${anio}`,
    estadoPersona
      ? `Estado: ${
          (catalogos.estados || []).find(
            (item) => String(item.id_estado) === String(estadoPersona),
          )?.nombre || estadoPersona
        }`
      : null,
    cobrador
      ? `Cobrador: ${
          (catalogos.cobradores || []).find(
            (item) => String(item.id_cobrador) === String(cobrador),
          )?.nombre || cobrador
        }`
      : null,
    medioPago
      ? `Medio: ${
          (catalogos.medios_pago || []).find(
            (item) => String(item.id_medio_pago) === String(medioPago),
          )?.nombre || medioPago
        }`
      : null,
    filtroBuscar ? `Socio: ${filtroBuscar}` : null,
    filtroIdSocio ? `ID socio: ${filtroIdSocio}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const paymentYearOptions = Array.from(
    new Set([...visibleYearOptions, paymentForm.anio].filter(Boolean).map(String)),
  ).sort((left, right) => Number(right) - Number(left));
  const selectedMonthIds = (paymentForm.meses || [])
    .map(String)
    .sort((left, right) => Number(left) - Number(right));
  const availableMonthIds = monthOptions
    .map((item) => String(item.id_mes))
    .filter((monthId) => {
      const period = paymentPeriods[monthId];
      return monthId !== "7" && period && !period.paid && !period.unavailable;
    });
  const annualPaymentAvailable = isAnnualPaymentAvailable(
    paymentPeriods,
    monthOptions,
  );
  const allAvailableMonthsSelected =
    availableMonthIds.length > 0 &&
    availableMonthIds.every((monthId) => selectedMonthIds.includes(monthId));
  const selectedItems = Object.values(selectedPayments);
  const selectedCount = selectedItems.length;
  const entityLabel = "socio";
  const previewPaymentContext =
    paymentContext ||
    paymentPeriods[String(currentMonth)]?.context ||
    Object.values(paymentPeriods).find((period) => period?.context?.familia)?.context ||
    Object.values(paymentPeriods).find((period) => period?.context)?.context ||
    null;
  const family = previewPaymentContext?.familia || null;
  const principal = paymentContext?.principal || previewPaymentContext?.principal || null;
  const familyPaymentTargets = familyTargetsForMonths(
    paymentPeriods,
    selectedMonthIds,
  );
  const familyPaymentCount = familyPaymentTargets.length;
  const familyPaymentTotal = familyPaymentTargets.reduce(
    (total, target) => total + Number(target.monto || 0),
    0,
  );
  const activePaymentPeriod = paymentPeriods[String(paymentForm.mes)] || null;
  const activeMonthAmount =
    paymentForm.montos_por_mes?.[String(paymentForm.mes)]?.monto ??
    paymentForm.monto;
  const paymentPeriodAmount = Number(
    activeMonthAmount ||
      defaultAmountOption(activePaymentPeriod?.context?.principal)?.monto ||
      activePaymentPeriod?.context?.principal?.monto_sugerido ||
      activePaymentPeriod?.context?.principal?.monto_base ||
      principal?.monto_sugerido ||
      principal?.monto_base ||
      selectedPartner?.monto_sugerido ||
      0,
  );
  const paymentTotal =
    paymentMode === "multiple"
      ? paymentForm.pagos.reduce(
          (total, payment) => total + Number(payment.monto || 0),
          0,
        )
      : paymentForm.aplicar_familia && family
        ? familyPaymentTotal
        : selectedMonthIds.reduce(
            (total, monthId) =>
              total +
              Number(
                paymentForm.montos_por_mes?.[monthId]?.monto ||
                  defaultAmountOption(
                    paymentPeriods[monthId]?.context?.principal,
                  )?.monto ||
                  0,
              ),
            0,
          );

  const clearMultipleSelection = () => {
    setSelectedPayments({});
    setMultiMode(false);
  };

  const cancelMultipleSelection = () => {
    if (saving) return;
    if (paymentMode === "multiple") setPaymentOpen(false);
    clearMultipleSelection();
  };

  const closePayment = () => {
    if (saving) return;
    contextRequestId.current += 1;
    setContextLoading(false);
    setPaymentOpen(false);
    if (paymentMode === "multiple") clearMultipleSelection();
  };

  const loadPaymentPeriods = async (
    partnerId,
    year,
    paymentDate,
    { selectedMonths = [], activeMonth = "", defaultFamily = false } = {},
  ) => {
    if (!partnerId || !year || !paymentDate) {
      setPaymentContext(null);
      setRegistrationContext(null);
      setPaymentPeriods({});
      return null;
    }

    const requestId = ++contextRequestId.current;
    setContextLoading(true);
    setPaymentPeriods({});

    try {
      const annualResponse = await cuotasApi.contextosPago({
        id_socio: partnerId,
        anio: year,
        fecha_pago: paymentDate,
      });
      const annualContexts = annualResponse?.periodos || {};
      const inscriptionContext = annualResponse?.inscripcion || null;
      const periods = monthOptions.map((monthItem) => {
        const monthId = String(monthItem.id_mes);
        const context = annualContexts[monthId] || annualContexts[Number(monthId)] || null;
        return {
          monthId,
          context,
          paid: isPaidPrincipal(context?.principal),
          unavailable: !context || isUnavailablePrincipal(context?.principal),
        };
      });
      if (requestId !== contextRequestId.current) return null;

      const periodMap = Object.fromEntries(
        periods.map((period) => [period.monthId, period]),
      );
      const annualAvailable = isAnnualPaymentAvailable(periodMap, monthOptions);
      const validSelection = selectedMonths
        .map(String)
        .filter(
          (monthId) =>
            periodMap[monthId] &&
            !periodMap[monthId].paid &&
            !periodMap[monthId].unavailable &&
            (monthId !== "7" || annualAvailable),
        )
        .sort((left, right) => Number(left) - Number(right));
      const resolvedActiveMonth = validSelection.includes(String(activeMonth))
        ? String(activeMonth)
        : validSelection[0] || "";
      const activeContext = periodMap[resolvedActiveMonth]?.context || null;
      const hasFamilyToPay = hasAdditionalFamilyTargets(
        periodMap,
        validSelection,
      );

      setPaymentPeriods(periodMap);
      setPaymentContext(activeContext);
      setRegistrationContext(inscriptionContext);
      setPaymentForm((current) => {
        const monthAmounts = reconcileMonthAmountStates(
          periodMap,
          current.montos_por_mes,
        );
        const activeAmount =
          monthAmounts[resolvedActiveMonth]?.monto ||
          defaultMonthAmountState(activeContext?.principal).monto;

        return {
          ...current,
          mes: resolvedActiveMonth || current.mes,
          meses: validSelection,
          monto: String(activeAmount || ""),
          monto_inscripcion:
            current.monto_inscripcion || String(inscriptionContext?.monto_sugerido || ""),
          montos_por_mes: monthAmounts,
          aplicar_familia: defaultFamily
            ? hasFamilyToPay
            : current.aplicar_familia && hasFamilyToPay,
        };
      });
      return periodMap;
    } catch (err) {
      if (requestId === contextRequestId.current) {
        setPaymentContext(null);
        setRegistrationContext(null);
        setPaymentPeriods({});
        setFeedback({
          type: "error",
          message: err.message || "No se pudieron consultar los períodos.",
        });
      }
      return null;
    } finally {
      if (requestId === contextRequestId.current) setContextLoading(false);
    }
  };

  const applyPartnerDefaults = (partnerId, base = paymentForm) => {
    const partner = partners.find(
      (item) => String(item.id_socio) === String(partnerId),
    );
    const next = {
      ...base,
      id_socio: String(partnerId || ""),
      meses: base.meses || [],
      monto: partner ? String(partner.monto_sugerido || "") : "",
      montos_por_mes: {},
      id_medio_pago: "",
      aplicar_familia: false,
    };
    setPaymentForm(next);
    loadPaymentPeriods(next.id_socio, next.anio, next.fecha_pago, {
      selectedMonths: next.meses,
      activeMonth: next.mes,
      defaultFamily: next.meses.length === 1,
    });
  };

  const openPayment = (row = null) => {
    setFeedback(null);
    setPaymentMode("single");
    setPaymentContext(null);
    setRegistrationContext(null);
    const next = {
      ...emptyForm(),
      id_socio: String(row?.id_socio || partners?.[0]?.id_socio || ""),
      anio: String(row?.anio || anio),
      mes: String(row?.mes || mes),
      meses: [String(row?.mes || mes)],
    };
    const partner = partners.find(
      (item) => String(item.id_socio) === String(next.id_socio),
    );
    const resolved = {
      ...next,
      monto: String(row?.monto_sugerido || partner?.monto_sugerido || ""),
      id_medio_pago: "",
    };
    setPaymentForm(resolved);
    setPaymentOpen(true);
    loadPaymentPeriods(resolved.id_socio, resolved.anio, resolved.fecha_pago, {
      selectedMonths: resolved.meses,
      activeMonth: resolved.mes,
      defaultFamily: true,
    });
  };

  const openMultiplePayment = () => {
    if (!selectedCount) {
      setFeedback({
        type: "error",
        message:
          "Seleccioná al menos una cuota para registrar el pago múltiple.",
      });
      return;
    }
    setFeedback(null);
    setPaymentMode("multiple");
    setPaymentContext(null);
    setRegistrationContext(null);
    setPaymentForm({
      ...emptyForm(),
      anio,
      mes,
      id_medio_pago: "",
      pagos: selectedItems.map((item) => {
        const amountOptions = Array.isArray(item.opciones_monto)
          ? item.opciones_monto
          : [];
        const currentOption = currentBatchAmountOption(item);
        return {
          id_socio: item.id_socio,
          anio: item.anio,
          mes: item.mes,
          denominacion: item.denominacion,
          documento: item.documento,
          categoria: item.categoria,
          familia: item.familia,
          porcentaje_descuento_familiar: item.porcentaje_descuento_familiar,
          monto_base: item.monto_base,
          monto_actual_categoria: item.monto_actual_categoria,
          opciones_monto: amountOptions,
          opcion_monto_id: currentOption?.id || "actual",
          domicilio: item.domicilio || item.domicilio_2 || item.direccion || "",
          domicilio_cobro: item.domicilio_cobro || "",
          telefono_movil: item.telefono_movil || "",
          telefono_fijo: item.telefono_fijo || "",
          cobrador: item.cobrador || "",
          // En selección múltiple se usa el importe recomendado para ese período.
          monto: String(
            currentOption?.monto ??
              item.monto_actual_categoria ??
              item.monto_sugerido ??
              "",
          ),
        };
      }),
    });
    setPaymentOpen(true);
    setMultiMode(false);
  };

  const printPaymentRow = (item) => {
    const receiptState = isCondoned
      ? "CONDONADO"
      : isPaid
        ? "PAGADO"
        : "PENDIENTE";
    const amount = Number(
      isResolved
        ? item.monto || 0
        : item.monto_sugerido || item.monto_base || 0,
    );
    const receiptPartner =
      partners.find(
        (partner) => String(partner.id_socio) === String(item.id_socio),
      ) || item;
    const domicilio = preferredAddress(receiptPartner);
    const cobrador = receiptPartner.cobrador || item.cobrador || "";

    openPaymentReceipt(
      enrichPaymentReceipt(
        {
          operacion: {
            codigo_operacion:
              item.codigo_operacion ||
              item.numero_comprobante ||
              (item.id_pago ? `PAGO-${item.id_pago}` : ""),
            estado: receiptState,
            fecha_pago: isResolved ? item.fecha_pago : localToday(),
            socios_label: item.denominacion || `ID ${item.id_socio}`,
            modalidad_label: isCondoned
              ? "Condonación de cuota"
              : isPaid
                ? "Pago de cuotas"
                : "Cuota pendiente",
            medio_pago: isCondoned
              ? ""
              : isPaid
                ? item.medio_pago || "—"
                : "PENDIENTE",
            monto_base: Number(item.monto_base || amount),
            monto: amount,
          },
          lineas: [
            {
              id: item.id_pago || selectionKey(item),
              id_pago: item.id_pago || null,
              id_socio: Number(item.id_socio),
              id_periodo: Number(item.id_periodo_pago || item.id_periodo || item.mes),
              anio: Number(item.anio),
              codigo_barra: item.codigo_barra || "",
              socio: item.denominacion || `ID ${item.id_socio}`,
              categoria: item.categoria || "SIN CATEGORÍA",
              periodo: item.periodo_pago || item.periodo,
              monto_base: Number(item.monto_base || amount),
              porcentaje_descuento_familiar: Number(
                item.porcentaje_descuento_familiar || 0,
              ),
              monto: amount,
              domicilio: preferredAddress(item),
              domicilio_cobro: item.domicilio_cobro || "",
              telefono_movil: item.telefono_movil || "",
              telefono_fijo: item.telefono_fijo || "",
            },
          ],
        },
        {
          socios: item.denominacion || `ID ${item.id_socio}`,
          domicilio,
          cobrador,
          medio: isCondoned
            ? ""
            : isPaid
              ? item.medio_pago || "—"
              : "PENDIENTE",
          tipoEntidad: tipo,
        },
      ),
      { openPrintDialog: true },
    );
  };

  const printAllFiltered = async () => {
    if (printingAll || loading || totalRegistros === 0) return;

    // Se abre la ventana en el mismo gesto del usuario para evitar que el
    // navegador la bloquee mientras se descargan las páginas restantes.
    const popup = window.open("", "_blank", "width=1100,height=820");
    if (!popup) {
      setFeedback({
        type: "error",
        message: "El navegador bloqueó la ventana de impresión. Habilitá las ventanas emergentes e intentá de nuevo.",
      });
      return;
    }

    popup.document.open();
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Preparando comprobantes</title></head><body style="font-family:Arial,sans-serif;padding:32px"><strong>Preparando todos los comprobantes filtrados…</strong></body></html>`);
    popup.document.close();

    setPrintingAll(true);
    try {
      const records = await obtenerTodosFiltrados();
      if (!records.length) {
        popup.close();
        setFeedback({
          type: "warning",
          message: "No hay comprobantes para imprimir con los filtros actuales.",
        });
        return;
      }

      const lines = records.map((item) => {
        const amount = Number(
          isResolved
            ? item.monto || 0
            : item.monto_sugerido || item.monto_base || 0,
        );
        const receiptState = isCondoned
          ? "CONDONADO"
          : isPaid
            ? "PAGADO"
            : "PENDIENTE";
        return {
          id: item.id_pago || selectionKey(item),
          id_pago: item.id_pago || null,
          id_socio: Number(item.id_socio),
          id_periodo: Number(
            item.id_periodo_pago || item.id_periodo || item.mes,
          ),
          anio: Number(item.anio),
          codigo_barra: item.codigo_barra || "",
          socio: item.denominacion || `ID ${item.id_socio}`,
          categoria: item.categoria || "SIN CATEGORÍA",
          periodo: item.periodo_pago || item.periodo,
          monto_base: Number(item.monto_base || amount),
          porcentaje_descuento_familiar: Number(
            item.porcentaje_descuento_familiar || 0,
          ),
          monto: amount,
          domicilio: preferredAddress(item),
          domicilio_cobro: item.domicilio_cobro || "",
          telefono_movil: item.telefono_movil || "",
          telefono_fijo: item.telefono_fijo || "",
          cobrador: item.cobrador || "",
          medio_pago: isCondoned
            ? ""
            : isPaid
              ? item.medio_pago || "—"
              : "PENDIENTE",
          estado: receiptState,
        };
      });

      const receiptSource = {
        operacion: {
          estado: isCondoned
            ? "CONDONADO"
            : isPaid
              ? "PAGADO"
              : "PENDIENTE",
          fecha_pago: isResolved ? "" : localToday(),
          socios_label: `${records.length} socios`,
          modalidad_label: isCondoned
            ? "Condonaciones filtradas"
            : isPaid
              ? "Pagos filtrados"
              : "Cuotas pendientes filtradas",
          medio_pago: "",
          monto: lines.reduce(
            (total, line) => total + Number(line.monto || 0),
            0,
          ),
        },
        lineas: lines,
      };

      popup.document.open();
      popup.document.write(paymentReceiptHtml(receiptSource));
      popup.document.close();
      popup.focus();
    } catch (err) {
      popup.close();
      setFeedback({
        type: "error",
        message: err?.message || "No se pudieron preparar los comprobantes.",
      });
    } finally {
      setPrintingAll(false);
    }
  };

  const applyMonthSelection = (months, activeMonth, defaultFamily = true) => {
    const eligibleMonths = months
      .map(String)
      .filter((monthId) => {
        const period = paymentPeriods[monthId];
        return (
          period &&
          !period.paid &&
          !period.unavailable &&
          (monthId !== "7" || annualPaymentAvailable)
        );
      })
      .sort((left, right) => Number(left) - Number(right));
    const normalizedMonths = eligibleMonths.includes("7")
      ? ["7"]
      : eligibleMonths;
    const resolvedActiveMonth = normalizedMonths.includes(String(activeMonth))
      ? String(activeMonth)
      : normalizedMonths[0] || "";
    const activeContext = paymentPeriods[resolvedActiveMonth]?.context || null;
    const hasFamilyToPay = hasAdditionalFamilyTargets(
      paymentPeriods,
      normalizedMonths,
    );

    setPaymentContext(activeContext);
    setPaymentForm((current) => {
      const activeAmount =
        current.montos_por_mes?.[resolvedActiveMonth]?.monto ||
        defaultMonthAmountState(activeContext?.principal).monto;

      return {
        ...current,
        mes: resolvedActiveMonth || current.mes,
        meses: normalizedMonths,
        monto: String(activeAmount || ""),
        aplicar_familia: defaultFamily
          ? hasFamilyToPay
          : current.aplicar_familia && hasFamilyToPay,
      };
    });
  };

  const togglePaymentMonth = (monthId) => {
    const normalizedMonth = String(monthId);
    const period = paymentPeriods[normalizedMonth];
    if (
      !period ||
      period.paid ||
      period.unavailable ||
      (normalizedMonth === "7" && !annualPaymentAvailable)
    ) return;

    const selected = selectedMonthIds.includes(normalizedMonth);
    const nextMonths = selected
      ? selectedMonthIds.filter((value) => value !== normalizedMonth)
      : normalizedMonth === "7"
        ? ["7"]
        : [
            ...selectedMonthIds.filter((value) => value !== "7"),
            normalizedMonth,
          ];
    applyMonthSelection(
      nextMonths,
      selected ? nextMonths[0] : normalizedMonth,
      true,
    );
  };

  const toggleAllPaymentMonths = () => {
    applyMonthSelection(
      allAvailableMonthsSelected ? [] : availableMonthIds,
      allAvailableMonthsSelected ? "" : availableMonthIds[0],
      false,
    );
  };

  const updatePaymentYear = (value) => {
    const next = {
      ...paymentForm,
      anio: String(value),
      meses: [],
      montos_por_mes: {},
      aplicar_familia: false,
    };
    setPaymentForm(next);
    setPaymentContext(null);
    loadPaymentPeriods(next.id_socio, next.anio, next.fecha_pago, {
      selectedMonths: [],
    });
  };

  const updatePaymentDate = (value) => {
    const next = { ...paymentForm, fecha_pago: value };
    setPaymentForm(next);
    loadPaymentPeriods(next.id_socio, next.anio, next.fecha_pago, {
      selectedMonths: next.meses,
      activeMonth: next.mes,
      defaultFamily: next.meses.length === 1,
    });
  };

  const updateMonthAmountOption = (monthId, optionId) => {
    const normalizedMonth = String(monthId);
    const principalForMonth =
      paymentPeriods[normalizedMonth]?.context?.principal || null;
    const options = Array.isArray(principalForMonth?.opciones_monto)
      ? principalForMonth.opciones_monto
      : [];
    const option =
      options.find((item) => String(item.id) === String(optionId)) ||
      defaultAmountOption(principalForMonth);
    if (!option) return;

    setPaymentForm((current) => {
      const nextAmount = String(option.monto ?? "");
      return {
        ...current,
        aplicar_familia: false,
        monto:
          String(current.mes) === normalizedMonth ? nextAmount : current.monto,
        montos_por_mes: {
          ...(current.montos_por_mes || {}),
          [normalizedMonth]: {
            personalizado: false,
            opcion_id: String(option.id),
            monto: nextAmount,
          },
        },
      };
    });
  };

  const toggleMonthCustomAmount = (monthId, checked) => {
    const normalizedMonth = String(monthId);
    const principalForMonth =
      paymentPeriods[normalizedMonth]?.context?.principal || null;

    setPaymentForm((current) => {
      const currentState =
        current.montos_por_mes?.[normalizedMonth] ||
        defaultMonthAmountState(principalForMonth);
      let nextState;

      if (checked) {
        nextState = {
          ...currentState,
          personalizado: true,
        };
      } else {
        const options = Array.isArray(principalForMonth?.opciones_monto)
          ? principalForMonth.opciones_monto
          : [];
        const option =
          options.find(
            (item) => String(item.id) === String(currentState.opcion_id),
          ) || defaultAmountOption(principalForMonth);
        nextState = {
          personalizado: false,
          opcion_id: option?.id || "actual",
          monto: String(
            option?.monto ??
              principalForMonth?.monto_sugerido ??
              principalForMonth?.monto_base ??
              "",
          ),
        };
      }

      return {
        ...current,
        aplicar_familia: false,
        monto:
          String(current.mes) === normalizedMonth
            ? String(nextState.monto ?? "")
            : current.monto,
        montos_por_mes: {
          ...(current.montos_por_mes || {}),
          [normalizedMonth]: nextState,
        },
      };
    });
  };

  const updateMonthCustomAmount = (monthId, value) => {
    const normalizedMonth = String(monthId);
    const sanitizedValue = decimalInput(value);
    setPaymentForm((current) => {
      const previous = current.montos_por_mes?.[normalizedMonth] || {};
      return {
        ...current,
        aplicar_familia: false,
        monto:
          String(current.mes) === normalizedMonth
            ? sanitizedValue
            : current.monto,
        montos_por_mes: {
          ...(current.montos_por_mes || {}),
          [normalizedMonth]: {
            ...previous,
            personalizado: true,
            monto: sanitizedValue,
          },
        },
      };
    });
  };

  const updateRegistrationAmount = (value) => {
    const sanitizedValue = integerInput(value);
    setPaymentForm((current) => ({
      ...current,
      monto_inscripcion: sanitizedValue,
    }));
  };

  const updateBatchAmountOption = (index, optionId) => {
    setPaymentForm((current) => ({
      ...current,
      pagos: current.pagos.map((payment, paymentIndex) => {
        if (paymentIndex !== index) return payment;
        const options = Array.isArray(payment.opciones_monto)
          ? payment.opciones_monto
          : [];
        const option = options.find(
          (item) => String(item.id) === String(optionId),
        );
        if (!option) return payment;
        return {
          ...payment,
          opcion_monto_id: String(option.id),
          monto: String(option.monto ?? payment.monto ?? ""),
        };
      }),
    }));
  };

  const submitRegistration = async (event) => {
    event.preventDefault();

    if (!paymentForm.id_socio) {
      setFeedback({ type: "error", message: "Seleccioná un socio." });
      return;
    }
    if (registrationContext?.pagada) {
      setFeedback({
        type: "warning",
        message: "Este socio ya tiene la inscripción registrada.",
      });
      return;
    }
    if (!paymentForm.fecha_pago) {
      setFeedback({ type: "error", message: "Completá la fecha de pago." });
      return;
    }
    if (!paymentForm.id_medio_pago) {
      setFeedback({ type: "error", message: "Seleccioná el medio de pago." });
      return;
    }

    const selectedMedium = (catalogos.medios_pago || []).find(
      (item) => String(item.id_medio_pago) === String(paymentForm.id_medio_pago),
    );
    const mediumName = String(selectedMedium?.nombre || "").toLocaleUpperCase("es-AR");
    if (!mediumName.includes("EFECTIVO") && !mediumName.includes("TRANSFERENCIA")) {
      setFeedback({
        type: "error",
        message: "La inscripción se registra en efectivo o transferencia.",
      });
      return;
    }

    const registrationAmount = Number(integerInput(paymentForm.monto_inscripcion));
    if (!(registrationAmount > 0)) {
      setFeedback({
        type: "error",
        message: "Ingresá un monto de inscripción mayor a cero.",
      });
      return;
    }

    setSaving(true);
    try {
      await cuotasApi.registrarInscripcion({
        id_socio: Number(paymentForm.id_socio),
        fecha_pago: paymentForm.fecha_pago,
        monto: registrationAmount,
        id_medio_pago: Number(paymentForm.id_medio_pago),
      });

      setPaymentOpen(false);
      setRegistrationContext(null);
      setFeedback({
        type: "success",
        message: "Inscripción pagada correctamente.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err.message || "No se pudo registrar la inscripción.",
      });
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteRegistration = () => {
    const payment = registrationContext?.pago;
    if (!payment?.id_inscripcion || !paymentForm.id_socio) return;

    setRegistrationDeleteRow({
      id_inscripcion: Number(payment.id_inscripcion),
      id_socio: Number(paymentForm.id_socio),
      denominacion:
        selectedPartner?.denominacion ||
        principal?.denominacion ||
        registrationContext?.socio ||
        `ID ${paymentForm.id_socio}`,
      fecha_pago: payment.fecha_pago || "",
      monto: Number(payment.monto || 0),
      medio_pago: payment.medio_pago || "—",
    });
    setPaymentOpen(false);
  };

  const deleteRegistrationPayment = async () => {
    if (!registrationDeleteRow?.id_inscripcion) return null;

    const response = await cuotasApi.eliminarInscripcion(
      registrationDeleteRow.id_inscripcion,
    );

    await loadPaymentPeriods(
      paymentForm.id_socio,
      paymentForm.anio,
      paymentForm.fecha_pago,
      {
        selectedMonths: paymentForm.meses,
        activeMonth: paymentForm.mes,
        defaultFamily: false,
      },
    );

    setFeedback({
      type: "success",
      message: "Pago de inscripción eliminado correctamente.",
    });

    return {
      ...response,
      mensaje:
        "Pago de inscripción eliminado correctamente. La inscripción volvió a quedar pendiente.",
    };
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!paymentForm.id_medio_pago) {
      setFeedback({ type: "error", message: "Seleccioná el medio de pago." });
      return;
    }
    if (!paymentForm.fecha_pago) {
      setFeedback({ type: "error", message: "Completá la fecha de pago." });
      return;
    }

    if (paymentMode === "single") {
      if (!paymentForm.id_socio) {
        setFeedback({
          type: "error",
          message: "Seleccioná un socio.",
        });
        return;
      }
      if (!selectedMonthIds.length) {
        setFeedback({
          type: "error",
          message: "Seleccioná al menos un mes para registrar el pago.",
        });
        return;
      }
      if (selectedMonthIds.includes("7") && !annualPaymentAvailable) {
        setFeedback({
          type: "error",
          message:
            "Contado Anual sólo está disponible cuando los seis períodos del año están disponibles para pagar.",
        });
        return;
      }
      if (
        !paymentForm.aplicar_familia &&
        selectedMonthIds.some(
          (monthId) =>
            !(
              Number(
                decimalInput(paymentForm.montos_por_mes?.[monthId]?.monto),
              ) > 0
            ),
        )
      ) {
        setFeedback({
          type: "error",
          message: "Todos los meses seleccionados deben tener un monto mayor a cero.",
        });
        return;
      }
    } else if (
      !paymentForm.pagos.length ||
      paymentForm.pagos.some(
        (payment) => !(Number(decimalInput(payment.monto)) > 0),
      )
    ) {
      setFeedback({
        type: "error",
        message:
          "Todos los pagos seleccionados deben tener un monto mayor a cero.",
      });
      return;
    }

    setSaving(true);
    try {
      let response;
      if (paymentMode === "multiple") {
        response = await cuotasApi.registrarPagos({
          fecha_pago: paymentForm.fecha_pago,
          id_medio_pago: Number(paymentForm.id_medio_pago),
          pagos: paymentForm.pagos.map((payment) => ({
            id_socio: Number(payment.id_socio),
            anio: Number(payment.anio),
            mes: Number(payment.mes),
            monto: Number(decimalInput(payment.monto)),
          })),
        });
      } else if (paymentForm.aplicar_familia && family) {
        response = await cuotasApi.registrarPagos({
          modo_pago: "FAMILIAR",
          fecha_pago: paymentForm.fecha_pago,
          id_medio_pago: Number(paymentForm.id_medio_pago),
          pagos: familyPaymentTargets.map((target) => ({
            id_socio: Number(target.id_socio),
            anio: Number(paymentForm.anio),
            mes: Number(target.mes),
            id_familia: Number(target.id_familia),
          })),
        });
      } else if (selectedMonthIds.length > 1) {
        response = await cuotasApi.registrarPagos({
          fecha_pago: paymentForm.fecha_pago,
          id_medio_pago: Number(paymentForm.id_medio_pago),
          pagos: selectedMonthIds.map((monthId) => {
            const periodPrincipal =
              paymentPeriods[monthId]?.context?.principal;
            return {
              id_socio: Number(paymentForm.id_socio),
              anio: Number(paymentForm.anio),
              mes: Number(monthId),
              monto: Number(
                decimalInput(
                  paymentForm.montos_por_mes?.[monthId]?.monto ||
                  defaultAmountOption(periodPrincipal)?.monto ||
                  periodPrincipal?.monto_sugerido ||
                  periodPrincipal?.monto_base ||
                  selectedPartner?.monto_sugerido ||
                  0,
                ),
              ),
            };
          }),
        });
      } else {
        response = await cuotasApi.registrarPago({
          id_socio: Number(paymentForm.id_socio),
          anio: Number(paymentForm.anio),
          mes: Number(selectedMonthIds[0]),
          fecha_pago: paymentForm.fecha_pago,
          monto: Number(
            decimalInput(
              paymentForm.montos_por_mes?.[selectedMonthIds[0]]?.monto ||
                paymentForm.monto,
            ),
          ),
          id_medio_pago: Number(paymentForm.id_medio_pago),
          aplicar_familia: false,
        });
      }

      const selectedMedium = (catalogos.medios_pago || []).find(
        (item) =>
          String(item.id_medio_pago) === String(paymentForm.id_medio_pago),
      );
      const fallbackLines =
        paymentMode === "multiple"
          ? paymentForm.pagos.map((payment) => ({
              id_socio: Number(payment.id_socio),
              id_periodo: Number(payment.mes),
              anio: Number(payment.anio),
              socio: payment.denominacion || `ID ${payment.id_socio}`,
              categoria: payment.categoria || "SIN CATEGORÍA",
              periodo: `${
                monthOptions.find(
                  (monthItem) =>
                    String(monthItem.id_mes) === String(payment.mes),
                )?.nombre || payment.mes
              } ${payment.anio}`,
              monto_base: Number(payment.monto_base || payment.monto || 0),
              porcentaje_descuento_familiar: Number(
                payment.porcentaje_descuento_familiar || 0,
              ),
              monto: Number(payment.monto || 0),
              domicilio: payment.domicilio || "",
              domicilio_cobro: payment.domicilio_cobro || "",
              telefono_movil: payment.telefono_movil || "",
              telefono_fijo: payment.telefono_fijo || "",
              cobrador: payment.cobrador || "",
              medio_pago: selectedMedium?.nombre || "—",
            }))
          : selectedMonthIds.map((monthId) => {
              const periodPrincipal =
                paymentPeriods[monthId]?.context?.principal || principal || {};
              return {
                id_socio: Number(paymentForm.id_socio),
                id_periodo: Number(monthId),
                anio: Number(paymentForm.anio),
                socio:
                  selectedPartner?.denominacion ||
                  periodPrincipal.denominacion ||
                  `ID ${paymentForm.id_socio}`,
                categoria:
                  periodPrincipal.categoria ||
                  selectedPartner?.categoria ||
                  "SIN CATEGORÍA",
                periodo: `${
                  monthOptions.find(
                    (monthItem) =>
                      String(monthItem.id_mes) === String(monthId),
                  )?.nombre || monthId
                } ${paymentForm.anio}`,
                monto_base: Number(
                  periodPrincipal.monto_base ||
                    selectedPartner?.monto_base ||
                    periodPrincipal.monto_sugerido ||
                    paymentForm.monto ||
                    0,
                ),
                porcentaje_descuento_familiar: Number(
                  periodPrincipal.porcentaje_descuento_familiar ||
                    selectedPartner?.porcentaje_descuento_familiar ||
                    0,
                ),
                monto: Number(
                  paymentForm.montos_por_mes?.[monthId]?.monto ||
                    defaultAmountOption(periodPrincipal)?.monto ||
                    periodPrincipal.monto_sugerido ||
                    periodPrincipal.monto_base ||
                    paymentForm.monto ||
                    0,
                ),
                domicilio:
                  selectedPartner?.domicilio_2 ||
                  selectedPartner?.domicilio ||
                  selectedPartner?.direccion ||
                  "",
                domicilio_cobro:
                  periodPrincipal.domicilio_cobro ||
                  selectedPartner?.domicilio_cobro ||
                  "",
                telefono_movil:
                  periodPrincipal.telefono_movil ||
                  selectedPartner?.telefono_movil ||
                  "",
                telefono_fijo:
                  periodPrincipal.telefono_fijo ||
                  selectedPartner?.telefono_fijo ||
                  "",
                cobrador:
                  periodPrincipal.cobrador || selectedPartner?.cobrador || "",
                medio_pago: selectedMedium?.nombre || "—",
              };
            });
      const receiptPeople =
        paymentMode === "multiple"
          ? paymentForm.pagos
              .map((payment) => payment.denominacion)
              .filter(Boolean)
              .join(" · ")
          : selectedPartner?.denominacion || "";
      const receiptPartnerCount =
        paymentMode === "multiple"
          ? new Set(
              paymentForm.pagos.map((payment) =>
                String(payment.id_socio ?? payment.denominacion ?? "").trim(),
              ),
            ).size
          : 1;
      const receiptRecordCount = fallbackLines.length || 1;

      setPaymentOpen(false);
      setReceipt(
        enrichPaymentReceipt(response.comprobante || null, {
          socios: receiptPeople,
          domicilio:
            selectedPartner?.domicilio_2 ||
            selectedPartner?.domicilio ||
            selectedPartner?.direccion ||
            "",
          cobrador: principal?.cobrador || selectedPartner?.cobrador || "",
          medio: selectedMedium?.nombre || "—",
          tipoEntidad: tipo,
          cantidadSocios: receiptPartnerCount,
          cantidadRegistros: receiptRecordCount,
          lineas: fallbackLines,
        }),
      );
      pendingTableScrollRef.current = tableBodyRef.current?.scrollTop || 0;
      setFeedback(null);
      clearMultipleSelection();
      // Conservamos pestaña, período, página y posición de la tabla. El pago
      // desaparece de Deudores al refrescar, pero el usuario sigue exactamente
      // en el contexto desde el que abrió el modal.
      await Promise.all([cargar(), cargarTotalesEstado()]);
      setFeedback({
        type: "success",
        message: "Período pagado correctamente.",
      });
    } catch (err) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const deletePayment = async () => {
    const response = await cuotasApi.eliminarPago(deleteRow.id_pago);
    const successMessage = "Cuota eliminada correctamente.";
    setDeleteRow(null);
    setEstado("DEUDORES");
    setFeedback({ type: "success", message: successMessage });
    // Si era el último pago de un año futuro, refrescamos los años visibles
    // sin bloquear el cierre ni el feedback del modal.
    void cargarCatalogos();
    void cargarTotalesEstado();
    return { ...response, mensaje: successMessage };
  };

  const condonePayment = async () => {
    if (!condoneRow) return null;
    const response = await cuotasApi.condonarPago({
      id_socio: Number(condoneRow.id_socio),
      anio: Number(condoneRow.anio),
      mes: Number(condoneRow.mes),
      fecha_condonacion: localToday(),
    });
    const successMessage = "Cuota condonada correctamente.";
    pendingTableScrollRef.current = tableBodyRef.current?.scrollTop || 0;
    setCondoneRow(null);
    setFeedback({ type: "success", message: successMessage });
    await Promise.all([cargar(), cargarTotalesEstado(), cargarCatalogos()]);
    return { ...response, mensaje: successMessage };
  };

  const toggleSelection = (item) => {
    const key = selectionKey(item);
    setSelectedPayments((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = item;
      return next;
    });
  };

  const selectAllFiltered = async () => {
    if (saving || selectingFiltered || isResolved) return;

    setSelectingFiltered(true);
    setFeedback(null);

    try {
      const filterSnapshot = {
        ...filtros,
        estado: "DEUDORES",
        pagina: 1,
        por_pagina: BULK_SELECTION_PAGE_SIZE,
        incluir_catalogos: 0,
      };
      const firstResponse = await cuotasApi.listar(filterSnapshot);
      const filteredItems = [...(firstResponse.items || [])];
      const total = Number(
        firstResponse.paginacion?.total || filteredItems.length,
      );
      const totalPages = Number(
        firstResponse.paginacion?.total_paginas ||
          Math.max(1, Math.ceil(total / BULK_SELECTION_PAGE_SIZE)),
      );

      for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
        const response = await cuotasApi.listar({
          ...filterSnapshot,
          pagina: pageNumber,
        });
        filteredItems.push(...(response.items || []));
      }

      setSelectedPayments((current) => {
        const next = { ...current };
        filteredItems.forEach((item) => {
          next[selectionKey(item)] = item;
        });
        return next;
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err?.message ||
          "No se pudieron seleccionar todas las cuotas del filtro actual.",
      });
    } finally {
      setSelectingFiltered(false);
    }
  };

  const selectRow = (event, item) => {
    if (!multiMode || isResolved || !writable) return;
    if (!(event.target instanceof Element)) return;

    const interactiveElement = event.target.closest(
      'button, input, select, textarea, a, label, [role="button"]',
    );
    if (interactiveElement) return;

    toggleSelection(item);
  };

  const selectRowWithKeyboard = (event, item) => {
    if (!multiMode || isResolved || !writable) return;
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    toggleSelection(item);
  };

  // Mantiene estable la tabla mientras cambian estados exclusivos del modal de pago.
  // Las filas leen siempre los handlers actuales desde este ref sin volver a renderizarse.
  rowActionsRef.current = {
    selectRow,
    selectRowWithKeyboard,
    toggleSelection,
    printPaymentRow,
    openPayment,
    setCondoneRow,
    setDeleteRow,
  };


  const setYearFilter = (value) => {
    setAnio(value);
  };

  const setMonthFilter = (value) => {
    setMes(value);
  };

  const pageFilters = [
    {
      key: "estado",
      type: "tabs",
      label: "Estado",
      ariaLabel: "Estado de las cuotas",
      value: estado,
      onChange: (value) => {
        setEstado(value);
        if (value !== "PAGADOS") setMedioPago("");
        if (value !== "DEUDORES") setMultiMode(false);
      },
      options: [
        {
          value: "DEUDORES",
          label: (
            <span className="cuotas-state-tabContent">
              <span className="cuotas-state-tabText">Deudores</span>
              <span
                className={`cuotas-state-tabBadge ${estadoTotales.DEUDORES == null ? "is-pending" : ""}`.trim()}
                aria-label={estadoTotales.DEUDORES == null ? "Total de deudores cargando" : `${estadoTotales.DEUDORES} deudores`}
              >
                {estadoTotales.DEUDORES ?? <span className="cuotas-state-tabSpinner" aria-hidden="true" />}
              </span>
            </span>
          ),
        },
        {
          value: "PAGADOS",
          label: (
            <span className="cuotas-state-tabContent">
              <span className="cuotas-state-tabText">Pagados</span>
              <span
                className={`cuotas-state-tabBadge ${estadoTotales.PAGADOS == null ? "is-pending" : ""}`.trim()}
                aria-label={estadoTotales.PAGADOS == null ? "Total de pagados cargando" : `${estadoTotales.PAGADOS} pagados`}
              >
                {estadoTotales.PAGADOS ?? <span className="cuotas-state-tabSpinner" aria-hidden="true" />}
              </span>
            </span>
          ),
        },
        {
          value: "CONDONADOS",
          label: (
            <span className="cuotas-state-tabContent">
              <span className="cuotas-state-tabText">Condonados</span>
              <span
                className={`cuotas-state-tabBadge ${estadoTotales.CONDONADOS == null ? "is-pending" : ""}`.trim()}
                aria-label={estadoTotales.CONDONADOS == null ? "Total de condonados cargando" : `${estadoTotales.CONDONADOS} condonados`}
              >
                {estadoTotales.CONDONADOS ?? <span className="cuotas-state-tabSpinner" aria-hidden="true" />}
              </span>
            </span>
          ),
        },
      ],
    },
    {
      key: "buscar-socio",
      type: "search",
      label: "Socio",
      placeholder: "",
      value: buscarSocio,
      onChange: setBuscarSocio,
      className: "cuotas-search-filter",
    },
    {
      key: "buscar-id",
      type: "search",
      label: "ID",
      placeholder: "",
      value: buscarId,
      onChange: (value) => setBuscarId(String(value || "").replace(/\D/g, "").slice(0, 10)),
      className: "cuotas-id-filter",
    },
    {
      key: "anio",
      type: "select",
      label: "Año",
      value: anio,
      onChange: setYearFilter,
      includeEmptyOption: false,
      options: visibleYearOptions.map((value) => ({ value, label: value })),
      className: "cuotas-year-filter",
    },
    {
      key: "mes",
      type: "select",
      label: "Mes",
      value: mes,
      onChange: setMonthFilter,
      includeEmptyOption: false,
      options: (catalogos.meses || []).map((item) => ({
        value: item.id_mes,
        label: item.nombre,
      })),
      className: "cuotas-month-filter",
    },
  ];

  const tableLabel = `Cuotas de socios ${isPaid ? "pagadas" : isCondoned ? "condonadas" : "adeudadas"}`;
  const baseColumns = [
    "ID",
    "Socio",
    "Dirección",
    "Estado",
    "Cobrador",
    "Importe",
    "Acciones",
  ];
  const columns = !isResolved && multiMode
    ? ["Selec.", ...baseColumns.slice(0, -1)]
    : baseColumns;

  const debtGridClass = multiMode
    ? "cuotas-grid cuotas-grid--debt cuotas-grid--selecting"
    : "cuotas-grid cuotas-grid--debt";
  const debtRowClass = multiMode
    ? "cuotas-grid--debt cuotas-grid--selecting"
    : "cuotas-grid--debt";
  const toggleMultipleMode = () => {
    if (multiMode) clearMultipleSelection();
    else setMultiMode(true);
  };

  const handleBarcodeSaved = async ({ type }) => {
    setFeedback({
      type: "success",
      message:
        type === "condoned"
          ? "Cuota condonada correctamente."
          : "Período pagado correctamente.",
    });
    await Promise.all([cargar(), cargarTotalesEstado(), cargarCatalogos()]);
  };

  const deletingAnnual = Boolean(
    deleteRow &&
      (deleteRow.origen_anual ||
        Number(
          deleteRow.id_periodo_pago ||
            deleteRow.id_periodo ||
            deleteRow.mes,
        ) === 7),
  );
  const deletePeriodLabel = deletingAnnual
    ? deleteRow?.periodo_pago || `CONTADO ANUAL ${deleteRow?.anio || ""}`.trim()
    : deleteRow?.periodo || "este período";

  return (
    <>
      <ModulePage
        className="cuotas-page"
        title="Cuotas"
        description="Control de períodos bimestrales y Contado Anual."
        filters={pageFilters}
        tabsInTitle
        headLeftClassName="cuotas-header-row"
        headFiltersContainerClassName="cuotas-head-filters"
        headerActions={
          <>
            <CuotasAdvancedFilters
              estadoPersona={estadoPersona}
              cobrador={cobrador}
              medioPago={medioPago}
              catalogos={catalogos}
              showPaymentMedium={isPaid}
              onEstadoPersona={setEstadoPersona}
              onCobrador={setCobrador}
              onMedioPago={setMedioPago}
            />
            {writable ? (
              <button
                type="button"
                className="mov-btn mov-btn--ghost cuotas-barcode-action"
                onClick={() => setBarcodeOpen(true)}
                title="Registrar una cuota leyendo el código del comprobante"
              >
                <FontAwesomeIcon icon={faBarcode} />
                Cód. barras
              </button>
            ) : null}
          </>
        }
        secondaryActions={
          !isResolved && writable
            ? [
                {
                  key: "multiple-selection",
                  label: multiMode
                    ? "Cancelar selección"
                    : "Seleccionar",
                  icon: faUserGroup,
                  onClick: toggleMultipleMode,
                  className: multiMode
                    ? "mov-btn--danger cuotas-multiple-action"
                    : "mov-btn--primary cuotas-multiple-action",
                },
              ]
            : []
        }
        canCreate={false}
        refreshing={loading}
        notice={
          !writable
            ? "Tu usuario tiene permiso de consulta. Registrar, condonar y eliminar cuotas está deshabilitado."
            : null
        }
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || error}
          duration={feedback?.duration}
          onClose={() => setFeedback(null)}
        />

        {multiMode ? (
          <Toast
            tipo="info"
            persistente
            cerrarConEscape={false}
            cerrarConInteraccion={false}
            cierreDeshabilitado={saving}
            onClose={cancelMultipleSelection}
            className="cuotas-selection-toast"
            ariaLabelCerrar="Cancelar selección múltiple"
            mensaje={
              <div className="cuotas-selection-toast__copy">
                <strong>
                  {selectedCount} cuota{selectedCount === 1 ? "" : "s"}{" "}
                  seleccionada{selectedCount === 1 ? "" : "s"}
                </strong>
                <span>
                  Hacé clic en cualquier parte de una fila para seleccionarla.
                </span>
              </div>
            }
            acciones={
              <>
                {!isResolved ? (
                  <button
                    type="button"
                    className="mov-btn mov-btn--ghost"
                    onClick={selectAllFiltered}
                    disabled={loading || saving || selectingFiltered || totalRegistros === 0}
                    title="Suma a la selección todas las cuotas que coinciden con los filtros actuales, incluyendo otras páginas"
                  >
                    {selectingFiltered
                      ? "Seleccionando..."
                      : `Seleccionar todo lo filtrado (${totalRegistros})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mov-btn mov-btn--ghost"
                  onClick={() => setSelectedPayments({})}
                  disabled={!selectedCount || saving || selectingFiltered}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  className="mov-btn mov-btn--primary"
                  onClick={openMultiplePayment}
                  disabled={!selectedCount || saving || selectingFiltered}
                >
                  Continuar ({selectedCount})
                </button>
              </>
            }
          />
        ) : null}

        <GlobalDivTable
          className={`cuotas-table ${totalRegistros ? "has-bottom-pagination" : ""}`.trim()}
          bodyClassName="entity-table-wrap"
          bodyRef={tableBodyRef}
          gridClassName={
            isResolved ? "cuotas-grid cuotas-grid--paid" : debtGridClass
          }
          ariaLabel={tableLabel}
          empty={!loading && !error && !items.length}
          loading={loading}
          loadingLabel="Cargando cuotas..."
          skeletonRows={8}
          columns={columns}
        >
          {!loading && !error && !items.length ? (
            <div className="module-empty">
              <FontAwesomeIcon icon={isResolved ? faReceipt : faWallet} />
              <strong>
                {isPaid
                  ? "No hay pagos registrados"
                  : isCondoned
                    ? "No hay cuotas condonadas"
                    : "No hay deudores"}
              </strong>
              <span>
                {isPaid
                  ? "No existen pagos para el mes, año y filtros seleccionados."
                  : isCondoned
                    ? "No existen condonaciones para el mes, año y filtros seleccionados."
                    : "Todos los registros del período están pagados, condonados o todavía no debían cuota."}
              </span>
            </div>
          ) : null}

          <CuotasTableRows
            items={itemsPagina}
            selectedPayments={selectedPayments}
            isResolved={isResolved}
            isCondoned={isCondoned}
            multiMode={multiMode}
            writable={writable}
            tipo={tipo}
            debtRowClass={debtRowClass}
            actionsRef={rowActionsRef}
          />
        </GlobalDivTable>

        <div className="cuotas-table-footer">
          {totalRegistros || activeAdvancedFilters.length ? (
            <nav
              className="cuotas-pagination"
              aria-label="Paginación de cuotas"
            >
              <div className="cuotas-pagination__left">
                {totalRegistros ? (
                  <p className="cuotas-pagination__summary">
                    <span className="cuotas-pagination__summaryFull">
                      Mostrando <strong>{registroDesde}</strong>–
                      <strong>{registroHasta}</strong> de{" "}
                      <strong>{totalRegistros}</strong> registros
                    </span>
                    <span className="cuotas-pagination__summaryCompact">
                      <span className="cuotas-pagination__summaryRange">
                        <strong>{registroDesde}</strong>–
                        <strong>{registroHasta}</strong>
                      </span>
                      <span className="cuotas-pagination__summarySeparator">/</span>
                      <strong>{totalRegistros}</strong>
                    </span>
                    {loading ? (
                      <>
                        <span className="cuotas-pagination__loadingFull">
                          Cargando página...
                        </span>
                        <span className="cuotas-pagination__loadingCompact">
                          Cargando...
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <CuotasActiveFilterChips
                  chips={activeAdvancedFilters}
                  onRemove={removeAdvancedFilter}
                />
              </div>

              {totalRegistros ? (
                <div className="cuotas-pagination__controls">
                <button
                  type="button"
                  onClick={() => setPagina((actual) => Math.max(1, actual - 1))}
                  disabled={loading || pagina <= 1}
                >
                  Anterior
                </button>

                {opcionesPagina.map((item) =>
                  typeof item === "number" ? (
                    <button
                      type="button"
                      key={item}
                      className={item === pagina ? "is-active" : ""}
                      aria-current={item === pagina ? "page" : undefined}
                      onClick={() => setPagina(item)}
                      disabled={loading}
                    >
                      {item}
                    </button>
                  ) : (
                    <span
                      className="cuotas-pagination__ellipsis"
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
                    setPagina((actual) => Math.min(totalPaginas, actual + 1))
                  }
                  disabled={loading || pagina >= totalPaginas}
                >
                  Siguiente
                </button>
                </div>
              ) : null}
            </nav>
          ) : null}

          <div
            className="cuotas-lower-actions"
            aria-label="Acciones de cuotas"
          >
            <button
              type="button"
              className="mov-btn mov-btn--ghost cuotas-lower-action"
              onClick={printAllFiltered}
              disabled={loading || printingAll || totalRegistros === 0}
              title="Abrir todos los comprobantes que coinciden con los filtros actuales, incluyendo todas las páginas"
            >
              <FontAwesomeIcon icon={faPrint} />
              {printingAll ? "Preparando..." : "Imprimir"}
            </button>
            {writable ? (
              <button
                type="button"
                className="mov-btn cuotas-lower-action cuotas-barcode-lower-action"
                onClick={() => setBarcodeOpen(true)}
                title="Registrar una cuota leyendo el código del comprobante"
              >
                <FontAwesomeIcon icon={faBarcode} />
                Cód. barras
              </button>
            ) : null}

            <BotonExportarGlobal
              label="Exportar"
              className="cuotas-lower-action mov-btn--compact"
              onClick={() => setExportModalOpen(true)}
              disabled={loading || itemsPagina.length === 0}
              title="Exportar cuotas en Excel o PDF"
            />

            {writable && !isResolved ? (
              <button
                type="button"
                className={`mov-btn cuotas-lower-action cuotas-multiple-action ${multiMode ? "mov-btn--danger" : "mov-btn--primary"}`}
                onClick={toggleMultipleMode}
              >
                <FontAwesomeIcon icon={faUserGroup} />
                {multiMode ? "Cancelar selección" : "Seleccionar"}
              </button>
            ) : null}
          </div>
        </div>
      </ModulePage>

      <ModalExportarGlobal
        open={exportModalOpen}
        title="Exportar cuotas"
        subtitle="Elegí el alcance y descargá la información en Excel o PDF."
        tituloArchivo="Cuotas"
        subtituloArchivoActual={`${exportFilterDescription} · Página ${pagina} de ${Math.max(1, totalPaginas)}`}
        subtituloArchivoTodos={exportFilterDescription}
        nombreArchivo={`cuotas-${isPaid ? "pagadas" : isCondoned ? "condonadas" : "adeudadas"}`}
        columnas={CUOTAS_EXPORT_COLUMNS}
        registrosActuales={exportRecords(itemsPagina)}
        obtenerRegistrosTodos={obtenerTodosParaExportar}
        cantidadActual={itemsPagina.length}
        cantidadTodos={totalRegistros}
        mostrarAlcanceTodos={totalRegistros > itemsPagina.length}
        alcanceActualLabel={totalPaginas > 1 ? "Exportar esta página" : "Exportar registros visibles"}
        alcanceActualDescription="Descarga las cuotas visibles con los filtros actuales."
        alcanceTodosLabel="Exportar todas las cuotas filtradas"
        alcanceTodosDescription="Descarga todas las páginas que coinciden con los filtros actuales."
        totalLabelSingular="cuota disponible"
        totalLabelPlural="cuotas disponibles"
        onClose={() => setExportModalOpen(false)}
        onSuccess={(message) =>
          setFeedback({ type: "success", message, duration: 4200 })
        }
        onError={(message) =>
          setFeedback({ type: "error", message, duration: 5200 })
        }
      />

      <ModalPagoCuota
        paymentOpen={paymentOpen}
        paymentMode={paymentMode}
        tipo={tipo}
        paymentForm={paymentForm}
        entityLabel={entityLabel}
        closePayment={closePayment}
        submitPayment={submitPayment}
        submitRegistration={submitRegistration}
        requestDeleteRegistration={requestDeleteRegistration}
        saving={saving}
        selectedMonthIds={selectedMonthIds}
        family={family}
        familyPaymentCount={familyPaymentCount}
        contextLoading={contextLoading}
        registrationContext={registrationContext}
        paymentTotal={paymentTotal}
        money={money}
        selectedPartner={selectedPartner}
        principal={principal}
        setPaymentForm={setPaymentForm}
        updatePaymentDate={updatePaymentDate}
        paymentYearOptions={paymentYearOptions}
        updatePaymentYear={updatePaymentYear}
        paymentPeriodAmount={paymentPeriodAmount}
        availableMonthIds={availableMonthIds}
        annualPaymentAvailable={annualPaymentAvailable}
        allAvailableMonthsSelected={allAvailableMonthsSelected}
        toggleAllPaymentMonths={toggleAllPaymentMonths}
        monthOptions={monthOptions}
        paymentPeriods={paymentPeriods}
        togglePaymentMonth={togglePaymentMonth}
        catalogos={catalogos}
        updateMonthAmountOption={updateMonthAmountOption}
        toggleMonthCustomAmount={toggleMonthCustomAmount}
        updateMonthCustomAmount={updateMonthCustomAmount}
        updateRegistrationAmount={updateRegistrationAmount}
        updateBatchAmountOption={updateBatchAmountOption}
      />

      <ModalComprobantePago
        open={Boolean(receipt)}
        comprobante={receipt}
        onClose={() => setReceipt(null)}
        onPrint={() => openPaymentReceipt(receipt, { openPrintDialog: true })}
        onExportPdf={() => downloadPaymentReceiptPdf(receipt)}
      />

      <ModalCodigoBarras
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        mediosPago={catalogos.medios_pago || []}
        onSaved={handleBarcodeSaved}
      />

      <ModalEliminarGlobal
        open={Boolean(registrationDeleteRow)}
        operacion="eliminar"
        row={registrationDeleteRow}
        onClose={() => {
          setRegistrationDeleteRow(null);
          setPaymentOpen(true);
        }}
        onConfirm={deleteRegistrationPayment}
        title="Eliminar pago de inscripción"
        message="¿Deseás eliminar este pago de inscripción?"
        warning="La inscripción volverá a quedar pendiente y podrá registrarse nuevamente con otro monto, fecha o medio de pago."
        confirmLabel="Eliminar pago"
        loadingMessage="Eliminando pago de inscripción…"
        successMessage="Pago de inscripción eliminado correctamente."
        errorMessage="No se pudo eliminar el pago de inscripción."
        details={[
          {
            label: "Socio",
            value: registrationDeleteRow?.denominacion,
          },
          {
            label: "Fecha",
            value: formatDate(registrationDeleteRow?.fecha_pago),
          },
          {
            label: "Importe",
            value: money(registrationDeleteRow?.monto),
          },
          {
            label: "Medio",
            value: registrationDeleteRow?.medio_pago || "—",
          },
        ]}
      />

      <ModalEliminarGlobal
        open={Boolean(condoneRow)}
        operacion="advertencia"
        row={condoneRow}
        onClose={() => setCondoneRow(null)}
        onConfirm={condonePayment}
        title="Condonar cuota"
        message="¿Seguro que querés condonar esta cuota?"
        warning="El período dejará de figurar como deuda, pero no se registrará ningún ingreso: quedará con estado CONDONADO e importe $0,00."
        confirmLabel="Condonar cuota"
        loadingMessage="Condonando cuota…"
        successMessage="Cuota condonada correctamente."
        errorMessage="No se pudo condonar la cuota."
        details={[
          {
            label: "Socio",
            value: condoneRow?.denominacion,
          },
          { label: "Período", value: condoneRow?.periodo },
          { label: "Estado final", value: "CONDONADO" },
          { label: "Importe contable", value: money(0) },
        ]}
      />

      <ModalEliminarGlobal
        open={Boolean(deleteRow)}
        operacion="eliminar"
        row={deleteRow}
        onClose={() => setDeleteRow(null)}
        onConfirm={deletePayment}
        modalClassName={`cuotas-delete-modal ${
          deletingAnnual
            ? "cuotas-delete-modal--annual"
            : "cuotas-delete-modal--standard"
        }`}
        title={
          deletingAnnual
            ? "Eliminar Contado Anual"
            : deleteRow?.estado === "CONDONADO"
              ? "Eliminar condonación"
              : "Eliminar pago"
        }
        message={
          deletingAnnual
            ? "¿Deseás eliminar este pago de Contado Anual?"
            : deleteRow?.estado === "CONDONADO"
              ? `¿Deseás eliminar la condonación de ${deletePeriodLabel}?`
              : `¿Deseás eliminar el pago de ${deletePeriodLabel}?`
        }
        warning={
          deletingAnnual
            ? "Este pago corresponde a Contado Anual. Si eliminás este pago, también eliminás el Contado Anual y los seis períodos volverán a figurar como deuda."
            : ""
        }
        confirmLabel={
          deletingAnnual
            ? "Eliminar Contado Anual"
            : deleteRow?.estado === "CONDONADO"
              ? "Eliminar condonación"
              : "Eliminar pago"
        }
        loadingMessage={deleteRow?.estado === "CONDONADO" ? "Eliminando condonación…" : "Eliminando pago…"}
        successMessage="Cuota eliminada correctamente."
        errorMessage={deleteRow?.estado === "CONDONADO" ? "No se pudo eliminar la condonación." : "No se pudo eliminar el pago."}
        details={[
          {
            label: "Socio",
            value: deleteRow?.denominacion,
          },
          { label: "Período", value: deletePeriodLabel },
          { label: "Estado", value: deleteRow?.estado || "PAGADO" },
          { label: "Importe", value: money(deleteRow?.monto) },
          { label: "Medio", value: deleteRow?.medio_pago || "—" },
        ]}
      />
    </>
  );
}
