import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faArrowRotateLeft,
  faCalculator,
  faChevronRight,
  faFileInvoiceDollar,
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
import { canWrite } from "../../_shared/auth/session";
import { upperWithoutDigits } from "../../Global/Formularios/inputSanitizers";
import { configuracionApi } from "../api/configuracionApi";
import { useConfiguracion } from "../hooks/useConfiguracion";
import { useTableScrollbarCompensation } from "../hooks/useTableScrollbarCompensation";
import "../configuracion.css";
import "./CatalogosConfiguracion.css";

const upper = (value) => String(value ?? "").toLocaleUpperCase("es-AR");

const CATALOG_META = {
  medios_pago: {
    label: "medio de pago",
    title: "Medios de pago",
    description:
      "Opciones disponibles para socios y para registrar el cobro de cuotas.",
    detail:
      "Se utilizan como medio habitual del socio y como medio real de cada pago.",
    icon: faMoneyBillTransfer,
    idField: "id_medio_pago",
    activeSingular: "activo",
    activePlural: "activos",
    inactivePlural: "inactivos",
    empty: "Todavía no hay medios de pago configurados.",
    maxLength: 100,
    deletedFieldLabel: "medio de pago",
  },
  condiciones_iva: {
    label: "condición frente al IVA",
    title: "Condiciones frente al IVA",
    description:
      "Condiciones fiscales disponibles al registrar o editar una empresa.",
    detail: "Se aplican únicamente a socios de tipo empresa.",
    icon: faFileInvoiceDollar,
    idField: "id_condicion_iva",
    activeSingular: "activa",
    activePlural: "activas",
    inactivePlural: "inactivas",
    empty: "Todavía no hay condiciones frente al IVA configuradas.",
    maxLength: 100,
    deletedFieldLabel: "condición frente al IVA",
  },
};

const emptyForm = (lista = "medios_pago") => ({
  lista,
  id: "",
  nombre: "",
});

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
      description:
        "Creá, editá, eliminá o desactivá usuarios y definí qué rol tiene cada acceso.",
      icon: faUsers,
      status: "Seguridad",
      area: "Usuarios",
      detail: "Administradores y solo lectura",
      path: "/configuracion/usuarios",
    },
    {
      id: "catalogos",
      title: "Catálogos generales",
      description:
        "Administrá en una sola caja los medios de pago y las condiciones frente al IVA.",
      icon: faSliders,
      status: "2 pestañas",
      area: "Sistema",
      detail: "Medios de pago y condición IVA",
      path: "/configuracion/catalogos",
    },
    {
      id: "contable",
      title: "Contable",
      description:
        "Administrá las listas que aparecen en los selectores de otros ingresos y egresos.",
      icon: faCalculator,
      status: "5 listas",
      area: "Contabilidad",
      detail: "Proveedores, categorías y conceptos",
      path: "/configuracion/contable",
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
            Gestioná usuarios, roles y los catálogos vinculados con socios,
            pagos y Contabilidad.
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
                    <small>{meta.label}</small>
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
                        title={
                          usageCount > 0
                            ? "Eliminar definitivamente; los registros asociados quedarán sin esta información"
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
  const writable = canWrite();
  const { listas, resumen, loading, error, cargar } = useConfiguracion();
  const [activeList, setActiveList] = useState("medios_pago");
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
    setForm({
      lista: activeList,
      id: String(item[meta.idField]),
      nombre: item.nombre || "",
    });
    setFormOpen(true);
  };

  const saveItem = async (event) => {
    event.preventDefault();
    const sanitizedName = upperWithoutDigits(form.nombre).trim();
    if (!sanitizedName) {
      setFeedback({ type: "error", message: "Ingresá un nombre válido." });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await configuracionApi.guardarItem({
        lista: form.lista,
        id: form.id || null,
        nombre: sanitizedName,
      });
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
        subtitle={
          form.lista === "medios_pago"
            ? "La opción estará disponible en socios y pagos nuevos."
            : "La opción estará disponible en el formulario de empresas."
        }
        onClose={() => setFormOpen(false)}
        onSubmit={saveItem}
        saving={saving}
        submitLabel={form.id ? "Guardar cambios" : "Agregar"}
        closeOnBackdrop={false}
        modalClassName="config-catalogModal"
      >
        <div className="entity-form config-catalogForm">
          <div className="entity-form__grid entity-form__grid--single">
            <FloatingField
              label={
                <>
                  <FontAwesomeIcon icon={meta.icon} aria-hidden="true" />
                  Nombre *
                </>
              }
              active={Boolean(form.nombre)}
            >
              <input
                value={form.nombre}
                placeholder=" "
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    nombre: upperWithoutDigits(event.target.value),
                  }))
                }
                maxLength={meta.maxLength}
                required
                autoFocus
              />
            </FloatingField>
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
        message={
          Number(deleteModal?.cantidad_usos || 0) > 0
            ? Number(deleteModal?.cantidad_usos || 0) === 1
              ? `La opción se eliminará definitivamente. El registro asociado se conservará, pero quedará sin ${meta.deletedFieldLabel}.`
              : `La opción se eliminará definitivamente. Los ${Number(deleteModal?.cantidad_usos || 0)} registros asociados se conservarán, pero quedarán sin ${meta.deletedFieldLabel}.`
            : "La opción se eliminará definitivamente de la configuración."
        }
        warning={
          Number(deleteModal?.cantidad_usos || 0) > 0
            ? `Esta acción no se puede deshacer. Al confirmar, esos registros quedarán con el campo ${meta.deletedFieldLabel} vacío y sin información.`
            : "Esta acción no se puede deshacer."
        }
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
