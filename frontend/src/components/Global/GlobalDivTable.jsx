import React, { useCallback, useEffect, useRef, useState } from "react";
import DataTableSkeleton from "./DataTableSkeleton";

/**
 * Estructura global para tablas construidas con divs.
 *
 * El encabezado queda fuera del contenedor desplazable para que la barra
 * vertical empiece debajo de él. El gutter se calcula solo cuando el cuerpo
 * realmente tiene overflow, manteniendo alineadas sus columnas.
 */
export default function GlobalDivTable({
  ariaLabel,
  bodyClassName = "",
  bodyRef: externalBodyRef = null,
  children,
  className = "",
  columns = [],
  empty = false,
  gridClassName = "",
  loading = false,
  loadingLabel = "Cargando registros...",
  skeletonActionColumn = true,
  skeletonRows = 6,
}) {
  const bodyRef = useRef(null);
  const setBodyRef = useCallback(
    (node) => {
      bodyRef.current = node;
      if (typeof externalBodyRef === "function") {
        externalBodyRef(node);
      } else if (externalBodyRef) {
        externalBodyRef.current = node;
      }
    },
    [externalBodyRef],
  );
  const [hasVerticalScroll, setHasVerticalScroll] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;

    let animationFrame = 0;
    const updateScrollbar = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (empty) {
          body.scrollTop = 0;
          setHasVerticalScroll(false);
          setScrollbarWidth(0);
          return;
        }

        const hasOverflow = body.scrollHeight > body.clientHeight + 1;
        const width = hasOverflow
          ? Math.max(0, body.offsetWidth - body.clientWidth)
          : 0;
        setHasVerticalScroll(hasOverflow);
        setScrollbarWidth(width);
      });
    };

    updateScrollbar();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollbar);
    const mutationObserver = new MutationObserver(updateScrollbar);

    resizeObserver?.observe(body);
    mutationObserver.observe(body, { childList: true, subtree: true });
    window.addEventListener("resize", updateScrollbar);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updateScrollbar);
    };
  }, [empty]);

  const actionColumnIndex =
    typeof skeletonActionColumn === "number"
      ? skeletonActionColumn
      : skeletonActionColumn
        ? Math.max(0, columns.length - 1)
        : -1;

  return (
    <div
      className={`global-divTable ${empty ? "is-empty" : ""} ${hasVerticalScroll ? "has-y-scroll" : ""} ${className}`.trim()}
      role="table"
      aria-label={ariaLabel}
      aria-busy={loading}
      style={{ "--global-table-scrollbar-width": `${scrollbarWidth}px` }}
    >
      {loading ? (
        <span className="mov-skeletonStatus" role="status" aria-live="polite">
          {loadingLabel}
        </span>
      ) : null}
      <div
        className={`mov-gridTable mov-gridTable--head global-divTable__head ${gridClassName}`.trim()}
        role="row"
      >
        {columns.map((column, index) => {
          const isDefinition =
            column &&
            typeof column === "object" &&
            !React.isValidElement(column) &&
            Object.prototype.hasOwnProperty.call(column, "label");
          const definition = isDefinition ? column : { label: column };
          const alignmentClass = definition.align
            ? `is-${definition.align}`
            : "";

          return (
            <div
              className={`mov-gridCell--head ${alignmentClass} ${definition.className || ""}`.trim()}
              key={
                definition.key ||
                (typeof definition.label === "string" ? definition.label : index)
              }
              role="columnheader"
            >
              {definition.label}
            </div>
          );
        })}
      </div>

      <div
        ref={setBodyRef}
        className={`mov-tableWrap global-divTable__wrap global-divTable__body ${bodyClassName}`.trim()}
        role="rowgroup"
      >
        {loading ? (
          <DataTableSkeleton
            actionColumnIndex={actionColumnIndex}
            columnCount={columns.length}
            gridClassName={gridClassName}
            rows={skeletonRows}
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
