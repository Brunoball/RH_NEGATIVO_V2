const NATIVE_PICKER_TYPES = new Set([
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

function resolvePickerInput(eventOrInput) {
  if (typeof HTMLInputElement === "undefined") return null;

  if (eventOrInput instanceof HTMLInputElement) return eventOrInput;

  const currentTarget = eventOrInput?.currentTarget;
  if (currentTarget instanceof HTMLInputElement) return currentTarget;

  const target = eventOrInput?.target;
  return target instanceof HTMLInputElement ? target : null;
}

/**
 * Abre el selector nativo al pulsar cualquier punto del input, no solamente
 * el indicador del calendario. En navegadores sin showPicker se conserva el
 * comportamiento nativo y se enfoca el control.
 */
export function openNativePicker(eventOrInput) {
  const input = resolvePickerInput(eventOrInput);

  if (
    !input ||
    !NATIVE_PICKER_TYPES.has(input.type) ||
    input.disabled ||
    input.readOnly
  ) {
    return;
  }

  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      // Algunos navegadores exigen un gesto directo; el foco mantiene el
      // fallback nativo sin bloquear la interacción.
    }
  }

  input.focus();
}
