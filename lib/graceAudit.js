const fs = require('fs');

const PAYMENT_PAYLOAD_KEY_PATTERN = /^payment(?:$|[_-]?(?:method|details?|info))$/i;
const SENSITIVE_KEY_PATTERN = /(card|pan|cvv|cvc|security.?code|expiry|exp|account|routing|iban|bank)/i;
const CVV_LABELS = ['cvv', 'cvc', 'security code'];

function isDigit(char) {
  return char >= '0' && char <= '9';
}

function isCvvSeparator(char) {
  return char === ' ' || char === ':' || char === '#' || char === '-';
}

function passesLuhnCheck(digits) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function sanitizeStringForStorage(value) {
  const lowerValue = value.toLowerCase();
  let withoutCvv = '';
  let index = 0;

  while (index < value.length) {
    const nextMatch = CVV_LABELS
      .map((label) => ({ label, position: lowerValue.indexOf(label, index) }))
      .filter(({ position }) => position !== -1)
      .sort((left, right) => left.position - right.position)[0];

    if (!nextMatch) {
      withoutCvv += value.slice(index);
      break;
    }

    const labelStart = nextMatch.position;
    const labelEnd = labelStart + nextMatch.label.length;
    withoutCvv += value.slice(index, labelEnd);

    let cursor = labelEnd;
    while (cursor < value.length && isCvvSeparator(value[cursor])) {
      withoutCvv += value[cursor];
      cursor += 1;
    }

    const digitStart = cursor;
    while (cursor < value.length && isDigit(value[cursor])) {
      cursor += 1;
    }

    const digits = value.slice(digitStart, cursor);
    withoutCvv += digits.length >= 3 && digits.length <= 4 ? '[REDACTED]' : digits;
    index = cursor;
  }

  let sanitized = '';
  let candidate = '';

  function flushCandidate() {
    if (!candidate) {
      return;
    }

    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && passesLuhnCheck(digits)) {
      sanitized += '[REDACTED]';
    } else {
      sanitized += candidate;
    }
    candidate = '';
  }

  for (const char of withoutCvv) {
    if (isDigit(char) || char === ' ' || char === '-') {
      candidate += char;
      continue;
    }

    flushCandidate();
    sanitized += char;
  }

  flushCandidate();
  return sanitized;
}

function sanitizeForStorage(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForStorage);
  }

  if (typeof value === 'string') {
    return sanitizeStringForStorage(value);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const cleaned = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (PAYMENT_PAYLOAD_KEY_PATTERN.test(key)) {
      cleaned[key] = '[REDACTED]';
      continue;
    }
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      cleaned[key] = '[REDACTED]';
      continue;
    }
    cleaned[key] = sanitizeForStorage(rawValue);
  }

  return cleaned;
}

function appendAuditEvent(auditFilePath, event) {
  const safeEvent = sanitizeForStorage(event);
  fs.appendFileSync(auditFilePath, `${JSON.stringify(safeEvent)}\n`);
}

module.exports = {
  sanitizeForStorage,
  appendAuditEvent
};
