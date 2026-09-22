const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sanitizeForStorage, appendAuditEvent } = require('../lib/graceAudit');

test('sanitizeForStorage redacts payment data embedded in free-text values', () => {
  const sanitized = sanitizeForStorage({
    issueDescription: 'Customer pasted card 4242 4242 4242 4242 for payment.',
    requestedWork: 'Use CVV: 123 after diagnosis.',
    resolutionNotes: 'Confirmed non-payment note 4111111111111111 and cvc 999 were removed.'
  });

  assert.equal(sanitized.issueDescription.includes('4242 4242 4242 4242'), false);
  assert.equal(sanitized.requestedWork.includes('123'), false);
  assert.equal(sanitized.resolutionNotes.includes('4111111111111111'), false);
  assert.equal(sanitized.resolutionNotes.includes('999'), false);
  assert.match(sanitized.issueDescription, /\[REDACTED\]/);
  assert.match(sanitized.requestedWork, /\[REDACTED\]/);
  assert.match(sanitized.resolutionNotes, /\[REDACTED\]/);
});

test('sanitizeForStorage redacts whole nested payment payloads', () => {
  const sanitized = sanitizeForStorage({
    paymentMethod: {
      number: '5555555555554444',
      cvv: '321'
    },
    paymentLink: {
      provider: 'pci-compliant-provider'
    }
  });

  assert.deepEqual(sanitized, {
    paymentMethod: '[REDACTED]',
    paymentLink: {
      provider: 'pci-compliant-provider'
    }
  });
});

test('appendAuditEvent does not write free-text payment values to disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-audit-'));
  const auditPath = path.join(tempDir, 'grace_audit.log');

  appendAuditEvent(auditPath, {
    action: 'closeout',
    details: {
      resolutionNotes: 'Customer provided PAN 4242424242424242 and security code 123.'
    }
  });

  const auditLog = fs.readFileSync(auditPath, 'utf8');
  assert.equal(auditLog.includes('4242424242424242'), false);
  assert.equal(auditLog.includes('123'), false);
  assert.match(auditLog, /\[REDACTED\]/);
});
