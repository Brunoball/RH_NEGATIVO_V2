import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAddressBook,
  faCalendarDays,
  faCircleInfo,
  faClockRotateLeft,
  faHouse,
  faPen,
  faPlus,
  faRotateLeft,
  faUserSlash,
  faUsers,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import CrudModal from "../../Global/Modales/CrudModal";
import InfoModal, {
  InfoEmpty,
  InfoRow,
  InfoSection,
  InfoSummary,
} from "../../Global/Modales/InfoModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModalExportarGlobal from "../../Global/Modales/ModalExportarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import BotonExportarGlobal from "../../Global/Botones/BotonExportarGlobal";
import {
  EntityFormPanel,
  EntityTabPane,
  EntityTabs,
  FloatingField,
} from "../../Global/Formularios/TabbedForm";
import {
  matchesEverySearchTerm,
  normalizeSearchQuery,
} from "../../Global/Formularios/searchUtils";
import {
  personNameInput,
  upperLimitedText,
} from "../../Global/Formularios/inputSanitizers";
import { canWrite } from "../../_shared/auth/session";
import { familiasApi } from "../api/sociosApi";
import { useFamilias } from "../hooks/useFamilias";
import "./Familias.css";
import "../modales/FamiliasModal.css";

const FORM_TAB_DETAILS = "datos";
const FORM_TAB_MEMBERS = "integrantes";
const INFO_TAB_CURRENT = "actual";
const INFO_TAB_HISTORY = "historial";
const PARTNER_STATUS_STORAGE_KEY = "rh_v2_familias_estado_seleccionado";

function readSharedFamilyStatus() {
  if (typeof window === "undefined") return "activo";
  try {
    return window.sessionStorage.getItem(PARTNER_STATUS_STORAGE_KEY) ===
      "INACTIVO"
      ? "inactivo"
      : "activo";
  } catch (_error) {
    return "activo";
  }
}

function saveSharedFamilyStatus(value) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      PARTNER_STATUS_STORAGE_KEY,
      value === "inactivo" ? "INACTIVO" : "ACTIVO",
    );
  } catch (_error) {
    // La navegación sigue funcionando aunque el almacenamiento esté bloqueado.
  }
}

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};
const upper = (value) => String(value || "").toLocaleUpperCase("es-AR");
const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`),
      )
    : "—";

const FAMILY_EXPORT_COLUMNS = [
  { label: "N.º", value: (_item, index) => index + 1 },
  { label: "Familia", key: "nombre" },
  { label: "Observaciones", value: (item) => item.descripcion || "—" },
  { label: "Integrantes", value: (item) => Number(item.cantidad_integrantes || 0) },
  { label: "Estado", value: (item) => item.activo ? "ACTIVA" : "BAJA" },
];

function emptyForm() {
  return {
    id_familia: "",
    nombre: "",
    descripcion: "",
    integrantes: [],
    integrantes_originales: [],
    fecha_desvinculacion: today(),
  };
}

function getCatalogFamilyId(person) {
  return Number(
    person?.id_familia_activa ??
      person?.id_familia ??
      person?.familia_id ??
      person?.idFamilia ??
      0,
  );
}

function getCatalogFamilyName(person) {
  return String(
    person?.familia ?? person?.nombre_familia ?? person?.familia_nombre ?? "",
  ).trim();
}

function hasCatalogFamily(person) {
  const familyId = getCatalogFamilyId(person);
  const familyName = upper(getCatalogFamilyName(person));
  const familyFlag = String(person?.familia_activa ?? person?.tiene_familia ?? "")
    .trim()
    .toLocaleUpperCase("es-AR");

  return (
    familyId > 0 ||
    ["1", "TRUE", "SI", "SÍ", "ACTIVO", "ACTIVA"].includes(familyFlag) ||
    Boolean(familyName && !["-", "—", "SIN FAMILIA"].includes(familyName))
  );
}

function belongsToAnotherFamily(person, form) {
  if (!hasCatalogFamily(person)) return false;

  const personFamilyId = getCatalogFamilyId(person);
  const currentFamilyId = Number(form?.id_familia || 0);
  if (currentFamilyId && personFamilyId) {
    return personFamilyId !== currentFamilyId;
  }

  const personFamilyName = upper(getCatalogFamilyName(person));
  const currentFamilyName = upper(form?.nombre || "").trim();
  if (currentFamilyId && personFamilyName && currentFamilyName) {
    return personFamilyName !== currentFamilyName;
  }

  return true;
}

function memberFromCatalog(person) {
  return {
    id_socio: Number(person.id_socio),
    nombre: person.nombre || "",
    dni: person.dni || "",
    categoria: person.categoria || "",
    desde: person.desde || person.fecha_incorporacion || today(),
    activo: person.activo !== false,
    vigente: person.vigente !== false,
  };
}

function FamilyForm({ form, setForm, catalog, activeTab, onTabChange, pendingMemberIds, setPendingMemberIds }) {
  const [memberSearch, setMemberSearch] = useState("");
  const selectedIds = useMemo(
    () => new Set(form.integrantes.map((member) => Number(member.id_socio))),
    [form.integrantes],
  );
  const visible = useMemo(() => {
    return (catalog || []).filter((person) => {
      if (selectedIds.has(Number(person.id_socio))) return false;
      return matchesEverySearchTerm(
        [person.nombre, person.dni, person.categoria]
          .filter(Boolean)
          .join(" "),
        memberSearch,
      );
    });
  }, [catalog, memberSearch, selectedIds]);

  const togglePendingMember = (person) => {
    const id = Number(person.id_socio);
    setPendingMemberIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateMember = (id, key, value) => {
    setForm((current) => ({
      ...current,
      integrantes: current.integrantes.map((member) =>
        Number(member.id_socio) === Number(id)
          ? { ...member, [key]: value }
          : member,
      ),
    }));
  };

  const removedCount = form.integrantes_originales.filter(
    (id) => !selectedIds.has(Number(id)),
  ).length;

  return (
    <div className="entity-form familias-modal__form">
      <EntityTabs
        tabs={[
          {
            value: FORM_TAB_DETAILS,
            label: "Datos de la familia",
            icon: faHouse,
          },
          {
            value: FORM_TAB_MEMBERS,
            label: "Integrantes",
            icon: faUsers,
            badge: form.integrantes.length || null,
          },
        ]}
        value={activeTab}
        onChange={onTabChange}
        idPrefix="familia-form-tab"
        ariaLabel="Secciones de la familia"
      />

      <EntityTabPane active={activeTab === FORM_TAB_DETAILS} disableWhenInactive>
        <EntityFormPanel
          tabValue={FORM_TAB_DETAILS}
          idPrefix="familia-form-tab"
          eyebrow="Ficha principal"
          title="Identificación del grupo"
          icon={faAddressBook}
          tag="Nombre obligatorio"
          bodyClassName="familias-form-panel__body--details"
        >
          <FloatingField label="Nombre de la familia *">
            <input
              value={form.nombre}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  nombre: personNameInput(event.target.value, 120),
                }))
              }
              maxLength={120}
              placeholder=" "
              autoFocus
            />
          </FloatingField>
          <FloatingField label="Observaciones" textarea>
            <textarea
              value={form.descripcion}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  descripcion: upperLimitedText(event.target.value, 2000),
                }))
              }
              rows={3}
              maxLength={2000}
              placeholder=" "
            />
          </FloatingField>
          <div className="familias-form-note">
            <FontAwesomeIcon icon={faCircleInfo} />
            <span>
              Cada socio puede tener
              un solo vínculo familiar activo.
            </span>
          </div>
        </EntityFormPanel>
      </EntityTabPane>

      <EntityTabPane active={activeTab === FORM_TAB_MEMBERS} disableWhenInactive>
        <EntityFormPanel
          tabValue={FORM_TAB_MEMBERS}
          idPrefix="familia-form-tab"
          bodyClassName="familias-form-panel__body--members"
        >
          <div className="familias-members-layout">
            <section className="familias-members-column familias-members-column--available">
              <div className="familias-members-column__header">
                <div>
                  <strong>Socios</strong>
                  <span>Los que ya tienen familia aparecen deshabilitados.</span>
                </div>
                <span className="familias-members-count">{visible.length}</span>
              </div>

              <FloatingField
                label="Buscar socio por nombre, DNI o categoría"
                className="familias-modal__member-search"
              >
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.currentTarget.value)}
                  placeholder=" "
                  autoComplete="off"
                />
              </FloatingField>

              <div className="familias-modal__member-list familias-modal__member-list--available">
                {visible.map((person) => {
                  const id = Number(person.id_socio);
                  const checked = pendingMemberIds.has(id);
                  const belongsElsewhere = belongsToAnotherFamily(person, form);
                  const disabled = Boolean(belongsElsewhere || !person.activo);
                  const familyName = getCatalogFamilyName(person);
                  return (
                    <label
                      className={`entity-check-option familias-modal__member ${checked ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`.trim()}
                      key={person.id_socio}
                      title={
                        belongsElsewhere
                          ? familyName
                            ? `Ya pertenece a ${familyName}`
                            : "Ya pertenece a otra familia"
                          : !person.activo
                            ? "Socio dado de baja"
                            : ""
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => togglePendingMember(person)}
                      />
                      <span className="familias-member-avatar" aria-hidden="true">
                        {(person.nombre || "?").trim().charAt(0).toLocaleUpperCase("es-AR")}
                      </span>
                      <span className="familias-modal__member-copy">
                        <strong>{person.nombre}</strong>
                        <small>
                          DNI {person.dni || "—"}
                          {person.categoria ? ` · ${person.categoria}` : ""}
                          {belongsElsewhere
                            ? ` · ${familyName ? `Familia: ${familyName}` : "Ya tiene familia"}`
                            : ""}
                        </small>
                      </span>
                    </label>
                  );
                })}
                {!visible.length ? (
                  <div className="familias-modal__empty">
                    <strong>Sin socios disponibles</strong>
                    <span>No hay personas que coincidan con la búsqueda.</span>
                  </div>
                ) : null}
              </div>

            </section>

            <section className="familias-members-column familias-members-column--current">
              <div className="familias-members-column__header">
                <div>
                  <strong>Integrantes de la familia</strong>
                  <span>Definí desde cuándo integra el grupo.</span>
                </div>
                <span className="familias-members-count">{form.integrantes.length}</span>
              </div>

              <div className="familias-selected-members__list">
                {form.integrantes.map((member) => (
                  <article
                    className="familias-selected-member"
                    key={member.id_socio}
                  >
                    <div className="familias-selected-member__top">
                      <span className="familias-member-avatar" aria-hidden="true">
                        {(member.nombre || "?").trim().charAt(0).toLocaleUpperCase("es-AR")}
                      </span>
                      <div className="familias-selected-member__identity">
                        <strong>{member.nombre}</strong>
                        <small>
                          DNI {member.dni || "—"}
                          {member.categoria ? ` · ${member.categoria}` : ""}
                          {member.vigente === false ? " · SOCIO DE BAJA" : ""}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="familias-member-remove"
                        title="Quitar integrante"
                        aria-label={`Quitar a ${member.nombre}`}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            integrantes: current.integrantes.filter(
                              (entry) => Number(entry.id_socio) !== Number(member.id_socio),
                            ),
                          }))
                        }
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                    <div className="familias-selected-member__fields">
                      <label className="familias-member-date">
                        <span>Integra la familia desde</span>
                        <input
                          className="familias-member-input"
                          type="date"
                          value={member.desde || today()}
                          max={today()}
                          onChange={(event) =>
                            updateMember(member.id_socio, "desde", event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </article>
                ))}
                {!form.integrantes.length ? (
                  <div className="familias-modal__empty">
                    <strong>Sin integrantes</strong>
                    <span>Seleccioná socios y presioná Agregar miembros.</span>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {removedCount > 0 ? (
            <div className="familias-unlink-panel">
              <strong>
                {removedCount} integrante
                {removedCount === 1 ? " será" : "s serán"} desvinculado
                {removedCount === 1 ? "" : "s"}
              </strong>
              <p>
                El socio no se elimina: se cierra su vínculo con esta familia y
                el período queda disponible en el historial.
              </p>
              <div className="entity-form__grid">
                <FloatingField label="Fecha de desvinculación *" active>
                  <input
                    type="date"
                    value={form.fecha_desvinculacion}
                    max={today()}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        fecha_desvinculacion: event.target.value,
                      }))
                    }
                  />
                </FloatingField>
              </div>
            </div>
          ) : null}
        </EntityFormPanel>
      </EntityTabPane>
    </div>
  );
}

function formFromFamily(item) {
  const members = (item.integrantes || []).map((member) =>
    memberFromCatalog(member),
  );
  return {
    id_familia: item.id_familia,
    nombre: item.nombre || item.nombre_familia || "",
    descripcion: item.descripcion || item.observaciones || "",
    integrantes: members,
    integrantes_originales: members.map((member) => member.id_socio),
    fecha_desvinculacion: today(),
  };
}

export default function Familias() {
  const writable = canWrite();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState(readSharedFamilyStatus);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(normalizeSearchQuery(search));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters = useMemo(
    () => ({ buscar: debouncedSearch, estado: status }),
    [debouncedSearch, status],
  );
  const { items, catalogos, loading, error, cargar } = useFamilias(filters);
  const [form, setForm] = useState(emptyForm);
  const [formTab, setFormTab] = useState(FORM_TAB_DETAILS);
  const [pendingMemberIds, setPendingMemberIds] = useState(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stateModal, setStateModal] = useState(null);
  const [stateDate, setStateDate] = useState(today());
  const [deleteModal, setDeleteModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [detailTab, setDetailTab] = useState(INFO_TAB_CURRENT);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const openNew = () => {
    setForm(emptyForm());
    setPendingMemberIds(new Set());
    setFormTab(FORM_TAB_DETAILS);
    setModalOpen(true);
  };
  const openEdit = async (item) => {
    try {
      const response = await familiasApi.obtener(item.id_familia);
      setForm(formFromFamily(response.item || item));
      setPendingMemberIds(new Set());
      setFormTab(FORM_TAB_DETAILS);
      setModalOpen(true);
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.message });
    }
  };
  const addPendingMembers = () => {
    if (!pendingMemberIds.size) return;
    const peopleToAdd = (catalogos.socios || []).filter(
      (person) =>
        pendingMemberIds.has(Number(person.id_socio)) &&
        person.activo !== false &&
        !belongsToAnotherFamily(person, form),
    );
    setForm((current) => ({
      ...current,
      integrantes: [
        ...current.integrantes,
        ...peopleToAdd.map(memberFromCatalog),
      ],
    }));
    setPendingMemberIds(new Set());
  };

  const save = async (event) => {
    event.preventDefault();
    if (!form.nombre.trim()) {
      setFormTab(FORM_TAB_DETAILS);
      setFeedback({
        type: "error",
        message: "Completá el nombre de la familia. Los datos cargados se conservaron.",
      });
      return;
    }
    if (!form.integrantes.length) {
      setFormTab(FORM_TAB_MEMBERS);
      setFeedback({
        type: "error",
        message: "Seleccioná al menos un integrante para la familia. Los datos cargados se conservaron.",
      });
      return;
    }
    setSaving(true);
    try {
      const response = await familiasApi.guardar({
        id_familia: form.id_familia || null,
        nombre: personNameInput(form.nombre, 120).trim(),
        descripcion: upperLimitedText(form.descripcion, 2000),
        observaciones: form.descripcion,
        integrantes: form.integrantes.map((member) => ({
          id_socio: member.id_socio,
          desde: member.desde || today(),
        })),
        fecha_desvinculacion: form.fecha_desvinculacion,
      });
      setModalOpen(false);
      setFeedback({ type: "success", message: response.mensaje });
      void cargar();
    } catch (requestError) {
      const field = requestError?.data?.detalles?.campo || "";
      if (["nombre", "descripcion", "observaciones"].includes(field)) {
        setFormTab(FORM_TAB_DETAILS);
      } else if (
        ["integrantes", "id_socio", "desde", "fecha_desvinculacion"].includes(field)
      ) {
        setFormTab(FORM_TAB_MEMBERS);
      }
      setFeedback({
        type: "error",
        message: `${requestError.message || "No se pudo guardar la familia."} Los datos cargados se conservaron.`,
      });
    } finally {
      setSaving(false);
    }
  };
  const openDetail = async (item) => {
    setDetailModal({ item, data: null, error: "" });
    setDetailTab(INFO_TAB_CURRENT);
    setDetailLoading(true);
    try {
      const response = await familiasApi.obtener(item.id_familia);
      setDetailModal({ item, data: response.item, error: "" });
    } catch (requestError) {
      setDetailModal({ item, data: null, error: requestError.message });
    } finally {
      setDetailLoading(false);
    }
  };
  const changeState = async ({ motivo }) => {
    if (!stateModal) return null;
    const response = stateModal.activo
      ? await familiasApi.darBaja({
          id: stateModal.id_familia,
          fecha_baja: stateDate,
          motivo_baja: motivo,
        })
      : await familiasApi.reactivar(stateModal.id_familia);
    void cargar();
    return response;
  };
  const openPermanentDelete = async (item) => {
    if (!item) return;
    setDeleteModal({ item, data: null, loading: true, error: "" });
    try {
      const response = await familiasApi.obtener(item.id_familia);
      setDeleteModal({ item, data: response.item, loading: false, error: "" });
    } catch (requestError) {
      setDeleteModal({
        item,
        data: null,
        loading: false,
        error:
          requestError.message ||
          "No se pudo calcular el impacto de la eliminación.",
      });
    }
  };
  const deletePermanently = async () => {
    if (!deleteModal?.item) return null;
    const response = await familiasApi.eliminarDefinitivo({
      id: deleteModal.item.id_familia,
      confirmacion: "ELIMINAR",
    });
    void cargar();
    return response;
  };

  const activeMembersToUnlink =
    deleteModal?.data?.integrantes?.length ??
    Number(deleteModal?.item?.cantidad_integrantes || 0);
  const familyLinksToDelete =
    deleteModal?.data?.historial_integrantes?.length ?? "Calculando...";

  const filtersUi = [
    {
      key: "estado",
      label: "Estado",
      type: "tabs",
      ariaLabel: "Estado de las familias",
      value: status,
      onChange: (value) => {
        saveSharedFamilyStatus(value);
        setStatus(value);
      },
      options: [
        { value: "activo", label: "Activas" },
        { value: "inactivo", label: "Bajas" },
      ],
    },
    {
      key: "buscar",
      label: "Búsqueda",
      type: "search",
      placeholder: " ",
      value: search,
      onChange: setSearch,
      className: "familias-mainSearch",
    },
  ];

  return (
    <>
      <ModulePage
        title="Familias"
        className="familias-page"
        filters={filtersUi}
        tabsInTitle
        headFiltersInActions
        primaryActionLabel="Nueva familia"
        onPrimaryAction={openNew}
        headerActions={
          <BotonExportarGlobal
            label="Exportar"
            onClick={() => setExportModalOpen(true)}
            disabled={loading || items.length === 0}
            title="Exportar familias en Excel o PDF"
          />
        }
        canCreate={writable}
        notice={
          !writable
            ? "Tu usuario tiene permiso de consulta. Las modificaciones están deshabilitadas."
            : null
        }
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || error}
          duration={feedback?.duration}
          onClose={() => setFeedback(null)}
        />
        <GlobalDivTable
          className="familias-table"
          bodyClassName="entity-table-wrap"
          gridClassName="familias-grid"
          ariaLabel="Listado de familias"
          loading={loading}
          loadingLabel="Cargando familias..."
          skeletonRows={6}
          columns={[
            "Familia",
            "Observaciones",
            "Integrantes",
            "Acciones",
          ]}
        >
          {!loading && !error && !items.length ? (
            <div className="module-empty">
              <FontAwesomeIcon icon={faUsers} />
              <strong>Sin familias para mostrar</strong>
              <span>Creá la primera familia o cambiá los filtros.</span>
            </div>
          ) : null}
          {items.map((item) => (
            <div
              className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row familias-grid"
              role="row"
              key={item.id_familia}
            >
              <div className="mov-gridCell entity-main-cell">
                <strong>{item.nombre}</strong>
              </div>
              <div className="mov-gridCell">
                <span className="entity-wrap-text">
                  {item.descripcion || "—"}
                </span>
              </div>
              <div className="mov-gridCell is-strong">
                {Number(item.cantidad_integrantes || 0)}
              </div>
              <div className="mov-gridCell mov-gridCell--actions">
                <div className="mov-actionsInline">
                  <button
                    className="mov-iconBtn"
                    type="button"
                    title="Ver integrantes e historial"
                    onClick={() => openDetail(item)}
                  >
                    <FontAwesomeIcon icon={faCircleInfo} />
                  </button>
                  {writable ? (
                    <>
                      {item.activo ? (
                        <button
                          className="mov-iconBtn"
                          type="button"
                          title="Editar"
                          onClick={() => openEdit(item)}
                        >
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                      ) : null}
                      <button
                        className={`mov-iconBtn ${item.activo ? "mov-iconBtn--danger" : ""}`}
                        type="button"
                        title={item.activo ? "Dar de baja" : "Reactivar"}
                        onClick={() => {
                          setStateDate(today());
                          setStateModal(item);
                        }}
                      >
                        <FontAwesomeIcon
                          icon={item.activo ? faUserSlash : faRotateLeft}
                        />
                      </button>
                      {!item.activo ? (
                        <button
                          className="mov-iconBtn mov-iconBtn--danger"
                          type="button"
                          title="Eliminar definitivamente la familia"
                          aria-label={`Eliminar definitivamente la familia ${item.nombre}`}
                          onClick={() => openPermanentDelete(item)}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </GlobalDivTable>
      </ModulePage>

      <ModalExportarGlobal
        open={exportModalOpen}
        title="Exportar familias"
        subtitle="Elegí el formato para descargar las familias filtradas."
        tituloArchivo="Familias"
        subtituloArchivoActual={[
          status === "inactivo" ? "Bajas" : "Activas",
          debouncedSearch ? `Búsqueda: ${debouncedSearch}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        nombreArchivo="familias"
        columnas={FAMILY_EXPORT_COLUMNS}
        registrosActuales={items}
        cantidadActual={items.length}
        mostrarAlcanceTodos={false}
        alcanceActualLabel="Exportar familias filtradas"
        alcanceActualDescription="Descarga las familias que coinciden con la vista actual."
        totalLabelSingular="familia disponible"
        totalLabelPlural="familias disponibles"
        onClose={() => setExportModalOpen(false)}
        onSuccess={(message) =>
          setFeedback({ type: "success", message, duration: 4200 })
        }
        onError={(message) =>
          setFeedback({ type: "error", message, duration: 5200 })
        }
      />

      <CrudModal
        open={modalOpen}
        title={form.id_familia ? "Editar familia" : "Nueva familia"}
        subtitle="Los integrantes se vinculan de forma histórica; quitar uno cierra su período sin borrar al socio."
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        saving={saving}
        submitLabel={form.id_familia ? "Guardar cambios" : "Crear familia"}
        modalClassName="familias-modal familias-modal--form"
        closeOnBackdrop={false}
        autoUppercaseInputs={false}
        wide
        footerStart={formTab === FORM_TAB_MEMBERS ? (
          <button
            type="button"
            className="mov-btn mov-btn--primary familias-footer-add-members"
            onClick={addPendingMembers}
            disabled={!pendingMemberIds.size || saving}
          >
            <FontAwesomeIcon icon={faPlus} />
            Agregar miembros
            {pendingMemberIds.size ? ` (${pendingMemberIds.size})` : ""}
          </button>
        ) : null}
      >
        <FamilyForm
          form={form}
          setForm={setForm}
          catalog={catalogos.socios || []}
          activeTab={formTab}
          onTabChange={setFormTab}
          pendingMemberIds={pendingMemberIds}
          setPendingMemberIds={setPendingMemberIds}
        />
      </CrudModal>

      <InfoModal
        open={Boolean(detailModal)}
        title="Ficha de la familia"
        subtitle={detailModal?.item?.nombre || ""}
        onClose={() => setDetailModal(null)}
        tabs={[
          {
            value: INFO_TAB_CURRENT,
            label: "Integrantes actuales",
            icon: faUsers,
            badge: detailModal?.data?.integrantes?.length || null,
          },
          {
            value: INFO_TAB_HISTORY,
            label: "Historial",
            icon: faClockRotateLeft,
            badge: detailModal?.data?.historial_integrantes?.length || null,
          },
        ]}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        loading={detailLoading}
        loadingTitle="Cargando familia..."
        loadingText="Consultando integrantes activos e históricos."
        modalClassName="familias-info-modal"
        closeOnBackdrop={false}
      >
        {detailModal?.error ? (
          <ModuleFeedback type="error" message={detailModal.error} />
        ) : detailModal?.data ? (
          detailTab === INFO_TAB_CURRENT ? (
            <div className="socios-info-content">
              <InfoSummary
                items={[
                  {
                    label: "Estado",
                    value: detailModal.data.activo ? "ACTIVA" : "BAJA",
                    icon: detailModal.data.activo ? faHouse : faUserSlash,
                    tone: detailModal.data.activo ? "success" : "danger",
                  },
                  {
                    label: "Integrantes",
                    value: detailModal.data.integrantes.length,
                    icon: faUsers,
                  },
                  {
                    label: "Creación",
                    value: formatDate(
                      String(detailModal.data.creado_en || "").slice(0, 10),
                    ),
                    icon: faCalendarDays,
                  },
                  {
                    label: "Actualización",
                    value: formatDate(
                      String(detailModal.data.actualizado_en || "").slice(0, 10),
                    ),
                    icon: faClockRotateLeft,
                  },
                ]}
              />
              <InfoSection
                title="Integrantes activos"
                icon={faUsers}
                badge={detailModal.data.integrantes.length}
              >
                {detailModal.data.integrantes.length ? (
                  detailModal.data.integrantes.map((member) => (
                    <InfoRow
                      key={member.id_familia_socio}
                      title={member.denominacion}
                      detail={[
                        `DNI ${member.dni || "—"}`,
                        member.categoria,
                        member.socio_vigente === false ? "SOCIO DE BAJA" : "SOCIO VIGENTE",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      meta={`DESDE ${formatDate(member.desde || member.fecha_incorporacion)}`}
                      tone={member.socio_vigente === false ? "danger" : "success"}
                    />
                  ))
                ) : (
                  <InfoEmpty>
                    La familia no tiene integrantes activos.
                  </InfoEmpty>
                )}
              </InfoSection>
              {detailModal.data.descripcion ? (
                <InfoSection title="Observaciones" icon={faAddressBook}>
                  <InfoRow title={detailModal.data.descripcion} />
                </InfoSection>
              ) : null}
            </div>
          ) : (
            <InfoSection
              title="Períodos familiares"
              icon={faClockRotateLeft}
              badge={detailModal.data.historial_integrantes.length}
            >
              {detailModal.data.historial_integrantes.length ? (
                detailModal.data.historial_integrantes.map((member) => (
                  <InfoRow
                    key={member.id_familia_socio}
                    title={member.denominacion}
                    detail={[
                      member.categoria,
                      member.activo ? "VÍNCULO ACTIVO" : "VÍNCULO FINALIZADO",
                      member.socio_vigente === false ? "SOCIO DE BAJA" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    meta={`${formatDate(member.desde || member.fecha_incorporacion)} → ${member.hasta || member.fecha_desvinculacion ? formatDate(member.hasta || member.fecha_desvinculacion) : "ACTUALIDAD"}`}
                    tone={member.activo ? "success" : ""}
                  />
                ))
              ) : (
                <InfoEmpty>Sin períodos familiares registrados.</InfoEmpty>
              )}
            </InfoSection>
          )
        ) : null}
      </InfoModal>

      <ModalEliminarGlobal
        open={Boolean(stateModal)}
        operacion={stateModal?.activo ? "baja" : "alta"}
        row={stateModal}
        title={
          stateModal?.activo ? "Dar de baja la familia" : "Reactivar familia"
        }
        message={
          stateModal?.activo
            ? "Se cerrarán los vínculos activos de todos sus integrantes. La familia y su historial se conservarán."
            : "La familia volverá a estar activa, pero los vínculos anteriores no se restauran automáticamente."
        }
        warning={
          stateModal?.activo
            ? "Los integrantes quedarán disponibles para incorporarse a otra familia."
            : "Agregá nuevamente los integrantes desde Editar familia."
        }
        details={
          stateModal
            ? [
                { label: "Familia", value: stateModal.nombre },
                {
                  label: "Integrantes activos",
                  value: stateModal.cantidad_integrantes,
                },
                {
                  label: "Estado actual",
                  value: stateModal.activo ? "ACTIVA" : "BAJA",
                },
              ]
            : []
        }
        showReason={Boolean(stateModal?.activo)}
        reasonRequired={Boolean(stateModal?.activo)}
        reasonLabel="Motivo de baja *"
        reasonPlaceholder="Indicá por qué se da de baja la familia..."
        extraContent={
          stateModal?.activo ? (
            <label className="entity-field gdel-date-field">
              <span>Fecha de baja *</span>
              <input
                type="date"
                value={stateDate}
                max={today()}
                onChange={(event) => setStateDate(event.target.value)}
                required
              />
            </label>
          ) : null
        }
        confirmDisabled={Boolean(stateModal?.activo && !stateDate)}
        onClose={() => setStateModal(null)}
        onConfirm={changeState}
        onToast={(typeFeedback, message, duration) =>
          setFeedback({ type: typeFeedback, message, duration })
        }
        confirmLabel={stateModal?.activo ? "Dar de baja" : "Reactivar"}
      />

      <ModalEliminarGlobal
        open={Boolean(deleteModal)}
        operacion="eliminar"
        row={deleteModal?.item}
        loading={Boolean(deleteModal?.loading)}
        title="Eliminar definitivamente la familia"
        message="Confirmá la eliminación definitiva. Se borrarán la familia y sus vínculos históricos, pero no se eliminará ningún socio ni sus pagos."
        warning="Esta operación es irreversible. Los socios seguirán disponibles y podrán incorporarse a otra familia."
        details={
          deleteModal?.item
            ? [
                { label: "Familia", value: deleteModal.item.nombre },
                {
                  label: "Integrantes actuales",
                  value: activeMembersToUnlink,
                },
                {
                  label: "Vínculos familiares que se borrarán",
                  value: familyLinksToDelete,
                },
                {
                  label: "Socios, pagos y datos personales",
                  value: "SE CONSERVAN",
                },
              ]
            : []
        }
        extraContent={deleteModal?.error ? <p>{deleteModal.error}</p> : null}
        confirmDisabled={
          Boolean(deleteModal?.loading) || Boolean(deleteModal?.error)
        }
        onClose={() => setDeleteModal(null)}
        onConfirm={deletePermanently}
        onToast={(typeFeedback, message, duration) =>
          setFeedback({ type: typeFeedback, message, duration })
        }
        confirmLabel="Eliminar definitivamente"
        loadingLabel={deleteModal?.loading ? "Cargando..." : "Eliminando..."}
        successMessage="La familia fue eliminada definitivamente. Sus socios quedaron sin familia."
        errorMessage="No se pudo eliminar definitivamente la familia."
      />
    </>
  );
}
