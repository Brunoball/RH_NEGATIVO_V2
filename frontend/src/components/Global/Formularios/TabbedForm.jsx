import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import "../Global_css/Global_TabbedForms.css";

const tabId = (prefix, value) =>
  `${prefix}-${String(value).replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export function EntityTabs({
  tabs,
  value,
  onChange,
  idPrefix = "entity-tab",
  ariaLabel = "Secciones del formulario",
  className = "",
}) {
  const moveFocus = (nextIndex) => {
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onChange(nextTab.value);
    window.requestAnimationFrame(() => {
      document.getElementById(tabId(idPrefix, nextTab.value))?.focus();
    });
  };

  const handleKeyDown = (event, index) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus((index + 1) % tabs.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus((index - 1 + tabs.length) % tabs.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(tabs.length - 1);
    }
  };

  return (
    <div
      className={`entity-form-tabs ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab, index) => {
        const selected = String(value) === String(tab.value);
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.value)}
            aria-controls={`${tabId(idPrefix, tab.value)}-panel`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`entity-form-tab ${selected ? "is-active" : ""}`}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : null}
            <span>{tab.label}</span>
            {tab.badge !== undefined &&
            tab.badge !== null &&
            tab.badge !== "" ? (
              <span className="entity-form-tab__badge">{tab.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function EntityFormPanel({
  tabValue,
  idPrefix = "entity-tab",
  eyebrow,
  title,
  icon,
  tag,
  children,
  hint,
  standalone = false,
  className = "",
  bodyClassName = "",
}) {
  const id = tabId(idPrefix, tabValue);
  return (
    <section
      className={`entity-form-panel ${className}`.trim()}
      id={standalone ? undefined : `${id}-panel`}
      role={standalone ? "group" : "tabpanel"}
      aria-label={standalone ? title : undefined}
      aria-labelledby={standalone ? undefined : id}
    >
      {(eyebrow || title || tag) && (
        <header className="entity-form-panel__header">
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            {title ? (
              <h3>
                {icon ? <FontAwesomeIcon icon={icon} /> : null}
                {title}
              </h3>
            ) : null}
          </div>
          {tag ? <small>{tag}</small> : null}
        </header>
      )}
      <div className={`entity-form-panel__body ${bodyClassName}`.trim()}>
        {children}
      </div>
      {hint ? <p className="entity-form-panel__hint">{hint}</p> : null}
    </section>
  );
}

export function FloatingField({
  label,
  active = false,
  wide = false,
  textarea = false,
  placeholderOnFloat = false,
  className = "",
  children,
}) {
  return (
    <label
      className={`entity-field entity-floating-field ${wide ? "entity-field--wide" : ""} ${textarea ? "is-textarea" : ""} ${active ? "is-active" : ""} ${placeholderOnFloat ? "has-placeholder-on-float" : ""} ${className}`.trim()}
    >
      {children}
      <span>{label}</span>
    </label>
  );
}
