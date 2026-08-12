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
  return withoutDigits(value)
    .toLocaleUpperCase("es-AR")
    .replace(/[^A-ZÁÉÍÓÚÜÑÇ'’.\-\s]/g, "")
    .replace(/ {2,}/g, " ");
}


export function upperLimitedText(value, maxLength = 1000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .toLocaleUpperCase("es-AR")
    .slice(0, maxLength);
}

export function personNameInput(value, maxLength = 100) {
  return upperLimitedText(value, maxLength)
    .replace(/[^A-ZÁÉÍÓÚÜÑÇ'’.\-\s]/g, "")
    .replace(/ {2,}/g, " ")
    .slice(0, maxLength);
}

export function dniInput(value) {
  return onlyDigits(value, 8);
}

export function phoneInput(value) {
  return onlyDigits(value, 15);
}

export function addressInput(value, maxLength = 150) {
  return upperLimitedText(value, maxLength)
    .replace(/[^A-ZÁÉÍÓÚÜÑÇ0-9\s.,°º#/'()\-]/g, "")
    .slice(0, maxLength);
}

export function addressNumberInput(value, maxLength = 20) {
  return onlyDigits(value, maxLength);
}

export function receiptNumberInput(value, maxLength = 120) {
  return upperLimitedText(value, maxLength)
    .replace(/[^A-ZÁÉÍÓÚÜÑÇ0-9\s./\-]/g, "")
    .slice(0, maxLength);
}

export function usernameInput(value, maxLength = 100) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, maxLength);
}

export function emailInput(value, maxLength = 190) {
  return String(value ?? "")
    .replace(/[\s\u0000-\u001F\u007F]/g, "")
    .slice(0, maxLength);
}

export function upperCatalogName(value, maxLength = 160) {
  return upperLimitedText(value, maxLength)
    .replace(/[^A-ZÁÉÍÓÚÜÑÇ0-9\s+&./\-]/g, "")
    .replace(/ {2,}/g, " ")
    .slice(0, maxLength);
}

export function upperLettersOnly(value, maxLength = 160) {
  return personNameInput(value, maxLength);
}

export function upperBloodGroup(value, maxLength = 10) {
  return upperLimitedText(value, maxLength)
    .replace(/[^A-Z0-9+\-\s]/g, "")
    .slice(0, maxLength);
}
