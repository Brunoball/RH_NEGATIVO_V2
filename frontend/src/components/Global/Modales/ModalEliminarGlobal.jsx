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
  faTimes,
  faTrashCan,
  faUserCheck,
  faUserSlash,
} from "@fortawesome/free-solid-svg-icons";
import Toast from "../Toast";
import useAnimatedModalSize from "./useAnimatedModalSize";
import "../Global_css/Global_ModalEliminar.css";

const OPERATION_CONFIG = {
  eliminar: {
    icon: faTrashCan,
    tone: "danger",
    title: "Eliminar registro",
    message: "¿Seguro que querés eliminar este registro definitivamente?",
    confirmLabel: "Eliminar",
    loadingLabel: "Eliminando...",
    loadingMessage: "Eliminando registro…",
    successMessage: "Registro eliminado correctamente.",
    errorMessage: "No se pudo eliminar el registro.",
  },
  baja: {
    icon: faUserSlash,
    tone: "warning",
    title: "Dar de baja registro",
    message:
      "El registro dejará de figurar como activo, pero se conservará en dados de baja.",
    warning: "",
    confirmLabel: "Dar de baja",
    loadingLabel: "Procesando...",
    loadingMessage: "Dando de baja…",
    successMessage: "Registro dado de baja correctamente.",
    errorMessage: "No se pudo dar de baja el registro.",
  },
  alta: {
    icon: faUserCheck,
    tone: "success",
    title: "Dar de alta registro",
    message: "El registro volverá a figurar como activo.",
    warning: "",
    confirmLabel: "Dar de alta",
    loadingLabel: "Procesando...",
    loadingMessage: "Dando de alta…",
    successMessage: "Registro dado de alta correctamente.",
    errorMessage: "No se pudo dar de alta el registro.",
  },
  advertencia: {
    icon: faExclamationTriangle,
    tone: "warning",
    title: "Confirmar acción",
    message: "¿Seguro que querés continuar?",
    warning: "",
    confirmLabel: "Confirmar",
    loadingLabel: "Procesando...",
    loadingMessage: "Procesando…",
    successMessage: "Operación realizada correctamente.",
    errorMessage: "No se pudo completar la operación.",
  },
  exito: {
    icon: faCheckCircle,
    tone: "success",
    title: "Operación exitosa",
    message: "La operación se completó correctamente.",
    warning: "",
    confirmLabel: "Aceptar",
    loadingLabel: "Procesando...",
    loadingMessage: "Procesando…",
    successMessage: "Operación realizada correctamente.",
    errorMessage: "No se pudo completar la operación.",
  },
};

const safeText = (value) => String(value ?? "").trim() || "—";
const upper = (value) => String(value ?? "").toLocaleUpperCase("es-AR");

function openDatePickerFromInput(event) {
  const input = event.target;
  if (
    !(input instanceof HTMLInputElement) ||
    input.type !== "date" ||
    input.disabled ||
    input.readOnly ||
    typeof input.showPicker !== "function"
  ) {
    return;
  }

  try {
    input.showPicker();
  } catch {
    input.focus();
  }
}

function normalizeDetails(details) {
  if (!Array.isArray(details)) return [];
  return details
    .filter((detail) => detail && typeof detail === "object")
    .map((detail, index) => ({
      key: `${index}-${detail.label || "detalle"}`,
      label: safeText(detail.label),
      value: safeText(detail.value),
    }));
}

export default function ModalEliminarGlobal({
  open,
  operacion = "eliminar",
  row = null,
  loading = false,
  onClose,
  onConfirm,
  onBeforeConfirm,
  onToast,
  title,
  message,
  warning,
  confirmLabel,
  cancelLabel = "Cancelar",
  loadingLabel,
  loadingMessage,
  successMessage,
  errorMessage,
  tone,
  icon,
  details = null,
  extraContent = null,
  hideDefaultCard = false,
  showReason = false,
  reasonLabel = "Motivo u observación",
  reasonPlaceholder = "Escribí una observación opcional...",
  reasonRequired = false,
  initialReason = "",
  closeOnSuccess = true,
  confirmDisabled = false,
  modalClassName = "",
  fixedHeight = false,
}) {
  const modalRef = useRef(null);
  const cancelRef = useRef(null);
  useAnimatedModalSize(modalRef, open && !fixedHeight);
  const reasonRef = useRef(null);
  const [processing, setProcessing] = useState(false);
  const [reason, setReason] = useState(upper(initialReason));
  const [localToast, setLocalToast] = useState(null);

  const config = OPERATION_CONFIG[operacion] || OPERATION_CONFIG.advertencia;
  const isLoading = loading || processing;
  const isDeleteOperation = operacion === "eliminar";
  const resolvedTone = isDeleteOperation
    ? OPERATION_CONFIG.eliminar.tone
    : tone || config.tone;
  const resolvedIcon = isDeleteOperation
    ? OPERATION_CONFIG.eliminar.icon
    : icon || config.icon;
  const resolvedTitle = title || config.title;
  const resolvedMessage = message || config.message;
  const resolvedWarning = warning ?? config.warning;
  const resolvedConfirmLabel = confirmLabel || config.confirmLabel;
  const resolvedLoadingLabel = loadingLabel || config.loadingLabel;
  const resolvedLoadingMessage = loadingMessage || config.loadingMessage;
  const resolvedSuccessMessage = successMessage || config.successMessage;
  const resolvedErrorMessage = errorMessage || config.errorMessage;
  // Todas las eliminaciones comparten la misma composición visual global.
  // La referencia es el modal de Contabilidad/Ingresos: icono, título,
  // descripción, detalle y acciones se renderizan desde este único componente.
  const showSubtitle = operacion !== "baja";

  const resolvedDetails = useMemo(() => {
    const custom = normalizeDetails(details);
    if (custom.length) return custom;
    return normalizeDetails([
      { label: "ID", value: row?.id ?? row?.id_socio ?? row?.id_familia },
      { label: "Nombre", value: row?.nombre ?? row?.descripcion },
      {
        label: "Estado",
        value: row?.estado ?? (row?.activo ? "ACTIVO" : "BAJA"),
      },
    ]);
  }, [details, row]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setReason(upper(initialReason));
    setLocalToast(null);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, initialReason]);

  const showToast = useCallback(
    (tipo, mensaje, duracion = 2800) => {
      if (!mensaje) return;
      if (typeof onToast === "function") {
        onToast(tipo, mensaje, duracion);
        return;
      }
      setLocalToast({ id: Date.now(), tipo, mensaje, duracion });
    },
    [onToast],
  );

  const close = useCallback(() => {
    if (!isLoading) onClose?.();
  }, [isLoading, onClose]);

  const confirm = useCallback(async () => {
    if (isLoading || confirmDisabled || typeof onConfirm !== "function") return;
    const cleanReason = reason.trim();
    if (showReason && reasonRequired && !cleanReason) {
      showToast("error", "Tenés que completar el motivo para continuar.", 4200);
      return;
    }

    if (
      typeof onBeforeConfirm === "function" &&
      onBeforeConfirm({
        motivo: cleanReason,
        reason: cleanReason,
        row,
        operacion,
      }) === false
    ) {
      return;
    }

    setProcessing(true);
    showToast("cargando", resolvedLoadingMessage, 12000);
    let shouldClose = false;
    try {
      const result = await onConfirm({
        motivo: cleanReason,
        reason: cleanReason,
        row,
        operacion,
      });
      if (result?.ok === false) {
        throw new Error(
          result.mensaje || result.message || resolvedErrorMessage,
        );
      }
      showToast("exito", result?.mensaje || resolvedSuccessMessage, 2800);
      shouldClose = closeOnSuccess;
    } catch (error) {
      showToast("error", error?.message || resolvedErrorMessage, 4200);
    } finally {
      setProcessing(false);
      if (shouldClose) onClose?.();
    }
  }, [
    closeOnSuccess,
    confirmDisabled,
    isLoading,
    onBeforeConfirm,
    onClose,
    onConfirm,
    operacion,
    reason,
    resolvedErrorMessage,
    resolvedLoadingMessage,
    resolvedSuccessMessage,
    row,
    showReason,
    reasonRequired,
    showToast,
  ]);

  useEffect(() => {
    if (!open) return undefined;
    const focusTimer = window.setTimeout(() => {
      (showReason ? reasonRef.current : cancelRef.current)?.focus?.({
        preventScroll: true,
      });
    }, 0);
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (
        event.key === "Enter" &&
        event.target?.tagName !== "TEXTAREA" &&
        !isLoading &&
        !confirmDisabled
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        confirm();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close, confirm, confirmDisabled, isLoading, open, showReason]);

  if (!open) return null;

  return createPortal(
    <>
      {localToast ? (
        <Toast
          key={localToast.id}
          tipo={localToast.tipo}
          mensaje={localToast.mensaje}
          duracion={localToast.duracion}
          onClose={() => setLocalToast(null)}
        />
      ) : null}
      <div
        className="gdel-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gdel-title"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openDatePickerFromInput(event);
        }}
      >
        <div
          ref={modalRef}
          className={`gdel-modal gdel-modal--${resolvedTone} ${fixedHeight ? "gdel-modal--fixed-height" : ""} ${modalClassName}`.trim()}
        >
          <button
            type="button"
            className="gdel-close"
            onClick={close}
            aria-label="Cerrar"
            disabled={isLoading}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
          <div
            className={`gdel-icon gdel-icon--${resolvedTone}`}
            aria-hidden="true"
          >
            <FontAwesomeIcon icon={resolvedIcon} />
          </div>
          <h3
            id="gdel-title"
            className={`gdel-title gdel-title--${resolvedTone}`}
          >
            {resolvedTitle}
          </h3>
          {showSubtitle ? (
            <p className="gdel-body">{resolvedMessage}</p>
          ) : null}
          {resolvedWarning ? (
            <div className="gdel-note">
              <FontAwesomeIcon
                icon={faExclamationTriangle}
                aria-hidden="true"
              />
              <span>{resolvedWarning}</span>
            </div>
          ) : null}
          {!hideDefaultCard && resolvedDetails.length ? (
            <div className="gdel-card">
              {resolvedDetails.map((detail) => (
                <div className="gdel-row" key={detail.key}>
                  <span className="gdel-label">{detail.label}</span>
                  <span className="gdel-value">{detail.value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {extraContent ? (
            <div className="gdel-extraContent">{extraContent}</div>
          ) : null}
          {showReason ? (
            <label className="gdel-reason">
              <span className="gdel-reason__label">{reasonLabel}</span>
              <textarea
                ref={reasonRef}
                rows={3}
                value={reason}
                onChange={(event) => setReason(upper(event.target.value))}
                placeholder={reasonPlaceholder}
                maxLength={500}
                disabled={isLoading}
              />
            </label>
          ) : null}
          <div className="gdel-actions">
            <button
              ref={cancelRef}
              type="button"
              className="gdel-btn gdel-btn--ghost"
              onClick={close}
              disabled={isLoading}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`gdel-btn gdel-btn--solid-${resolvedTone}`}
              onClick={confirm}
              disabled={isLoading || confirmDisabled}
            >
              {isLoading ? resolvedLoadingLabel : resolvedConfirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
