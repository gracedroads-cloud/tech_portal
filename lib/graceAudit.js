const fs = require('fs');

const SENSITIVE_KEY_PATTERN = /(card|pan|cvv|cvc|security.?code|expiry|exp|account|routing|iban|bank)/i;
const CVV_VALUE_PATTERN = /\b((?:cvv|cvc|security\s*code)\s*[:#-]?\s*)(\d{3,4})\b/gi;
const CARD_NUMBER_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

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
  const withoutCvv = value.replace(CVV_VALUE_PATTERN, '$1[REDACTED]');

  return withoutCvv.replace(CARD_NUMBER_PATTERN, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !passesLuhnCheck(digits)) {
      return match;
    }
    return '[REDACTED]';
  });
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
