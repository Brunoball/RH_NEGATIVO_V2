import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAddressBook,
  faCalendarDays,
  faCakeCandles,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCircleInfo,
  faClockRotateLeft,
  faEye,
  faFilter,
  faDroplet,
  faIdCard,
  faPen,
  faReceipt,
  faRotateLeft,
  faTags,
  faTrashCan,
  faUser,
  faUserSlash,
  faWallet,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../Global/ModulePage";
import GlobalDivTable from "../Global/GlobalDivTable";
import CrudModal from "../Global/Modales/CrudModal";
import InfoModal, {
  InfoEmpty,
  InfoRow,
  InfoSection,
  InfoSummary,
} from "../Global/Modales/InfoModal";
import ModalEliminarGlobal from "../Global/Modales/ModalEliminarGlobal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import ModuleFeedback from "../Global/ModuleFeedback";
import BotonExportarGlobal from "../Global/Botones/BotonExportarGlobal";
import {
  EntityFormPanel,
  EntityTabPane,
  EntityTabs,
  FloatingField,
} from "../Global/Formularios/TabbedForm";
import { openNativePicker } from "../Global/Formularios/nativePicker";
import {
  addressInput,
  addressNumberInput,
  dniInput,
  personNameInput,
  phoneInput,
  upperLimitedText,
} from "../Global/Formularios/inputSanitizers";
import { normalizeSearchQuery } from "../Global/Formularios/searchUtils";
import { canWrite } from "../_shared/auth/session";
import { sociosApi } from "./api/sociosApi";
import { useSocios } from "./hooks/useSocios";
import "./Socios.css";

const PAGE_SIZE = 100;
const STATUS_STORAGE_KEY = "rh_v2_socios_vigencia";
const FORM_TAB_PERSONAL = "personal";
const FORM_TAB_MANAGEMENT = "gestion";
const INFO_TAB_GENERAL = "general";
const INFO_TAB_CONTACTS = "contactos";
const INFO_TAB_PAYMENTS = "pagos";
const INFO_TAB_HISTORY = "historial";

const CONTACT_OPTIONS = [
  { value: "CONTACTADO", label: "Contactados" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "NO_CONTACTADO", label: "No contactados" },
  { value: "SIN_GESTION", label: "Sin gestión" },
];
const DEBT_OPTIONS = [
  { value: "AL_DIA", label: "Al día" },
  { value: "DEBE_1_2", label: "Debe 1 o 2 meses" },
  { value: "DEBE_3_MAS", label: "Debe 3 meses o más" },
];
const LETTERS = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ".split("");

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function formatDate(value) {
  if (!value) return "—";
  const source = String(value).slice(0, 10);
  const [year, month, day] = source.split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  const text = String(value).replace("T", " ");
  const [date, time = ""] = text.split(" ");
  return `${formatDate(date)}${time ? ` · ${time.slice(0, 5)}` : ""}`;
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function readStatus() {
  if (typeof window === "undefined") return "VIGENTE";
  try {
    return window.sessionStorage.getItem(STATUS_STORAGE_KEY) === "BAJA"
      ? "BAJA"
      : "VIGENTE";
  } catch {
    return "VIGENTE";
  }
}

function saveStatus(value) {
  try {
    window.sessionStorage.setItem(
      STATUS_STORAGE_KEY,
      value === "BAJA" ? "BAJA" : "VIGENTE",
    );
  } catch {
    // La pantalla sigue funcionando aunque el storage esté bloqueado.
  }
}

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

function emptyAdvancedFilters() {
  return {
    letra: "",
    grupo_sanguineo: "",
    estado: "",
    deuda: "",
    ultimo_contacto: "",
    ingreso_desde: "",
    ingreso_hasta: "",
  };
}

function countAdvanced(filters) {
  return Object.values(filters).filter((value) => String(value || "").trim()).length;
}

function findOptionLabel(options, value, valueKey = "value", labelKey = "label") {
  return (
    options.find((option) => String(option?.[valueKey]) === String(value))?.[labelKey] ||
    String(value)
  );
}

function buildAdvancedFilterChips(filters, catalogs) {
  return [
    filters.letra
      ? { key: "letra", label: "Inicial", value: filters.letra }
      : null,
    filters.grupo_sanguineo
      ? {
          key: "grupo_sanguineo",
          label: "T.S.",
          value: findOptionLabel(
            catalogs.grupos_sanguineos || [],
            filters.grupo_sanguineo,
            "id_grupo_sanguineo",
            "nombre",
          ),
        }
      : null,
    filters.estado
      ? {
          key: "estado",
          label: "Estado",
          value: findOptionLabel(
            catalogs.estados || [],
            filters.estado,
            "id_estado",
            "nombre",
          ),
        }
      : null,
    filters.deuda
      ? {
          key: "deuda",
          label: "Pagos",
          value: findOptionLabel(DEBT_OPTIONS, filters.deuda),
        }
      : null,
    filters.ultimo_contacto
      ? {
          key: "ultimo_contacto",
          label: "Último contacto",
          value: findOptionLabel(CONTACT_OPTIONS, filters.ultimo_contacto),
        }
      : null,
    filters.ingreso_desde
      ? {
          key: "ingreso_desde",
          label: "Ingreso desde",
          value: formatDate(filters.ingreso_desde),
        }
      : null,
    filters.ingreso_hasta
      ? {
          key: "ingreso_hasta",
          label: "Ingreso hasta",
          value: formatDate(filters.ingreso_hasta),
        }
      : null,
  ].filter(Boolean);
}

function selectOnlyActive(items, key) {
  const activeItems = (items || []).filter((item) => item.activo !== false);
  return activeItems.length === 1 ? String(activeItems[0]?.[key] || "") : "";
}

function emptyForm(catalogs = {}) {
  return {
    id_socio: "",
    nombre: "",
    apellido: "",
    dni: "",
    fecha_nacimiento: "",
    id_grupo_sanguineo: "",
    domicilio: "",
    numero: "",
    telefono_movil: "",
    telefono_fijo: "",
    domicilio_cobro: "",
    fecha_ingreso: localToday(),
    id_estado: "",
    id_categoria: selectOnlyActive(catalogs.categorias, "id_categoria"),
    id_cobrador: "",
    observaciones: "",
  };
}

function splitPersonFullName(item) {
  const rawName = String(item?.nombre || "").trim();
  const rawLastName = String(item?.apellido || "").trim();

  if (rawLastName) {
    return { nombre: rawName, apellido: rawLastName };
  }

  const parts = rawName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { nombre: rawName, apellido: "" };
  }

  return {
    nombre: parts.slice(0, -1).join(" "),
    apellido: parts.at(-1) || "",
  };
}

function formFromItem(item) {
  const personName = splitPersonFullName(item);
  return {
    id_socio: item.id_socio,
    nombre: personName.nombre,
    apellido: personName.apellido,
    dni: item.dni || "",
    fecha_nacimiento: item.fecha_nacimiento || "",
    id_grupo_sanguineo: item.id_grupo_sanguineo
      ? String(item.id_grupo_sanguineo)
      : "",
    domicilio: item.domicilio || "",
    numero: item.numero || "",
    telefono_movil: item.telefono_movil || "",
    telefono_fijo: item.telefono_fijo || "",
    domicilio_cobro: item.domicilio_cobro || "",
    fecha_ingreso: item.fecha_ingreso || "",
    id_estado: item.id_estado ? String(item.id_estado) : "",
    id_categoria: item.id_categoria ? String(item.id_categoria) : "",
    id_cobrador: item.id_cobrador ? String(item.id_cobrador) : "",
    observaciones: item.observaciones || "",
  };
}

function contactLabel(value) {
  const key = String(value || "").toUpperCase();
  if (key === "CONTACTADO") return "CONTACTADO";
  if (key === "PENDIENTE") return "PENDIENTE";
  if (key === "NO_CONTACTADO") return "NO CONTACTADO";
  return "SIN GESTIÓN";
}

function debtLabel(months) {
  const count = Number(months || 0);
  if (count <= 0) return "AL DÍA";
  return `DEBE ${count} ${count === 1 ? "MES" : "MESES"}`;
}

function statusChipTone(item) {
  const status = String(item?.estado || "").trim().toLocaleUpperCase("es-AR");
  const isPassive =
    !item?.vigente ||
    status.includes("PASIV") ||
    status.includes("INACTIV") ||
    status === "BAJA";

  return isPassive ? "is-inactive" : "is-active";
}

const EXPORT_COLUMNS = [
  { label: "ID", key: "id_socio" },
  { label: "Socio", key: "nombre" },
  { label: "DNI", value: (item) => item.dni || "—" },
  { label: "Grupo sanguíneo", value: (item) => item.grupo_sanguineo || "—" },
  { label: "Estado", value: (item) => item.estado || "—" },
  { label: "Categoría", value: (item) => item.categoria || "—" },
  { label: "Cobrador", value: (item) => item.cobrador || "—" },
  { label: "Fecha ingreso", value: (item) => formatDate(item.fecha_ingreso) },
  { label: "Teléfono móvil", value: (item) => item.telefono_movil || "—" },
  { label: "Deuda actual", value: (item) => debtLabel(item.meses_adeudados) },
  {
    label: "Último contacto",
    value: (item) =>
      item.ultimo_contacto_fecha
        ? `${formatDate(item.ultimo_contacto_fecha)} · ${contactLabel(item.ultimo_contacto_estado)}`
        : "SIN GESTIÓN",
  },
  { label: "Vigencia", value: (item) => (item.vigente ? "VIGENTE" : "BAJA") },
];

function AccordionSection({ title, active, children, onToggle }) {
  return (
    <section className={`socios-filterSection ${active ? "is-open" : ""}`.trim()}>
      <button type="button" className="socios-filterSection__head" onClick={onToggle}>
        <span>{title}</span>
        <FontAwesomeIcon icon={faChevronDown} />
      </button>
      {active ? <div className="socios-filterSection__body">{children}</div> : null}
    </section>
  );
}

function ChoiceList({ options, value, onChange }) {
  return (
    <div className="socios-filterChoices">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={String(value) === String(option.value) ? "is-selected" : ""}
          onClick={() => onChange(String(value) === String(option.value) ? "" : String(option.value))}
        >
          <span>{option.label}</span>
          {String(value) === String(option.value) ? <FontAwesomeIcon icon={faCheck} /> : null}
        </button>
      ))}
    </div>
  );
}

function AdvancedFilters({ filters, catalogs, onChange, onReset }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("");
  const rootRef = useRef(null);
  const activeCount = countAdvanced(filters);

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

  const update = (key, value) => onChange({ ...filters, [key]: value });
  const toggle = (key) => setSection((current) => (current === key ? "" : key));

  return (
    <div className="socios-filterRoot" ref={rootRef}>
      <button
        type="button"
        className={`socios-filterTrigger ${open ? "is-open" : ""}`.trim()}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <FontAwesomeIcon icon={faFilter} />
        <span>Aplicar Filtros</span>
        {activeCount ? <strong>{activeCount}</strong> : null}
        <FontAwesomeIcon icon={faChevronDown} className="socios-filterTrigger__arrow" />
      </button>

      {open ? (
        <div className="socios-filterMenu">
          <AccordionSection
            title="Filtrar de la A a la Z"
            active={section === "letter"}
            onToggle={() => toggle("letter")}
          >
            <div className="socios-letterGrid">
              {LETTERS.map((letter) => (
                <button
                  type="button"
                  key={letter}
                  className={filters.letra === letter ? "is-selected" : ""}
                  onClick={() => update("letra", filters.letra === letter ? "" : letter)}
                >
                  {letter}
                </button>
              ))}
            </div>
          </AccordionSection>

          <AccordionSection
            title="Tipo de sangre"
            active={section === "blood"}
            onToggle={() => toggle("blood")}
          >
            <ChoiceList
              options={(catalogs.grupos_sanguineos || []).map((item) => ({
                value: item.id_grupo_sanguineo,
                label: item.nombre,
              }))}
              value={filters.grupo_sanguineo}
              onChange={(value) => update("grupo_sanguineo", value)}
            />
          </AccordionSection>

          <AccordionSection
            title="Estado"
            active={section === "state"}
            onToggle={() => toggle("state")}
          >
            <ChoiceList
              options={(catalogs.estados || []).map((item) => ({
                value: item.id_estado,
                label: item.nombre,
              }))}
              value={filters.estado}
              onChange={(value) => update("estado", value)}
            />
          </AccordionSection>

          <AccordionSection
            title="Pagos"
            active={section === "debt"}
            onToggle={() => toggle("debt")}
          >
            <ChoiceList
              options={DEBT_OPTIONS}
              value={filters.deuda}
              onChange={(value) => update("deuda", value)}
            />
          </AccordionSection>

          <AccordionSection
            title="Último contacto"
            active={section === "contact"}
            onToggle={() => toggle("contact")}
          >
            <ChoiceList
              options={CONTACT_OPTIONS}
              value={filters.ultimo_contacto}
              onChange={(value) => update("ultimo_contacto", value)}
            />
          </AccordionSection>

          <AccordionSection
            title="Fecha de ingreso"
            active={section === "joined"}
            onToggle={() => toggle("joined")}
          >
            <div className="socios-dateFilter">
              <label>
                <span><FontAwesomeIcon icon={faCalendarDays} /> Desde</span>
                <input
                  type="date"
                  value={filters.ingreso_desde}
                  max={filters.ingreso_hasta || localToday()}
                  onClick={openNativePicker}
                  onChange={(event) => update("ingreso_desde", event.target.value)}
                />
              </label>
              <label>
                <span><FontAwesomeIcon icon={faCalendarDays} /> Hasta</span>
                <input
                  type="date"
                  value={filters.ingreso_hasta}
                  min={filters.ingreso_desde || undefined}
                  max={localToday()}
                  onClick={openNativePicker}
                  onChange={(event) => update("ingreso_hasta", event.target.value)}
                />
              </label>
              <div className="socios-dateFilter__actions">
                <button
                  type="button"
                  className="is-clear"
                  onClick={() => onChange({ ...filters, ingreso_desde: "", ingreso_hasta: "" })}
                >
                  Limpiar
                </button>
                <button type="button" className="is-apply" onClick={() => setOpen(false)}>
                  Aplicar
                </button>
              </div>
            </div>
          </AccordionSection>

          <button
            type="button"
            className="socios-filterReset"
            onClick={() => {
              onReset();
              setSection("");
              setOpen(false);
            }}
          >
            Mostrar Todos
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ActiveFilterChips({ chips, onRemove }) {
  if (!chips.length) return null;

  return (
    <section className="socios-activeFilters" aria-label="Filtros avanzados activos">
      <div className="socios-activeFilters__list">
        {chips.map((chip) => (
          <span className="socios-activeFilterChip" key={chip.key}>
            <span>
              {chip.label}: <strong>{chip.value}</strong>
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

function BirthdayContactCard({ items, onView, onClose, writable }) {
  const [index, setIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!items.length) setIndex(0);
    else if (index >= items.length) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);

  if (!items.length || typeof document === "undefined") return null;
  const item = items[index];
  const move = (direction) => {
    setIndex((current) => (current + direction + items.length) % items.length);
  };

  const close = async () => {
    if (!writable || closing) return;
    setClosing(true);
    try {
      await onClose(item);
    } finally {
      setClosing(false);
    }
  };

  return createPortal(
    <aside
      className={`socios-birthdayDrawer${open ? " is-open" : ""}`}
      aria-label="Socios para contactar de 18 a 23 años"
    >
      <button
        type="button"
        className="socios-birthdayDrawer__toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Cerrar avisos de cumpleaños" : "Abrir avisos de cumpleaños"}
        title={open ? "Cerrar avisos de cumpleaños" : `${items.length} ${items.length === 1 ? "socio para contactar" : "socios para contactar"}`}
      >
        <FontAwesomeIcon icon={open ? faChevronRight : faCakeCandles} />
      </button>

      <div className="socios-birthdayCard">
        <header>
          <span className="socios-birthdayCard__icon" aria-hidden="true"><FontAwesomeIcon icon={faCakeCandles} /></span>
          <div>
            <small>SOCIOS PARA CONTACTAR</small>
            <strong>18 a 23 años</strong>
          </div>
          <span className="socios-birthdayCard__counter">{index + 1}/{items.length}</span>
          {writable ? (
            <button
              type="button"
              className="socios-birthdayCard__close"
              onClick={close}
              disabled={closing}
              title="Marcar aviso como gestionado este año"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          ) : null}
        </header>
        <div className="socios-birthdayCard__body">
          <strong className="socios-birthdayCard__name">{item.nombre}</strong>
          <p>Tiene <b>{item.edad} años</b>. Podés contactarlo para actualizar sus datos o hacer seguimiento.</p>
          <div className="socios-birthdayCard__meta">
            <span>ID <b>{item.id_socio}</b></span>
            <span>NAC. <b>{formatDate(item.fecha_nacimiento)}</b></span>
          </div>
        </div>
        <footer>
          <button type="button" className="socios-birthdayCard__nav" onClick={() => move(-1)} disabled={items.length < 2}>
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <button type="button" className="socios-birthdayCard__view" onClick={() => onView(item)}>
            <FontAwesomeIcon icon={faEye} /> Ver socio
          </button>
          <button type="button" className="socios-birthdayCard__nav" onClick={() => move(1)} disabled={items.length < 2}>
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        </footer>
      </div>
    </aside>,
    document.body
  );
}

const SociosRows = memo(function SociosRows({ items, writable, onHistory, onEdit, onState, onDelete }) {
  return items.map((item) => (
    <div
      className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row socios-grid"
      role="row"
      key={item.id_socio}
    >
      <div className="mov-gridCell is-strong is-center socios-idCell">{item.id_socio}</div>
      <div className="mov-gridCell entity-main-cell">
        <strong>{item.nombre}</strong>
        <small>
          {[item.domicilio, item.numero].filter(Boolean).join(" ") || "SIN DOMICILIO"}
        </small>
      </div>
      <div className="mov-gridCell is-center">
        <span className="socios-bloodChip">{item.grupo_sanguineo || "SIN DATO"}</span>
      </div>
      <div className="mov-gridCell socios-statusCell is-center">
        <span className={`socios-statusChip ${statusChipTone(item)}`}>
          {item.vigente ? (item.estado || "ACTIVO") : "BAJA"}
        </span>
      </div>
      <div className="mov-gridCell is-center">
        <span className={`socios-debtChip ${Number(item.meses_adeudados) ? "is-due" : "is-ok"}`}>
          {debtLabel(item.meses_adeudados)}
        </span>
      </div>
      <div className="mov-gridCell entity-main-cell socios-contactCell">
        <strong>{contactLabel(item.ultimo_contacto_estado)}</strong>
        <small>{item.ultimo_contacto_fecha ? formatDate(item.ultimo_contacto_fecha) : "SIN FECHA"}</small>
      </div>
      <div className="mov-gridCell mov-gridCell--actions">
        <div className="mov-actionsInline">
          <button className="mov-iconBtn" type="button" title="Ver ficha, contactos, pagos e historial" onClick={() => onHistory(item)}>
            <FontAwesomeIcon icon={faCircleInfo} />
          </button>
          {writable ? (
            <>
              <button className="mov-iconBtn" type="button" title="Editar socio" onClick={() => onEdit(item)}>
                <FontAwesomeIcon icon={faPen} />
              </button>
              <button
                className={`mov-iconBtn socios-state-action ${item.vigente ? "is-deactivation" : "is-reactivation"}`}
                type="button"
                title={item.vigente ? "Dar de baja" : "Reactivar"}
                onClick={() => onState(item)}
              >
                <FontAwesomeIcon icon={item.vigente ? faUserSlash : faRotateLeft} />
              </button>
              <button
                className="mov-iconBtn mov-iconBtn--danger"
                type="button"
                title="Eliminar socio definitivamente"
                onClick={() => onDelete(item)}
              >
                <FontAwesomeIcon icon={faTrashCan} />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  ));
});

function PartnerForm({ form, setForm, catalogs, activeTab, onTabChange }) {
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setText = (key, value, maxLength) => set(key, upperLimitedText(value, maxLength));
  const tabs = [
    { value: FORM_TAB_PERSONAL, label: "Datos personales", icon: faIdCard },
    { value: FORM_TAB_MANAGEMENT, label: "Gestión", icon: faTags },
  ];
  const activeValue = (key) => String(form[key] || "").trim() !== "";

  return (
    <div className="socios-form">
      <EntityTabs tabs={tabs} value={activeTab} onChange={onTabChange} idPrefix="socios-form" ariaLabel="Datos del socio" />

      <EntityTabPane active={activeTab === FORM_TAB_PERSONAL} disableWhenInactive>
        <EntityFormPanel tabValue={FORM_TAB_PERSONAL} idPrefix="socios-form" title="Identificación y contacto" icon={faUser}>
          <FloatingField label="Nombre *" active={activeValue("nombre")}>
            <input
              value={form.nombre}
              maxLength={50}
              onChange={(event) => set("nombre", personNameInput(event.target.value, 50))}
              required
              placeholder=" "
              autoComplete="given-name"
            />
          </FloatingField>
          <FloatingField label="Apellido *" active={activeValue("apellido")}>
            <input
              value={form.apellido}
              maxLength={50}
              onChange={(event) => set("apellido", personNameInput(event.target.value, 50))}
              required
              placeholder=" "
              autoComplete="family-name"
            />
          </FloatingField>
          <FloatingField label="DNI" active={activeValue("dni")}>
            <input
              value={form.dni}
              inputMode="numeric"
              maxLength={8}
              minLength={8}
              pattern="[0-9]{8}"
              title="El DNI debe tener exactamente 8 números."
              onChange={(event) => set("dni", dniInput(event.target.value))}
              placeholder=" "
              autoComplete="off"
            />
          </FloatingField>
          <FloatingField label="Fecha de nacimiento" active>
            <input type="date" value={form.fecha_nacimiento} max={localToday()} onChange={(event) => set("fecha_nacimiento", event.target.value)} />
          </FloatingField>
          <FloatingField label="Grupo sanguíneo" active>
            <select value={form.id_grupo_sanguineo} onChange={(event) => set("id_grupo_sanguineo", event.target.value)}>
              <option value="">NO SELECCIONADO</option>
              {(catalogs.grupos_sanguineos || []).map((item) => (
                <option key={item.id_grupo_sanguineo} value={item.id_grupo_sanguineo}>{item.nombre}</option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Domicilio" active={activeValue("domicilio")}>
            <input value={form.domicilio} maxLength={100} onChange={(event) => set("domicilio", addressInput(event.target.value, 100))} placeholder=" " autoComplete="street-address" />
          </FloatingField>
          <FloatingField label="Número" active={activeValue("numero")}>
            <input
              value={form.numero}
              maxLength={20}
              inputMode="numeric"
              pattern="[0-9]*"
              onChange={(event) => set("numero", addressNumberInput(event.target.value, 20))}
              placeholder=" "
              autoComplete="off"
            />
          </FloatingField>
          <FloatingField label="Teléfono móvil" active={activeValue("telefono_movil")}>
            <input
              value={form.telefono_movil}
              inputMode="tel"
              maxLength={15}
              pattern="[0-9]{6,15}"
              title="Ingresá entre 6 y 15 números, sin espacios ni símbolos."
              onChange={(event) => set("telefono_movil", phoneInput(event.target.value))}
              placeholder=" "
              autoComplete="tel"
            />
          </FloatingField>
          <FloatingField label="Teléfono fijo" active={activeValue("telefono_fijo")}>
            <input
              value={form.telefono_fijo}
              inputMode="tel"
              maxLength={15}
              pattern="[0-9]{6,15}"
              title="Ingresá entre 6 y 15 números, sin espacios ni símbolos."
              onChange={(event) => set("telefono_fijo", phoneInput(event.target.value))}
              placeholder=" "
              autoComplete="tel"
            />
          </FloatingField>
          <FloatingField label="Domicilio de cobro" wide active={activeValue("domicilio_cobro")}>
            <input value={form.domicilio_cobro} maxLength={150} onChange={(event) => set("domicilio_cobro", addressInput(event.target.value, 150))} placeholder=" " />
          </FloatingField>
        </EntityFormPanel>
      </EntityTabPane>

      <EntityTabPane active={activeTab === FORM_TAB_MANAGEMENT} disableWhenInactive>
        <EntityFormPanel tabValue={FORM_TAB_MANAGEMENT} idPrefix="socios-form" title="Configuración del socio" icon={faTags}>
          <FloatingField label="Fecha de ingreso" active={activeValue("fecha_ingreso")}>
            <input type="date" value={form.fecha_ingreso} max={localToday()} onChange={(event) => set("fecha_ingreso", event.target.value)} />
          </FloatingField>
          <FloatingField label="Estado" active={activeValue("id_estado")}>
            <select value={form.id_estado} onChange={(event) => set("id_estado", event.target.value)}>
              <option value="">NO SELECCIONADO</option>
              {(catalogs.estados || []).map((item) => (
                <option key={item.id_estado} value={item.id_estado}>{item.nombre}{item.activo ? "" : " (INACTIVO)"}</option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Categoría *" active={activeValue("id_categoria")}>
            <select value={form.id_categoria} onChange={(event) => set("id_categoria", event.target.value)} required>
              <option value="">NO SELECCIONADO</option>
              {(catalogs.categorias || []).map((item) => (
                <option key={item.id_categoria} value={item.id_categoria}>{item.nombre}{item.activo ? "" : " (INACTIVA)"}</option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Cobrador *" active={activeValue("id_cobrador")}>
            <select value={form.id_cobrador} onChange={(event) => set("id_cobrador", event.target.value)} required>
              <option value="">NO SELECCIONADO</option>
              {(catalogs.cobradores || []).map((item) => (
                <option key={item.id_cobrador} value={item.id_cobrador}>{item.nombre}{item.activo ? "" : " (INACTIVO)"}</option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Observaciones" wide textarea active={activeValue("observaciones")}>
            <textarea value={form.observaciones} maxLength={8000} rows={5} onChange={(event) => setText("observaciones", event.target.value, 8000)} placeholder=" " />
          </FloatingField>
        </EntityFormPanel>
      </EntityTabPane>
    </div>
  );
}

function StateHistory({ events = [] }) {
  if (!events.length) return <InfoEmpty>No hay movimientos de estado registrados.</InfoEmpty>;
  return events.map((event) => {
    const label = String(event.tipo_evento || "MOVIMIENTO").replaceAll("_", " ");
    const states = [event.estado_anterior, event.estado_nuevo].filter(Boolean).join(" → ");
    const vigence =
      event.vigente_anterior === null || event.vigente_nuevo === null
        ? ""
        : `${event.vigente_anterior ? "VIGENTE" : "BAJA"} → ${event.vigente_nuevo ? "VIGENTE" : "BAJA"}`;
    return (
      <InfoRow
        key={event.id_historial}
        title={label}
        detail={[states, vigence, event.motivo].filter(Boolean).join(" · ")}
        meta={`${formatDateTime(event.fecha_evento || event.creado_en)}${event.usuario ? ` · ${event.usuario}` : ""}`}
        tone={event.tipo_evento === "BAJA" ? "warning" : event.tipo_evento === "REACTIVACION" || event.tipo_evento === "ALTA" ? "success" : ""}
      />
    );
  });
}

function ContactsPanel({ contacts, writable, saving, onSave }) {
  const [form, setForm] = useState({
    fecha_contacto: localToday(),
    estado_contacto: "CONTACTADO",
    detalle_contacto: "",
  });

  const submit = async () => {
    if (!form.fecha_contacto || !form.estado_contacto) return;
    const ok = await onSave(form);
    if (ok) {
      setForm({ fecha_contacto: localToday(), estado_contacto: "CONTACTADO", detalle_contacto: "" });
    }
  };

  return (
    <div className="socios-contactPanel">
      {writable ? (
        <div className="socios-contactForm">
          <div className="socios-contactForm__head">
            <div>
              <small>NUEVA GESTIÓN</small>
              <strong>Registrar último contacto</strong>
            </div>
            <button className="mov-btn mov-btn--primary" type="button" onClick={submit} disabled={saving || !form.fecha_contacto || !form.estado_contacto}>
              {saving ? "Guardando..." : "Registrar gestión"}
            </button>
          </div>
          <div className="socios-contactForm__grid">
            <FloatingField label="Fecha *" active>
              <input type="date" value={form.fecha_contacto} max={localToday()} onChange={(event) => setForm((current) => ({ ...current, fecha_contacto: event.target.value }))} required />
            </FloatingField>
            <FloatingField label="Resultado *" active>
              <select value={form.estado_contacto} onChange={(event) => setForm((current) => ({ ...current, estado_contacto: event.target.value }))} required>
                <option value="CONTACTADO">CONTACTADO</option>
                <option value="PENDIENTE">PENDIENTE</option>
                <option value="NO_CONTACTADO">NO CONTACTADO</option>
              </select>
            </FloatingField>
            <FloatingField
              label="Detalle"
              wide
              textarea
              active={Boolean(form.detalle_contacto)}
              placeholderOnFloat
            >
              <textarea value={form.detalle_contacto} maxLength={4000} rows={3} onChange={(event) => setForm((current) => ({ ...current, detalle_contacto: upperLimitedText(event.target.value, 4000) }))} placeholder="OBSERVACIÓN DE LA LLAMADA, MENSAJE O GESTIÓN..." />
            </FloatingField>
          </div>
        </div>
      ) : null}

      <InfoSection title="Historial de contactos" icon={faAddressBook} badge={contacts.length}>
        {contacts.length ? (
          contacts.map((contact) => (
            <InfoRow
              key={contact.id_contacto}
              title={contactLabel(contact.estado_contacto)}
              detail={contact.detalle_contacto || "Sin detalle adicional."}
              meta={`${formatDate(contact.fecha_contacto)}${contact.usuario ? ` · ${contact.usuario}` : ""}`}
              tone={contact.estado_contacto === "CONTACTADO" ? "success" : contact.estado_contacto === "PENDIENTE" ? "warning" : ""}
            />
          ))
        ) : (
          <InfoEmpty>Este socio todavía no tiene gestiones de contacto.</InfoEmpty>
        )}
      </InfoSection>
    </div>
  );
}

function PaymentsPanel({ item, payments = [], registrationPayments = [] }) {
  return (
    <div className="socios-paymentsPanel">
      <InfoSummary
        items={[
          {
            label: "Situación actual",
            value: debtLabel(item?.meses_adeudados),
            icon: faWallet,
            tone: Number(item?.meses_adeudados) ? "warning" : "success",
          },
          { label: "Pagos de cuota", value: payments.length, icon: faReceipt },
          { label: "Pagos de inscripción", value: registrationPayments.length, icon: faIdCard },
          { label: "Cuota mensual", value: formatMoney(item?.categoria_monto_mensual), icon: faTags },
        ]}
      />
      <div className="entity-info-grid">
        <InfoSection title="Pagos de cuotas" icon={faReceipt} badge={payments.length} className="socios-paymentHistory">
          {payments.length ? payments.map((payment) => (
            <InfoRow
              key={payment.id_pago}
              title={`${payment.periodo} · ${payment.anio_aplicado}`}
              detail={`${payment.estado}${payment.monto !== null ? ` · ${formatMoney(payment.monto)}` : ""}${payment.medio_pago ? ` · ${payment.medio_pago}` : ""}`}
              meta={formatDate(payment.fecha_pago)}
              tone={payment.estado === "CONDONADO" ? "warning" : "success"}
            />
          )) : <InfoEmpty>No hay pagos de cuotas registrados.</InfoEmpty>}
        </InfoSection>
        <InfoSection title="Inscripción" icon={faIdCard} badge={registrationPayments.length} className="socios-registrationHistory">
          {registrationPayments.length ? registrationPayments.map((payment) => (
            <InfoRow
              key={payment.id_inscripcion}
              title={formatMoney(payment.monto)}
              detail={payment.medio_pago || "MEDIO SIN INFORMAR"}
              meta={formatDate(payment.fecha_pago)}
              tone="success"
            />
          )) : <InfoEmpty>No hay pagos de inscripción registrados.</InfoEmpty>}
        </InfoSection>
      </div>
    </div>
  );
}

export default function Socios() {
  const writable = canWrite();
  const tableBodyRef = useRef(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState(readStatus);
  const [category, setCategory] = useState("");
  const [advanced, setAdvanced] = useState(emptyAdvancedFilters);
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(normalizeSearchQuery(search));
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters = useMemo(
    () => ({
      vigente: status,
      buscar: debouncedSearch,
      categoria: category,
      letra: advanced.letra,
      grupo_sanguineo: advanced.grupo_sanguineo,
      estado: advanced.estado,
      deuda: advanced.deuda,
      ultimo_contacto: advanced.ultimo_contacto,
      ingreso_desde: advanced.ingreso_desde,
      ingreso_hasta: advanced.ingreso_hasta,
      pagina: page,
    }),
    [status, debouncedSearch, category, advanced, page],
  );

  const {
    items,
    catalogos,
    paginacion,
    avisos_cumpleanios: birthdayItems,
    loading,
    error,
    cargar,
  } = useSocios(filters);

  const totalPages = Number(paginacion?.total_paginas || 0);
  const pages = useMemo(() => paginationItems(page, totalPages), [page, totalPages]);
  const activeAdvancedFilters = useMemo(
    () => buildAdvancedFilterChips(advanced, catalogos),
    [advanced, catalogos],
  );

  useEffect(() => {
    if (!loading && totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [loading, totalPages, page]);

  const [form, setForm] = useState(() => emptyForm());
  const [formTab, setFormTab] = useState(FORM_TAB_PERSONAL);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stateModal, setStateModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [stateDate, setStateDate] = useState(localToday());
  const [infoModal, setInfoModal] = useState(null);
  const [infoTab, setInfoTab] = useState(INFO_TAB_GENERAL);
  const [infoLoading, setInfoLoading] = useState(false);
  const infoRequestIdRef = useRef(0);
  const [contactSaving, setContactSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const resetAdvanced = useCallback(() => {
    setAdvanced(emptyAdvancedFilters());
    setCategory("");
    setPage(1);
  }, []);

  const setAdvancedFilters = useCallback((value) => {
    setAdvanced(value);
    setPage(1);
  }, []);

  const removeAdvancedFilter = useCallback((key) => {
    setAdvanced((current) => ({ ...current, [key]: "" }));
    setPage(1);
  }, []);

  const refresh = useCallback(async () => {
    const scrollTop = tableBodyRef.current?.scrollTop || 0;
    const result = await cargar();
    window.requestAnimationFrame(() => {
      if (tableBodyRef.current) tableBodyRef.current.scrollTop = scrollTop;
    });
    return result;
  }, [cargar]);

  const openNew = () => {
    setForm(emptyForm(catalogos));
    setFormTab(FORM_TAB_PERSONAL);
    setFormOpen(true);
  };

  const openEdit = async (item) => {
    try {
      const result = await sociosApi.obtener(item.id_socio);
      setForm(formFromItem(result.item || item));
      setFormTab(FORM_TAB_PERSONAL);
      setFormOpen(true);
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo cargar el socio." });
    }
  };

  const openDelete = async (item) => {
    setDeleteModal({ ...item, impacto_eliminacion: null });
    try {
      const response = await sociosApi.historial(item.id_socio);
      setDeleteModal((current) =>
        current?.id_socio === item.id_socio
          ? {
              ...(response.item || item),
              impacto_eliminacion: response.impacto_eliminacion || null,
            }
          : current,
      );
    } catch {
      // La confirmación puede continuar: el backend vuelve a calcular el impacto
      // dentro de la misma transacción antes de eliminar.
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!form.nombre.trim() || !form.apellido.trim()) {
      setFormTab(FORM_TAB_PERSONAL);
      setFeedback({
        type: "warning",
        message: "Completá nombre y apellido del socio. Los datos cargados se conservaron.",
      });
      return;
    }
    if (form.dni && dniInput(form.dni).length !== 8) {
      setFormTab(FORM_TAB_PERSONAL);
      setFeedback({ type: "error", message: "El DNI debe tener exactamente 8 números. Los datos cargados se conservaron." });
      return;
    }
    if ([form.telefono_movil, form.telefono_fijo].some((value) => value && phoneInput(value).length < 6)) {
      setFormTab(FORM_TAB_PERSONAL);
      setFeedback({ type: "error", message: "Los teléfonos deben contener entre 6 y 15 números. Los datos cargados se conservaron." });
      return;
    }
    if (!form.id_categoria || !form.id_cobrador) {
      setFormTab(FORM_TAB_MANAGEMENT);
      setFeedback({ type: "error", message: "Completá categoría y cobrador. Los datos cargados se conservaron." });
      return;
    }
    setSaving(true);
    try {
      const { apellido, ...payload } = form;
      payload.nombre = [form.nombre, apellido]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ");
      const response = await sociosApi.guardar(payload);
      setFeedback({ type: "success", message: response.mensaje || "Socio guardado correctamente." });
      setFormOpen(false);
      await refresh();
    } catch (requestError) {
      const field = requestError?.data?.detalles?.campo || "";
      if (["nombre", "dni", "fecha_nacimiento"].includes(field)) {
        setFormTab(FORM_TAB_PERSONAL);
      } else if (["id_categoria", "id_cobrador", "id_estado", "fecha_ingreso"].includes(field)) {
        setFormTab(FORM_TAB_MANAGEMENT);
      }
      setFeedback({
        type: "error",
        message: `${requestError.message || "No se pudo guardar el socio."} Los datos cargados se conservaron.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const closeInfo = useCallback(() => {
    // Invalida cualquier carga de ficha que siga en vuelo. Sin esto, una
    // respuesta tardía puede volver a abrir el modal después de cerrarlo.
    infoRequestIdRef.current += 1;
    setInfoModal(null);
    setInfoLoading(false);
  }, []);

  const openHistory = async (item, preferredTab = INFO_TAB_GENERAL) => {
    const requestId = infoRequestIdRef.current + 1;
    infoRequestIdRef.current = requestId;
    setInfoModal({ item, data: null });
    setInfoTab(preferredTab);
    setInfoLoading(true);
    try {
      const response = await sociosApi.historial(item.id_socio);
      if (infoRequestIdRef.current !== requestId) return;

      setInfoModal((current) => {
        const currentId = current?.data?.item?.id_socio ?? current?.item?.id_socio;
        if (Number(currentId) !== Number(item.id_socio)) return current;
        return { item: response.item || item, data: response };
      });
    } catch (requestError) {
      if (infoRequestIdRef.current !== requestId) return;
      setFeedback({ type: "error", message: requestError.message || "No se pudo cargar la ficha del socio." });
      setInfoModal(null);
    } finally {
      if (infoRequestIdRef.current === requestId) setInfoLoading(false);
    }
  };

  const reloadInfo = async (id) => {
    const response = await sociosApi.historial(id);
    setInfoModal((current) => (current ? { item: response.item || current.item, data: response } : current));
    return response;
  };

  const saveContact = async (contactForm) => {
    const id = infoModal?.data?.item?.id_socio || infoModal?.item?.id_socio;
    if (!id) return false;
    setContactSaving(true);
    try {
      const response = await sociosApi.guardarContacto({ id_socio: id, ...contactForm });
      setFeedback({ type: "success", message: response.mensaje || "Gestión registrada correctamente." });
      await Promise.all([reloadInfo(id), refresh()]);
      return true;
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo registrar la gestión." });
      return false;
    } finally {
      setContactSaving(false);
    }
  };

  const closeBirthday = async (item) => {
    try {
      const response = await sociosApi.cerrarCumpleanios({ id_socio: item.id_socio });
      setFeedback({ type: "success", message: response.mensaje || "Aviso marcado como gestionado." });
      await refresh();
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message || "No se pudo cerrar el aviso." });
    }
  };

  const openState = (item) => {
    setStateDate(localToday());
    setStateModal(item);
  };

  const changeState = async ({ motivo }) => {
    if (!stateModal) return { ok: false, mensaje: "No hay socio seleccionado." };
    const response = stateModal.vigente
      ? await sociosApi.darBaja({ id: stateModal.id_socio, fecha_baja: stateDate, motivo_baja: motivo })
      : await sociosApi.reactivar({ id: stateModal.id_socio, fecha_reactivacion: stateDate, motivo_reactivacion: motivo || "REACTIVACIÓN" });
    await refresh();
    return response;
  };

  const deleteDefinitively = async () => {
    if (!deleteModal) return { ok: false, mensaje: "No hay socio seleccionado." };
    const response = await sociosApi.eliminarDefinitivo({
      id: deleteModal.id_socio,
    });
    if (infoModal?.item?.id_socio === deleteModal.id_socio || infoModal?.data?.item?.id_socio === deleteModal.id_socio) {
      setInfoModal(null);
    }
    await refresh();
    return response;
  };

  const obtainAllForExport = useCallback(async () => {
    const first = await sociosApi.listar({ ...filters, pagina: 1 });
    const total = Number(first.paginacion?.total_paginas || 1);
    const all = [...(first.items || [])];
    for (let current = 2; current <= total; current += 1) {
      const response = await sociosApi.listar({ ...filters, pagina: current });
      all.push(...(response.items || []));
    }
    return all;
  }, [filters]);

  const pageFilters = [
    {
      type: "tabs",
      key: "vigencia",
      label: "Vigencia",
      value: status,
      onChange: (value) => {
        saveStatus(value);
        setStatus(value);
        setPage(1);
      },
      options: [
        { value: "VIGENTE", label: "Vigentes" },
        { value: "BAJA", label: "Bajas" },
      ],
    },
    {
      type: "search",
      key: "buscar",
      label: "Buscar socio",
      placeholder: "",
      value: search,
      onChange: setSearch,
    },
    {
      type: "select",
      key: "categoria",
      label: "Categoría",
      className: "socios-categoryFilter",
      placeholder: "Todas",
      value: category,
      onChange: (value) => {
        setCategory(value);
        setPage(1);
      },
      options: (catalogos.categorias || []).map((item) => ({
        value: item.id_categoria,
        label: `${item.nombre}${item.activo ? "" : " (INACTIVA)"}`,
      })),
    },
  ];

  const info = infoModal?.data;
  const itemInfo = info?.item || infoModal?.item;
  const filterDescription = [
    status === "BAJA" ? "Bajas" : "Vigentes",
    category ? `Categoría ${catalogos.categorias?.find((item) => String(item.id_categoria) === String(category))?.nombre || category}` : null,
    debouncedSearch ? `Búsqueda ${debouncedSearch}` : null,
    countAdvanced(advanced) ? `${countAdvanced(advanced)} filtros avanzados` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <section className="socios-sectionShell">
        <ModulePage
        title="Socios"
        className="socios-page"
        filters={pageFilters}
        tabsInTitle
        headFiltersInActions
        headFiltersClassName="socios-headFilters"
        primaryActionLabel="Nuevo socio"
        onPrimaryAction={openNew}
        canCreate={writable}
        headerActions={(
          <>
            <AdvancedFilters filters={advanced} catalogs={catalogos} onChange={setAdvancedFilters} onReset={resetAdvanced} />
            <BotonExportarGlobal label="Exportar" onClick={() => setExportOpen(true)} disabled={loading || !items.length} title="Exportar socios en Excel o PDF" />
          </>
        )}
        notice={!writable ? "Tu usuario tiene permiso de consulta. Las modificaciones están deshabilitadas." : null}
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || error}
          duration={feedback?.duration}
          onClose={() => setFeedback(null)}
        />

        <GlobalDivTable
          className={`socios-table ${Number(paginacion?.total || 0) > 0 ? "has-bottom-pagination" : ""}`.trim()}
          bodyClassName="entity-table-wrap"
          bodyRef={tableBodyRef}
          gridClassName="socios-grid"
          ariaLabel="Listado de socios"
          loading={loading}
          loadingLabel="Cargando socios..."
          skeletonRows={7}
          columns={[
            { label: "ID", align: "center" },
            "Socio",
            { label: "Sangre", align: "center" },
            { label: "Estado", align: "center" },
            { label: "Pagos", align: "center" },
            "Último contacto",
            { label: "Acciones", align: "center" },
          ]}
        >
          {!loading && !error && !items.length ? (
            <div className="module-empty">
              <FontAwesomeIcon icon={faUser} />
              <strong>Sin socios para mostrar</strong>
              <span>Cambiá los filtros o creá un nuevo registro.</span>
            </div>
          ) : null}
          <SociosRows items={items} writable={writable} onHistory={openHistory} onEdit={openEdit} onState={openState} onDelete={openDelete} />
        </GlobalDivTable>

        {Number(paginacion?.total || 0) > 0 || activeAdvancedFilters.length ? (
          <footer className="socios-pagination">
            <p className="socios-pagination__summary">
              Mostrando <strong>{paginacion?.desde || 0}</strong>–<strong>{paginacion?.hasta || 0}</strong> de <strong>{paginacion?.total || 0}</strong> socios
            </p>
            <ActiveFilterChips
              chips={activeAdvancedFilters}
              onRemove={removeAdvancedFilter}
            />
            {Number(paginacion?.total || 0) > 0 ? (
              <nav className="socios-pagination__controls" aria-label="Paginación de socios">
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1}>Anterior</button>
                {pages.map((value) => typeof value === "number" ? (
                  <button type="button" key={value} className={value === page ? "is-active" : ""} aria-current={value === page ? "page" : undefined} onClick={() => setPage(value)} disabled={loading}>{value}</button>
                ) : <span className="socios-pagination__ellipsis" key={value}>…</span>)}
                <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || totalPages === 0 || page >= totalPages}>Siguiente</button>
              </nav>
            ) : null}
          </footer>
        ) : null}
        </ModulePage>

      </section>

      <BirthdayContactCard
        items={birthdayItems || []}
        writable={writable}
        onView={(item) => openHistory(item, INFO_TAB_CONTACTS)}
        onClose={closeBirthday}
      />

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar socios"
        subtitle="Elegí el alcance y descargá la información en Excel o PDF."
        tituloArchivo="Socios"
        subtituloArchivoActual={`${filterDescription} · Página ${page} de ${Math.max(1, totalPages)}`}
        subtituloArchivoTodos={filterDescription}
        nombreArchivo="socios"
        columnas={EXPORT_COLUMNS}
        registrosActuales={items}
        obtenerRegistrosTodos={obtainAllForExport}
        cantidadActual={items.length}
        cantidadTodos={Number(paginacion?.total || items.length)}
        mostrarAlcanceTodos={Number(paginacion?.total || 0) > items.length}
        alcanceActualLabel={totalPages > 1 ? "Exportar esta página" : "Exportar registros visibles"}
        alcanceActualDescription="Descarga los socios visibles con los filtros actuales."
        alcanceTodosLabel="Exportar todos los socios filtrados"
        alcanceTodosDescription="Descarga todas las páginas que coinciden con los filtros actuales."
        totalLabelSingular="socio disponible"
        totalLabelPlural="socios disponibles"
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => setFeedback({ type: "success", message, duration: 4200 })}
        onError={(message) => setFeedback({ type: "error", message, duration: 5200 })}
      />

      <CrudModal
        open={formOpen}
        title={form.id_socio ? "Editar socio" : "Nuevo socio"}
        subtitle={form.id_socio ? "Actualizá la ficha conservando pagos, contactos e historial." : "Cargá los datos principales y de gestión del socio."}
        onClose={() => setFormOpen(false)}
        onSubmit={save}
        saving={saving}
        submitLabel={form.id_socio ? "Guardar cambios" : "Crear socio"}
        modalClassName="socios-modal socios-modal--form"
        closeOnBackdrop={false}
        autoUppercaseInputs={false}
        wide
      >
        <PartnerForm form={form} setForm={setForm} catalogs={catalogos} activeTab={formTab} onTabChange={setFormTab} />
      </CrudModal>

      <InfoModal
        open={Boolean(infoModal)}
        title="Información del socio"
        subtitle={itemInfo ? `ID ${itemInfo.id_socio} · ${itemInfo.nombre}` : ""}
        onClose={closeInfo}
        loading={infoLoading}
        tabs={[
          { value: INFO_TAB_GENERAL, label: "General", icon: faUser },
          { value: INFO_TAB_CONTACTS, label: "Contactos", icon: faAddressBook, badge: info?.contactos?.length || 0 },
          { value: INFO_TAB_PAYMENTS, label: "Pagos", icon: faWallet, badge: info?.pagos?.length || 0 },
          { value: INFO_TAB_HISTORY, label: "Historial", icon: faClockRotateLeft, badge: info?.historial_estados?.length || 0 },
        ]}
        activeTab={infoTab}
        onTabChange={setInfoTab}
        tabIdPrefix="socios-info"
        modalClassName="socios-info-modal"
      >
        {info && itemInfo ? (
          <>
            <EntityTabPane active={infoTab === INFO_TAB_GENERAL}>
              <div className="socios-info-content">
                <InfoSummary items={[
                  { label: "DNI", value: itemInfo.dni || "SIN INFORMAR", icon: faIdCard },
                  { label: "Grupo sanguíneo", value: itemInfo.grupo_sanguineo || "SIN INFORMAR", icon: faDroplet },
                  { label: "Estado", value: itemInfo.vigente ? (itemInfo.estado || "VIGENTE") : "BAJA", icon: itemInfo.vigente ? faCheck : faUserSlash, tone: itemInfo.vigente ? "success" : "warning" },
                  { label: "Situación de cuota", value: debtLabel(itemInfo.meses_adeudados), icon: faWallet, tone: Number(itemInfo.meses_adeudados) ? "warning" : "success" },
                ]} />
                <div className="entity-info-grid">
                  <InfoSection title="Datos personales" icon={faIdCard}>
                    <InfoRow title={itemInfo.nombre} detail={`Nacimiento: ${formatDate(itemInfo.fecha_nacimiento)}${itemInfo.edad !== null ? ` · ${itemInfo.edad} años` : ""}`} />
                    <InfoRow title="Domicilio" detail={[itemInfo.domicilio, itemInfo.numero].filter(Boolean).join(" ") || "—"} />
                    <InfoRow title="Domicilio de cobro" detail={itemInfo.domicilio_cobro || "—"} />
                    <InfoRow title="Teléfonos" detail={[itemInfo.telefono_movil, itemInfo.telefono_fijo].filter(Boolean).join(" · ") || "—"} />
                  </InfoSection>
                  <InfoSection title="Gestión" icon={faTags}>
                    <InfoRow title="Fecha de ingreso" detail={formatDate(itemInfo.fecha_ingreso)} />
                    <InfoRow title="Categoría" detail={`${itemInfo.categoria || "—"} · ${formatMoney(itemInfo.categoria_monto_mensual)} mensual`} />
                    <InfoRow title="Cobrador" detail={itemInfo.cobrador || "—"} />
                    <InfoRow title="Último contacto" detail={itemInfo.ultimo_contacto_fecha ? `${formatDate(itemInfo.ultimo_contacto_fecha)} · ${contactLabel(itemInfo.ultimo_contacto_estado)}` : "SIN GESTIÓN"} />
                    {itemInfo.observaciones ? <InfoRow title="Observaciones" detail={itemInfo.observaciones} /> : null}
                  </InfoSection>
                </div>
              </div>
            </EntityTabPane>

            <EntityTabPane active={infoTab === INFO_TAB_CONTACTS}>
              <ContactsPanel contacts={info.contactos || []} writable={writable} saving={contactSaving} onSave={saveContact} />
            </EntityTabPane>

            <EntityTabPane active={infoTab === INFO_TAB_PAYMENTS}>
              <PaymentsPanel item={itemInfo} payments={info.pagos || []} registrationPayments={info.pagos_inscripcion || []} />
            </EntityTabPane>

            <EntityTabPane active={infoTab === INFO_TAB_HISTORY}>
              <InfoSection title="Altas, bajas y cambios de estado" icon={faClockRotateLeft} badge={info.historial_estados?.length || 0}>
                <StateHistory events={info.historial_estados || []} />
              </InfoSection>
            </EntityTabPane>
          </>
        ) : null}
      </InfoModal>

      <ModalEliminarGlobal
        open={Boolean(stateModal)}
        operacion={stateModal?.vigente ? "baja" : "alta"}
        row={stateModal}
        title={stateModal?.vigente ? "Dar de baja al socio" : "Reactivar socio"}
        message={stateModal?.vigente ? "El socio dejará de figurar como vigente, pero conservará pagos, contactos, familia e historial." : "El socio volverá a figurar como vigente y el reingreso quedará registrado."}
        details={stateModal ? [
          { label: "Socio", value: stateModal.nombre },
          { label: "DNI", value: stateModal.dni },
          { label: "Estado", value: stateModal.estado || (stateModal.vigente ? "VIGENTE" : "BAJA") },
        ] : []}
        showReason={Boolean(stateModal?.vigente)}
        reasonRequired={Boolean(stateModal?.vigente)}
        reasonLabel="Motivo de baja *"
        reasonPlaceholder="Indicá el motivo de la baja..."
        extraContent={stateModal ? (
          <label className="entity-field socios-stateDate">
            <span>{stateModal.vigente ? "Fecha de baja *" : "Fecha de reactivación *"}</span>
            <input type="date" value={stateDate} min={stateModal.vigente ? (stateModal.fecha_ingreso || undefined) : undefined} max={localToday()} onChange={(event) => setStateDate(event.target.value)} required />
          </label>
        ) : null}
        confirmDisabled={!stateDate}
        onClose={() => setStateModal(null)}
        onConfirm={changeState}
        onToast={(type, message, duration) => setFeedback({ type: type === "exito" ? "success" : type, message, duration })}
        confirmLabel={stateModal?.vigente ? "Dar de baja" : "Reactivar"}
        successMessage={stateModal?.vigente ? "Socio dado de baja correctamente." : "Socio reactivado correctamente."}
      />

      <ModalEliminarGlobal
        open={Boolean(deleteModal)}
        operacion="eliminar"
        row={deleteModal}
        title="Eliminar socio definitivamente"
        message="El socio desaparecerá del sistema. Se eliminarán también todos sus pagos de cuotas, pagos de inscripción, contactos, vínculos familiares, cierres de cumpleaños, historial de estados y registros de fusión relacionados."
        warning="ADVERTENCIA: esta acción es irreversible. Si sólo querés que deje de figurar como activo, usá Dar de baja en lugar de eliminar."
        details={deleteModal ? [
          { label: "Socio", value: deleteModal.nombre },
          { label: "DNI", value: deleteModal.dni || "SIN INFORMAR" },
          { label: "Estado actual", value: deleteModal.vigente ? (deleteModal.estado || "VIGENTE") : "BAJA" },
          ...(deleteModal.impacto_eliminacion ? [
            {
              label: "Pagos que se eliminarán",
              value: Number(deleteModal.impacto_eliminacion.pagos || 0) + Number(deleteModal.impacto_eliminacion.pagos_inscripcion || 0),
            },
            {
              label: "Otros registros relacionados",
              value: Math.max(
                0,
                Number(deleteModal.impacto_eliminacion.total_relaciones || 0)
                  - Number(deleteModal.impacto_eliminacion.pagos || 0)
                  - Number(deleteModal.impacto_eliminacion.pagos_inscripcion || 0),
              ),
            },
          ] : []),
        ] : []}
        onClose={() => setDeleteModal(null)}
        onConfirm={deleteDefinitively}
        onToast={(type, message, duration) =>
          setFeedback({ type: type === "exito" ? "success" : type, message, duration })
        }
        confirmLabel="Eliminar definitivamente"
        loadingLabel="Eliminando..."
        loadingMessage="Eliminando socio y todos sus registros asociados…"
        successMessage="Socio y registros relacionados eliminados definitivamente."
        errorMessage="No se pudo eliminar definitivamente el socio."
      />

    </>
  );
}
