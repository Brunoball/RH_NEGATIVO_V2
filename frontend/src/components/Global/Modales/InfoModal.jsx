import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import CrudModal from "./CrudModal";
import { EntityTabs } from "../Formularios/TabbedForm";
import "../Global_css/Global_InfoModal.css";

export default function InfoModal({
  open,
  title,
  subtitle,
  onClose,
  tabs = [],
  activeTab,
  onTabChange,
  tabIdPrefix = "entity-info-tab",
  loading = false,
  loadingTitle = "Cargando información...",
  loadingText = "Consultando los datos del registro.",
  modalClassName = "",
  closeOnBackdrop = true,
  children,
}) {
  return (
    <CrudModal
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      hideSubmit
      hideCancel
      wide
      modalClassName={`entity-info-modal ${modalClassName}`.trim()}
      closeOnBackdrop={closeOnBackdrop}
    >
      <div className="entity-info-layout">
        {tabs.length ? (
          <EntityTabs
            tabs={tabs}
            value={activeTab}
            onChange={onTabChange}
            idPrefix={tabIdPrefix}
            ariaLabel="Secciones de información"
          />
        ) : null}
        {loading ? (
          <div className="entity-info-loading" aria-live="polite">
            <span className="entity-info-loading__spinner" aria-hidden="true" />
            <strong>{loadingTitle}</strong>
            <span>{loadingText}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </CrudModal>
  );
}

export function InfoSummary({ items = [] }) {
  return (
    <div className="entity-info-summary">
      {items.map((item, index) => (
        <article
          className={`entity-info-summary__item ${item.tone ? `is-${item.tone}` : ""}`.trim()}
          key={item.key || `${item.label}-${index}`}
        >
          {item.icon ? <FontAwesomeIcon icon={item.icon} /> : null}
          <div>
            <span>{item.label}</span>
            <strong>{item.value ?? "—"}</strong>
          </div>
        </article>
      ))}
    </div>
  );
}

export function InfoSection({ title, icon, badge, children, className = "" }) {
  return (
    <section className={`entity-info-section ${className}`.trim()}>
      <header className="entity-info-section__header">
        <h3>
          {icon ? <FontAwesomeIcon icon={icon} /> : null}
          {title}
        </h3>
        {badge !== undefined && badge !== null ? <span>{badge}</span> : null}
      </header>
      <div className="entity-info-section__body">{children}</div>
    </section>
  );
}

export function InfoRow({ title, detail, meta, tone = "" }) {
  return (
    <article className={`entity-info-row ${tone ? `is-${tone}` : ""}`.trim()}>
      <div>
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      {meta ? <small>{meta}</small> : null}
    </article>
  );
}

export function InfoEmpty({ children, tone = "" }) {
  return (
    <p className={`entity-info-empty ${tone ? `is-${tone}` : ""}`.trim()}>
      {children}
    </p>
  );
}
