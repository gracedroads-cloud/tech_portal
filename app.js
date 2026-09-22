const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const https = require('https');
const { Server } = require('socket.io');
const { rateLimit } = require('express-rate-limit');
const { FLOW_STATES, transitionState } = require('./lib/graceStateEngine');
const { SERVICE_SCOPE_POLICY, validateScope, generateEstimate } = require('./lib/gracePolicy');
const { sanitizeForStorage, appendAuditEvent } = require('./lib/graceAudit');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const CHANNELS = Object.freeze({
    DISPATCH: 'dispatch.activity',
    BREAKDOWN_ALERTS: 'breakdown.alerts',
    FLEET: 'fleet.telemetry',
    HR_PAYROLL: 'hr.payroll.activity',
    ALERTS: 'system.alerts',
    SYSTEM_HEALTH: 'system.health'
});

const RETENTION = Object.freeze({
    [CHANNELS.DISPATCH]: 500,
    [CHANNELS.BREAKDOWN_ALERTS]: 500,
    [CHANNELS.FLEET]: 500,
    [CHANNELS.HR_PAYROLL]: 500,
    [CHANNELS.ALERTS]: 300,
    [CHANNELS.SYSTEM_HEALTH]: 300
});

const eventBus = {
    [CHANNELS.DISPATCH]: [],
    [CHANNELS.BREAKDOWN_ALERTS]: [],
    [CHANNELS.FLEET]: [],
    [CHANNELS.HR_PAYROLL]: [],
    [CHANNELS.ALERTS]: [],
    [CHANNELS.SYSTEM_HEALTH]: []
};

const DOMAIN_BASELINE = Object.freeze({
    dispatch: { eventChannel: CHANNELS.DISPATCH, apiBase: '/api/dispatch', ownerRole: 'operator' },
    breakdowns: { eventChannel: CHANNELS.BREAKDOWN_ALERTS, apiBase: '/api/breakdowns', ownerRole: 'operator' },
    fleet: { eventChannel: CHANNELS.FLEET, apiBase: '/api/fleet', ownerRole: 'operator' },
    hr_payroll: { eventChannel: CHANNELS.HR_PAYROLL, apiBase: '/api/hr', ownerRole: 'hr' },
    billing: { eventChannel: 'billing.activity', apiBase: '/api/billing', ownerRole: 'admin' },
    compliance: { eventChannel: 'compliance.activity', apiBase: '/api/compliance', ownerRole: 'admin' },
    system_health: { eventChannel: CHANNELS.SYSTEM_HEALTH, apiBase: '/api/system', ownerRole: 'admin' },
    ai_oversight: { eventChannel: 'ai.oversight', apiBase: '/api/ai', ownerRole: 'admin' }
});

const ROLE_BOUNDARIES = Object.freeze({
    operator: ['dispatch', 'breakdowns', 'fleet', 'alerts', 'system_health'],
    hr: ['hr_payroll', 'alerts'],
    admin: ['dispatch', 'breakdowns', 'fleet', 'hr_payroll', 'billing', 'compliance', 'system_health', 'ai_oversight', 'alerts']
});

const FEATURE_FLAGS = {
    monitor_dispatch: true,
    monitor_breakdowns: true,
    monitor_fleet: false,
    monitor_hr_payroll: false,
    monitor_billing: false,
    monitor_compliance: false,
    monitor_ai_insights: false,
    governance_approval_gate: true
};

const FIELD_JOB_STATES = ['Assigned', 'En Route', 'On Scene', 'Work In Progress', 'Completed'];
const FIELD_STATE_TRANSITIONS = {
    Assigned: ['En Route'],
    'En Route': ['On Scene'],
    'On Scene': ['Work In Progress'],
    'Work In Progress': ['Completed'],
    Completed: []
};

const SLO_POLICY = Object.freeze({
    eventDeliveryP95Ms: 1200,
    apiLatencyP95Ms: 250,
    uptimeTargetPercent: 99.9,
    alertAckP95Seconds: 180
});

const auditTrail = [];
const AUDIT_RETENTION = 400;
const FIELD_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const FIELD_LOGIN_WINDOW_MS = 1000 * 60 * 15;
const FIELD_LOGIN_MAX_ATTEMPTS = 8;
const FIELD_RATE_LIMIT_WINDOW_MS = 1000 * 60;
const FIELD_RATE_LIMIT_MAX = 120;
const TEAMS_WEBHOOK_URL = String(process.env.TEAMS_WEBHOOK_URL || '').trim();
const ADMIN_API_KEY = String(process.env.ADMIN_API_KEY || '').trim();
const teamsIntegration = {
    enabled: TEAMS_WEBHOOK_URL.length > 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null
};
const AUTOMATION_INTERVAL_MS = Object.freeze({
    dispatch: 12000,
    hrPayroll: 15000,
    systemOps: 20000,
    field: 25000
});
const SYSTEM_HEAP_ALERT_BYTES = 450 * 1024 * 1024;
const FIELD_STALE_REMINDER_MS = 1000 * 60 * 30;
const DVIR_REMINDER_COOLDOWN_MS = 1000 * 60 * 60 * 4;
const AUTH_RATE_LIMIT_WINDOW_MS = 1000 * 60;
const AUTH_RATE_LIMIT_MAX = 40;
const ADMIN_RATE_LIMIT_WINDOW_MS = 1000 * 60;
const ADMIN_RATE_LIMIT_MAX = 80;
const automationState = {
    dispatch: { enabled: true, runs: 0, lastRunAt: null, lastResult: null, lastError: null },
    hrPayroll: { enabled: true, runs: 0, lastRunAt: null, lastResult: null, lastError: null },
    systemOps: { enabled: true, runs: 0, lastRunAt: null, lastResult: null, lastError: null },
    field: { enabled: true, runs: 0, lastRunAt: null, lastResult: null, lastError: null }
};
const hrPayrollAutomationTemplates = [
    { type: 'Clock In', text: 'Field technician clock-in event captured.', priority: 'normal' },
    { type: 'Payroll Sync', text: 'Payroll draft sync completed for active technicians.', priority: 'normal' },
    { type: 'Compliance Check', text: 'Compliance review completed for active shift records.', priority: 'high' },
    { type: 'Benefits Update', text: 'Benefits eligibility refresh completed.', priority: 'low' }
];
const automationDispatchStatuses = ['Dispatched', 'En-route', 'Completed'];
const automationDispatchJobs = [
    { id: 'AUTO-DSP-1001', operator: 'Automation Control', mode: 'Auto Lifecycle', statusIndex: 0 },
    { id: 'AUTO-DSP-1002', operator: 'Automation Control', mode: 'Auto Lifecycle', statusIndex: 0 }
];
let hrPayrollAutomationIndex = 0;
let dispatchAutomationIndex = 0;
const fieldDvirReminderTracker = new Map();
const fieldStaleReminderTracker = new Map();
const fieldAuthRequestBuckets = new Map();
const adminRequestBuckets = new Map();
const publicPageLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false
});
const fieldAuthLoginLimiter = rateLimit({
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    limit: AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth requests. Try again shortly.' }
});
const adminOpsLimiter = rateLimit({
    windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
    limit: ADMIN_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Admin rate limit exceeded. Try again shortly.' }
});
const fieldSessions = new Map();
const fieldLoginAttempts = new Map();
const fieldRequestBuckets = new Map();
const fieldTechnicians = [
    { techId: 'tech-101', name: 'Elijah Wright', pin: '1101', role: 'field_technician' },
    { techId: 'tech-202', name: 'Jordan Miles', pin: '2202', role: 'field_technician' }
];
const fieldJobs = [
    {
        id: 'JOB-1001',
        assignedTo: 'tech-101',
        customer: 'Keystone Freight',
        unit: 'Freightliner Cascadia 145',
        location: { label: 'I-78 EB MM 71, Easton PA', lat: 40.6823, lng: -75.2415 },
        cause: 'Air brake pressure loss',
        state: 'Assigned',
        acceptedAt: null,
        enRouteAt: null,
        onSceneAt: null,
        workStartedAt: null,
        completedAt: null,
        diagnostics: '',
        workPerformed: '',
        partsUsed: '',
        laborMinutes: '',
        signature: '',
        photos: [],
        stateProof: {}
    },
    {
        id: 'JOB-1002',
        assignedTo: 'tech-202',
        customer: 'Valley Haul Logistics',
        unit: 'Kenworth T680',
        location: { label: 'US-22 WB near Bethlehem PA', lat: 40.647, lng: -75.3752 },
        cause: 'Trailer tire blowout',
        state: 'Assigned',
        acceptedAt: null,
        enRouteAt: null,
        onSceneAt: null,
        workStartedAt: null,
        completedAt: null,
        diagnostics: '',
        workPerformed: '',
        partsUsed: '',
        laborMinutes: '',
        signature: '',
        photos: [],
        stateProof: {}
    }
];
const LEHIGH_VALLEY_BASE = Object.freeze({
    label: 'Lehigh Valley, PA',
    lat: 40.6884,
    lng: -75.2207
});

const BREAKDOWN_CAUSES = [
    'Air brake pressure loss',
    'Trailer tire blowout',
    'Alternator charging fault',
    'Coolant leak',
    'Fuel delivery interruption',
    'Starter failure'
];

const BREAKDOWN_LOCATIONS = [
    { name: 'I-78 EB MM 71, Easton PA', lat: 40.6823, lng: -75.2415 },
    { name: 'US-22 WB near Bethlehem PA', lat: 40.647, lng: -75.3752 },
    { name: 'PA-33 NB near Wind Gap PA', lat: 40.8608, lng: -75.3114 },
    { name: 'I-476 near Allentown Service Area', lat: 40.5634, lng: -75.5426 },
    { name: 'I-80 EB near Stroudsburg PA', lat: 40.9902, lng: -75.2153 },
    { name: 'Route 309 near Coopersburg PA', lat: 40.5102, lng: -75.3907 }
];

// Middleware
app.use(express.json({ limit: '300kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self)');
    next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', publicPageLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.html', publicPageLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/no_tow_authorization.html', publicPageLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'no_tow_authorization.html'));
});

// Ensure local data directory exists for JSON backups
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const graceDataDir = path.join(dataDir, 'grace_calls');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(graceDataDir)) {
  fs.mkdirSync(graceDataDir, { recursive: true });
}

const auditFilePath = path.join(dataDir, 'grace_audit.log');
const graceCalls = new Map();
const operatorToken = process.env.GRACE_OPERATOR_TOKEN;
const writeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

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

function getPersistedGraceCallPath(callId) {
  if (path.basename(callId) !== callId) {
    return null;
  }
  return path.join(graceDataDir, `${callId}.json`);
}

function loadPersistedGraceCall(callId) {
  const filePath = getPersistedGraceCallPath(callId);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const call = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (call?.callId !== callId) {
    return null;
  }

  graceCalls.set(callId, call);
  return call;
}

function getCallOrThrow(callId) {
  const call = graceCalls.get(callId) || loadPersistedGraceCall(callId);
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

function recordStateEvent(call, action, nextState, metadata = {}) {
  const stateEvent = {
    timestamp: new Date().toISOString(),
    action,
    from: call.state,
    to: nextState,
    metadata
  };
  call.state = nextState;
  call.stateHistory.push(stateEvent);
  return stateEvent;
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

function requireOperatorAuth(req, res, next) {
  if (!operatorToken) {
    return res.status(503).json({ success: false, error: 'Operator token is not configured.' });
  }
  const provided = req.headers['x-operator-token'];
  if (provided !== operatorToken) {
    return res.status(401).json({ success: false, error: 'Operator authorization required.' });
  }
  return next();
}

function generateSecurePaymentLink(callId) {
  const provider = {
    name: 'pci-compliant-provider',
    baseUrl: process.env.PCI_PAYMENT_PROVIDER_URL || 'https://payments.example.com/secure-link'
  };

  const token = crypto.randomBytes(12).toString('hex');
  return {
    provider: provider.name,
    url: `${provider.baseUrl}?token=${token}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  };
}

const dispatchLogsPath = path.join(__dirname, 'radio_dispatch_logs.json');
const fieldDvirPath = path.join(dataDir, 'field_dvir_reports.json');
const BREAKDOWN_INGEST_KEY = process.env.BREAKDOWN_INGEST_KEY || '';
const statusPriority = {
    Dispatched: 'high',
    'En-route': 'normal',
    Completed: 'low',
    Cancelled: 'critical'
};

function getPriority(type) {
    return statusPriority[type] || 'normal';
}

function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function distanceMiles(fromLat, fromLng, toLat, toLng) {
    const earthRadiusMiles = 3958.8;
    const latDiff = toRadians(toLat - fromLat);
    const lngDiff = toRadians(toLng - fromLng);
    const a =
        Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
        Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(lngDiff / 2) * Math.sin(lngDiff / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMiles * c;
}

function createDispatchEvent(log) {
    const type = log.status || 'Dispatched';
    const timestamp = log.timestamp || new Date().toISOString();
    return {
        id: log.id || `DISPATCH-${Date.now()}`,
        timestamp,
        channel: CHANNELS.DISPATCH,
        source: 'dispatch',
        type,
        priority: getPriority(type),
        text: `${log.operator || 'Unknown Operator'} — ${log.serviceNotes || 'No dispatch notes available.'}`,
        operator: log.operator || 'Unknown Operator',
        mode: log.mode || 'Unknown Mode'
    };
}

function publishEvent(channel, event) {
    if (!eventBus[channel]) {
        eventBus[channel] = [];
    }
    eventBus[channel].push(event);
    const retentionCount = RETENTION[channel] || 300;
    if (eventBus[channel].length > retentionCount) {
        eventBus[channel].splice(0, eventBus[channel].length - retentionCount);
    }
    if (channel === CHANNELS.DISPATCH) {
        auditTrail.push({
            id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            timestamp: new Date().toISOString(),
            actor: event.operator || 'System',
            action: event.type || 'DispatchEvent',
            channel,
            summary: event.text || 'Dispatch event emitted',
            approvalRequired: ['Cancelled'].includes(event.type),
            policy: event.type === 'Cancelled' ? 'operator_ack_required' : 'none'
        });
        if (auditTrail.length > AUDIT_RETENTION) {
            auditTrail.splice(0, auditTrail.length - AUDIT_RETENTION);
        }
    }
    if (channel === CHANNELS.BREAKDOWN_ALERTS) {
        notifyTeamsEvent({
            title: '🚨 Breakdown Alert',
            text: `${event.vehicle || 'Unit'} • ${event.location || 'Unknown location'}`,
            sections: [
                {
                    facts: [
                        { name: 'Cause', value: event.cause || 'Unknown' },
                        { name: 'Priority', value: event.priority || 'normal' },
                        { name: 'Distance', value: `${event.distanceFromBaseMiles || '--'} miles` }
                    ]
                }
            ]
        });
    }
    if (channel === CHANNELS.DISPATCH && ['Cancelled', 'Completed'].includes(event.type)) {
        notifyTeamsEvent({
            title: `📡 Dispatch ${event.type}`,
            text: event.text || 'Dispatch status update',
            sections: [{ facts: [{ name: 'Operator', value: event.operator || 'Unknown' }] }]
        });
    }
    io.emit(channel, event);
}

function bufferEvent(channel, event) {
    if (!eventBus[channel]) {
        eventBus[channel] = [];
    }
    eventBus[channel].push(event);
    const retentionCount = RETENTION[channel] || 300;
    if (eventBus[channel].length > retentionCount) {
        eventBus[channel].splice(0, eventBus[channel].length - retentionCount);
    }
}

function loadDispatchHistory() {
    if (!fs.existsSync(dispatchLogsPath)) {
        return;
    }
    try {
        const raw = fs.readFileSync(dispatchLogsPath, 'utf8');
        const logs = JSON.parse(raw);
        if (!Array.isArray(logs)) {
            return;
        }
        logs.forEach((log) => bufferEvent(CHANNELS.DISPATCH, createDispatchEvent(log)));
    } catch (error) {
        console.error('Error loading dispatch history:', error);
    }
}

function getDispatchFeed() {
    return eventBus[CHANNELS.DISPATCH]
        .slice()
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function getReplaySince(channel, since) {
    if (!since) {
        return [];
    }
    const sinceTs = new Date(since).getTime();
    if (Number.isNaN(sinceTs)) {
        return [];
    }
    return (eventBus[channel] || []).filter((event) => new Date(event.timestamp).getTime() > sinceTs);
}

function toIsoTimestamp(value) {
    const asDate = value ? new Date(value) : new Date();
    if (Number.isNaN(asDate.getTime())) {
        return new Date().toISOString();
    }
    return asDate.toISOString();
}

function isValidCoordinates(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function writeAuditEntry(entry) {
    auditTrail.push({
        id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        ...entry
    });
    if (auditTrail.length > AUDIT_RETENTION) {
        auditTrail.splice(0, auditTrail.length - AUDIT_RETENTION);
    }
}

function markAutomationSuccess(domain, result) {
    automationState[domain].runs += 1;
    automationState[domain].lastRunAt = new Date().toISOString();
    automationState[domain].lastResult = result;
    automationState[domain].lastError = null;
}

function markAutomationFailure(domain, error) {
    automationState[domain].runs += 1;
    automationState[domain].lastRunAt = new Date().toISOString();
    automationState[domain].lastError = error.message;
}

function cleanupLoginAttemptWindow() {
    const now = Date.now();
    Array.from(fieldLoginAttempts.entries()).forEach(([key, value]) => {
        if (!value || now - value.firstAttemptAt > FIELD_LOGIN_WINDOW_MS) {
            fieldLoginAttempts.delete(key);
        }
    });
}

function cleanupRateLimitBuckets() {
    const now = Date.now();
    Array.from(fieldRequestBuckets.entries()).forEach(([key, value]) => {
        if (!value || now - value.windowStart > FIELD_RATE_LIMIT_WINDOW_MS) {
            fieldRequestBuckets.delete(key);
        }
    });
}

function cleanupAuthRateLimitBuckets() {
    const now = Date.now();
    Array.from(fieldAuthRequestBuckets.entries()).forEach(([key, value]) => {
        if (!value || now - value.windowStart > AUTH_RATE_LIMIT_WINDOW_MS) {
            fieldAuthRequestBuckets.delete(key);
        }
    });
}

function requireFieldAuthRateLimit(req, res, next) {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown-ip';
    const now = Date.now();
    const bucket = fieldAuthRequestBuckets.get(key);
    if (!bucket || now - bucket.windowStart > AUTH_RATE_LIMIT_WINDOW_MS) {
        fieldAuthRequestBuckets.set(key, { count: 1, windowStart: now });
        return next();
    }
    if (bucket.count >= AUTH_RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many auth requests. Try again shortly.' });
    }
    bucket.count += 1;
    fieldAuthRequestBuckets.set(key, bucket);
    return next();
}

function cleanupAdminRateLimitBuckets() {
    const now = Date.now();
    Array.from(adminRequestBuckets.entries()).forEach(([key, value]) => {
        if (!value || now - value.windowStart > ADMIN_RATE_LIMIT_WINDOW_MS) {
            adminRequestBuckets.delete(key);
        }
    });
}

function requireAdminRateLimit(req, res, next) {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown-ip';
    const now = Date.now();
    const bucket = adminRequestBuckets.get(key);
    if (!bucket || now - bucket.windowStart > ADMIN_RATE_LIMIT_WINDOW_MS) {
        adminRequestBuckets.set(key, { count: 1, windowStart: now });
        return next();
    }
    if (bucket.count >= ADMIN_RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Admin rate limit exceeded. Try again shortly.' });
    }
    bucket.count += 1;
    adminRequestBuckets.set(key, bucket);
    return next();
}

function requireAdminAccess(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const providedKey = String(req.headers['x-admin-key'] || token || '').trim();

    if (ADMIN_API_KEY) {
        if (providedKey !== ADMIN_API_KEY) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        return next();
    }

    const ip = String(req.ip || '');
    const forwarded = String(req.headers['x-forwarded-for'] || '');
    const isLocal =
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        forwarded.includes('127.0.0.1') ||
        req.hostname === 'localhost';
    if (!isLocal) {
        return res.status(403).json({ error: 'Admin API key is not configured for remote access' });
    }
    return next();
}

function createHrPayrollEvent(template) {
    return {
        id: `HRP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        channel: CHANNELS.HR_PAYROLL,
        source: 'automation.hr_payroll',
        type: template.type,
        priority: template.priority,
        text: template.text
    };
}

function createSystemHealthSnapshot() {
    const memoryUsage = process.memoryUsage();
    return {
        id: `HEALTH-${Date.now()}`,
        timestamp: new Date().toISOString(),
        channel: CHANNELS.SYSTEM_HEALTH,
        source: 'automation.system_ops',
        type: 'Health Snapshot',
        priority: 'normal',
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
            rss: memoryUsage.rss,
            heapUsed: memoryUsage.heapUsed,
            heapTotal: memoryUsage.heapTotal
        },
        queueDepth: {
            dispatch: eventBus[CHANNELS.DISPATCH].length,
            breakdowns: eventBus[CHANNELS.BREAKDOWN_ALERTS].length,
            hrPayroll: eventBus[CHANNELS.HR_PAYROLL].length,
            alerts: eventBus[CHANNELS.ALERTS].length
        }
    };
}

function createSystemAlert({ type, text, priority = 'normal' }) {
    return {
        id: `ALERT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        channel: CHANNELS.ALERTS,
        source: 'automation.system_ops',
        type,
        priority,
        text
    };
}

function getJobLastActivityAt(job) {
    const candidates = [job.acceptedAt, job.enRouteAt, job.onSceneAt, job.workStartedAt, job.completedAt]
        .filter(Boolean)
        .map((value) => new Date(value).getTime())
        .filter((value) => Number.isFinite(value));
    return candidates.length ? Math.max(...candidates) : null;
}

function runDispatchAutomation() {
    const job = automationDispatchJobs[dispatchAutomationIndex % automationDispatchJobs.length];
    dispatchAutomationIndex = (dispatchAutomationIndex + 1) % automationDispatchJobs.length;
    const status = automationDispatchStatuses[job.statusIndex];
    job.statusIndex = (job.statusIndex + 1) % automationDispatchStatuses.length;
    const event = {
        id: `${job.id}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        channel: CHANNELS.DISPATCH,
        source: 'automation.dispatch',
        type: status,
        priority: getPriority(status),
        text: `${job.operator} — ${job.id} ${status.toLowerCase()} by automation.`,
        operator: job.operator,
        mode: job.mode
    };
    publishEvent(CHANNELS.DISPATCH, event);
    writeAuditEntry({
        actor: 'automation.dispatch',
        action: `dispatch_${status.toLowerCase().replace('-', '_')}`,
        channel: CHANNELS.DISPATCH,
        summary: `${job.id} moved to ${status} automatically`,
        policy: 'backend_automation_dispatch_lifecycle'
    });
    return { jobId: job.id, status };
}

function runHrPayrollAutomation() {
    const template = hrPayrollAutomationTemplates[hrPayrollAutomationIndex % hrPayrollAutomationTemplates.length];
    hrPayrollAutomationIndex = (hrPayrollAutomationIndex + 1) % hrPayrollAutomationTemplates.length;
    const event = createHrPayrollEvent(template);
    publishEvent(CHANNELS.HR_PAYROLL, event);
    writeAuditEntry({
        actor: 'automation.hr_payroll',
        action: template.type.toLowerCase().replace(/\s+/g, '_'),
        channel: CHANNELS.HR_PAYROLL,
        summary: template.text,
        policy: 'backend_automation_hr_payroll'
    });
    return { type: template.type };
}

function runSystemOpsAutomation() {
    cleanupExpiredFieldSessions();
    cleanupLoginAttemptWindow();
    cleanupRateLimitBuckets();
    cleanupAuthRateLimitBuckets();
    cleanupAdminRateLimitBuckets();
    const healthSnapshot = createSystemHealthSnapshot();
    publishEvent(CHANNELS.SYSTEM_HEALTH, healthSnapshot);

    const alerts = [];
    if (healthSnapshot.memory.heapUsed > SYSTEM_HEAP_ALERT_BYTES) {
        const highMemoryAlert = createSystemAlert({
            type: 'Resource Alert',
            text: `Heap usage is elevated at ${Math.round(healthSnapshot.memory.heapUsed / (1024 * 1024))} MB.`,
            priority: 'high'
        });
        publishEvent(CHANNELS.ALERTS, highMemoryAlert);
        alerts.push(highMemoryAlert.type);
    }
    if (teamsIntegration.enabled && teamsIntegration.lastError) {
        const teamsAlert = createSystemAlert({
            type: 'Integration Alert',
            text: `Teams integration error detected: ${teamsIntegration.lastError}`,
            priority: 'normal'
        });
        publishEvent(CHANNELS.ALERTS, teamsAlert);
        alerts.push(teamsAlert.type);
    }

    writeAuditEntry({
        actor: 'automation.system_ops',
        action: 'system_maintenance_cycle',
        channel: CHANNELS.SYSTEM_HEALTH,
        summary: `System automation cycle completed${alerts.length ? ` with ${alerts.length} alert(s)` : ''}`,
        policy: 'backend_automation_system_ops'
    });
    return { alertsTriggered: alerts.length };
}

function runFieldAutomation() {
    const now = Date.now();
    const reports = readFieldDvirReports();
    let reminders = 0;
    let staleJobs = 0;

    fieldTechnicians.forEach((technician) => {
        const hasRecentDvir = reports.some((report) => {
            if (report.techId !== technician.techId) return false;
            const submittedMs = new Date(report.submittedAt).getTime();
            return Number.isFinite(submittedMs) && now - submittedMs <= 24 * 60 * 60 * 1000;
        });
        const lastReminderAt = fieldDvirReminderTracker.get(technician.techId) || 0;
        if (!hasRecentDvir && now - lastReminderAt >= DVIR_REMINDER_COOLDOWN_MS) {
            const reminder = createSystemAlert({
                type: 'DVIR Reminder',
                text: `${technician.name} has no DVIR submission in the last 24 hours.`,
                priority: 'high'
            });
            publishEvent(CHANNELS.ALERTS, reminder);
            fieldDvirReminderTracker.set(technician.techId, now);
            reminders += 1;
        }
    });

    fieldJobs.forEach((job) => {
        if (job.state === 'Completed') {
            fieldStaleReminderTracker.delete(job.id);
            return;
        }
        const lastActivityAt = getJobLastActivityAt(job);
        if (!lastActivityAt) {
            fieldStaleReminderTracker.delete(job.id);
            return;
        }
        if (now - lastActivityAt < FIELD_STALE_REMINDER_MS) {
            fieldStaleReminderTracker.delete(job.id);
            return;
        }
        const lastReminderAt = fieldStaleReminderTracker.get(job.id) || 0;
        if (now - lastReminderAt < FIELD_STALE_REMINDER_MS) {
            return;
        }
        const staleAlert = createSystemAlert({
            type: 'Field Workflow Reminder',
            text: `${job.id} is still ${job.state}. Please advance workflow or escalate.`,
            priority: 'normal'
        });
        publishEvent(CHANNELS.ALERTS, staleAlert);
        fieldStaleReminderTracker.set(job.id, now);
        staleJobs += 1;
    });

    writeAuditEntry({
        actor: 'automation.field',
        action: 'field_workflow_cycle',
        channel: 'field.jobs',
        summary: `Field automation completed (${reminders} DVIR reminder(s), ${staleJobs} stale job alert(s))`,
        policy: 'backend_automation_field_workflow'
    });

    return { reminders, staleJobs };
}

function runAutomationDomain(domain) {
    if (!automationState[domain].enabled) {
        return { skipped: true, reason: 'disabled' };
    }
    try {
        let result = {};
        if (domain === 'dispatch') result = runDispatchAutomation();
        if (domain === 'hrPayroll') result = runHrPayrollAutomation();
        if (domain === 'systemOps') result = runSystemOpsAutomation();
        if (domain === 'field') result = runFieldAutomation();
        markAutomationSuccess(domain, result);
        return { success: true, ...result };
    } catch (error) {
        markAutomationFailure(domain, error);
        return { success: false, error: error.message };
    }
}

function createFieldToken(techId) {
    return `field-${techId}-${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
}

function getLoginAttemptKey(req, techId) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown-ip';
    return `${techId || 'unknown-tech'}:${ip}`;
}

function isLoginBlocked(req, techId) {
    const key = getLoginAttemptKey(req, techId);
    const entry = fieldLoginAttempts.get(key);
    if (!entry) return false;
    const withinWindow = Date.now() - entry.firstAttemptAt <= FIELD_LOGIN_WINDOW_MS;
    if (!withinWindow) {
        fieldLoginAttempts.delete(key);
        return false;
    }
    return entry.count >= FIELD_LOGIN_MAX_ATTEMPTS;
}

function markLoginFailure(req, techId) {
    const key = getLoginAttemptKey(req, techId);
    const current = fieldLoginAttempts.get(key);
    const now = Date.now();
    if (!current || now - current.firstAttemptAt > FIELD_LOGIN_WINDOW_MS) {
        fieldLoginAttempts.set(key, { count: 1, firstAttemptAt: now });
        return;
    }
    current.count += 1;
    fieldLoginAttempts.set(key, current);
}

function clearLoginFailures(req, techId) {
    const key = getLoginAttemptKey(req, techId);
    fieldLoginAttempts.delete(key);
}

function cleanupExpiredFieldSessions() {
    const now = Date.now();
    Array.from(fieldSessions.entries()).forEach(([token, session]) => {
        if (now > session.expiresAt) {
            fieldSessions.delete(token);
        }
    });
}

function readFieldDvirReports() {
    if (!fs.existsSync(fieldDvirPath)) {
        return [];
    }
    try {
        const raw = fs.readFileSync(fieldDvirPath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Error reading field DVIR reports:', error);
        return [];
    }
}

function writeFieldDvirReports(reports) {
    fs.writeFileSync(fieldDvirPath, JSON.stringify(reports, null, 2));
}

function sanitizeTeamsStatus() {
    return {
        enabled: teamsIntegration.enabled,
        webhookConfigured: teamsIntegration.enabled,
        lastAttemptAt: teamsIntegration.lastAttemptAt,
        lastSuccessAt: teamsIntegration.lastSuccessAt,
        lastError: teamsIntegration.lastError
    };
}

function sendTeamsMessage({ title, text, sections = [] }) {
    if (!teamsIntegration.enabled) {
        return Promise.resolve({ sent: false, reason: 'Teams webhook not configured' });
    }

    const webhook = new URL(TEAMS_WEBHOOK_URL);
    const body = JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: title,
        themeColor: '0076D7',
        title,
        text,
        sections
    });

    teamsIntegration.lastAttemptAt = new Date().toISOString();

    return new Promise((resolve, reject) => {
        const request = https.request(
            {
                protocol: webhook.protocol,
                hostname: webhook.hostname,
                port: webhook.port || 443,
                path: `${webhook.pathname}${webhook.search}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 7000
            },
            (response) => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    teamsIntegration.lastSuccessAt = new Date().toISOString();
                    teamsIntegration.lastError = null;
                    resolve({ sent: true });
                    return;
                }
                const error = new Error(`Teams webhook failed with status ${response.statusCode}`);
                teamsIntegration.lastError = error.message;
                reject(error);
            }
        );

        request.on('timeout', () => {
            request.destroy(new Error('Teams webhook timeout'));
        });
        request.on('error', (error) => {
            teamsIntegration.lastError = error.message;
            reject(error);
        });
        request.write(body);
        request.end();
    });
}

function notifyTeamsEvent(payload) {
    sendTeamsMessage(payload).catch((error) => {
        console.error('Teams notification error:', error.message);
    });
}

function sanitizeFieldJob(job) {
    return {
        id: job.id,
        customer: job.customer,
        unit: job.unit,
        location: job.location,
        cause: job.cause,
        state: job.state,
        diagnostics: job.diagnostics,
        workPerformed: job.workPerformed,
        partsUsed: job.partsUsed,
        laborMinutes: job.laborMinutes,
        signaturePresent: Boolean(job.signature),
        photosCount: job.photos.length,
        acceptedAt: job.acceptedAt,
        enRouteAt: job.enRouteAt,
        onSceneAt: job.onSceneAt,
        workStartedAt: job.workStartedAt,
        completedAt: job.completedAt
    };
}

function requireFieldTechnician(req, res, next) {
    cleanupExpiredFieldSessions();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
        return res.status(401).json({ error: 'Missing field technician token' });
    }
    const session = fieldSessions.get(token);
    if (!session) {
        return res.status(401).json({ error: 'Invalid session token' });
    }
    if (Date.now() > session.expiresAt) {
        fieldSessions.delete(token);
        return res.status(401).json({ error: 'Session expired' });
    }
    const technician = fieldTechnicians.find((tech) => tech.techId === session.techId);
    if (!technician || technician.role !== 'field_technician') {
        return res.status(403).json({ error: 'Field technician access required' });
    }
    req.fieldSession = session;
    req.fieldTechnician = technician;
    return next();
}

function requireFieldRateLimit(req, res, next) {
    const key = req.fieldTechnician.techId;
    const now = Date.now();
    const bucket = fieldRequestBuckets.get(key);
    if (!bucket || now - bucket.windowStart > FIELD_RATE_LIMIT_WINDOW_MS) {
        fieldRequestBuckets.set(key, { count: 1, windowStart: now });
        return next();
    }
    if (bucket.count >= FIELD_RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Rate limit exceeded for field requests. Try again shortly.' });
    }
    bucket.count += 1;
    fieldRequestBuckets.set(key, bucket);
    return next();
}

function getAssignedJobOrError(req, res) {
    const job = fieldJobs.find((entry) => entry.id === req.params.jobId);
    if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return null;
    }
    if (job.assignedTo !== req.fieldTechnician.techId) {
        res.status(403).json({ error: 'Job is not assigned to this technician' });
        return null;
    }
    return job;
}

function createBreakdownAlert(overrides = {}) {
    const candidate = BREAKDOWN_LOCATIONS[Math.floor(Math.random() * BREAKDOWN_LOCATIONS.length)];
    const cause = BREAKDOWN_CAUSES[Math.floor(Math.random() * BREAKDOWN_CAUSES.length)];
    const lat = toNumber(overrides.lat, candidate.lat);
    const lng = toNumber(overrides.lng, candidate.lng);
    const distanceFromBase = Number(distanceMiles(LEHIGH_VALLEY_BASE.lat, LEHIGH_VALLEY_BASE.lng, lat, lng).toFixed(1));

    return {
        id: overrides.id || `BD-${Date.now()}`,
        timestamp: overrides.timestamp || new Date().toISOString(),
        channel: CHANNELS.BREAKDOWN_ALERTS,
        type: overrides.type || 'Breakdown Alert',
        priority: overrides.priority || (distanceFromBase <= 50 ? 'high' : 'normal'),
        vehicle: overrides.vehicle || `Tractor ${Math.floor(Math.random() * 900) + 100}`,
        location: overrides.location || candidate.name,
        lat,
        lng,
        cause: overrides.cause || cause,
        source: overrides.source || 'dispatch_console',
        sourceRef: overrides.sourceRef || '',
        radiusMiles: 150,
        base: LEHIGH_VALLEY_BASE,
        distanceFromBaseMiles: distanceFromBase
    };
}

function getBreakdownFeed(centerLat, centerLng, radiusMiles) {
    return eventBus[CHANNELS.BREAKDOWN_ALERTS]
        .filter((alert) => distanceMiles(centerLat, centerLng, alert.lat, alert.lng) <= radiusMiles)
        .map((alert) => ({
            ...alert,
            distanceMiles: Number(distanceMiles(centerLat, centerLng, alert.lat, alert.lng).toFixed(1))
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

loadDispatchHistory();
BREAKDOWN_LOCATIONS.forEach((location, index) => {
    bufferEvent(
        CHANNELS.BREAKDOWN_ALERTS,
        createBreakdownAlert({
            id: `BD-SEED-${index + 1}`,
            lat: location.lat,
            lng: location.lng,
            location: location.name,
            timestamp: new Date(Date.now() - (index + 1) * 120000).toISOString()
        })
    );
});

let automationTimers = [];

function startAutomationLoops() {
    if (automationTimers.length) {
        return;
    }
    automationTimers = [
        setInterval(() => {
            runAutomationDomain('dispatch');
        }, AUTOMATION_INTERVAL_MS.dispatch),
        setInterval(() => {
            runAutomationDomain('hrPayroll');
        }, AUTOMATION_INTERVAL_MS.hrPayroll),
        setInterval(() => {
            runAutomationDomain('systemOps');
        }, AUTOMATION_INTERVAL_MS.systemOps),
        setInterval(() => {
            runAutomationDomain('field');
        }, AUTOMATION_INTERVAL_MS.field),
        setInterval(() => {
            publishEvent(CHANNELS.BREAKDOWN_ALERTS, createBreakdownAlert());
        }, 10000)
    ];
}

function stopAutomationLoops() {
    automationTimers.forEach((timer) => clearInterval(timer));
    automationTimers = [];
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

app.get('/api/grace/calls/:callId', requireOperatorAuth, (req, res) => {
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
    const decision = validateScope({
      serviceCategory: call.intake.serviceCategory,
      vehicleType: call.intake.vehicleType,
      requestedWork: call.intake.requestedWork,
      issueDescription: call.intake.issueDescription
    });

    call.scopeDecision = decision;
    call.gates.scopeApproved = decision.approved;

    if (!decision.approved) {
      const rejectedStateEvent = recordStateEvent(call, 'scope_check_rejected', FLOW_STATES.SCOPE_REJECTED, { decision });
      audit(call, 'scope_check_rejected', rejectedStateEvent);
      persistCall(call);
      return res.status(422).json({
        success: false,
        callId: call.callId,
        state: call.state,
        scopeApproved: false,
        reasons: decision.reasons,
        outOfScope: true
      });
    }

    const stateEvent = transitionState(call, 'scope_check', { initiatedBy: 'grace' });
    audit(call, 'scope_check', { ...stateEvent, decision });
    persistCall(call);
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

    const estimate = generateEstimate({
      serviceCategory: req.body.serviceCategory || call.intake.serviceCategory,
      laborTier: req.body.laborTier,
      laborHours: req.body.laborHours,
      mileage: req.body.mileage,
      feeSchedule: req.body.feeSchedule
    });
    const stateEvent = transitionState(call, 'quote', { generatedBy: 'grace' });

    call.estimate = estimate;
    call.dispatch.estimateProvided = true;
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

app.post('/api/grace/estimate_approval', writeRateLimit, requireOperatorAuth, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    call.gates.pricingEstimateApprovedOrAccepted = true;
    audit(call, 'estimate_approval', { approvedBy: req.body.approvedBy || 'operator' });
    persistCall(call);
    return respondWithCall(res, call, { message: 'Estimate approved for downstream dispatch actions.' });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/payment_link', writeRateLimit, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    if (!call.gates.pricingEstimateApprovedOrAccepted) {
      return res.status(409).json({
        success: false,
        callId: call.callId,
        error: 'Estimate must be approved or accepted before payment-link generation.'
      });
    }
    const stateEvent = transitionState(call, 'payment_link', { providerType: 'pci-compliant' });
    const paymentLink = generateSecurePaymentLink(call.callId);
    call.paymentLink = paymentLink;
    audit(call, 'payment_link', { ...stateEvent, paymentLink });
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

app.post('/api/grace/technician_acceptance', writeRateLimit, requireOperatorAuth, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);

    const stateEvent = transitionState(call, 'technician_acceptance', { acceptedBy: 'operator' });
    call.gates.technicianAccepted = true;
    audit(call, 'technician_acceptance', stateEvent);
    persistCall(call);
    return respondWithCall(res, call, { message: 'Technician accepted assignment.' });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/grace/work_order_create', writeRateLimit, requireOperatorAuth, (req, res) => {
  try {
    const call = getCallOrThrow(req.body.callId);
    const effectiveGates = {
      ...call.gates,
      safetyCheckPassed: true
    };

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

    const stateEvent = transitionState(call, 'work_order_create', { approvedBy: 'operator' });
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

app.get('/api/system/health', (req, res) => {
    const memoryUsage = process.memoryUsage();
    res.json({
        uptimeSeconds: process.uptime(),
        apiLatencyMs: 0,
        errorRate: 0,
        memory: {
            rss: memoryUsage.rss,
            heapUsed: memoryUsage.heapUsed,
            heapTotal: memoryUsage.heapTotal
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/api/events/model', (req, res) => {
    res.json({
        channels: CHANNELS,
        retention: RETENTION,
        namingConvention: '{domain}.{stream}',
        dispatchPayloadSchema: {
            id: 'string',
            timestamp: 'ISO8601',
            channel: CHANNELS.DISPATCH,
            source: 'dispatch',
            type: 'Dispatched | En-route | Completed | Cancelled',
            priority: 'critical | high | normal | low',
            text: 'string',
            operator: 'string',
            mode: 'string'
        },
        breakdownPayloadSchema: {
            id: 'string',
            timestamp: 'ISO8601',
            channel: CHANNELS.BREAKDOWN_ALERTS,
            type: 'Breakdown Alert',
            priority: 'critical | high | normal',
            vehicle: 'string',
            location: 'string',
            lat: 'number',
            lng: 'number',
            cause: 'string',
            source: 'dispatch_console | field_dvir | telematics | manual_intake',
            sourceRef: 'string',
            distanceFromBaseMiles: 'number'
        },
        fieldJobPayloadSchema: {
            id: 'string',
            state: FIELD_JOB_STATES.join(' | '),
            diagnostics: 'string',
            workPerformed: 'string',
            partsUsed: 'string',
            laborMinutes: 'string',
            signaturePresent: 'boolean',
            photosCount: 'number'
        },
        fieldDvirPayloadSchema: {
            id: 'string',
            techId: 'string',
            vehicleId: 'string',
            odometer: 'string',
            defectsSummary: 'string',
            safeToOperate: 'boolean',
            outOfServiceReason: 'string?',
            lat: 'number',
            lng: 'number',
            submittedAt: 'ISO8601'
        }
    });
});

app.get('/api/dispatch/live', (req, res) => {
    res.json(getDispatchFeed());
});

app.get('/api/hr/live', (req, res) => {
    const limit = Math.min(Math.max(toNumber(req.query.limit, 100), 1), 500);
    res.json(
        eventBus[CHANNELS.HR_PAYROLL]
            .slice(-limit)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    );
});

app.get('/api/system/alerts/live', (req, res) => {
    const limit = Math.min(Math.max(toNumber(req.query.limit, 100), 1), 300);
    res.json(
        eventBus[CHANNELS.ALERTS]
            .slice(-limit)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    );
});

app.get('/api/automation/status', requireAdminAccess, adminOpsLimiter, requireAdminRateLimit, (req, res) => {
    res.json({
        intervalsMs: AUTOMATION_INTERVAL_MS,
        domains: automationState,
        eventBuffers: {
            dispatch: eventBus[CHANNELS.DISPATCH].length,
            hrPayroll: eventBus[CHANNELS.HR_PAYROLL].length,
            alerts: eventBus[CHANNELS.ALERTS].length,
            systemHealth: eventBus[CHANNELS.SYSTEM_HEALTH].length
        }
    });
});

app.post('/api/automation/run', requireAdminAccess, adminOpsLimiter, requireAdminRateLimit, (req, res) => {
    const domain = String(req.body.domain || 'all').trim();
    const supported = ['dispatch', 'hrPayroll', 'systemOps', 'field'];
    if (domain === 'all') {
        const result = supported.reduce((acc, item) => {
            acc[item] = runAutomationDomain(item);
            return acc;
        }, {});
        return res.json({ result });
    }
    if (!supported.includes(domain)) {
        return res.status(400).json({ error: 'Invalid automation domain', supported: ['all', ...supported] });
    }
    return res.json({ result: runAutomationDomain(domain) });
});

app.patch('/api/automation/config', requireAdminAccess, adminOpsLimiter, requireAdminRateLimit, (req, res) => {
    const requested = req.body || {};
    const mappings = {
        dispatch: 'dispatch',
        hrPayroll: 'hrPayroll',
        systemOps: 'systemOps',
        field: 'field'
    };
    Object.entries(mappings).forEach(([key, domain]) => {
        if (typeof requested[key] === 'boolean') {
            automationState[domain].enabled = requested[key];
        }
    });
    res.json({ domains: automationState });
});

app.get('/api/breakdowns/live', (req, res) => {
    const centerLat = toNumber(req.query.lat, LEHIGH_VALLEY_BASE.lat);
    const centerLng = toNumber(req.query.lng, LEHIGH_VALLEY_BASE.lng);
    const radiusMiles = Math.min(Math.max(toNumber(req.query.radius, 150), 10), 300);

    res.json({
        center: {
            lat: centerLat,
            lng: centerLng,
            radiusMiles
        },
        alerts: getBreakdownFeed(centerLat, centerLng, radiusMiles)
    });
});

app.post('/api/breakdowns/ingest', (req, res) => {
    if (!BREAKDOWN_INGEST_KEY) {
        return res.status(503).json({ error: 'Breakdown ingest is disabled until BREAKDOWN_INGEST_KEY is configured' });
    }
    const providedKey = String(req.headers['x-ingest-key'] || '').trim();
    if (!providedKey || providedKey !== BREAKDOWN_INGEST_KEY) {
        return res.status(401).json({ error: 'Invalid ingest key' });
    }

    const vehicle = String(req.body.vehicle || '').trim();
    const location = String(req.body.location || '').trim();
    const cause = String(req.body.cause || '').trim();
    const source = String(req.body.source || 'manual_intake').trim();
    const sourceRef = String(req.body.sourceRef || '').trim();
    const lat = toNumber(req.body.lat, Number.NaN);
    const lng = toNumber(req.body.lng, Number.NaN);

    const missing = [];
    if (!vehicle) missing.push('vehicle');
    if (!location) missing.push('location');
    if (!cause) missing.push('cause');
    if (!isValidCoordinates(lat, lng)) missing.push('valid lat/lng');
    if (missing.length) {
        return res.status(400).json({ error: 'Breakdown ingest blocked. Missing required fields.', missing });
    }

    const event = createBreakdownAlert({
        vehicle,
        location,
        cause,
        source,
        sourceRef,
        lat,
        lng,
        timestamp: toIsoTimestamp(req.body.timestamp),
        priority: String(req.body.priority || '').trim() || undefined
    });

    publishEvent(CHANNELS.BREAKDOWN_ALERTS, event);
    writeAuditEntry({
        actor: 'breakdown_ingest',
        action: 'breakdown_alert_ingested',
        channel: CHANNELS.BREAKDOWN_ALERTS,
        summary: `${event.vehicle} breakdown alert ingested from ${event.source}`,
        policy: 'multi_source_breakdown_monitoring'
    });

    return res.status(201).json({ alert: event });
});

app.get('/api/location/base', (req, res) => {
    res.json({
        base: LEHIGH_VALLEY_BASE,
        defaultRadiusMiles: 150
    });
});

app.post('/api/field/auth/login', fieldAuthLoginLimiter, requireFieldAuthRateLimit, (req, res) => {
    const techId = String(req.body.techId || '').trim();
    const pin = String(req.body.pin || '').trim();
    if (isLoginBlocked(req, techId)) {
        return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    const technician = fieldTechnicians.find((tech) => tech.techId === techId && tech.pin === pin);
    if (!technician) {
        markLoginFailure(req, techId);
        return res.status(401).json({ error: 'Invalid technician credentials' });
    }

    clearLoginFailures(req, techId);
    const token = createFieldToken(technician.techId);
    const expiresAt = Date.now() + FIELD_SESSION_TTL_MS;
    fieldSessions.set(token, {
        techId: technician.techId,
        role: technician.role,
        expiresAt,
        issuedAt: Date.now(),
        userAgent: String(req.headers['user-agent'] || 'unknown-agent')
    });

    writeAuditEntry({
        actor: technician.techId,
        action: 'field_login',
        channel: 'field.jobs',
        summary: 'Technician authenticated on mobile app',
        policy: 'short_lived_device_session'
    });

    return res.json({
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        technician: {
            techId: technician.techId,
            name: technician.name,
            role: technician.role
        }
    });
});

app.post('/api/field/auth/logout', requireFieldTechnician, (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    fieldSessions.delete(token);
    writeAuditEntry({
        actor: req.fieldTechnician.techId,
        action: 'field_logout',
        channel: 'field.jobs',
        summary: 'Technician logged out from mobile app',
        policy: 'session_revoked'
    });
    res.json({ success: true });
});

app.get('/api/field/jobs', requireFieldTechnician, requireFieldRateLimit, (req, res) => {
    const jobs = fieldJobs
        .filter((job) => job.assignedTo === req.fieldTechnician.techId)
        .map((job) => sanitizeFieldJob(job));
    res.json({
        technician: { techId: req.fieldTechnician.techId, name: req.fieldTechnician.name },
        jobs
    });
});

app.get('/api/field/policy', requireFieldTechnician, requireFieldRateLimit, (req, res) => {
    res.json({
        role: 'field_technician',
        allowed: [
            'job acceptance and workflow state updates',
            'navigation and location proof',
            'diagnostics, parts/labor notes, photos, signature',
            'job completion submission',
            'DVIR inspection submission and history'
        ],
        denied: [
            'payroll administration',
            'billing controls',
            'system configuration',
            'mastersuite governance endpoints',
            'company secrets and codes'
        ]
    });
});

app.get('/api/field/security/session', requireFieldTechnician, requireFieldRateLimit, (req, res) => {
    const ttlMs = Math.max(req.fieldSession.expiresAt - Date.now(), 0);
    res.json({
        role: req.fieldTechnician.role,
        tokenTtlMinutes: Math.ceil(ttlMs / 60000),
        sessionExpiry: new Date(req.fieldSession.expiresAt).toISOString(),
        policy: 'field_service_only'
    });
});

app.get('/api/field/dvir', requireFieldTechnician, requireFieldRateLimit, (req, res) => {
    const limit = Math.min(Math.max(toNumber(req.query.limit, 25), 1), 100);
    const reports = readFieldDvirReports()
        .filter((report) => report.techId === req.fieldTechnician.techId)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
        .slice(0, limit);
    res.json({ reports });
});

app.post('/api/field/dvir', requireFieldTechnician, requireFieldRateLimit, (req, res) => {
    const vehicleId = String(req.body.vehicleId || '').trim();
    const odometer = String(req.body.odometer || '').trim();
    const defectsSummary = String(req.body.defectsSummary || '').trim();
    const safeToOperate = req.body.safeToOperate === true || req.body.safeToOperate === 'true';
    const outOfServiceReason = String(req.body.outOfServiceReason || '').trim();
    const lat = toNumber(req.body.lat, Number.NaN);
    const lng = toNumber(req.body.lng, Number.NaN);
    const submittedAt = toIsoTimestamp(req.body.submittedAt);

    const missing = [];
    if (!vehicleId) missing.push('vehicleId');
    if (!odometer) missing.push('odometer');
    if (!defectsSummary) missing.push('defectsSummary');
    if (!isValidCoordinates(lat, lng)) missing.push('valid GPS coordinates');
    if (!safeToOperate && !outOfServiceReason) missing.push('outOfServiceReason');

    if (missing.length) {
        return res.status(400).json({ error: 'DVIR submission blocked. Missing required fields.', missing });
    }

    const reports = readFieldDvirReports();
    const report = {
        id: `DVIR-${Date.now()}`,
        techId: req.fieldTechnician.techId,
        technicianName: req.fieldTechnician.name,
        vehicleId,
        odometer,
        defectsSummary,
        safeToOperate,
        outOfServiceReason: safeToOperate ? '' : outOfServiceReason,
        lat,
        lng,
        submittedAt
    };
    reports.push(report);
    writeFieldDvirReports(reports);

    writeAuditEntry({
        actor: req.fieldTechnician.techId,
        action: 'field_dvir_submitted',
        channel: 'field.dvir',
        summary: `${report.vehicleId} DVIR submitted`,
        policy: 'field_dvir_required'
    });

    if (!report.safeToOperate) {
        const breakdownEvent = createBreakdownAlert({
            vehicle: report.vehicleId,
            location: `DVIR reported location (${report.lat}, ${report.lng})`,
            cause: report.outOfServiceReason || report.defectsSummary,
            source: 'field_dvir',
            sourceRef: report.id,
            lat: report.lat,
            lng: report.lng,
            timestamp: report.submittedAt,
            priority: 'high'
        });
        publishEvent(CHANNELS.BREAKDOWN_ALERTS, breakdownEvent);
        writeAuditEntry({
            actor: req.fieldTechnician.techId,
            action: 'field_dvir_breakdown_alert',
            channel: CHANNELS.BREAKDOWN_ALERTS,
            summary: `${report.vehicleId} unsafe DVIR emitted breakdown alert`,
            policy: 'dvir_to_breakdown_escalation'
        });
    }

    notifyTeamsEvent({
        title: '🧾 Field DVIR Submitted',
        text: `${req.fieldTechnician.name} submitted DVIR for ${report.vehicleId}`,
        sections: [
            {
                facts: [
                    { name: 'Safe to operate', value: report.safeToOperate ? 'Yes' : 'No' },
                    { name: 'Odometer', value: report.odometer },
                    { name: 'Submitted', value: report.submittedAt }
                ]
            }
        ]
    });

    return res.status(201).json({ report });
});

app.patch('/api/field/jobs/:jobId/state', requireFieldTechnician, requireFieldRateLimit, (req, res) => {
    const job = getAssignedJobOrError(req, res);
    if (!job) {
        return;
    }
    const nextState = String(req.body.state || '').trim();
    const lat = toNumber(req.body.lat, Number.NaN);
    const lng = toNumber(req.body.lng, Number.NaN);
    const timestamp = toIsoTimestamp(req.body.timestamp);

    if (!FIELD_JOB_STATES.includes(nextState)) {
        return res.status(400).json({ error: 'Invalid state value' });
    }
    if (!FIELD_STATE_TRANSITIONS[job.state].includes(nextState)) {
        return res.status(400).json({ error: `Invalid transition from ${job.state} to ${nextState}` });
    }
    if (!isValidCoordinates(lat, lng)) {
        return res.status(400).json({ error: 'Valid GPS coordinates are required for state transitions' });
    }

    job.state = nextState;
    job.stateProof[nextState] = { timestamp, lat, lng };

    if (nextState === 'En Route') {
        job.acceptedAt = job.acceptedAt || timestamp;
        job.enRouteAt = timestamp;
    }
    if (nextState === 'On Scene') {
        job.onSceneAt = timestamp;
    }
    if (nextState === 'Work In Progress') {
        job.workStartedAt = timestamp;
    }
    if (nextState === 'Completed') {
        job.completedAt = timestamp;
    }

    writeAuditEntry({
        actor: req.fieldTechnician.techId,
        action: 'field_state_update',
        channel: 'field.jobs',
        summary: `${job.id} moved to ${nextState}`,
        policy: 'gps_and_timestamp_required'
    });

    return res.json({ job: sanitizeFieldJob(job) });
});

app.patch('/api/field/jobs/:jobId/proof', requireFieldTechnician, requireFieldRateLimit, (req, res) => {
    const job = getAssignedJobOrError(req, res);
    if (!job) {
        return;
    }
    const diagnostics = String(req.body.diagnostics || '').trim();
    const workPerformed = String(req.body.workPerformed || '').trim();
    const partsUsed = String(req.body.partsUsed || '').trim();
    const laborMinutes = String(req.body.laborMinutes || '').trim();
    const signature = String(req.body.signature || '').trim();
    const photos = Array.isArray(req.body.photos) ? req.body.photos.map((item) => String(item).trim()).filter(Boolean) : [];

    if (diagnostics) job.diagnostics = diagnostics;
    if (workPerformed) job.workPerformed = workPerformed;
    if (partsUsed) job.partsUsed = partsUsed;
    if (laborMinutes) job.laborMinutes = laborMinutes;
    if (signature) job.signature = signature;
    if (photos.length > 0) {
        job.photos = photos.slice(0, 10);
    }

    writeAuditEntry({
        actor: req.fieldTechnician.techId,
        action: 'field_proof_update',
        channel: 'field.jobs',
        summary: `${job.id} proof data updated`,
        policy: 'field_completion_evidence'
    });

    return res.json({ job: sanitizeFieldJob(job) });
});

app.post('/api/field/jobs/:jobId/complete', requireFieldTechnician, requireFieldRateLimit, (req, res) => {
    const job = getAssignedJobOrError(req, res);
    if (!job) {
        return;
    }
    const requiredMissing = [];
    if (job.state !== 'Work In Progress') requiredMissing.push('state must be Work In Progress before completion');
    if (!job.diagnostics) requiredMissing.push('diagnostics');
    if (!job.workPerformed) requiredMissing.push('workPerformed');
    if (!job.partsUsed) requiredMissing.push('partsUsed');
    if (!job.laborMinutes) requiredMissing.push('laborMinutes');
    if (!job.signature) requiredMissing.push('signature');
    if (!job.photos.length) requiredMissing.push('at least one photo');

    const completionLat = toNumber(req.body.lat, Number.NaN);
    const completionLng = toNumber(req.body.lng, Number.NaN);
    if (!isValidCoordinates(completionLat, completionLng)) {
        requiredMissing.push('valid completion GPS');
    }

    if (requiredMissing.length) {
        return res.status(400).json({
            error: 'Completion blocked. Required fields missing.',
            missing: requiredMissing
        });
    }

    const completedAt = toIsoTimestamp(req.body.timestamp);
    job.state = 'Completed';
    job.completedAt = completedAt;
    job.stateProof.Completed = {
        timestamp: completedAt,
        lat: completionLat,
        lng: completionLng
    };

    writeAuditEntry({
        actor: req.fieldTechnician.techId,
        action: 'field_job_completed',
        channel: 'field.jobs',
        summary: `${job.id} completed with required evidence`,
        policy: 'completion_proof_enforced'
    });

    notifyTeamsEvent({
        title: '✅ Field Job Completed',
        text: `${job.id} completed by ${req.fieldTechnician.name}`,
        sections: [
            {
                facts: [
                    { name: 'Customer', value: job.customer },
                    { name: 'Unit', value: job.unit },
                    { name: 'Location', value: job.location.label }
                ]
            }
        ]
    });

    return res.json({ job: sanitizeFieldJob(job) });
});

app.get('/api/mastersuite/contracts', (req, res) => {
    res.json({
        qualityStandards: {
            visual: ['high-contrast readability', 'semantic status colors', 'consistent spacing and typography'],
            technical: ['contract-first events', 'domain ownership boundaries', 'feature-flag rollout safety'],
            operational: ['audit trail for high-impact actions', 'SLO enforcement visibility', 'incident-ready observability']
        },
        acceptanceCriteria: {
            ux: ['operator can identify critical alert in < 2 seconds', 'role-based views prevent irrelevant data clutter'],
            architecture: ['all live streams follow {domain}.{stream}', 'domain metadata declared in one source of truth'],
            performance: ['apiLatencyP95Ms <= 250', 'eventDeliveryP95Ms <= 1200', 'uptimeTargetPercent >= 99.9']
        },
        domains: DOMAIN_BASELINE,
        roleBoundaries: ROLE_BOUNDARIES
    });
});

app.get('/api/mastersuite/feature-flags', (req, res) => {
    res.json({
        flags: FEATURE_FLAGS,
        stagedRollout: [
            { stage: 'pilot', enabled: ['monitor_dispatch'] },
            { stage: 'phase_1', enabled: ['monitor_fleet', 'monitor_hr_payroll'] },
            { stage: 'phase_2', enabled: ['monitor_billing', 'monitor_compliance', 'monitor_ai_insights'] }
        ]
    });
});

app.get('/api/mastersuite/observability', (req, res) => {
    const dispatchEvents = eventBus[CHANNELS.DISPATCH].length;
    res.json({
        slos: SLO_POLICY,
        telemetry: {
            dispatchEventsBuffered: dispatchEvents,
            auditEventsBuffered: auditTrail.length,
            tracesEnabled: true,
            logsEnabled: true,
            metricsEnabled: true
        },
        regressionGates: ['frontend-build', 'backend-syntax-check', 'codeql-security-scan']
    });
});

app.get('/api/mastersuite/audit', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const safeLimit = Math.min(Math.max(limit, 1), 250);
    res.json(auditTrail.slice(-safeLimit).reverse());
});

app.get('/api/mastersuite/kpis', (req, res) => {
    const uptimeSeconds = process.uptime();
    const dispatchCount = eventBus[CHANNELS.DISPATCH].length;
    const cancelledCount = eventBus[CHANNELS.DISPATCH].filter((item) => item.type === 'Cancelled').length;
    const cancellationRate = dispatchCount ? Number((cancelledCount / dispatchCount).toFixed(4)) : 0;
    res.json({
        eventDelayMs: 820,
        droppedMessages: 0,
        meanResponseMinutes: 28,
        alertAckSecondsP95: 140,
        cancellationRate,
        uptimeSeconds
    });
});

app.get('/api/integrations/teams/status', requireAdminAccess, adminOpsLimiter, requireAdminRateLimit, (req, res) => {
    res.json(sanitizeTeamsStatus());
});

app.post('/api/integrations/teams/test', requireAdminAccess, adminOpsLimiter, requireAdminRateLimit, (req, res) => {
    sendTeamsMessage({
        title: '🧪 Grace Teams Integration Test',
        text: 'Microsoft Teams integration test triggered from MasterSuite.',
        sections: [
            {
                facts: [
                    { name: 'Environment', value: process.env.NODE_ENV || 'development' },
                    { name: 'Timestamp', value: new Date().toISOString() }
                ]
            }
        ]
    })
        .then((result) => res.json({ success: true, ...result, status: sanitizeTeamsStatus() }))
        .catch((error) =>
            res.status(500).json({
                success: false,
                error: error.message,
                status: sanitizeTeamsStatus()
            })
        );
});

app.get('/api/security/posture', requireAdminAccess, adminOpsLimiter, requireAdminRateLimit, (req, res) => {
    cleanupExpiredFieldSessions();
    res.json({
        headers: {
            nosniff: true,
            frameGuard: 'SAMEORIGIN',
            referrerPolicy: 'strict-origin-when-cross-origin',
            permissionsPolicy: 'geolocation=(self), microphone=(self)'
        },
        fieldAuth: {
            tokenTtlHours: FIELD_SESSION_TTL_MS / (1000 * 60 * 60),
            loginWindowMinutes: FIELD_LOGIN_WINDOW_MS / (1000 * 60),
            loginMaxAttempts: FIELD_LOGIN_MAX_ATTEMPTS,
            activeSessions: fieldSessions.size
        },
        controls: [
            'field role-only endpoint guard',
            'gps-required state updates',
            'proof-required completion',
            'dvir-required fields',
            'audit trail for field actions'
        ]
    });
});

io.on('connection', (socket) => {
    const lastSeen =
        socket.handshake.auth?.lastSeen ||
        socket.handshake.query?.lastSeen ||
        socket.handshake.headers['x-last-seen-event'];

    const replay = getReplaySince(CHANNELS.DISPATCH, lastSeen);
    if (replay.length > 0) {
        socket.emit('dispatch.replay', replay);
    }
    socket.emit('dispatch.snapshot', getDispatchFeed().slice(-80));
});

function startServer() {
    if (server.listening) {
        return server;
    }
    return server.listen(PORT, () => {
        startAutomationLoops();
        console.log('=======================================================');
        console.log(`⚡ GRACE MASTER HUB ONLINE - PORT ${PORT}`);
        console.log('📍 OPERATING BASE: LEHIGH VALLEY, PA (150-MILE RADAR LIVE)');
        console.log('=======================================================');
    });
}

server.on('close', () => {
    stopAutomationLoops();
});
server.on('error', () => {
    stopAutomationLoops();
});

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    server,
    startServer,
    runAutomationDomain
};
