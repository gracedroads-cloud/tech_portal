const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

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
const fieldSessions = new Map();
const fieldLoginAttempts = new Map();
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
app.use(express.static(__dirname)); // Serves root-level files like index.html

// Ensure local data directory exists for JSON backups
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dispatchLogsPath = path.join(__dirname, 'radio_dispatch_logs.json');
const fieldDvirPath = path.join(dataDir, 'field_dvir_reports.json');
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
    io.emit(channel, event);
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
        logs.forEach((log) => publishEvent(CHANNELS.DISPATCH, createDispatchEvent(log)));
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
    publishEvent(
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

let simulatedStatusIndex = 0;
const simulatedStatuses = ['Dispatched', 'En-route', 'Completed', 'Cancelled'];
setInterval(() => {
    simulatedStatusIndex = (simulatedStatusIndex + 1) % simulatedStatuses.length;
    const status = simulatedStatuses[simulatedStatusIndex];
    publishEvent(CHANNELS.DISPATCH, {
        id: `SIM-${Date.now()}`,
        timestamp: new Date().toISOString(),
        channel: CHANNELS.DISPATCH,
        source: 'dispatch',
        type: status,
        priority: getPriority(status),
        text: `Grace Operations — ${status} update received for live command-center monitor.`,
        operator: 'Grace Operations',
        mode: 'Live Monitor Stream'
    });
}, 8000);

setInterval(() => {
    publishEvent(CHANNELS.BREAKDOWN_ALERTS, createBreakdownAlert());
}, 10000);

// DVIR API Endpoint
app.post('/api/dvir', (req, res) => {
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
        timestamp: new Date().toISOString()
    });
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

app.get('/api/location/base', (req, res) => {
    res.json({
        base: LEHIGH_VALLEY_BASE,
        defaultRadiusMiles: 150
    });
});

app.post('/api/field/auth/login', (req, res) => {
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

app.get('/api/field/jobs', requireFieldTechnician, (req, res) => {
    const jobs = fieldJobs
        .filter((job) => job.assignedTo === req.fieldTechnician.techId)
        .map((job) => sanitizeFieldJob(job));
    res.json({
        technician: { techId: req.fieldTechnician.techId, name: req.fieldTechnician.name },
        jobs
    });
});

app.get('/api/field/policy', requireFieldTechnician, (req, res) => {
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

app.get('/api/field/security/session', requireFieldTechnician, (req, res) => {
    const ttlMs = Math.max(req.fieldSession.expiresAt - Date.now(), 0);
    res.json({
        role: req.fieldTechnician.role,
        tokenTtlMinutes: Math.ceil(ttlMs / 60000),
        sessionExpiry: new Date(req.fieldSession.expiresAt).toISOString(),
        policy: 'field_service_only'
    });
});

app.get('/api/field/dvir', requireFieldTechnician, (req, res) => {
    const limit = Math.min(Math.max(toNumber(req.query.limit, 25), 1), 100);
    const reports = readFieldDvirReports()
        .filter((report) => report.techId === req.fieldTechnician.techId)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
        .slice(0, limit);
    res.json({ reports });
});

app.post('/api/field/dvir', requireFieldTechnician, (req, res) => {
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

    return res.status(201).json({ report });
});

app.patch('/api/field/jobs/:jobId/state', requireFieldTechnician, (req, res) => {
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

app.patch('/api/field/jobs/:jobId/proof', requireFieldTechnician, (req, res) => {
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

app.post('/api/field/jobs/:jobId/complete', requireFieldTechnician, (req, res) => {
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

app.get('/api/security/posture', (req, res) => {
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

// Start Server
server.listen(PORT, () => {
    console.log('=======================================================');
    console.log(`⚡ GRACE MASTER HUB ONLINE - PORT ${PORT}`);
    console.log('📍 OPERATING BASE: LEHIGH VALLEY, PA (150-MILE RADAR LIVE)');
    console.log('=======================================================');
});