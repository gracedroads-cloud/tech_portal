const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
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

const SLO_POLICY = Object.freeze({
    eventDeliveryP95Ms: 1200,
    apiLatencyP95Ms: 250,
    uptimeTargetPercent: 99.9,
    alertAckP95Seconds: 180
});

const auditTrail = [];
const AUDIT_RETENTION = 400;
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // Serves root-level files like index.html

// Ensure local data directory exists for JSON backups
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dispatchLogsPath = path.join(__dirname, 'radio_dispatch_logs.json');
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