import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faArrowRotateLeft,
  faCheck,
  faEnvelope,
  faGear,
  faKey,
  faLock,
  faPen,
  faShieldHalved,
  faTrashCan,
  faUser,
  faUserPlus,
  faUsers,
  faUserSlash,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import DataTableSkeleton from "../../Global/DataTableSkeleton";
import CrudModal from "../../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import { getSession, saveSession } from "../../_shared/auth/session";
import { configuracionApi } from "../api/configuracionApi";
import { useTableScrollbarCompensation } from "../hooks/useTableScrollbarCompensation";
import "./UsuariosConfiguracion.css";

const EMPTY_SUMMARY = { total: 0, activos: 0, bajas: 0, admins: 0 };
const EMPTY_FORM = {
  id: "",
  usuario: "",
  email: "",
  rol: "vista",
  contrasena: "",
  confirmar_contrasena: "",
  sesion_actual: false,
};

const ROLE_LABELS = {
  admin: "Administrador",
  vista: "Solo lectura",
};

function formatCreatedAt(value) {
  if (!value) return "Sin fecha";
  return String(value).replace("T", " ").slice(0, 19);
}

function userInitial(value) {
  return (
    String(value || "U")
      .trim()
      .charAt(0)
      .toLocaleUpperCase("es-AR") || "U"
  );
}

function UserStat({ icon, label, value, detail, tone }) {
  return (
    <article className={`config-usersStat config-usersStat--${tone}`}>
      <span className="config-usersStat__icon" aria-hidden="true">
        <FontAwesomeIcon icon={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
      <span className="config-usersStat__decoration" aria-hidden="true" />
    </article>
  );
}

export default function UsuariosConfiguracion({ onBack }) {
  const currentSession = getSession();
  const [data, setData] = useState({
    usuarios: [],
    resumen: EMPTY_SUMMARY,
    capacidades: { email: true, fecha_creacion: true },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("activos");
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [stateModal, setStateModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const { bodyRef: tableBodyRef, hasVerticalScroll, scrollbarWidth } =
    useTableScrollbarCompensation();

  const handleModalToast = useCallback((type, message, duration) => {
    setFeedback({ type, message, duration });
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const response = await configuracionApi.listarUsuarios();
      setData({
        usuarios: response.usuarios || [],
        resumen: { ...EMPTY_SUMMARY, ...(response.resumen || {}) },
        capacidades: {
          email: response.capacidades?.email !== false,
          fecha_creacion: response.capacidades?.fecha_creacion !== false,
        },
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message || "No se pudieron cargar los usuarios.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    return data.usuarios.filter((user) => {
      if (statusFilter === "activos" && !user.activo) return false;
      if (statusFilter === "bajas" && user.activo) return false;
      if (!term) return true;
      return [user.usuario, user.email, ROLE_LABELS[user.rol], user.rol]
        .filter(Boolean)
        .some((value) =>
          String(value).toLocaleLowerCase("es-AR").includes(term),
        );
    });
  }, [data.usuarios, search, statusFilter]);

  const openCreate = () => {
    setFeedback(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (user) => {
    setFeedback(null);
    setForm({
      id: String(user.id),
      usuario: user.usuario || "",
      email: user.email || "",
      rol: user.rol || "vista",
      contrasena: "",
      confirmar_contrasena: "",
      sesion_actual: Boolean(user.sesion_actual),
    });
    setFormOpen(true);
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveUser = async (event) => {
    event.preventDefault();
    if (form.contrasena !== form.confirmar_contrasena) {
      setFeedback({ type: "error", message: "Las contraseñas no coinciden." });
      return;
    }
    if (!form.id && form.contrasena.length < 8) {
      setFeedback({
        type: "error",
        message: "La contraseña debe tener al menos 8 caracteres.",
      });
      return;
    }
    if (form.id && form.contrasena && form.contrasena.length < 8) {
      setFeedback({
        type: "error",
        message: "La contraseña debe tener al menos 8 caracteres.",
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await configuracionApi.guardarUsuario({
        id: form.id || null,
        usuario: form.usuario.trim(),
        email: form.email.trim() || null,
        rol: form.rol,
        contrasena: form.contrasena,
        confirmar_contrasena: form.confirmar_contrasena,
      });

      if (response.usuario?.sesion_actual && currentSession?.token) {
        saveSession({
          ...currentSession,
          usuario: {
            ...currentSession.usuario,
            nombre: response.usuario.usuario,
            rol: response.usuario.rol,
          },
        });
      }

      setFormOpen(false);
      setFeedback({ type: "success", message: response.mensaje });
      void cargar();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message || "No se pudo guardar el usuario.",
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmState = async () => {
    if (!stateModal) return { ok: false };
    setSaving(true);
    try {
      const response = await configuracionApi.cambiarEstadoUsuario(
        stateModal.id,
        !stateModal.activo,
      );
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
      const response = await configuracionApi.eliminarUsuario(deleteModal.id);
      void cargar();
      return response;
    } finally {
      setSaving(false);
    }
  };

  const stats = [
    {
      icon: faUsers,
      label: "TOTAL",
      value: data.resumen.total,
      detail: "Usuarios registrados",
      tone: "total",
    },
    {
      icon: faArrowRotateLeft,
      label: "ACTIVOS",
      value: data.resumen.activos,
      detail: "Pueden ingresar",
      tone: "active",
    },
    {
      icon: faUserSlash,
      label: "BAJAS",
      value: data.resumen.bajas,
      detail: "Sin acceso activo",
      tone: "inactive",
    },
    {
      icon: faGear,
      label: "ADMINS",
      value: data.resumen.admins,
      detail: "Permiso completo",
      tone: "admin",
    },
  ];

  return (
    <>
      <ModulePage
        title="Configuración de usuarios"
        filters={[
          {
            key: "usuarios-search",
            type: "search",
            label: "Buscar",
            value: search,
            onChange: setSearch,
            placeholder: "",
          },
        ]}
        primaryActionLabel="Nuevo usuario"
        onPrimaryAction={openCreate}
        secondaryActions={[
          {
            key: "volver",
            label: "Volver",
            icon: faArrowLeft,
            onClick: onBack,
          },
        ]}
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || ""}
          duration={feedback?.duration}
          onClose={() => setFeedback(null)}
        />

        {!data.capacidades.email || !data.capacidades.fecha_creacion ? (
          <div className="config-usersSchemaNotice">
            Ejecutá el SQL incluido en el ZIP sobre lalcec_v2 para completar la
            estructura de usuarios.
          </div>
        ) : null}

        <section className="config-usersStats" aria-label="Resumen de usuarios">
          {stats.map((stat) => (
            <UserStat key={stat.label} {...stat} />
          ))}
        </section>

        <section className="config-usersPanel">
          <header className="config-usersPanel__toolbar">
            <div
              className="config-usersTabs"
              role="tablist"
              aria-label="Estado de usuarios"
            >
              {[
                { value: "activos", label: "Activos" },
                { value: "bajas", label: "Dados de baja" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === option.value}
                  className={statusFilter === option.value ? "is-active" : ""}
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <strong>
              {loading
                ? "Cargando usuarios..."
                : `Mostrando ${filteredUsers.length} usuario${filteredUsers.length === 1 ? "" : "s"}`}
            </strong>
          </header>

          <div
            className={`config-usersTable ${hasVerticalScroll ? "has-y-scroll" : ""}`.trim()}
            role="table"
            aria-label="Usuarios del sistema"
            aria-busy={loading}
            style={{ "--config-table-scrollbar-width": `${scrollbarWidth}px` }}
          >
            {loading ? (
              <span
                className="mov-skeletonStatus"
                role="status"
                aria-live="polite"
              >
                Cargando usuarios...
              </span>
            ) : null}
            <div className="config-usersTable__head" role="row">
              <span role="columnheader">Usuario</span>
              <span role="columnheader">Email</span>
              <span role="columnheader">Rol</span>
              <span role="columnheader">Estado</span>
              <span role="columnheader">Creación</span>
              <span
                className="config-usersTable__actionsHeading"
                role="columnheader"
              >
                Acciones
              </span>
            </div>
            <div ref={tableBodyRef} className="config-usersTable__body" role="rowgroup">
              {loading ? (
                <DataTableSkeleton
                  actionColumnIndex={5}
                  columnCount={6}
                  gridClassName="config-usersTable__skeletonRow"
                  rows={6}
                />
              ) : (
                filteredUsers.map((user) => (
                  <div
                    className={`config-usersTable__row ${user.activo ? "" : "is-inactive"}`}
                    role="row"
                    key={user.id}
                  >
                    <div className="config-usersIdentity" role="cell">
                      <span className="config-usersAvatar">
                        {userInitial(user.usuario)}
                      </span>
                      <div>
                        <strong>{user.usuario}</strong>
                        {user.sesion_actual ? (
                          <small>Sesión actual</small>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className="config-usersEmail"
                      role="cell"
                      data-label="Email"
                    >
                      {user.email || <span>Sin email</span>}
                    </div>
                    <div role="cell" data-label="Rol">
                      <span
                        className={`config-usersRole config-usersRole--${user.rol}`}
                      >
                        {ROLE_LABELS[user.rol] || user.rol}
                      </span>
                    </div>
                    <div role="cell" data-label="Estado">
                      <span
                        className={`config-usersState ${user.activo ? "is-active" : "is-inactive"}`}
                      >
                        <i aria-hidden="true" />
                        {user.activo ? "Activo" : "Baja"}
                      </span>
                    </div>
                    <div
                      className="config-usersCreated"
                      role="cell"
                      data-label="Creación"
                    >
                      {formatCreatedAt(user.creado_en)}
                    </div>
                    <div
                      className="config-usersActions config-usersTable__actionsCell mov-actionsInline"
                      role="cell"
                    >
                      <button
                        type="button"
                        className="mov-iconBtn"
                        onClick={() => openEdit(user)}
                        title="Editar usuario"
                        aria-label={`Editar ${user.usuario}`}
                      >
                        <FontAwesomeIcon icon={faPen} />
                      </button>
                      <button
                        type="button"
                        className={`mov-iconBtn ${user.activo ? "mov-iconBtn--danger" : ""}`.trim()}
                        onClick={() => setStateModal(user)}
                        disabled={!user.puede_cambiar_estado}
                        title={user.activo ? "Dar de baja" : "Reactivar"}
                        aria-label={`${user.activo ? "Dar de baja" : "Reactivar"} ${user.usuario}`}
                      >
                        <FontAwesomeIcon
                          icon={user.activo ? faUserSlash : faArrowRotateLeft}
                        />
                      </button>
                      <button
                        type="button"
                        className="mov-iconBtn mov-iconBtn--danger"
                        onClick={() => setDeleteModal(user)}
                        disabled={!user.puede_eliminar}
                        title={
                          user.puede_eliminar
                            ? "Eliminar usuario definitivamente"
                            : "No podés eliminar tu propia sesión"
                        }
                        aria-label={`Eliminar ${user.usuario}`}
                      >
                        <FontAwesomeIcon icon={faTrashCan} />
                      </button>
                    </div>
                  </div>
                ))
              )}

              {!loading && !filteredUsers.length ? (
                <div className="config-usersEmpty">
                  No hay usuarios que coincidan con los filtros seleccionados.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </ModulePage>

      <CrudModal
        open={formOpen}
        title={
          <>
            <FontAwesomeIcon
              icon={form.id ? faPen : faUserPlus}
              aria-hidden="true"
            />
            <span>{form.id ? "Editar usuario" : "Nuevo usuario"}</span>
          </>
        }
        subtitle={
          form.id
            ? "Actualizá los datos, el rol o la contraseña del usuario."
            : "Creá un acceso independiente para esta organización."
        }
        onClose={() => setFormOpen(false)}
        onSubmit={saveUser}
        saving={saving}
        submitLabel={form.id ? "Guardar cambios" : "Crear usuario"}
        closeOnBackdrop={false}
        modalClassName="config-usersModal"
        wide
      >
        <div className="entity-form config-usersForm">
          <div className="entity-form__grid">
            <FloatingField
              label={
                <>
                  <FontAwesomeIcon icon={faUser} aria-hidden="true" />
                  Usuario *
                </>
              }
              active={Boolean(form.usuario)}
            >
              <input
                value={form.usuario}
                placeholder=" "
                onChange={(event) => updateForm("usuario", event.target.value)}
                maxLength={100}
                autoComplete="off"
                required
                autoFocus
              />
            </FloatingField>
            <FloatingField
              label={
                <>
                  <FontAwesomeIcon icon={faEnvelope} aria-hidden="true" />
                  Email
                </>
              }
              active={Boolean(form.email)}
            >
              <input
                type="email"
                value={form.email}
                placeholder=" "
                onChange={(event) => updateForm("email", event.target.value)}
                maxLength={190}
                autoComplete="off"
                disabled={!data.capacidades.email}
              />
            </FloatingField>
            <fieldset className="config-usersForm__rolePicker">
              <legend>
                <FontAwesomeIcon icon={faShieldHalved} aria-hidden="true" />
                Rol de acceso
              </legend>
              <div
                className="config-usersForm__roleOptions"
                role="radiogroup"
                aria-label="Rol del usuario"
              >
                {[
                  {
                    value: "admin",
                    label: "Administrador",
                    description:
                      "Gestiona usuarios y puede modificar toda la información.",
                    icon: faShieldHalved,
                  },
                  {
                    value: "vista",
                    label: "Solo lectura",
                    description:
                      "Consulta la información sin realizar cambios.",
                    icon: faUser,
                  },
                ].map((role) => (
                  <label
                    className={`config-usersForm__roleOption ${form.rol === role.value ? "is-selected" : ""}`}
                    key={role.value}
                  >
                    <input
                      type="radio"
                      name="rol"
                      value={role.value}
                      checked={form.rol === role.value}
                      onChange={(event) =>
                        updateForm("rol", event.target.value)
                      }
                      disabled={form.sesion_actual}
                      required
                    />
                    <span
                      className="config-usersForm__roleIcon"
                      aria-hidden="true"
                    >
                      <FontAwesomeIcon icon={role.icon} />
                    </span>
                    <span className="config-usersForm__roleCopy">
                      <strong>{role.label}</strong>
                      <small>{role.description}</small>
                    </span>
                    <span
                      className="config-usersForm__roleCheck"
                      aria-hidden="true"
                    >
                      <FontAwesomeIcon icon={faCheck} />
                    </span>
                  </label>
                ))}
              </div>
              {form.sesion_actual ? (
                <small className="config-usersForm__roleNotice">
                  No podés cambiar el rol de tu propia sesión.
                </small>
              ) : null}
            </fieldset>
            <FloatingField
              label={
                <>
                  <FontAwesomeIcon icon={faLock} aria-hidden="true" />
                  {form.id ? "Nueva contraseña" : "Contraseña *"}
                </>
              }
              active={Boolean(form.contrasena)}
            >
              <input
                type="password"
                value={form.contrasena}
                placeholder=" "
                onChange={(event) =>
                  updateForm("contrasena", event.target.value)
                }
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required={!form.id}
              />
            </FloatingField>
            <FloatingField
              label={
                <>
                  <FontAwesomeIcon icon={faKey} aria-hidden="true" />
                  {form.id
                    ? "Confirmar nueva contraseña"
                    : "Confirmar contraseña *"}
                </>
              }
              active={Boolean(form.confirmar_contrasena)}
            >
              <input
                type="password"
                value={form.confirmar_contrasena}
                placeholder=" "
                onChange={(event) =>
                  updateForm("confirmar_contrasena", event.target.value)
                }
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required={!form.id || Boolean(form.contrasena)}
              />
            </FloatingField>
          </div>
          <p className="config-usersForm__passwordHelp">
            <FontAwesomeIcon icon={faLock} aria-hidden="true" />
            <span>
              {form.id
                ? "Dejá ambos campos vacíos para conservar la contraseña actual."
                : "Usá al menos 8 caracteres para proteger el acceso."}
            </span>
          </p>
        </div>
      </CrudModal>

      <ModalEliminarGlobal
        open={Boolean(stateModal)}
        operacion={stateModal?.activo ? "baja" : "alta"}
        row={stateModal}
        title={stateModal?.activo ? "Dar de baja usuario" : "Reactivar usuario"}
        message={
          stateModal?.activo
            ? "El usuario dejará de poder iniciar sesión y se cerrarán sus sesiones activas."
            : "El usuario volverá a poder iniciar sesión con su contraseña actual."
        }
        warning={
          stateModal?.rol === "admin" && stateModal?.activo
            ? "La organización siempre debe conservar al menos un administrador activo."
            : ""
        }
        confirmLabel={stateModal?.activo ? "Dar de baja" : "Reactivar"}
        loadingLabel={
          stateModal?.activo ? "Dando de baja..." : "Reactivando..."
        }
        loadingMessage="Actualizando el acceso del usuario…"
        successMessage={
          stateModal?.activo
            ? "Usuario dado de baja correctamente."
            : "Usuario reactivado correctamente."
        }
        errorMessage="No se pudo actualizar el estado del usuario."
        details={
          stateModal
            ? [
                { label: "Usuario", value: stateModal.usuario },
                {
                  label: "Rol",
                  value: ROLE_LABELS[stateModal.rol] || stateModal.rol,
                },
                {
                  label: "Estado actual",
                  value: stateModal.activo ? "Activo" : "Baja",
                },
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
        title="Eliminar usuario"
        message="El usuario se eliminará definitivamente. Sus sesiones se cerrarán y el historial existente se conservará sin vincularlo al usuario eliminado."
        warning="Esta acción no se puede deshacer. Si solo querés impedir el acceso, usá Dar de baja."
        confirmLabel="Eliminar"
        loadingLabel="Eliminando..."
        loadingMessage="Eliminando usuario…"
        successMessage="Usuario eliminado correctamente."
        errorMessage="No se pudo eliminar el usuario."
        details={
          deleteModal
            ? [
                { label: "Usuario", value: deleteModal.usuario },
                {
                  label: "Rol",
                  value: ROLE_LABELS[deleteModal.rol] || deleteModal.rol,
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
