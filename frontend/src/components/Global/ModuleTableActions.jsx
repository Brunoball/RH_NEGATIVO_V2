import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";

/**
 * Pie reutilizable para acciones asociadas a una tabla.
 *
 * En resoluciones compactas reemplaza las acciones equivalentes del
 * encabezado y mantiene los controles junto al final del listado.
 */
export default function ModuleTableActions({
  ariaLabel = "Acciones de la tabla",
  canCreate = true,
  children = null,
  className = "",
  disabled = false,
  onPrimaryAction,
  primaryActionLabel = "Nuevo registro",
}) {
  const showPrimaryAction = canCreate && Boolean(onPrimaryAction);

  if (!showPrimaryAction && !children) return null;

  return (
    <footer
      className={`global-tableFooter ${className}`.trim()}
      aria-label={ariaLabel}
    >
      <div className="global-tableActions">
        {children}
        {showPrimaryAction ? (
          <button
            type="button"
            className="mov-btn global-tableActions__create"
            onClick={onPrimaryAction}
            disabled={disabled}
          >
            <FontAwesomeIcon icon={faPlus} />
            {primaryActionLabel}
          </button>
        ) : null}
      </div>
    </footer>
  );
}
