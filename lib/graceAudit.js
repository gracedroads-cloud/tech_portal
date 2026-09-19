const fs = require('fs');

const SENSITIVE_KEY_PATTERN = /(card|pan|cvv|cvc|security.?code|expiry|exp|account|routing|iban|bank)/i;

function sanitizeForStorage(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForStorage);
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
