import { useCallback, useEffect, useRef } from "react";

/**
 * Conserva la posición de la tabla y del viewport únicamente cuando una acción
 * explícita pide refrescar datos. Los cambios normales de filtros/paginación no
 * capturan posición, por lo que mantienen el comportamiento esperado de cada
 * pantalla.
 */
export function useSmartScrollRefresh({ loading = false, contentKey = "" } = {}) {
  const bodyRef = useRef(null);
  const pendingScrollRef = useRef(null);

  const captureScroll = useCallback(() => {
    pendingScrollRef.current = {
      tableTop: bodyRef.current?.scrollTop ?? null,
      tableLeft: bodyRef.current?.scrollLeft ?? null,
      windowX: typeof window !== "undefined" ? window.scrollX : 0,
      windowY: typeof window !== "undefined" ? window.scrollY : 0,
    };
  }, []);

  useEffect(() => {
    if (loading || pendingScrollRef.current == null) return undefined;

    let firstFrame = 0;
    let secondFrame = 0;

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const pending = pendingScrollRef.current;
        if (!pending) return;

        const body = bodyRef.current;
        if (body && pending.tableTop != null) {
          const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
          const maxScrollLeft = Math.max(0, body.scrollWidth - body.clientWidth);
          body.scrollTop = Math.min(pending.tableTop, maxScrollTop);
          body.scrollLeft = Math.min(pending.tableLeft ?? 0, maxScrollLeft);
        }

        if (typeof window !== "undefined") {
          window.scrollTo({
            left: pending.windowX,
            top: pending.windowY,
            behavior: "auto",
          });
        }

        pendingScrollRef.current = null;
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [loading, contentKey]);

  return { bodyRef, captureScroll };
}
