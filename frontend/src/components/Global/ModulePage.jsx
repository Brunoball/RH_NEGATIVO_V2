import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMagnifyingGlass,
  faPlus,
  faRotateRight,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

export function useCompactModuleActions(maxWidth = 1499) {
  const getMatches = () =>
    typeof window !== "undefined" &&
    window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
  const [compact, setCompact] = React.useState(getMatches);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = (event) => setCompact(event.matches);

    setCompact(mediaQuery.matches);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", update);
    } else {
      mediaQuery.addListener(update);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", update);
      } else {
        mediaQuery.removeListener(update);
      }
    };
  }, [maxWidth]);

  return compact;
}

function filterOptionValue(option) {
  return typeof option === "object" ? option.value : option;
}

function filterOptionLabel(option) {
  return typeof option === "object" ? option.label : option;
}

function filterOptionCount(option) {
  if (!option || typeof option !== "object") return null;
  return option.count ?? null;
}

function ModuleTabContent({ option }) {
  const count = filterOptionCount(option);

  return (
    <span className="module-tabContent">
      <span className="module-tabLabel">{filterOptionLabel(option)}</span>
      {count != null ? <span className="module-tabCount">{count}</span> : null}
    </span>
  );
}

function ModuleTitleTabs({ filter }) {
  const value = filter.value ?? "";

  return (
    <div
      className="module-titleTabs"
      role="tablist"
      aria-label={filter.ariaLabel || filter.label}
    >
      {(filter.options || []).map((option) => {
        const optionValue = filterOptionValue(option);
        const selected = String(value) === String(optionValue);

        return (
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            className={`mov-tab module-titleTab ${selected ? "is-active" : ""}`}
            key={optionValue}
            onClick={() => filter.onChange?.(optionValue)}
          >
            <ModuleTabContent option={option} />
          </button>
        );
      })}
    </div>
  );
}

function ModuleFilter({ filter }) {
  const value = filter.value ?? "";
  const active = filter.type !== "search" || String(value).trim() !== "";

  if (filter.type === "tabs") {
    return (
      <div className="module-filter module-filter--tabs">
        <span className="module-floatingLabel">{filter.label}</span>
        <div
          className="mov-tabs module-filterTabs"
          role="tablist"
          aria-label={filter.ariaLabel || filter.label}
        >
          {(filter.options || []).map((option) => {
            const optionValue = filterOptionValue(option);
            return (
              <button
                type="button"
                role="tab"
                aria-selected={String(value) === String(optionValue)}
                className={`mov-tab module-filterTab ${String(value) === String(optionValue) ? "is-active" : ""}`}
                key={optionValue}
                onClick={() => filter.onChange?.(optionValue)}
              >
                <ModuleTabContent option={option} />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <label
      className={`module-filter module-filter--${filter.type || "search"} ${active ? "is-active" : ""} ${filter.className || ""}`.trim()}
    >
      {filter.type === "select" ? (
        <select
          className="module-filterControl"
          value={value}
          onChange={(event) => filter.onChange?.(event.target.value)}
          aria-label={filter.label}
        >
          {filter.includeEmptyOption !== false ? (
            <option value="">{filter.placeholder || "Todos"}</option>
          ) : null}
          {(filter.options || []).map((option) => (
            <option
              key={filterOptionValue(option)}
              value={filterOptionValue(option)}
            >
              {filterOptionLabel(option)}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            className="module-filterControl module-filterControl--search"
            type="text"
            value={String(value)}
            onInput={(event) => filter.onChange?.(event.currentTarget.value)}
            placeholder={filter.placeholder ?? "Buscar..."}
            aria-label={filter.label}
            autoComplete="off"
          />
          {String(value).trim() ? (
            <button
              type="button"
              className="module-clearSearch"
              title="Limpiar búsqueda"
              aria-label="Limpiar búsqueda"
              onClick={() => filter.onChange?.("")}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          ) : null}
        </>
      )}
      <span className="module-floatingLabel">
        {filter.type === "search" ? (
          <FontAwesomeIcon icon={faMagnifyingGlass} />
        ) : null}
        {filter.label}
      </span>
    </label>
  );
}

export function ModulePage({
  title,
  description,
  stats = [],
  filters = [],
  primaryActionLabel = "Nuevo registro",
  onPrimaryAction,
  onRefresh,
  headerActions = null,
  secondaryActions = [],
  primaryActionClassName = "",
  headFiltersClassName = "",
  headFiltersContainerClassName = "",
  canCreate = true,
  refreshing = false,
  tabsInTitle = false,
  headLeftClassName = "",
  className = "",
  children,
  notice,
}) {
  const titleTabs = tabsInTitle
    ? filters.find((filter) => filter.type === "tabs")
    : null;
  const headerFilters = titleTabs
    ? filters.filter((filter) => filter !== titleTabs)
    : filters;

  return (
    <section className={`mov-page module-page ${className}`.trim()}>
      {stats.length ? (
        <section className="module-stats" aria-label={`Resumen de ${title}`}>
          {stats.map((stat) => (
            <article className="module-stat" key={stat.label}>
              <span className="module-stat__icon">
                <FontAwesomeIcon icon={stat.icon} />
              </span>
              <div>
                <small>{stat.label}</small>
                <strong>{stat.value}</strong>
                <p>{stat.detail}</p>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <article className="mov-card mov-card--table module-card">
        <header className="mov-card__head module-card__head">
          <div
            className={
              headLeftClassName || "mov-card__headLeft module-card__headLeft"
            }
          >
            <div className="title-mov module-titleBox">
              <h1 className="mov-card__title module-title">{title}</h1>
              {titleTabs ? (
                <ModuleTitleTabs filter={titleTabs} />
              ) : description ? (
                <p className="mov-card__hint module-description">
                  {description}
                </p>
              ) : null}
            </div>

            {headerFilters.length ? (
              <div
                className={
                  headFiltersContainerClassName ||
                  `mov-headFilters module-headFilters ${headFiltersClassName}`.trim()
                }
              >
                {headerFilters.map((filter) => (
                  <ModuleFilter
                    filter={filter}
                    key={filter.key || filter.label}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="mov-card__actions module-card__actions">
            {headerActions}
            {secondaryActions.map((action) => (
              <button
                type="button"
                className={`mov-btn ${action.className || "mov-btn--ghost"}`}
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.title}
                key={action.key || action.label}
              >
                {action.icon ? <FontAwesomeIcon icon={action.icon} /> : null}
                {action.label}
              </button>
            ))}
            {onRefresh ? (
              <button
                type="button"
                className="mov-btn mov-btn--ghost"
                onClick={onRefresh}
                disabled={refreshing}
              >
                <FontAwesomeIcon icon={faRotateRight} />
                {refreshing ? "Actualizando..." : "Actualizar"}
              </button>
            ) : null}
            {canCreate ? (
              <button
                type="button"
                className={`mov-btn mov-btn--primary ${primaryActionClassName}`.trim()}
                onClick={onPrimaryAction}
                disabled={!onPrimaryAction}
              >
                <FontAwesomeIcon icon={faPlus} />
                {primaryActionLabel}
              </button>
            ) : null}
          </div>
        </header>
        {notice ? <div className="module-notice">{notice}</div> : null}
        {children}
      </article>
    </section>
  );
}
