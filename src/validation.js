function isNonEmptyString(value, maxLength = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function toTrimmed(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function isSimpleEmail(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf('@')) {
    return false;
  }

  const domain = trimmed.slice(atIndex + 1);
  if (!domain || domain.startsWith('.') || domain.endsWith('.') || !domain.includes('.')) {
    return false;
  }

  return !/\s/.test(trimmed);
}

function normalizeDvir(body) {
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Payload must be a JSON object.'] };
  }

  if (!isNonEmptyString(body.vehicleId, 64)) {
    errors.push('vehicleId is required (1-64 chars).');
  }
  if (!isNonEmptyString(body.driverName, 100)) {
    errors.push('driverName is required (1-100 chars).');
  }

  const defects = Array.isArray(body.defects) ? body.defects.filter((d) => isNonEmptyString(d, 120)).map((d) => d.trim()) : [];
  if (!defects.length) {
    errors.push('defects must include at least one item.');
  }

  const odometer = Number(body.odometer);
  if (!Number.isFinite(odometer) || odometer < 0) {
    errors.push('odometer must be a non-negative number.');
  }

  const safeToOperate = typeof body.safeToOperate === 'boolean' ? body.safeToOperate : null;
  if (safeToOperate === null) {
    errors.push('safeToOperate must be a boolean.');
  }

  const normalized = {
    vehicleId: toTrimmed(body.vehicleId),
    driverName: toTrimmed(body.driverName),
    location: isNonEmptyString(body.location, 160) ? body.location.trim() : 'Unknown',
    defects,
    odometer,
    safeToOperate,
    notes: isNonEmptyString(body.notes, 1000) ? body.notes.trim() : '',
    source: 'manual_submission',
  };

  return { errors, normalized };
}

function normalizeStreamOverride(body) {
  const errors = [];
  const action = toTrimmed(body?.action);
  if (!['pickup', 'resume_grace'].includes(action)) {
    errors.push('action must be either pickup or resume_grace.');
  }
  return { errors, normalized: { action } };
}

function normalizeOnboarding(body) {
  const errors = [];
  const carrierName = toTrimmed(body?.carrierName);
  const billingEmail = toTrimmed(body?.billingEmail);
  const paymentTerms = toTrimmed(body?.paymentTerms);
  const taxReference = toTrimmed(body?.taxReference || '');

  if (!isNonEmptyString(carrierName, 120)) {
    errors.push('carrierName is required.');
  }
  if (!isSimpleEmail(billingEmail || '')) {
    errors.push('billingEmail must be a valid email address.');
  }
  if (!isNonEmptyString(paymentTerms, 80)) {
    errors.push('paymentTerms is required.');
  }
  if (taxReference && !/^[A-Za-z0-9-]{2,12}$/.test(taxReference)) {
    errors.push('taxReference must be an alphanumeric masked reference (2-12 chars).');
  }

  return {
    errors,
    normalized: {
      carrierName,
      billingEmail,
      paymentTerms,
      taxReference,
      source: 'web_portal',
    },
  };
}

function normalizeOwnerDraw(body) {
  const errors = [];
  const amount = Number(body?.amount);
  const authorizationText = toTrimmed(body?.authorizationText || '');

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push('amount must be greater than 0.');
  }
  if (!isNonEmptyString(authorizationText, 120)) {
    errors.push('authorizationText is required.');
  }

  return {
    errors,
    normalized: {
      amount,
      authorizationProvided: Boolean(authorizationText),
      authorizationMask: authorizationText ? `${authorizationText.slice(0, 1)}***${authorizationText.slice(-1)}` : '',
      source: 'web_portal',
    },
  };
}

function normalizeWaiver(body) {
  const errors = [];
  const carrier = toTrimmed(body?.carrier);
  const unitAsset = toTrimmed(body?.unitAsset);
  const agent = toTrimmed(body?.agent);
  const executionDate = toTrimmed(body?.executionDate);
  const signature = toTrimmed(body?.signature || '');

  if (!isNonEmptyString(carrier, 120)) {
    errors.push('carrier is required.');
  }
  if (!isNonEmptyString(unitAsset, 120)) {
    errors.push('unitAsset is required.');
  }
  if (!isNonEmptyString(agent, 120)) {
    errors.push('agent is required.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(executionDate || '')) {
    errors.push('executionDate must be YYYY-MM-DD.');
  }
  if (!isNonEmptyString(signature, 120)) {
    errors.push('signature is required.');
  }

  return {
    errors,
    normalized: {
      carrier,
      unitAsset,
      agent,
      executionDate,
      signatureProvided: Boolean(signature),
      source: 'waiver_form',
    },
  };
}

function normalizeDispatchRequest(body) {
  const errors = [];
  const carrierName = toTrimmed(body?.carrierName);
  const serviceKey = toTrimmed(body?.serviceKey);

  if (!isNonEmptyString(carrierName, 120)) {
    errors.push('carrierName is required.');
  }
  if (!isNonEmptyString(serviceKey, 80)) {
    errors.push('serviceKey is required.');
  }

  return {
    errors,
    normalized: {
      carrierName,
      serviceKey,
      source: 'dispatch_console',
    },
  };
}

module.exports = {
  normalizeDvir,
  normalizeStreamOverride,
  normalizeOnboarding,
  normalizeOwnerDraw,
  normalizeWaiver,
  normalizeDispatchRequest,
};
