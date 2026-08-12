import { useCallback, useEffect, useState } from "react";

/**
 * Mide el scrollbar vertical real del cuerpo de una tabla.
 * No reserva gutter: solo informa si existe overflow y el ancho real
 * para compensar el encabezado cuando corresponde.
 */
export function useTableScrollbarCompensation() {
  const [bodyNode, setBodyNode] = useState(null);
  const [hasVerticalScroll, setHasVerticalScroll] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  const bodyRef = useCallback((node) => {
    setBodyNode(node);
  }, []);

  useEffect(() => {
    if (!bodyNode) {
      setHasVerticalScroll(false);
      setScrollbarWidth(0);
      return undefined;
    }

    let animationFrame = 0;

    const updateScrollbar = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const hasOverflow = bodyNode.scrollHeight > bodyNode.clientHeight + 1;
        const width = hasOverflow
          ? Math.max(0, bodyNode.offsetWidth - bodyNode.clientWidth)
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
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(updateScrollbar);

    resizeObserver?.observe(bodyNode);
    mutationObserver?.observe(bodyNode, { childList: true, subtree: true });
    window.addEventListener("resize", updateScrollbar);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", updateScrollbar);
    };
  }, [bodyNode]);

  return { bodyRef, hasVerticalScroll, scrollbarWidth };
}
