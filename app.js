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
    FLEET: 'fleet.telemetry',
    HR_PAYROLL: 'hr.payroll.activity',
    ALERTS: 'system.alerts',
    SYSTEM_HEALTH: 'system.health'
});

const RETENTION = Object.freeze({
    [CHANNELS.DISPATCH]: 500,
    [CHANNELS.FLEET]: 500,
    [CHANNELS.HR_PAYROLL]: 500,
    [CHANNELS.ALERTS]: 300,
    [CHANNELS.SYSTEM_HEALTH]: 300
});

const eventBus = {
    [CHANNELS.DISPATCH]: [],
    [CHANNELS.FLEET]: [],
    [CHANNELS.HR_PAYROLL]: [],
    [CHANNELS.ALERTS]: [],
    [CHANNELS.SYSTEM_HEALTH]: []
};

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

loadDispatchHistory();

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
        }
    });
});

app.get('/api/dispatch/live', (req, res) => {
    res.json(getDispatchFeed());
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