import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faArrowLeft,
  faArrowRotateLeft,
  faArrowUp,
  faCalculator,
  faCircleCheck,
  faList,
  faPen,
  faPowerOff,
  faTag,
  faTrashCan,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import CrudModal from "../../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import { canWrite } from "../../_shared/auth/session";
import { upperWithoutDigits } from "../../Global/Formularios/inputSanitizers";
import { contableApi } from "../../Contable/api/contableApi";
import { useTableScrollbarCompensation } from "../hooks/useTableScrollbarCompensation";
import "../configuracion.css";
import "./ContableConfiguracion.css";

const upper = (value) => String(value ?? "").toLocaleUpperCase("es-AR");
const sanitizeOptionName = (type, value) =>
  type === "PROVEEDOR" ? upper(value) : upperWithoutDigits(value);

const LIST_META = {
  PROVEEDOR: {
    label: "persona o proveedor",
    createLabel: "Nueva persona o proveedor",
    title: "Personas / proveedores",
    description: "Opciones disponibles para identificar de quién proviene un ingreso o a quién se realiza un egreso.",
    detail: "Se comparte entre otros ingresos y egresos.",
    icon: faUser,
    empty: "Todavía no hay personas o proveedores configurados.",
    deletedFieldLabel: "persona / proveedor",
  },
  CATEGORIA_INGRESO: {
    label: "categoría de ingreso",
    createLabel: "Nueva categoría de ingreso",
    title: "Categorías de ingresos",
    description: "Clasificación general utilizada al registrar ingresos ajenos a las cuotas de socios.",
    detail: "Ejemplos: donaciones, eventos o campañas.",
    icon: faArrowUp,
    empty: "Todavía no hay categorías de ingresos configuradas.",
    deletedFieldLabel: "categoría",
  },
  CONCEPTO_INGRESO: {
    label: "concepto de ingreso",
    createLabel: "Nuevo concepto de ingreso",
    title: "Conceptos de ingresos",
    description: "Motivos concretos que aparecen en el selector de otros ingresos.",
    detail: "Permiten detallar el origen de cada ingreso manual.",
    icon: faList,
    empty: "Todavía no hay conceptos de ingresos configurados.",
    deletedFieldLabel: "concepto",
  },
  CATEGORIA_EGRESO: {
    label: "categoría de egreso",
    createLabel: "Nueva categoría de egreso",
    title: "Categorías de egresos",
    description: "Clasificación general utilizada para ordenar los gastos de la asociación.",
    detail: "Ejemplos: servicios, insumos o mantenimiento.",
    icon: faArrowDown,
    empty: "Todavía no hay categorías de egresos configuradas.",
    deletedFieldLabel: "categoría",
  },
  CONCEPTO_EGRESO: {
    label: "concepto de egreso",
    createLabel: "Nuevo concepto de egreso",
    title: "Conceptos de egresos",
    description: "Motivos concretos que aparecen en el selector al registrar un egreso.",
    detail: "Permiten identificar rápidamente para qué se realizó el gasto.",
    icon: faTag,
    empty: "Todavía no hay conceptos de egresos configurados.",
    deletedFieldLabel: "concepto",
  },
};

const initialLists = Object.keys(LIST_META).reduce((result, key) => {
  result[key] = [];
  return result;
}, {});

function OptionList({ items, meta, writable, onEdit, onState, onDelete, bodyRef }) {
  if (!items.length) {
    return (
      <div ref={bodyRef} className="config-contableTable__body">
        <div className="config-contableEmpty">
          <span aria-hidden="true"><FontAwesomeIcon icon={meta.icon} /></span>
          <strong>Sin registros</strong>
          <p>{meta.empty}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={bodyRef} className="config-contableTable__body">
      {items.map((item) => {
        const active = Boolean(item.activo);
        const usageCount = Number(item.cantidad_usos || 0);
        return (
          <article
            className={`config-contableTable__row ${active ? "" : "is-inactive"}`.trim()}
            key={item.id_opcion}
          >
            <div className="config-contableIdentity">
              <span className="config-contableIdentity__icon" aria-hidden="true">
                <FontAwesomeIcon icon={meta.icon} />
              </span>
              <div>
                <strong>{item.nombre}</strong>
                <small>{meta.title}</small>
              </div>
            </div>
            <span className={`config-contableStatus ${active ? "is-active" : "is-inactive"}`}>
              <FontAwesomeIcon icon={active ? faCircleCheck : faPowerOff} />
              {active ? "Disponible" : "Baja"}
            </span>
            <span className="config-contableUsage">
              <strong>{usageCount}</strong>{" "}
              {usageCount === 1 ? "movimiento histórico" : "movimientos históricos"}
            </span>
            <div className="config-contableActions mov-actionsInline">
              {writable ? (
                <>
                  <button type="button" className="mov-iconBtn" onClick={() => onEdit(item)} title={`Editar ${meta.label}`} aria-label={`Editar ${item.nombre}`}>
                    <FontAwesomeIcon icon={faPen} />
                  </button>
                  <button
                    type="button"
                    className={`mov-iconBtn ${active ? "mov-iconBtn--danger" : ""}`.trim()}
                    onClick={() => onState(item)}
                    title={active ? "Dar de baja" : "Reactivar"}
                    aria-label={`${active ? "Dar de baja" : "Reactivar"} ${item.nombre}`}
                  >
                    <FontAwesomeIcon icon={active ? faPowerOff : faArrowRotateLeft} />
                  </button>
                  <button
                    type="button"
                    className="mov-iconBtn mov-iconBtn--danger"
                    onClick={() => onDelete(item)}
                    title="Eliminar definitivamente"
                    aria-label={`Eliminar definitivamente ${item.nombre}`}
                  >
                    <FontAwesomeIcon icon={faTrashCan} />
                  </button>
                </>
              ) : <span className="config-contableReadOnly">Solo lectura</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ContableSkeleton({ bodyRef }) {
  return (
    <div ref={bodyRef} className="config-contableTable__body" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="config-contableTable__skeletonRow" key={index}>
          <span className="config-contableSkeleton config-contableSkeleton--name" />
          <span className="config-contableSkeleton config-contableSkeleton--status" />
          <span className="config-contableSkeleton config-contableSkeleton--usage" />
          <span className="config-contableSkeleton config-contableSkeleton--actions" />
        </div>
      ))}
    </div>
  );
}

function ContableStat({ icon, label, value, detail, tone }) {
  return (
    <article className={`config-contableStat config-contableStat--${tone}`}>
      <span className="config-contableStat__icon" aria-hidden="true">
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

export default function ContableConfiguracion() {
  const navigate = useNavigate();
  const writable = canWrite();
  const requestId = useRef(0);
  const [activeType, setActiveType] = useState("PROVEEDOR");
  const [lists, setLists] = useState(initialLists);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ id_opcion: "", tipo: "PROVEEDOR", nombre: "" });
  const [stateModal, setStateModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const { bodyRef: tableBodyRef, hasVerticalScroll, scrollbarWidth } =
    useTableScrollbarCompensation();

  const meta = LIST_META[activeType];
  const items = useMemo(() => lists[activeType] || [], [lists, activeType]);
  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    if (!term) return items;
    return items.filter((item) =>
      String(item.nombre || "").toLocaleLowerCase("es-AR").includes(term),
    );
  }, [items, search]);

  const totalOptions = useMemo(
    () => Object.values(lists).reduce(
      (total, list) => total + (Array.isArray(list) ? list.length : 0),
      0,
    ),
    [lists],
  );

  const activeCount = items.filter((item) => Boolean(item.activo)).length;
  const inactiveCount = items.length - activeCount;

  const stats = [
    {
      icon: faCalculator,
      label: "TOTAL GENERAL",
      value: totalOptions,
      detail: "Opciones contables configuradas",
      tone: "total",
    },
    {
      icon: faCircleCheck,
      label: "ACTIVAS",
      value: activeCount,
      detail: "Disponibles en nuevas operaciones",
      tone: "active",
    },
    {
      icon: faPowerOff,
      label: "BAJAS",
      value: inactiveCount,
      detail: "Fuera de nuevas operaciones",
      tone: "visible",
    },
    {
      icon: faList,
      label: "MOSTRANDO",
      value: filteredItems.length,
      detail: search.trim() ? "Coincidencias de la búsqueda" : upper(meta.title),
      tone: "lists",
    },
  ];

  const loadOptions = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const response = await contableApi.opcionesConfiguracion();
      if (currentRequest === requestId.current) {
        setLists({ ...initialLists, ...(response.listas || {}) });
      }
      return response;
    } catch (error) {
      if (currentRequest === requestId.current) {
        setFeedback({
          type: "error",
          message: error.message || "No se pudo cargar la configuración contable.",
        });
      }
      return null;
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOptions();
    return () => {
      requestId.current += 1;
    };
  }, [loadOptions]);

  const openCreate = () => {
    setFeedback(null);
    setForm({ id_opcion: "", tipo: activeType, nombre: "" });
    setFormOpen(true);
  };

  const openEdit = (item) => {
    setFeedback(null);
    setForm({
      id_opcion: String(item.id_opcion),
      tipo: item.tipo,
      nombre: item.nombre || "",
    });
    setFormOpen(true);
  };

  const saveItem = async (event) => {
    event.preventDefault();
    const sanitizedName = sanitizeOptionName(form.tipo, form.nombre).trim();
    if (!sanitizedName) {
      setFeedback({ type: "error", message: "Ingresá un nombre válido." });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await contableApi.guardarOpcion({
        id_opcion: form.id_opcion || null,
        tipo: form.tipo,
        nombre: sanitizedName,
      });
      setFormOpen(false);
      setFeedback({ type: "success", message: response.mensaje });
      await loadOptions();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message || `No se pudo guardar la ${meta.label}.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmState = async () => {
    if (!stateModal) return { ok: false };
    setSaving(true);
    try {
      const response = await contableApi.cambiarEstadoOpcion(
        stateModal.id_opcion,
        !stateModal.activo,
      );
      await loadOptions();
      return response;
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteModal) return { ok: false };
    setSaving(true);
    try {
      const response = await contableApi.eliminarOpcion(deleteModal.id_opcion);
      await loadOptions();
      return response;
    } finally {
      setSaving(false);
    }
  };

  const handleModalToast = useCallback((type, message, duration) => {
    setFeedback({ type, message, duration });
  }, []);

  return (
    <>
      <ModulePage
        className="config-sectionPage"
        title="Configuración contable"
        description=""
        filters={[{
          key: "contable-search",
          type: "search",
          label: "Buscar",
          placeholder: "",
          value: search,
          onChange: setSearch,
        }]}
        primaryActionLabel={meta.createLabel}
        onPrimaryAction={writable ? openCreate : undefined}
        canCreate={writable}
        secondaryActions={[{
          key: "volver",
          label: "Volver a configuración",
          icon: faArrowLeft,
          onClick: () => navigate("/configuracion"),
        }]}
        notice={!writable ? "Tu usuario tiene permiso de consulta. Las modificaciones están deshabilitadas." : null}
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || ""}
          onClose={() => setFeedback(null)}
        />

        <section
          className="config-contableStats"
          aria-label={`Resumen de ${meta.title}`}
        >
          {stats.map((stat) => (
            <ContableStat key={stat.label} {...stat} />
          ))}
        </section>

        <section className="config-detailPanel config-detailPanel--list config-contablePanel">
          <div className="config-contableToolbar">
            <div className="config-contableTabs" role="tablist" aria-label="Listas contables">
              {Object.entries(LIST_META).map(([type, option]) => (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={activeType === type}
                  className={activeType === type ? "is-active" : ""}
                  onClick={() => {
                    setActiveType(type);
                    setSearch("");
                    setFeedback(null);
                  }}
                >
                  <FontAwesomeIcon icon={option.icon} />
                  <span>{option.title}</span>
                </button>
              ))}
            </div>
          </div>

          <div
            className={`config-contableTable ${hasVerticalScroll ? "has-y-scroll" : ""}`.trim()}
            style={{ "--config-table-scrollbar-width": `${scrollbarWidth}px` }}
          >
            <div className="config-contableTable__head"><span>Nombre</span><span>Estado</span><span>Uso</span><span>Acciones</span></div>
            {loading ? <ContableSkeleton bodyRef={tableBodyRef} /> : (
              <OptionList
                items={filteredItems}
                meta={meta}
                writable={writable}
                onEdit={openEdit}
                onState={setStateModal}
                onDelete={setDeleteModal}
                bodyRef={tableBodyRef}
              />
            )}
          </div>
        </section>
      </ModulePage>

      <CrudModal
        open={formOpen}
        title={`${form.id_opcion ? "Editar" : "Agregar"} ${meta.label}`}
        subtitle="La opción aparecerá inmediatamente en los formularios de Contabilidad."
        onClose={() => setFormOpen(false)}
        onSubmit={saveItem}
        saving={saving}
        submitLabel={form.id_opcion ? "Guardar cambios" : "Agregar"}
      >
        <div className="entity-form">
          <div className="entity-form__grid entity-form__grid--single">
            <label className="entity-field">
              <span>Nombre *</span>
              <input
                value={form.nombre}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  nombre: sanitizeOptionName(form.tipo, event.target.value),
                }))}
                maxLength={160}
                required
                autoFocus
              />
            </label>
          </div>
        </div>
      </CrudModal>

      <ModalEliminarGlobal
        open={Boolean(stateModal)}
        operacion={stateModal?.activo ? "baja" : "alta"}
        row={stateModal}
        title={stateModal?.activo ? `Dar de baja ${meta.label}` : `Reactivar ${meta.label}`}
        message={
          stateModal?.activo
            ? "La opción dejará de aparecer para nuevas operaciones, pero los movimientos ya registrados conservarán su información."
            : "La opción volverá a estar disponible en los formularios de Contabilidad."
        }
        warning={
          stateModal?.activo
            ? "La baja es reversible y no elimina ningún ingreso o egreso histórico."
            : ""
        }
        confirmLabel={stateModal?.activo ? "Dar de baja" : "Reactivar"}
        loadingLabel={stateModal?.activo ? "Dando de baja..." : "Reactivando..."}
        loadingMessage="Actualizando opción…"
        successMessage={stateModal?.activo ? "Opción dada de baja correctamente." : "Opción reactivada correctamente."}
        errorMessage="No se pudo actualizar el estado de la opción contable."
        details={stateModal ? [
          { label: "Opción", value: stateModal.nombre },
          { label: "Lista", value: meta.title },
          { label: "Movimientos históricos", value: Number(stateModal.cantidad_usos || 0) },
        ] : []}
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
        message={
          Number(deleteModal?.cantidad_usos || 0) > 0
            ? Number(deleteModal?.cantidad_usos || 0) === 1
              ? `La opción se eliminará definitivamente. El movimiento asociado se conservará, pero quedará sin ${meta.deletedFieldLabel}.`
              : `La opción se eliminará definitivamente. Los ${Number(deleteModal?.cantidad_usos || 0)} movimientos asociados se conservarán, pero quedarán sin ${meta.deletedFieldLabel}.`
            : "La opción se eliminará definitivamente de la configuración."
        }
        warning={
          Number(deleteModal?.cantidad_usos || 0) > 0
            ? `Esta acción no se puede deshacer. Al confirmar, esos movimientos quedarán con el campo ${meta.deletedFieldLabel} vacío y sin información; los movimientos no se eliminarán.`
            : "Esta acción no se puede deshacer."
        }
        confirmLabel="Eliminar"
        loadingLabel="Eliminando..."
        loadingMessage="Eliminando opción…"
        successMessage="Opción eliminada correctamente."
        errorMessage="No se pudo eliminar la opción contable."
        details={deleteModal ? [
          { label: "Opción", value: deleteModal.nombre },
          { label: "Lista", value: meta.title },
          { label: "Movimientos históricos", value: Number(deleteModal.cantidad_usos || 0) },
        ] : []}
        onClose={() => setDeleteModal(null)}
        onConfirm={confirmDelete}
        onToast={handleModalToast}
        loading={saving}
      />
    </>
  );
}
