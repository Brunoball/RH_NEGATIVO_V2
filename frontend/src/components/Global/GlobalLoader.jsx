import React from "react";
import "./Global_css/Global_Loader.css";

export default function GlobalLoader({
  label = "Cargando...",
  description = "",
  variant = "default",
  className = "",
}) {
  return (
    <div
      className={`global-loader global-loader--${variant} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="global-loader__spinner" aria-hidden="true" />
      {label ? <strong>{label}</strong> : null}
      {description ? <span>{description}</span> : null}
    </div>
  );
}
