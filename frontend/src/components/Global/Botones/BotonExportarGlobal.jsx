import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileExcel, faFilePdf, faSpinner } from "@fortawesome/free-solid-svg-icons";
import "../Global_css/Global_Exportar.css";

const ICONOS = {
  excel: faFileExcel,
  pdf: faFilePdf,
};

const BotonExportarGlobal = ({
  label = "Exportar",
  icon = "excel",
  loading = false,
  disabled = false,
  className = "",
  type = "button",
  title,
  onClick,
  children,
  ...props
}) => {
  const icono = loading ? faSpinner : (ICONOS[icon] || faFileExcel);

  return (
    <button
      type={type}
      className={`global-exportHistorial-trigger mov-btn mov-btn--excel ${className}`.trim()}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      {...props}
    >
      <FontAwesomeIcon icon={icono} spin={loading} />
      {children || label}
    </button>
  );
};

export default BotonExportarGlobal;
