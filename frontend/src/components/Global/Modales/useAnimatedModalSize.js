import { useLayoutEffect } from "react";

const RESIZE_DURATION_MS = 150;
const RESIZE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const SIZE_EPSILON_PX = 1;

// Mide el tamaño de layout, no el tamaño visual transformado.
// getBoundingClientRect() incluye transform/scale de la animación de apertura
// y puede hacer que el primer cambio interno parezca falsamente un resize.
const getLayoutHeight = (element) => {
  if (!element) return 0;

  const height = element.offsetHeight;
  return Number.isFinite(height) ? height : 0;
};

/**
 * Anima de forma global los cambios de alto de un modal ya abierto.
 *
 * Importante:
 * - No usa ResizeObserver sobre el propio modal. Animar `height` mientras se
 *   observa ese mismo `height` puede provocar el error del navegador
 *   "ResizeObserver loop completed with undelivered notifications".
 * - MutationObserver sólo detecta cambios reales de contenido/estado del DOM
 *   (tabs, loaders, mensajes, secciones condicionales, etc.).
 * - La medición y los cambios de estilo se ejecutan en requestAnimationFrame,
 *   fuera del ciclo del observer.
 * - No agrega delay ni modifica la animación de apertura del modal.
 * - Al terminar vuelve a la altura original (`auto` normalmente) para mantener
 *   max-height, scroll y comportamiento responsive.
 */
export default function useAnimatedModalSize(modalRef, open = true) {
  useLayoutEffect(() => {
    const modal = modalRef?.current;

    if (!open || !modal || typeof window === "undefined") {
      return undefined;
    }

    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;

    if (reduceMotion || typeof MutationObserver === "undefined") {
      return undefined;
    }

    const previousInlineTransition = modal.style.transition;
    const previousInlineHeight = modal.style.height;

    let lastHeight = getLayoutHeight(modal);
    let destroyed = false;
    let animating = false;
    let pendingChange = false;
    let measureFrame = 0;
    let animationFrame = 0;
    let settleFrame = 0;
    let fallbackTimer = 0;

    const clearTimer = () => {
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = 0;
      }
    };

    const scheduleMeasure = () => {
      if (destroyed) return;

      if (animating) {
        pendingChange = true;
        return;
      }

      if (measureFrame) cancelAnimationFrame(measureFrame);

      measureFrame = requestAnimationFrame(() => {
        measureFrame = 0;
        if (destroyed || animating) return;

        const nextHeight = getLayoutHeight(modal);
        if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;

        if (Math.abs(nextHeight - lastHeight) < SIZE_EPSILON_PX) {
          lastHeight = nextHeight;
          return;
        }

        const fromHeight = lastHeight;
        lastHeight = nextHeight;
        animating = true;

        // Fijamos primero la altura anterior y recién en el próximo frame
        // arrancamos la transición. Esto evita tocar layout dentro del observer.
        modal.style.transition = "none";
        modal.style.height = `${fromHeight}px`;
        modal.classList.add("is-size-transitioning");
        void modal.offsetHeight;

        animationFrame = requestAnimationFrame(() => {
          animationFrame = 0;
          if (destroyed) return;

          modal.style.transition = `height ${RESIZE_DURATION_MS}ms ${RESIZE_EASING} 0ms`;
          modal.style.height = `${nextHeight}px`;

          fallbackTimer = window.setTimeout(
            finishTransition,
            RESIZE_DURATION_MS + 70,
          );
        });
      });
    };

    const finishTransition = () => {
      if (destroyed || !animating) return;

      clearTimer();
      animating = false;
      modal.classList.remove("is-size-transitioning");
      modal.style.transition = previousInlineTransition;
      modal.style.height = previousInlineHeight;

      // Una vez restaurado `auto`, tomamos la medida real ya asentada. Si el
      // contenido volvió a cambiar durante la animación, hacemos una segunda
      // transición corta en vez de dejar un salto brusco.
      settleFrame = requestAnimationFrame(() => {
        settleFrame = 0;
        if (destroyed) return;

        const settledHeight = getLayoutHeight(modal);
        const changedWhileAnimating =
          pendingChange ||
          (Number.isFinite(settledHeight) &&
            Math.abs(settledHeight - lastHeight) >= SIZE_EPSILON_PX);

        pendingChange = false;

        if (Number.isFinite(settledHeight) && settledHeight > 0) {
          // Conservamos como origen el alto al que terminó visualmente la
          // transición para que un cambio pendiente también sea animado.
          if (!changedWhileAnimating) lastHeight = settledHeight;
        }

        if (changedWhileAnimating) scheduleMeasure();
      });
    };

    const handleTransitionEnd = (event) => {
      if (event.target === modal && event.propertyName === "height") {
        finishTransition();
      }
    };

    const observer = new MutationObserver((mutations) => {
      // Los estilos/clases que este hook aplica al propio modal también son
      // mutaciones. Las ignoramos para no auto-disparar la animación.
      const hasContentChange = mutations.some((mutation) => {
        if (mutation.target === modal) return false;
        return true;
      });

      if (hasContentChange) scheduleMeasure();
    });

    const handleContentLoad = (event) => {
      if (event.target !== modal) scheduleMeasure();
    };

    modal.addEventListener("transitionend", handleTransitionEnd);
    modal.addEventListener("load", handleContentLoad, true);

    observer.observe(modal, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    });

    return () => {
      destroyed = true;
      observer.disconnect();
      modal.removeEventListener("transitionend", handleTransitionEnd);
      modal.removeEventListener("load", handleContentLoad, true);

      if (measureFrame) cancelAnimationFrame(measureFrame);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (settleFrame) cancelAnimationFrame(settleFrame);
      clearTimer();

      modal.classList.remove("is-size-transitioning");
      modal.style.transition = previousInlineTransition;
      modal.style.height = previousInlineHeight;
    };
  }, [modalRef, open]);
}
