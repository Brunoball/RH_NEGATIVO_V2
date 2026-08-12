import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const formatDashboardValue = (value) => {
  if (typeof value !== "string") return value;

  return value.replace(/([,.])00(?=\s*$)/, "");
};

export default function SummaryCards({
  title = "Resumen",
  ariaLabel,
  items = [],
  variant = "default",
  className = "",
  actions,
}) {
  if (!items.length) return null;

  const variantClass =
    variant === "footer"
      ? "global-summaryCards--footer"
      : variant === "dashboard"
        ? "global-summaryCards--dashboard"
        : "";
  const dashboardVariant = variant === "dashboard";

  return (
    <section
      className={`global-summaryCards ${variantClass} ${className}`.trim()}
      aria-label={ariaLabel || title || "Resumen"}
    >
      {title ? (
        <strong className="global-summaryCards__title">{title}</strong>
      ) : null}
      <div className="global-summaryCards__list">
        {items.map((item) => {
          const hasDetail = item.detail !== undefined && item.detail !== null;
          const toneClass = item.tone ? `is-${item.tone}` : "";

          if (dashboardVariant) {
            return (
              <article
                className={`global-summaryCards__item ${toneClass}`.trim()}
                key={item.key || item.label}
              >
                {item.icon ? (
                  <div className="global-summaryCards__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={item.icon} />
                  </div>
                ) : null}
                <div className="global-summaryCards__body">
                  <span className="global-summaryCards__label">
                    {item.label}
                  </span>
                  <b className="global-summaryCards__value">
                    {formatDashboardValue(item.value)}
                  </b>
                  {hasDetail ? (
                    <small className="global-summaryCards__detail">
                      {item.detail}
                    </small>
                  ) : null}
                </div>
              </article>
            );
          }

          return (
            <article
              className={`global-summaryCards__item ${
                hasDetail ? "" : "global-summaryCards__item--simple"
              } ${toneClass}`.trim()}
              key={item.key || item.label}
            >
              <span className="global-summaryCards__label">{item.label}</span>
              {hasDetail ? (
                <small className="global-summaryCards__detail">
                  {item.detail}
                </small>
              ) : null}
              <b className="global-summaryCards__value">{item.value}</b>
            </article>
          );
        })}
      </div>
      {actions ? (
        <div className="global-summaryCards__actions">{actions}</div>
      ) : null}
    </section>
  );
}
