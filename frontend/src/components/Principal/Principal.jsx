import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBars,
  faChartLine,
  faGear,
  faReceipt,
  faRightFromBracket,
  faTags,
  faUsers,
  faWallet,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { clearSession, getSession } from "../_shared/auth/session";
import { apiPost } from "../_shared/api/apiClient";
import ModalPerfil from "../Perfil/ModalPerfil";
import logoRh from "../../imagenes/Logo_rh_sf.png";
import "./principal.css";

const NAV_ITEMS = [
  {
    key: "administracion",
    label: "Administración",
    path: "/panel",
    icon: faChartLine,
  },
  {
    key: "socios",
    label: "Socios",
    path: "/socios",
    defaultPath: "/socios/personas",
    icon: faUsers,
    children: [
      { key: "socios-personas", label: "Socios", path: "/socios/personas" },
      { key: "socios-familias", label: "Familias", path: "/socios/familias" },
    ],
  },
  { key: "cuotas", label: "Cuotas", path: "/cuotas", icon: faReceipt },
  {
    key: "categorias",
    label: "Categorías",
    path: "/categorias",
    defaultPath: "/categorias",
    icon: faTags,
    children: [
      { key: "categorias-listado", label: "Categorías", path: "/categorias" },
      {
        key: "categorias-descuentos",
        label: "Descuentos familiares",
        path: "/categorias/descuentos",
      },
    ],
  },
  {
    key: "contable",
    label: "Contabilidad",
    path: "/contable",
    defaultPath: "/contable/ingresos",
    icon: faWallet,
    children: [
      { key: "contable-ingresos", label: "Ingresos", path: "/contable/ingresos" },
      { key: "contable-egresos", label: "Egresos", path: "/contable/egresos" },
      { key: "contable-resumen", label: "Resumen", path: "/contable/resumen" },
    ],
  },
];

const getGroupKeyForPath = (pathname) =>
  NAV_ITEMS.find(
    (item) =>
      item.children &&
      (pathname === item.path || pathname.startsWith(`${item.path}/`)),
  )?.key || null;

function LogoutModal({ open, onClose, onConfirm }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="pp-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pp-logout-modal-title"
    >
      <div className="pp-modal pp-modal--danger">
        <div className="pp-modal__icon" aria-hidden="true">
          <FontAwesomeIcon icon={faRightFromBracket} />
        </div>
        <h3 id="pp-logout-modal-title" className="pp-modal__title">
          Confirmar cierre de sesión
        </h3>
        <p className="pp-modal__text">
          ¿Estás seguro de que deseas cerrar la sesión?
        </p>
        <div className="pp-modal__actions">
          <button className="pp-btn pp-btn--ghost" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="pp-btn pp-btn--danger"
            type="button"
            onClick={onConfirm}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RhMark({ className = "" }) {
  return (
    <img
      className={`rh-brand-mark ${className}`.trim()}
      src={logoRh}
      alt=""
      aria-hidden="true"
    />
  );
}

export default function Principal() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = getSession();
  const writable = session?.usuario?.rol === "admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [openGroupKey, setOpenGroupKey] = useState(() =>
    getGroupKeyForPath(location.pathname),
  );
  const groupClickTimer = useRef(null);
  const logoutInProgress = useRef(false);

  useEffect(() => {
    if (!writable && location.pathname.startsWith("/configuracion")) {
      navigate("/panel", { replace: true });
    }
  }, [location.pathname, navigate, writable]);

  useEffect(() => {
    setDrawerOpen(false);
    setOpenGroupKey(getGroupKeyForPath(location.pathname));
  }, [location.pathname]);

  useEffect(
    () => () => {
      if (groupClickTimer.current) clearTimeout(groupClickTimer.current);
    },
    [],
  );

  const activeLabel = useMemo(() => {
    for (const item of NAV_ITEMS) {
      const child = item.children?.find(
        (entry) =>
          location.pathname === entry.path ||
          location.pathname.startsWith(`${entry.path}/`),
      );
      if (child) return child.label;
      if (
        location.pathname === item.path ||
        location.pathname.startsWith(`${item.path}/`)
      ) {
        return item.label;
      }
    }

    if (location.pathname.startsWith("/configuracion")) return "Configuración";
    return "RH Negativo";
  }, [location.pathname]);

  const clearGroupClickTimer = () => {
    if (!groupClickTimer.current) return;
    clearTimeout(groupClickTimer.current);
    groupClickTimer.current = null;
  };

  const toggleGroup = (item, event) => {
    clearGroupClickTimer();

    // El segundo clic pertenece al doble clic: la navegación se resuelve
    // exclusivamente en handleGroupDoubleClick.
    if (event.detail > 1) return;

    groupClickTimer.current = setTimeout(() => {
      setOpenGroupKey((currentKey) =>
        currentKey === item.key ? null : item.key,
      );
      groupClickTimer.current = null;
    }, 0);
  };

  const handleGroupDoubleClick = (item, event) => {
    event.preventDefault();
    clearGroupClickTimer();
    setOpenGroupKey(item.key);
    setDrawerOpen(false);
    navigate(item.defaultPath || item.path);
  };

  const closeOpenGroup = () => {
    clearGroupClickTimer();
    setOpenGroupKey(null);
  };

  const logout = async () => {
    if (logoutInProgress.current) return;
    logoutInProgress.current = true;

    try {
      await apiPost("auth_logout", {});
    } catch {
      // Aunque el backend ya haya invalidado o vencido la sesión,
      // la copia local se elimina para completar el cierre en la SPA.
    } finally {
      clearSession();
      setLogoutOpen(false);
      logoutInProgress.current = false;
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="pp-shell">
      <header className="mov-topbar">
        <div className="mov-topbar__left">
          <button
            className="pp-burger"
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú"
          >
            <FontAwesomeIcon icon={faBars} />
          </button>
          <div className="mov-topbar__logo mov-topbar__appBrand">
            <span className="mov-topbar__appBrandMark mov-topbar__appBrandMark--image">
              <RhMark />
            </span>
            <span className="mov-topbar__brandText">
              <strong>RH Negativo</strong>
              <small>Sistema de Gestión</small>
            </span>
          </div>
        </div>

        <div className="mov-topbar__right">
          <div className="mov-topbar__section">{activeLabel}</div>
          {writable ? (
            <button
              className={`pp-topbarConfig ${location.pathname.startsWith("/configuracion") ? "is-active" : ""}`}
              type="button"
              onClick={() => navigate("/configuracion")}
              title="Configuración"
              aria-label="Abrir configuración"
            >
              <FontAwesomeIcon icon={faGear} />
            </button>
          ) : null}
          <button
            className="mov-topbar__usericon has-logo"
            type="button"
            onClick={() => setPerfilOpen(true)}
            title="Perfil"
            aria-label="Abrir perfil"
          >
            <img
              className="mov-topbar__userlogo"
              src={logoRh}
              alt=""
              aria-hidden="true"
            />
          </button>
          <button
            className="pp-topbarLogout"
            type="button"
            onClick={() => setLogoutOpen(true)}
            title="Cerrar sesión"
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
          </button>
        </div>
      </header>

      <div
        className={`pp-drawerOverlay ${drawerOpen ? "is-open" : ""}`}
        onMouseDown={() => setDrawerOpen(false)}
      />

      <aside className={`pp-sidebar ${drawerOpen ? "is-drawerOpen" : ""}`}>
        <div className="pp-drawerHeader">
          <div
            className="pp-drawerBrand"
            onClick={() => navigate("/panel")}
            role="button"
            tabIndex={0}
          >
            <div className="pp-drawerBrand__mark pp-drawerBrand__mark--image">
              <RhMark />
            </div>
            <div className="pp-drawerBrand__txt">
              <div className="pp-drawerBrand__t">RH Negativo</div>
              <div className="pp-drawerBrand__s">Sistema de Gestión</div>
            </div>
          </div>
          <button
            className="pp-drawerClose"
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Cerrar menú"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div
          className="pp-brand panel_contable"
          onClick={() => navigate("/panel")}
          role="button"
          tabIndex={0}
        >
          <div className="pp-brand__mark pp-brand__mark--image">
            <RhMark />
          </div>
          <div className="pp-brand__text">
            <div className="pp-brand__title">RH Negativo</div>
            <div className="pp-brand__subtitle">Sistema de Gestión</div>
          </div>
        </div>

        <nav className="pp-nav" aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => {
            const active =
              location.pathname === item.path ||
              location.pathname.startsWith(`${item.path}/`);
            const groupOpen = Boolean(
              item.children && openGroupKey === item.key,
            );

            return (
              <div
                className={`pp-navGroup ${item.children ? "has-sub" : ""} ${groupOpen ? "is-open" : ""}`}
                key={item.key}
              >
                {item.children ? (
                  <button
                    className={`pp-nav__item ${active ? "is-active" : ""}`}
                    type="button"
                    aria-expanded={groupOpen}
                    onClick={(event) => toggleGroup(item, event)}
                    onDoubleClick={(event) => handleGroupDoubleClick(item, event)}
                    title="Un clic para desplegar; doble clic para ingresar"
                  >
                    <span className="pp-nav__icon">
                      <FontAwesomeIcon icon={item.icon} />
                    </span>
                    <span className="pp-nav__label">{item.label}</span>
                  </button>
                ) : (
                  <NavLink
                    className={({ isActive }) =>
                      `pp-nav__item ${isActive ? "is-active" : ""}`
                    }
                    to={item.path}
                    onClick={closeOpenGroup}
                  >
                    <span className="pp-nav__icon">
                      <FontAwesomeIcon icon={item.icon} />
                    </span>
                    <span className="pp-nav__label">{item.label}</span>
                  </NavLink>
                )}

                {item.children ? (
                  <div className="pp-navSub" aria-hidden={!groupOpen}>
                    {item.children.map((child) => (
                      <NavLink
                        end
                        className={({ isActive }) =>
                          `pp-navSub__item ${isActive ? "is-active" : ""}`
                        }
                        to={child.path}
                        key={child.key}
                      >
                        <span className="pp-navSub__dot" />
                        <span className="pp-navSub__label">{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="pp-content">
        <div className="pp-content__inner">
          <Outlet />
        </div>
      </main>

      <ModalPerfil
        open={perfilOpen}
        onClose={() => setPerfilOpen(false)}
        usuario={session?.usuario}
        onConfigRequest={
          writable
            ? () => {
                setPerfilOpen(false);
                navigate("/configuracion");
              }
            : undefined
        }
      />

      <LogoutModal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={logout}
      />
    </div>
  );
}
