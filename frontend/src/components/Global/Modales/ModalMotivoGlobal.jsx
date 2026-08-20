import React, { useEffect, useRef, useState } from "react";
import InfoModal from "./InfoModal";
import "../Global_css/Global_ModalMotivo.css";

export function MotivoPreviewGlobal({
  text,
  onOpen,
  emptyText = "SIN MOTIVO REGISTRADO",
  actionLabel = "Ver motivo completo",
  title = "Ver motivo completo",
  ariaLabel,
  className = "",
}) {
  const reason = String(text || "").trim();
  const displayReason = reason || emptyText;
  const textRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const node = textRef.current;
    if (!node || !reason) {
      setIsOverflowing(false);
      return undefined;
    }

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overflow = node.scrollWidth > node.clientWidth + 1;
        setIsOverflowing((current) => (current === overflow ? current : overflow));
      });
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }

    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [displayReason, reason, isOverflowing]);

  if (!isOverflowing) {
    return (
      <span
        ref={textRef}
        className={`global-reason-preview__text ${className}`.trim()}
      >
        {displayReason}
      </span>
    );
  }

  return (
    <button
      className={`global-reason-preview ${className}`.trim()}
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={ariaLabel || title}
    >
      <span ref={textRef}>{displayReason}</span>
      <small>{actionLabel}</small>
    </button>
  );
}

export default function ModalMotivoGlobal({
  open,
  title = "Motivo",
  subtitle = "",
  label = "Motivo registrado",
  text,
  emptyText = "SIN MOTIVO REGISTRADO",
  onClose,
  closeOnBackdrop = false,
  modalClassName = "",
}) {
  const reason = String(text || "").trim() || emptyText;

  return (
    <InfoModal
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      modalClassName={`global-reason-modal ${modalClassName}`.trim()}
      closeOnBackdrop={closeOnBackdrop}
    >
      <section className="global-reason-modal__content">
        <span>{label}</span>
        <p>{reason}</p>
      </section>
    </InfoModal>
  );
}
