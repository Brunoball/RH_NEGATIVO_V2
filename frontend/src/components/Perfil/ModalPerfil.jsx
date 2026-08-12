import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear, faXmark } from "@fortawesome/free-solid-svg-icons";
import "./ModalPerfil.css";

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function normalizeRoleLabel(value) {
  const role = String(value ?? "").trim();
  if (!role) return "Sin informar";

  const normalized = role.toLowerCase();
  if (["admin", "administrador", "administrator"].includes(normalized)) {
    return "Administrador";
  }
  if (["user", "usuario"].includes(normalized)) return "Usuario";
  if (["viewer", "vista", "consulta"].includes(normalized)) return "Consulta";

  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDate(value) {
  if (!value) return "-";

  const raw = String(value).trim();
  if (!raw) return "-";

  const datePart = raw.includes("T")
    ? raw.split("T")[0]
    : raw.includes(" ")
      ? raw.split(" ")[0]
      : raw;

  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;

  return `${match[3]}/${match[2]}/${match[1]}`;
}

export default function ModalPerfil({
  open,
  onClose,
  usuario,
  logoSrc,
  onConfigRequest,
}) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const timer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  const view = useMemo(() => {
    if (!usuario) return null;

    const nombre = firstValue(
      usuario.nombre,
      usuario.Nombre_Completo,
      usuario.nombre_completo,
      usuario.nombreCompleto,
      usuario.user,
      usuario.usuario,
      "Usuario",
    );

    const usuarioCuenta = firstValue(
      usuario.usuario,
      usuario.username,
      usuario.user,
      usuario.nombre_usuario,
      usuario.nombre,
      "-",
    );

    const email = firstValue(
      usuario.email,
      usuario.correo,
      usuario.mail,
      usuario.Email,
      "-",
    );

    const idUsuario = firstValue(
      usuario.idUsuario,
      usuario.id_usuario,
      usuario.usuario_id,
      usuario.id,
      "-",
    );

    const rolRaw = firstValue(usuario.rol, usuario.tipo_rol, usuario.role, "");
    const fechaCreacion = firstValue(
      usuario.Fecha_Creacion,
      usuario.fecha_creacion,
      usuario.created_at,
      usuario.fechaAlta,
      usuario.fecha_alta,
      "",
    );

    return {
      nombre: String(nombre),
      usuarioCuenta: String(usuarioCuenta),
      email: String(email),
      idUsuario: String(idUsuario),
      rol: normalizeRoleLabel(rolRaw),
      fechaCreacion: formatDate(fechaCreacion),
      isAdmin: ["admin", "administrador", "administrator"].includes(
        String(rolRaw).trim().toLowerCase(),
      ),
    };
  }, [usuario]);

  if (!open || !view) return null;

  return createPortal(
    <div className="perfil-modal-overlay">
      <section
        className="perfil-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perfil-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="perfil-modal__header">
          <div className="perfil-modal__heading">
            <h2 id="perfil-modal-title">Perfil de usuario</h2>
            <p>{view.rol} · RH Negativo</p>
          </div>
          <button
            ref={closeButtonRef}
            className="perfil-modal__close"
            type="button"
            onClick={() => onClose?.()}
            aria-label="Cerrar perfil"
            title="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="perfil-modal__body">
          <div className="perfil-card">
            <div className="perfil-card__logo" aria-hidden="true">
              {logoSrc ? (
                <img src={logoSrc} alt="" />
              ) : (
                <span>{view.nombre.trim().charAt(0).toUpperCase() || "U"}</span>
              )}
            </div>
            <div className="perfil-card__identity">
              <strong>{view.nombre}</strong>
              <span>
                Usuario: <b>{view.usuarioCuenta}</b>
              </span>
              <span>
                ID Usuario: <b>{view.idUsuario}</b>
              </span>
            </div>
          </div>

          <div className="perfil-data-grid">
            <div className="perfil-data-card">
              <span className="perfil-data-card__label">Rol</span>
              <strong className="perfil-data-card__value">{view.rol}</strong>
            </div>

            <div className="perfil-data-card">
              <span className="perfil-data-card__label">Institución</span>
              <strong className="perfil-data-card__value">RH Negativo</strong>
            </div>

            {view.email !== "-" ? (
              <div className="perfil-data-card perfil-data-card--wide">
                <span className="perfil-data-card__label">Correo electrónico</span>
                <strong className="perfil-data-card__value">{view.email}</strong>
              </div>
            ) : null}

            {view.fechaCreacion !== "-" ? (
              <div className="perfil-data-card perfil-data-card--wide">
                <span className="perfil-data-card__label">Fecha de creación</span>
                <strong className="perfil-data-card__value">{view.fechaCreacion}</strong>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="perfil-modal__footer">
          {view.isAdmin && onConfigRequest ? (
            <button
              className="perfil-modal__button perfil-modal__button--primary"
              type="button"
              onClick={onConfigRequest}
            >
              <FontAwesomeIcon icon={faGear} />
              Configuración
            </button>
          ) : null}
          <span className="perfil-modal__footer-spacer" />
          <button
            className="perfil-modal__button perfil-modal__button--ghost"
            type="button"
            onClick={() => onClose?.()}
          >
            Cerrar
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
