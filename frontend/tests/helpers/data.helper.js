const crypto = require('crypto');

const APP_TIME_ZONE = process.env.PW_TIMEZONE || 'America/Argentina/Cordoba';

let suffixSequence = 0;
const digitAssignments = new Map();
const usedDigitsByLength = new Map();

function uniqueSuffix() {
  suffixSequence = (suffixSequence + 1) % 1679616; // 36^4

  const now = Date.now().toString(36).toUpperCase();
  const highResolution = process.hrtime.bigint().toString(36).slice(-6).toUpperCase();
  const sequence = suffixSequence.toString(36).padStart(4, '0').toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();

  return `${now}${highResolution}${sequence}${random}`;
}

function digitsFromSuffix(suffix, length) {
  const requestedLength = Number(length);
  if (!Number.isInteger(requestedLength) || requestedLength <= 0 || requestedLength > 30) {
    throw new TypeError('La longitud numérica debe ser un entero entre 1 y 30.');
  }

  const assignmentKey = `${requestedLength}:${String(suffix)}`;
  const previous = digitAssignments.get(assignmentKey);
  if (previous) return previous;

  let used = usedDigitsByLength.get(requestedLength);
  if (!used) {
    used = new Set();
    usedDigitsByLength.set(requestedLength, used);
  }

  const space = 10n ** BigInt(requestedLength);
  const digest = crypto
    .createHash('sha256')
    .update(assignmentKey)
    .digest('hex');

  let candidate = BigInt(`0x${digest}`) % space;
  let value = candidate.toString().padStart(requestedLength, '0');

  // Garantiza que dos fixtures generados por el mismo proceso nunca reciban
  // el mismo DNI/CUIT, incluso si se crean dentro del mismo milisegundo.
  while (used.has(value)) {
    candidate = (candidate + 1n) % space;
    value = candidate.toString().padStart(requestedLength, '0');
  }

  used.add(value);
  digitAssignments.set(assignmentKey, value);
  return value;
}

function lettersFromSuffix(suffix, length = 18) {
  const requestedLength = Number(length);
  if (!Number.isInteger(requestedLength) || requestedLength <= 0 || requestedLength > 64) {
    throw new TypeError('La longitud alfabética debe ser un entero entre 1 y 64.');
  }

  const digest = crypto
    .createHash('sha256')
    .update(`letters:${String(suffix)}`)
    .digest('hex');
  let value = BigInt(`0x${digest}`);
  let result = '';

  for (let index = 0; index < requestedLength; index += 1) {
    result += String.fromCharCode(65 + Number(value % 26n));
    value /= 26n;
  }

  return result;
}

function dateIsoInAppTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function todayIso() {
  return dateIsoInAppTimeZone(new Date());
}

function addDaysIso(days) {
  const amount = Number(days);
  if (!Number.isFinite(amount)) throw new TypeError('La cantidad de días debe ser numérica.');
  return dateIsoInAppTimeZone(new Date(Date.now() + Math.trunc(amount) * 86400000));
}

function normalizeUiText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { addDaysIso, dateIsoInAppTimeZone, digitsFromSuffix, lettersFromSuffix, normalizeUiText, todayIso, uniqueSuffix };
