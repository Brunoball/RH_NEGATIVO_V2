import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInbox } from "@fortawesome/free-solid-svg-icons";

export default function DataTablePlaceholder({
  columns,
  message,
  minWidth = 760,
  icon = faInbox,
  title = "Sin datos cargados",
}) {
  const template = columns.map(() => "minmax(120px, 1fr)").join(" ");
  return (
    <div className="mov-tableWrap global-divTable__wrap" style={{ minWidth: 0 }}>
      <div className="mov-gridTable mov-gridTable--head" style={{ gridTemplateColumns: template, minWidth }}>
        {columns.map((column) => (
          <div className="mov-gridCell--head" key={column}>{column}</div>
        ))}
      </div>
      <div className="module-empty" style={{ minWidth }}>
        <FontAwesomeIcon icon={icon} />
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
    </div>
  );
}
