export function onlyDigits(value, maxLength = null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return Number.isInteger(maxLength) && maxLength >= 0
    ? digits.slice(0, maxLength)
    : digits;
}

export function decimalInput(value, maxIntegerDigits = 12, maxDecimals = 2) {
  const normalized = String(value ?? "")
    .replace(/,/g, ".")
    .replace(/[^\d.]/g, "");
  const [rawInteger = "", ...decimalParts] = normalized.split(".");
  const integer = rawInteger.slice(0, maxIntegerDigits);

  if (!decimalParts.length) return integer;

  const decimals = decimalParts.join("").slice(0, maxDecimals);
  return `${integer || "0"}.${decimals}`;
}

export function preventInvalidDecimalKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const allowedControlKeys = new Set([
    "Backspace",
    "Delete",
    "Tab",
    "Enter",
    "Escape",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ]);

  if (allowedControlKeys.has(event.key) || /^\d$/.test(event.key)) return;

  if (event.key === "." || event.key === ",") {
    const input = event.currentTarget;
    const currentValue = String(input?.value ?? "");
    const selectionStart = input?.selectionStart ?? currentValue.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const selectedText = currentValue.slice(selectionStart, selectionEnd);
    const valueWithoutSelection =
      currentValue.slice(0, selectionStart) + currentValue.slice(selectionEnd);

    if (!/[.,]/.test(valueWithoutSelection) || /[.,]/.test(selectedText)) return;
  }

  event.preventDefault();
}

export function withoutDigits(value) {
  return String(value ?? "").replace(/[0-9]/g, "");
}

export function upperWithoutDigits(value) {
  return withoutDigits(value).toLocaleUpperCase("es-AR");
}
