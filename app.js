const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { FLOW_STATES, transitionState } = require('./lib/graceStateEngine');
const { SERVICE_SCOPE_POLICY, validateScope, generateEstimate } = require('./lib/gracePolicy');
const { sanitizeForStorage, appendAuditEvent } = require('./lib/graceAudit');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // Serves root-level files like index.html

// Ensure local data directory exists for JSON backups
const dataDir = path.join(__dirname, 'data');
const graceDataDir = path.join(dataDir, 'grace_calls');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(graceDataDir)) {
  fs.mkdirSync(graceDataDir, { recursive: true });
}

const auditFilePath = path.join(dataDir, 'grace_audit.log');
const graceCalls = new Map();
const rateLimitState = new Map();

function createSimpleRateLimiter({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = rateLimitState.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitState.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      return res.status(429).json({ success: false, error: 'Rate limit exceeded. Please retry shortly.' });
    }

    entry.count += 1;
    return next();
  };
}

const writeRateLimit = createSimpleRateLimiter({ windowMs: 60 * 1000, max: 120 });

function createGraceCall(payload) {
  const now = new Date().toISOString();
  const call = {
    callId: `grace_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    state: FLOW_STATES.NEW,
    createdAt: now,
    updatedAt: now,
    caller: sanitizeForStorage(payload.caller || {}),
    intake: {},
    scopeDecision: null,
    estimate: null,
    paymentLink: null,
    technicianOffer: null,
    workOrder: null,
    gates: {
      scopeApproved: false,
      technicianAccepted: false,
      pricingEstimateApprovedOrAccepted: false,
      safetyCheckPassed: false
    },
    dispatch: {
      estimateProvided: false,
      finalConfirmed: false
    },
    stateHistory: []
  };

  graceCalls.set(call.callId, call);
  persistCall(call);
  return call;
}

function getCallOrThrow(callId) {
  const call = graceCalls.get(callId);
  if (!call) {
    throw new Error('Grace call not found.');
  }
  return call;
}

function persistCall(call) {
  call.updatedAt = new Date().toISOString();
  const safeCall = sanitizeForStorage(call);
  fs.writeFileSync(path.join(graceDataDir, `${call.callId}.json`), JSON.stringify(safeCall, null, 2));
}

function audit(call, action, details = {}) {
  appendAuditEvent(auditFilePath, {
    callId: call.callId,
    state: call.state,
    action,
    timestamp: new Date().toISOString(),
    details,
    gates: call.gates
  });
}

function respondWithCall(res, call, extras = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    callId: call.callId,
    state: call.state,
    gates: call.gates,
    dispatch: call.dispatch,
    ...extras
  });
}

function generateSecurePaymentLink(callId) {
  const provider = {
    name: 'pci-compliant-provider',
    baseUrl: process.env.PCI_PAYMENT_PROVIDER_URL || 'https://payments.example.com/secure-link'
  };

  const token = crypto.randomBytes(12).toString('hex');
  return {
    provider: provider.name,
    url: `${provider.baseUrl}?token=${token}&call=${encodeURIComponent(callId)}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  };
}

// DVIR API Endpoint
app.post('/api/dvir', writeRateLimit, (req, res) => {
  try {
    const dvirData = req.body;
    const filePath = path.join(dataDir, `dvir_${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(dvirData, null, 2));
    res.status(200).json({ success: true, message: 'DVIR record saved successfully', file: filePath });
  } catch (error) {
    console.error('Error saving DVIR:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// System Status / Breakdown Ticker Endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ONLINE',
    base: 'Lehigh Valley, PA',
    port: PORT,
    timestamp: new Date().toISOString(),
    gracePolicy: SERVICE_SCOPE_POLICY.domain
  });
});

app.get('/api/grace/calls/:callId', (req, res) => {
  try {
    const call = getCallOrThrow(req.params.callId);
    return respondWithCall(res, call, { call: sanitizeForStorage(call) });
  } catch (error) {
    return res.status(404).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/answer', writeRateLimit, (req, res) => {
  try {
    const call = createGraceCall(req.body);
    const stateEvent = transitionState(call, 'answer', { channel: req.body.channel || 'voice' });
    audit(call, 'answer', stateEvent);
    persistCall(call);
    return respondWithCall(res, call, { message: 'Call answered by Grace.' });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/intake', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    call.intake = sanitizeForStorage({
      carrierName: req.body.carrierName,
      vehicleType: req.body.vehicleType,
      serviceCategory: req.body.serviceCategory,
      issueDescription: req.body.issueDescription,
      requestedWork: req.body.requestedWork,
      location: req.body.location
    });
    const stateEvent = transitionState(call, 'intake', { intakeCaptured: true });
    audit(call, 'intake', stateEvent);
    persistCall(call);
    return respondWithCall(res, call, { message: 'Intake captured.' });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/scope_check', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    const stateEvent = transitionState(call, 'scope_check', { initiatedBy: 'grace' });
    const decision = validateScope({
      serviceCategory: req.body.serviceCategory || call.intake.serviceCategory,
      vehicleType: req.body.vehicleType || call.intake.vehicleType,
      requestedWork: req.body.requestedWork || call.intake.requestedWork,
      issueDescription: req.body.issueDescription || call.intake.issueDescription
    });

    call.scopeDecision = decision;
    call.gates.scopeApproved = decision.approved;
    audit(call, 'scope_check', { ...stateEvent, decision });
    persistCall(call);

    if (!decision.approved) {
      return res.status(422).json({
        success: false,
        callId: call.callId,
        state: call.state,
        scopeApproved: false,
        reasons: decision.reasons,
        outOfScope: true
      });
    }

    return respondWithCall(res, call, { scopeApproved: true, policyDomain: decision.policyDomain });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/quote', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    if (!call.gates.scopeApproved) {
      return res.status(409).json({ success: false, error: 'Scope must be approved before quote.' });
    }

    const stateEvent = transitionState(call, 'quote', { generatedBy: 'grace' });
    const estimate = generateEstimate({
      serviceCategory: req.body.serviceCategory || call.intake.serviceCategory,
      laborTier: req.body.laborTier,
      laborHours: req.body.laborHours,
      mileage: req.body.mileage,
      feeSchedule: req.body.feeSchedule
    });

    call.estimate = estimate;
    call.dispatch.estimateProvided = true;
    call.gates.pricingEstimateApprovedOrAccepted = Boolean(req.body.estimateApprovedOrAccepted);
    audit(call, 'quote', { ...stateEvent, estimate });
    persistCall(call);

    return respondWithCall(res, call, {
      dispatchType: 'estimate',
      finalDispatchConfirmed: false,
      estimate
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/payment_link', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    const stateEvent = transitionState(call, 'payment_link', { providerType: 'pci-compliant' });
    const paymentLink = generateSecurePaymentLink(call.callId);
    call.paymentLink = paymentLink;
    audit(call, 'payment_link', { ...stateEvent, paymentLink, request: sanitizeForStorage(req.body) });
    persistCall(call);
    return respondWithCall(res, call, {
      message: 'Secure payment link generated. Card data is never stored locally.',
      paymentLink
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/technician_offer', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    const stateEvent = transitionState(call, 'technician_offer', { technicianId: req.body.technicianId });
    call.technicianOffer = sanitizeForStorage({
      technicianId: req.body.technicianId,
      technicianName: req.body.technicianName,
      etaMinutes: req.body.etaMinutes
    });
    audit(call, 'technician_offer', stateEvent);
    persistCall(call);
    return respondWithCall(res, call, { message: 'Technician offer issued.', technicianOffer: call.technicianOffer });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/technician_acceptance', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);

    if (!req.body.accepted) {
      audit(call, 'technician_acceptance_denied', { accepted: false });
      persistCall(call);
      return res.status(409).json({ success: false, callId: call.callId, error: 'Dispatch remains estimate-only until technician acceptance.' });
    }

    const stateEvent = transitionState(call, 'technician_acceptance', { accepted: true });
    call.gates.technicianAccepted = true;
    audit(call, 'technician_acceptance', stateEvent);
    persistCall(call);
    return respondWithCall(res, call, { message: 'Technician accepted assignment.' });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/work_order_create', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    const effectiveGates = {
      ...call.gates,
      safetyCheckPassed: Boolean(req.body.safetyCheckPassed)
    };
    if (typeof req.body.estimateApprovedOrAccepted === 'boolean') {
      effectiveGates.pricingEstimateApprovedOrAccepted = req.body.estimateApprovedOrAccepted;
    }

    const missingGates = Object.entries(effectiveGates)
      .filter(([, passed]) => !passed)
      .map(([gate]) => gate);

    if (missingGates.length > 0) {
      audit(call, 'work_order_blocked', { missingGates });
      persistCall(call);
      return res.status(409).json({
        success: false,
        callId: call.callId,
        dispatchType: 'estimate',
        finalDispatchConfirmed: false,
        gates: call.gates,
        missingGates,
        message: 'Dispatch not final until all approval gates pass, including technician acceptance.'
      });
    }

    const stateEvent = transitionState(call, 'work_order_create', { approvedBy: req.body.approvedBy || 'operator' });
    call.gates = effectiveGates;
    call.workOrder = {
      workOrderId: `wo_${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    call.dispatch.finalConfirmed = true;
    audit(call, 'work_order_create', { ...stateEvent, workOrder: call.workOrder });
    persistCall(call);

    return respondWithCall(res, call, {
      dispatchType: 'final_confirmed_dispatch',
      finalDispatchConfirmed: true,
      workOrder: call.workOrder
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/closeout', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    const stateEvent = transitionState(call, 'closeout', { closedBy: req.body.closedBy || 'operator' });
    call.closeout = sanitizeForStorage({
      resolutionNotes: req.body.resolutionNotes,
      completedAt: new Date().toISOString()
    });
    audit(call, 'closeout', stateEvent);
    persistCall(call);
    return respondWithCall(res, call, { message: 'Call closed out.', closeout: call.closeout });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('=======================================================');
    console.log(`⚡ GRACE MASTER HUB ONLINE - PORT ${PORT}`);
    console.log('📍 OPERATING BASE: LEHIGH VALLEY, PA (150-MILE RADAR LIVE)');
    console.log('=======================================================');
  });
}

module.exports = app;
