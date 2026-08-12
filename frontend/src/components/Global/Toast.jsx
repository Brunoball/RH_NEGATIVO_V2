import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faExclamationTriangle,
  faTimesCircle,
  faSpinner,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";
import "./Toast.css";

const TIPOS_PERSISTENTES = new Set(["error", "advertencia", "alerta"]);

const normalizarTipo = (tipo) => {
  if (tipo === "success" || tipo === "ok") return "exito";
  if (tipo === "warning") return "advertencia";
  return tipo;
};

const Toast = ({
  tipo,
  mensaje,
  onClose,
  duracion,
  persistente,
  cerrarConEscape = true,
  cerrarConInteraccion = true,
  mostrarCerrar,
  cierreDeshabilitado = false,
  acciones = null,
  className = "",
  ariaLabelCerrar = "Cerrar notificación",
}) => {
  const [desapareciendo, setDesapareciendo] = useState(false);
  const cierreEjecutadoRef = useRef(false);
  const cierreTimerRef = useRef(null);
  const tipoNormalizado = useMemo(() => normalizarTipo(tipo), [tipo]);
  const esPersistente = useMemo(
    () => persistente ?? TIPOS_PERSISTENTES.has(tipoNormalizado),
    [persistente, tipoNormalizado],
  );
  const mostrarBotonCerrar = mostrarCerrar ?? esPersistente;

  const cerrarToast = useCallback(() => {
    if (cierreDeshabilitado || cierreEjecutadoRef.current) return;

    cierreEjecutadoRef.current = true;
    setDesapareciendo(true);

    cierreTimerRef.current = window.setTimeout(() => {
      cierreTimerRef.current = null;
      if (typeof onClose === "function") onClose();
    }, 280);
  }, [cierreDeshabilitado, onClose]);

  useEffect(
    () => () => {
      if (cierreTimerRef.current !== null) {
        window.clearTimeout(cierreTimerRef.current);
        cierreTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const manejarEscape = (event) => {
      if (event.key === "Escape" && cerrarConEscape) cerrarToast();
    };

    const cerrarConBotones = (event) => {
      const objetivo = event.target;
      if (!(objetivo instanceof Element)) return;

      const botonAccion = objetivo.closest(
        'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]',
      );

      if (botonAccion && cerrarConInteraccion) cerrarToast();
    };

    window.addEventListener("keydown", manejarEscape);
    document.addEventListener("click", cerrarConBotones, true);

    return () => {
      window.removeEventListener("keydown", manejarEscape);
      document.removeEventListener("click", cerrarConBotones, true);
    };
  }, [cerrarConEscape, cerrarConInteraccion, cerrarToast]);

  useEffect(() => {
    if (esPersistente) return undefined;

    if (duracion === undefined || duracion === null) {
      console.warn("⚠ Toast: No se especificó la duración del mensaje.");
      return undefined;
    }

    const tiempoSalida = Math.max(Number(duracion) - 500, 0);

    const mostrarTimer = window.setTimeout(() => {
      setDesapareciendo(true);
    }, tiempoSalida);

    const ocultarTimer = window.setTimeout(() => {
      if (typeof onClose === "function") onClose();
    }, Number(duracion));

    return () => {
      window.clearTimeout(mostrarTimer);
      window.clearTimeout(ocultarTimer);
    };
  }, [onClose, duracion, esPersistente]);

  const iconos = {
    exito: faCheckCircle,
    error: faTimesCircle,
    advertencia: faExclamationTriangle,
    alerta: faExclamationTriangle,
    cargando: faSpinner,
  };

  const clasesTipo = {
    exito: "toast-exito",
    error: "toast-error",
    advertencia: "toast-advertencia",
    alerta: "toast-advertencia",
    cargando: "toast-cargando",
  };

  const iconoSeleccionado = iconos[tipoNormalizado] || faInfoCircle;
  const claseSeleccionada = clasesTipo[tipoNormalizado] || "toast-info";

  const contenidoToast = (
    <div
      className={`toast-container ${claseSeleccionada} ${className} ${desapareciendo ? "desaparecer" : ""}`.trim()}
      role="status"
    >
      <FontAwesomeIcon
        icon={iconoSeleccionado}
        className={`toast-icon ${tipoNormalizado === "cargando" ? "spin" : ""}`}
      />
      <div className="toast-message">{mensaje}</div>

      {acciones ? <div className="toast-actions">{acciones}</div> : null}

      {mostrarBotonCerrar && (
        <button
          type="button"
          className="toast-close"
          onClick={cerrarToast}
          disabled={cierreDeshabilitado}
          aria-label={ariaLabelCerrar}
          title={
            cierreDeshabilitado
              ? "Esperá a que termine la acción"
              : ariaLabelCerrar
          }
        >
          ×
        </button>
      )}
    </div>
  );

  if (typeof document === "undefined") return contenidoToast;

  return createPortal(contenidoToast, document.body);
};

export default Toast;
