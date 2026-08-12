import React from "react";

const BAR_WIDTHS = [74, 56, 68, 48, 82, 61, 70, 52];

export default function DataTableSkeleton({
  actionColumnIndex = -1,
  columnCount,
  gridClassName = "",
  rows = 6,
}) {
  const safeColumnCount = Math.max(1, Number(columnCount) || 1);
  const safeRows = Math.max(1, Number(rows) || 1);

  return (
    <div className="mov-skeletonWrap" aria-hidden="true">
      {Array.from({ length: safeRows }, (_, rowIndex) => (
        <div
          className={`mov-gridTable mov-gridTable--row global-divTable__row mov-row--skeleton ${gridClassName}`.trim()}
          role="row"
          key={`skeleton-row-${rowIndex}`}
        >
          {Array.from({ length: safeColumnCount }, (_, columnIndex) => {
            const isActionColumn = columnIndex === actionColumnIndex;
            const width =
              BAR_WIDTHS[(rowIndex + columnIndex) % BAR_WIDTHS.length];

            return (
              <div
                className={`mov-gridCell ${isActionColumn ? "mov-gridCell--actions" : ""}`.trim()}
                role="cell"
                key={`skeleton-cell-${rowIndex}-${columnIndex}`}
              >
                {isActionColumn ? (
                  <span className="mov-skelActions">
                    <span className="mov-skelIcon" />
                    <span className="mov-skelIcon" />
                  </span>
                ) : columnIndex === 0 ? (
                  <span className="mov-skeletonStack">
                    <span
                      className="mov-skeletonBar mov-skeletonBar--main"
                      style={{ width: `${width}%` }}
                    />
                    <span
                      className="mov-skeletonBar mov-skeletonBar--sub"
                      style={{ width: `${Math.max(34, width - 22)}%` }}
                    />
                  </span>
                ) : (
                  <span
                    className="mov-skeletonBar"
                    style={{ width: `${width}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
