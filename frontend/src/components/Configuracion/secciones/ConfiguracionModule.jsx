import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faArrowRotateLeft,
  faCalculator,
  faChevronRight,
  faGear,
  faMoneyBillTransfer,
  faPen,
  faPowerOff,
  faSliders,
  faTrashCan,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import DataTableSkeleton from "../../Global/DataTableSkeleton";
import CrudModal from "../../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import {
  decimalInput,
  preventInvalidDecimalKey,
  upperBloodGroup,
  upperCatalogName,
  upperLettersOnly,
} from "../../Global/Formularios/inputSanitizers";
import { canWrite } from "../../_shared/auth/session";
import { configuracionApi } from "../api/configuracionApi";
import { useConfiguracion } from "../hooks/useConfiguracion";
import { useTableScrollbarCompensation } from "../hooks/useTableScrollbarCompensation";
import "../configuracion.css";
import "./CatalogosConfiguracion.css";

const upper = (value) => String(value ?? "").toLocaleUpperCase("es-AR");

const CATALOG_META = {
  categoria: {
    label: "categoría",
    title: "Categorías",
    description: "Categorías de socios con sus importes mensual y anual.",
    detail: "Los cambios de importe también quedan registrados en el historial de precios.",
    icon: faSliders,
    idField: "id_categoria",
    activePlural: "activas",
    inactivePlural: "inactivas",
    empty: "Todavía no hay categorías configuradas.",
    deletedFieldLabel: "categoría",
    fields: [
      { key: "nombre", label: "Nombre", type: "text", maxLength: 100, sanitizer: "letters" },
      { key: "monto_mensual", label: "Monto mensual", type: "decimal", maxLength: 13, maxIntegerDigits: 10, maxDecimals: 2 },
      { key: "monto_anual", label: "Monto anual", type: "decimal", maxLength: 13, maxIntegerDigits: 10, maxDecimals: 2 },
    ],
    secondary: (item) => `Mensual ${Number(item.monto_mensual || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" })} · Anual ${Number(item.monto_anual || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}`,
  },
  cobrador: {
    label: "cobrador",
    title: "Cobradores",
    description: "Personas o modalidades responsables de la cobranza de socios.",
    detail: "Se utilizan en la ficha del socio y en los filtros de gestión.",
    icon: faUsers,
    idField: "id_cobrador",
    activePlural: "activos",
    inactivePlural: "inactivos",
    empty: "Todavía no hay cobradores configurados.",
    deletedFieldLabel: "cobrador",
    fields: [{ key: "nombre", label: "Nombre", type: "text", maxLength: 50, sanitizer: "catalog" }],
  },
  estado: {
    label: "estado",
    title: "Estados",
    description: "Estados administrativos disponibles para clasificar socios.",
    detail: "Los estados usados en historial no se pueden borrar definitivamente.",
    icon: faPowerOff,
    idField: "id_estado",
    activePlural: "activos",
    inactivePlural: "inactivos",
    empty: "Todavía no hay estados configurados.",
    deletedFieldLabel: "estado",
    fields: [{ key: "nombre", label: "Nombre", type: "text", maxLength: 20, sanitizer: "letters" }],
  },
  grupo_sanguineo: {
    label: "grupo sanguíneo",
    title: "Grupos sanguíneos",
    description: "Valores de grupo y factor sanguíneo disponibles en socios.",
    detail: "Podés agregar, corregir o desactivar opciones sin tocar fichas existentes.",
    icon: faGear,
    idField: "id_grupo_sanguineo",
    activePlural: "activos",
    inactivePlural: "inactivos",
    empty: "Todavía no hay grupos sanguíneos configurados.",
    deletedFieldLabel: "grupo sanguíneo",
    fields: [{ key: "nombre", label: "Nombre", type: "text", maxLength: 10, sanitizer: "blood" }],
  },
  medios_pago: {
    label: "medio de pago",
    title: "Medios de pago",
    description: "Opciones disponibles al registrar cuotas e inscripciones.",
    detail: "Los medios usados en pagos históricos se conservan mediante baja lógica.",
    icon: faMoneyBillTransfer,
    idField: "id_medio_pago",
    activePlural: "activos",
    inactivePlural: "inactivos",
    empty: "Todavía no hay medios de pago configurados.",
    deletedFieldLabel: "medio de pago",
    fields: [{ key: "nombre", label: "Nombre", type: "text", maxLength: 50, sanitizer: "catalog" }],
  },
  periodo: {
    label: "período",
    title: "Períodos",
    description: "Períodos de cuota y el texto de meses que representa cada uno.",
    detail: "Los períodos usados por pagos no se pueden eliminar definitivamente.",
    icon: faCalculator,
    idField: "id_periodo",
    activePlural: "activos",
    inactivePlural: "inactivos",
    empty: "Todavía no hay períodos configurados.",
    deletedFieldLabel: "período",
    fields: [
      { key: "nombre", label: "Nombre", type: "text", maxLength: 50, sanitizer: "catalog" },
      { key: "meses", label: "Meses / descripción", type: "text", sanitizer: "catalog", unlimited: true },
    ],
    secondary: (item) => item.meses || "Sin descripción de meses",
  },
};

const emptyForm = (lista = "categoria") => {
  const meta = CATALOG_META[lista] || CATALOG_META.categoria;
  const values = { lista, id: "" };
  meta.fields.forEach((field) => {
    values[field.key] = "";
  });
  return values;
};

const sanitizeCatalogField = (field, value) => {
  if (field.type === "decimal") {
    return decimalInput(
      value,
      field.maxIntegerDigits ?? 10,
      field.maxDecimals ?? 2,
    );
  }

  if (field.unlimited && field.sanitizer === "catalog") {
    return upper(value)
      .replace(/[^A-ZÁÉÍÓÚÜÑÇ0-9\s+&./\-]/g, "")
      .replace(/ {2,}/g, " ");
  }
  if (field.sanitizer === "letters") {
    return upperLettersOnly(value, field.maxLength || 160);
  }
  if (field.sanitizer === "blood") {
    return upperBloodGroup(value, field.maxLength || 10);
  }
  return upperCatalogName(value, field.maxLength || 160);
};

const getCatalogFieldRule = (field) => {
  if (field.type === "decimal") {
    return `Hasta ${field.maxIntegerDigits ?? 10} dígitos enteros y ${field.maxDecimals ?? 2} decimales`;
  }
  if (field.sanitizer === "letters") {
    return "Solo letras, espacios, apóstrofe, punto y guion";
  }
  if (field.sanitizer === "blood") {
    return "Letras, números y signos + y -";
  }
  return "Letras, números, espacios y signos + & . / -";
};

const getCatalogFieldCounter = (field, value) => {
  const currentLength = String(value ?? "").length;
  if (field.unlimited) {
    return `${currentLength} caracteres · sin límite`;
  }
  if (field.type === "decimal") {
    return `${currentLength} / ${field.maxLength ?? 13}`;
  }
  return `${currentLength} / ${field.maxLength ?? 160}`;
};

function AccessCard({
  icon,
  title,
  description,
  status,
  area,
  detail,
  onClick,
}) {
  return (
    <button type="button" className="config-accessCard" onClick={onClick}>
      <span className="config-accessCard__icon" aria-hidden="true">
        <FontAwesomeIcon icon={icon} />
      </span>
      <strong className="config-accessCard__title">{title}</strong>
      <span className="config-accessCard__status">{status}</span>
      <span className="config-accessCard__description">{description}</span>
      <span className="config-accessCard__meta">
        <span>
          <small>ÁREA</small>
          {area}
        </span>
        <span>
          <small>DETALLE</small>
          {detail}
        </span>
      </span>
      <span className="config-accessCard__arrow" aria-hidden="true">
        <FontAwesomeIcon icon={faChevronRight} />
      </span>
    </button>
  );
}

function ConfigurationHome() {
  const navigate = useNavigate();

  const cards = [
    {
      id: "usuarios",
      title: "Usuarios y roles",
      description: "Creá, editá, eliminá o desactivá usuarios y definí qué rol tiene cada acceso.",
      icon: faUsers,
      status: "Seguridad",
      area: "Usuarios",
      detail: "Administradores y solo lectura",
      path: "/configuracion/usuarios",
    },
    {
      id: "catalogos",
      title: "Catálogos y parámetros",
      description: "Administrá categorías, cobradores, estados, grupos sanguíneos, medios de pago y períodos.",
      icon: faSliders,
      status: "6 catálogos",
      area: "Socios y pagos",
      detail: "Altas, edición y vigencia",
      path: "/configuracion/catalogos?lista=categoria",
    },
  ];

  return (
    <section className="config-homePage">
      <header className="config-homeIntro">
        <span className="config-homeIntro__icon" aria-hidden="true">
          <FontAwesomeIcon icon={faGear} />
        </span>
        <div>
          <small>CONFIGURACIÓN DEL SISTEMA</small>
          <strong>Administración y configuración general</strong>
          <p>
            Gestioná usuarios, roles y los catálogos generales vinculados con
            socios y pagos.
          </p>
        </div>
      </header>

      <nav
        className="config-accessGrid config-accessGrid--compact"
        aria-label="Secciones de configuración"
      >
        {cards.map((card) => (
          <AccessCard
            key={card.id}
            {...card}
            onClick={() => navigate(card.path)}
          />
        ))}
      </nav>
    </section>
  );
}

function CatalogStat({ icon, label, value, detail, tone }) {
  return (
    <article className={`config-catalogStat config-catalogStat--${tone}`}>
      <span className="config-catalogStat__icon" aria-hidden="true">
        <FontAwesomeIcon icon={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function CatalogTable({ items, loading, meta, writable, onEdit, onState, onDelete }) {
  const { bodyRef, hasVerticalScroll, scrollbarWidth } =
    useTableScrollbarCompensation();

  return (
    <div
      className={`config-catalogTable ${hasVerticalScroll ? "has-y-scroll" : ""}`.trim()}
      role="table"
      aria-label={meta.title}
      aria-busy={loading}
      style={{ "--config-table-scrollbar-width": `${scrollbarWidth}px` }}
    >
      {loading ? (
        <span className="mov-skeletonStatus" role="status" aria-live="polite">
          Cargando opciones...
        </span>
      ) : null}

      <div className="config-catalogTable__head" role="row">
        <span role="columnheader">Opción</span>
        <span role="columnheader">Uso</span>
        <span role="columnheader">Estado</span>
        <span
          className="config-catalogTable__actionsHeading"
          role="columnheader"
        >
          Acciones
        </span>
      </div>

      <div ref={bodyRef} className="config-catalogTable__body" role="rowgroup">
        {loading ? (
          <DataTableSkeleton
            actionColumnIndex={3}
            columnCount={4}
            gridClassName="config-catalogTable__skeletonRow"
            rows={6}
          />
        ) : (
          items.map((item) => {
            const id = item[meta.idField];
            const usageCount = Number(item.cantidad_usos || 0);
            const active = Boolean(item.activo);
            const stateAction = active ? "baja" : "reactivar";

            return (
              <div
                className={`config-catalogTable__row ${active ? "" : "is-inactive"}`}
                role="row"
                key={id}
              >
                <div className="config-catalogIdentity" role="cell">
                  <span
                    className="config-catalogIdentity__icon"
                    aria-hidden="true"
                  >
                    <FontAwesomeIcon icon={meta.icon} />
                  </span>
                  <div>
                    <strong>{item.nombre}</strong>
                    <small>{meta.secondary ? meta.secondary(item) : meta.label}</small>
                  </div>
                </div>

                <div
                  className="config-catalogUsage"
                  role="cell"
                  data-label="Uso"
                >
                  <strong>{usageCount}</strong>
                  <span>
                    {usageCount === 1
                      ? "registro asociado"
                      : "registros asociados"}
                  </span>
                </div>

                <div role="cell" data-label="Estado">
                  <span
                    className={`config-catalogState ${active ? "is-active" : "is-inactive"}`}
                  >
                    <i aria-hidden="true" />
                    {active ? "Activo" : "Inactivo"}
                  </span>
                </div>

                <div
                  className="config-catalogActions config-catalogTable__actionsCell mov-actionsInline"
                  role="cell"
                >
                  {writable ? (
                    <>
                      <button
                        type="button"
                        className="mov-iconBtn"
                        onClick={() => onEdit(item)}
                        title={`Editar ${meta.label}`}
                        aria-label={`Editar ${item.nombre}`}
                      >
                        <FontAwesomeIcon icon={faPen} />
                      </button>
                      <button
                        type="button"
                        className={`mov-iconBtn ${active ? "mov-iconBtn--danger" : ""}`.trim()}
                        onClick={() => onState(item, stateAction)}
                        title={active ? "Dar de baja" : "Reactivar"}
                        aria-label={`${active ? "Dar de baja" : "Reactivar"} ${item.nombre}`}
                      >
                        <FontAwesomeIcon
                          icon={active ? faPowerOff : faArrowRotateLeft}
                        />
                      </button>
                      <button
                        type="button"
                        className="mov-iconBtn mov-iconBtn--danger"
                        onClick={() => onDelete(item)}
                        disabled={usageCount > 0}
                        title={
                          usageCount > 0
                            ? "No se puede eliminar definitivamente mientras tenga registros asociados; podés darlo de baja"
                            : "Eliminar definitivamente"
                        }
                        aria-label={`Eliminar definitivamente ${item.nombre}`}
                      >
                        <FontAwesomeIcon icon={faTrashCan} />
                      </button>
                    </>
                  ) : (
                    <span className="config-catalogActions__readonly">
                      Solo lectura
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}

        {!loading && !items.length ? (
          <div className="config-catalogEmpty">{meta.empty}</div>
        ) : null}
      </div>
    </div>
  );
}

function CatalogsPanel() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const writable = canWrite();
  const { listas, resumen, loading, error, cargar } = useConfiguracion();
  const requestedList = searchParams.get("lista");
  const [activeList, setActiveList] = useState(() => CATALOG_META[requestedList] ? requestedList : "categoria");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [formOpen, setFormOpen] = useState(false);
  const [stateModal, setStateModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleModalToast = useCallback((type, message, duration) => {
    setFeedback({ type, message, duration });
  }, []);

  const meta = CATALOG_META[activeList];
  const items = useMemo(() => listas[activeList] || [], [listas, activeList]);
  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    if (!term) return items;
    return items.filter((item) =>
      String(item.nombre || "")
        .toLocaleLowerCase("es-AR")
        .includes(term),
    );
  }, [items, search]);

  const activeCount = Number(resumen[`${activeList}_activos`] || 0);
  const inactiveCount = items.filter((item) => !Boolean(item.activo)).length;
  const inUseCount = items.filter(
    (item) => Number(item.cantidad_usos || 0) > 0,
  ).length;

  const stats = [
    {
      icon: faSliders,
      label: "TOTAL",
      value: items.length,
      detail: "Opciones configuradas",
      tone: "total",
    },
    {
      icon: meta.icon,
      label: upper(meta.activePlural),
      value: activeCount,
      detail: "Disponibles para usar",
      tone: "active",
    },
    {
      icon: faArrowRotateLeft,
      label: upper(meta.inactivePlural),
      value: inactiveCount,
      detail: "Fuera de nuevas operaciones",
      tone: "inactive",
    },
    {
      icon: faGear,
      label: "EN USO",
      value: inUseCount,
      detail: "Con registros asociados",
      tone: "usage",
    },
  ];

  const openCreate = () => {
    setFeedback(null);
    setForm(emptyForm(activeList));
    setFormOpen(true);
  };

  const openEdit = (item) => {
    setFeedback(null);
    const nextForm = emptyForm(activeList);
    nextForm.id = String(item[meta.idField]);
    meta.fields.forEach((field) => {
      nextForm[field.key] = item[field.key] ?? "";
    });
    setForm(nextForm);
    setFormOpen(true);
  };

  const saveItem = async (event) => {
    event.preventDefault();
    const payload = { lista: form.lista, id: form.id || null };
    for (const field of meta.fields) {
      const rawValue = form[field.key];
      if (field.type === "decimal") {
        const value = decimalInput(
          rawValue,
          field.maxIntegerDigits ?? 10,
          field.maxDecimals ?? 2,
        );
        if (value === "" || Number.isNaN(Number(value)) || Number(value) < 0) {
          setFeedback({ type: "error", message: `Completá ${field.label.toLocaleLowerCase("es-AR")} con un valor válido. Los datos cargados se conservaron.` });
          return;
        }
        payload[field.key] = value;
      } else {
        const value = sanitizeCatalogField(field, rawValue).trim();
        if (!value) {
          setFeedback({ type: "error", message: `Completá ${field.label.toLocaleLowerCase("es-AR")}. Los datos cargados se conservaron.` });
          return;
        }
        payload[field.key] = value;
      }
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await configuracionApi.guardarItem(payload);
      setFormOpen(false);
      setFeedback({ type: "success", message: response.mensaje });
      void cargar();
    } catch (requestError) {
      setFeedback({
        type: "error",
        message: requestError.message || `No se pudo guardar el ${meta.label}.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmState = async () => {
    if (!stateModal) return { ok: false };
    setSaving(true);
    try {
      const id = stateModal.item[meta.idField];
      const response =
        stateModal.action === "reactivar"
          ? await configuracionApi.reactivarItem(activeList, id)
          : await configuracionApi.darBajaItem(activeList, id);
      void cargar();
      return response;
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteModal) return { ok: false };
    setSaving(true);
    try {
      const id = deleteModal[meta.idField];
      const response = await configuracionApi.eliminarDefinitivoItem(
        activeList,
        id,
      );
      void cargar();
      return response;
    } finally {
      setSaving(false);
    }
  };

  const usageCount = Number(stateModal?.item?.cantidad_usos || 0);

  return (
    <>
      <ModulePage
        className="config-sectionPage config-catalogsPage"
        title="Catálogos generales"
        filters={[
          {
            key: "catalog-search",
            type: "search",
            label: "Buscar",
            value: search,
            onChange: setSearch,
            placeholder: "",
          },
        ]}
        primaryActionLabel={`Nuevo ${meta.label}`}
        onPrimaryAction={writable ? openCreate : undefined}
        canCreate={writable}
        secondaryActions={[
          {
            key: "volver",
            label: "Volver",
            icon: faArrowLeft,
            onClick: () => navigate("/configuracion"),
          },
        ]}
        notice={
          !writable
            ? "Tu usuario tiene permiso de consulta. Las modificaciones están deshabilitadas."
            : null
        }
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || error}
          onClose={() => setFeedback(null)}
        />

        <section
          className="config-catalogStats"
          aria-label={`Resumen de ${meta.title}`}
        >
          {stats.map((stat) => (
            <CatalogStat key={stat.label} {...stat} />
          ))}
        </section>

        <section className="config-catalogPanel">
          <header className="config-catalogPanel__toolbar">
            <div
              className="config-catalogTabs"
              role="tablist"
              aria-label="Catálogos generales"
            >
              {Object.entries(CATALOG_META).map(([key, option]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeList === key}
                  className={activeList === key ? "is-active" : ""}
                  onClick={() => {
                    setActiveList(key);
                    setSearchParams({ lista: key }, { replace: true });
                    setSearch("");
                    setFeedback(null);
                  }}
                >
                  <FontAwesomeIcon icon={option.icon} />
                  {option.title}
                </button>
              ))}
            </div>
            <strong>
              {loading
                ? "Cargando opciones..."
                : `Mostrando ${filteredItems.length} de ${items.length} opciones`}
            </strong>
          </header>

          <CatalogTable
            items={filteredItems}
            loading={loading}
            meta={meta}
            writable={writable}
            onEdit={openEdit}
            onState={(item, action) => setStateModal({ item, action })}
            onDelete={setDeleteModal}
          />
        </section>
      </ModulePage>

      <CrudModal
        open={formOpen}
        title={
          <>
            <FontAwesomeIcon
              icon={form.id ? faPen : meta.icon}
              aria-hidden="true"
            />
            <span>{`${form.id ? "Editar" : "Agregar"} ${meta.label}`}</span>
          </>
        }
        subtitle={meta.description}
        onClose={() => setFormOpen(false)}
        onSubmit={saveItem}
        saving={saving}
        submitLabel={form.id ? "Guardar cambios" : "Agregar"}
        closeOnBackdrop={false}
        modalClassName="config-catalogModal"
      >
        <div className="entity-form config-catalogForm">
          <div className="entity-form__grid entity-form__grid--single">
            {meta.fields.map((field, index) => {
              const fieldValue = form[field.key] ?? "";
              const helpId = `catalog-field-${activeList}-${field.key}-help`;
              return (
                <div className="config-catalogField" key={field.key}>
                  <FloatingField
                    label={
                      <>
                        <FontAwesomeIcon icon={meta.icon} aria-hidden="true" />
                        {field.label} *
                      </>
                    }
                    active={String(fieldValue).trim() !== ""}
                  >
                    <input
                      type="text"
                      inputMode={field.type === "decimal" ? "decimal" : undefined}
                      value={fieldValue}
                      placeholder=" "
                      aria-describedby={helpId}
                      onKeyDown={field.type === "decimal" ? preventInvalidDecimalKey : undefined}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [field.key]: sanitizeCatalogField(field, event.target.value),
                        }))
                      }
                      maxLength={field.maxLength}
                      required
                      autoFocus={index === 0}
                    />
                  </FloatingField>
                  <div className="config-catalogField__meta" id={helpId}>
                    <span>{getCatalogFieldRule(field)}</span>
                    <strong>{getCatalogFieldCounter(field, fieldValue)}</strong>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="config-catalogForm__help">
            <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
            <span>{meta.detail}</span>
          </p>
        </div>
      </CrudModal>

      <ModalEliminarGlobal
        open={Boolean(stateModal)}
        operacion={stateModal?.action === "reactivar" ? "alta" : "baja"}
        row={stateModal?.item || null}
        title={
          stateModal?.action === "reactivar"
            ? `Reactivar ${meta.label}`
            : `Dar de baja ${meta.label}`
        }
        message={
          stateModal?.action === "reactivar"
            ? "La opción volverá a estar disponible en nuevas operaciones."
            : "La opción dejará de aparecer en nuevas operaciones, pero los registros existentes conservarán su información."
        }
        warning={
          stateModal?.action === "reactivar"
            ? ""
            : "Dar de baja no elimina el historial y se puede revertir en cualquier momento."
        }
        confirmLabel={
          stateModal?.action === "reactivar" ? "Reactivar" : "Dar de baja"
        }
        loadingLabel={
          stateModal?.action === "reactivar"
            ? "Reactivando..."
            : "Dando de baja..."
        }
        loadingMessage="Actualizando opción…"
        successMessage={
          stateModal?.action === "reactivar"
            ? "Opción reactivada correctamente."
            : "Opción dada de baja correctamente."
        }
        errorMessage="No se pudo actualizar el estado de la opción."
        details={
          stateModal
            ? [
                { label: "Opción", value: stateModal.item?.nombre },
                { label: "Sección", value: meta.title },
                { label: "Registros asociados", value: usageCount },
              ]
            : []
        }
        onClose={() => setStateModal(null)}
        onConfirm={confirmState}
        onToast={handleModalToast}
        loading={saving}
      />

      <ModalEliminarGlobal
        open={Boolean(deleteModal)}
        operacion="eliminar"
        row={deleteModal}
        title={`Eliminar ${meta.label}`}
        message="La opción se eliminará definitivamente de la configuración."
        warning="Esta acción no se puede deshacer. Sólo se habilita para opciones que no tienen registros asociados."
        confirmLabel="Eliminar"
        loadingLabel="Eliminando..."
        loadingMessage="Eliminando opción…"
        successMessage="Opción eliminada definitivamente."
        errorMessage="No se pudo eliminar definitivamente la opción."
        details={
          deleteModal
            ? [
                { label: "Opción", value: deleteModal.nombre },
                { label: "Sección", value: meta.title },
                {
                  label: "Registros asociados",
                  value: Number(deleteModal.cantidad_usos || 0),
                },
              ]
            : []
        }
        onClose={() => setDeleteModal(null)}
        onConfirm={confirmDelete}
        onToast={handleModalToast}
        loading={saving}
      />
    </>
  );
}

export default function ConfiguracionModule({ group = null }) {
  if (group === "catalogos") return <CatalogsPanel />;
  return <ConfigurationHome />;
}
