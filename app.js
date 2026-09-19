const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { GraceDispatchStore } = require('./grace-dispatch');

const PORT = process.env.PORT || 3000;

// Ensure local data directory exists for JSON backups
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function createApp(options = {}) {
    const app = express();
    const activeDataDir = options.dataDir || dataDir;
    if (!fs.existsSync(activeDataDir)) {
        fs.mkdirSync(activeDataDir, { recursive: true });
    }
    const graceDispatch = new GraceDispatchStore({
        dataDir: activeDataDir,
        seedDemoCall: options.seedDemoCall !== false
    });

    const breakdownFeed = [
        {
            id: 'BD-201',
            vehicle: '2021 Freightliner Cascadia',
            issue: 'No-start heavy-duty diesel diagnostics',
            location: 'US-22 near Bethlehem, PA',
            distance: '14 mi',
            severity: 'ACTIVE'
        },
        {
            id: 'BD-202',
            vehicle: '53ft commercial trailer',
            issue: 'Air line repair for heavy trailer circuit',
            location: 'I-78 near Easton, PA',
            distance: '22 mi',
            severity: 'READY'
        },
        {
            id: 'BD-203',
            vehicle: 'Class 8 service truck',
            issue: 'Battery and charging-system roadside repair',
            location: 'PA-33 freight connector',
            distance: '31 mi',
            severity: 'ACTIVE'
        }
    ];

    let streamControl = 'grace_ai_handling';
    const dvirWritesByIp = new Map();
    const dvirWindowMs = 60 * 1000;
    const dvirMaxWritesPerWindow = 10;

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cors());
    app.use(express.static(path.join(__dirname, 'public')));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.get('/index.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.get('/no_tow_authorization.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'no_tow_authorization.html'));
    });

    function applyDvirRateLimit(req, res, next) {
        const now = Date.now();
        const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const attempts = (dvirWritesByIp.get(key) || []).filter((time) => now - time < dvirWindowMs);

        if (attempts.length >= dvirMaxWritesPerWindow) {
            res.status(429).json({
                success: false,
                error: 'DVIR write rate limit exceeded. Please retry in a minute.'
            });
            return;
        }

        attempts.push(now);
        dvirWritesByIp.set(key, attempts);
        next();
    }

    app.post('/api/dvir', applyDvirRateLimit, (req, res) => {
        try {
            const dvirData = req.body;
            const filePath = path.join(activeDataDir, `dvir_${Date.now()}.json`);
            fs.writeFileSync(filePath, JSON.stringify(dvirData, null, 2));
            res.status(200).json({ success: true, message: 'DVIR record saved successfully', file: filePath });
        } catch (error) {
            console.error('Error saving DVIR:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/breakdowns/scanner', (req, res) => {
        res.json({
            base: 'Lehigh Valley, PA',
            radiusMiles: Number(req.query.radius || 150),
            breakdowns: breakdownFeed
        });
    });

    app.post('/api/stream/override', (req, res) => {
        const action = req.body.action === 'pickup' ? 'human_operator_override' : 'grace_ai_handling';
        streamControl = action;
        res.json({
            ok: true,
            action,
            lineStatus: streamControl
        });
    });

    app.get('/api/grace/calls/active', (req, res) => {
        res.json({
            ok: true,
            calls: graceDispatch.getActiveCalls(),
            summary: graceDispatch.getSummary()
        });
    });

    app.get('/api/grace/call/:callId', (req, res) => {
        try {
            const call = graceDispatch.serializeCall(graceDispatch.getCall(req.params.callId));
            res.json({
                ok: true,
                call,
                summary: graceDispatch.getSummary()
            });
        } catch (error) {
            res.status(error.statusCode || 500).json({
                ok: false,
                error: error.message,
                details: error.details || null
            });
        }
    });

    app.get('/api/grace/call/:callId/audit', (req, res) => {
        try {
            const call = graceDispatch.serializeCall(graceDispatch.getCall(req.params.callId));
            res.json({
                ok: true,
                callId: call.id,
                auditLog: call.auditLog
            });
        } catch (error) {
            res.status(error.statusCode || 500).json({
                ok: false,
                error: error.message,
                details: error.details || null
            });
        }
    });

    function respondWithCall(res, call, statusCode = 200) {
        res.status(statusCode).json({
            ok: true,
            call: graceDispatch.serializeCall(call),
            summary: graceDispatch.getSummary()
        });
    }

    function handleGraceTransition(res, action, statusCode = 200) {
        try {
            const call = action();
            respondWithCall(res, call, statusCode);
        } catch (error) {
            res.status(error.statusCode || 500).json({
                ok: false,
                error: error.message,
                details: error.details || null
            });
        }
    }

    app.post('/api/grace/call/answer', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.answer(req.body), 201);
    });

    app.post('/api/grace/call/intake', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.intake(req.body));
    });

    app.post('/api/grace/call/scope-check', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.scopeCheck(req.body));
    });

    app.post('/api/grace/call/quote', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.quote(req.body));
    });

    app.post('/api/grace/call/payment-link', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.paymentLink(req.body));
    });

    app.post('/api/grace/call/technician-offer', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.technicianOffer(req.body));
    });

    app.post('/api/grace/call/technician-acceptance', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.technicianAcceptance(req.body));
    });

    app.post('/api/grace/call/work-order', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.workOrder(req.body));
    });

    app.post('/api/grace/call/closeout', (req, res) => {
        handleGraceTransition(res, () => graceDispatch.closeout(req.body));
    });

    // System Status / Breakdown Ticker Endpoint
    app.get('/api/status', (req, res) => {
        res.json({
            status: 'ONLINE',
            base: 'Lehigh Valley, PA',
            port: PORT,
            streamControl,
            graceSummary: graceDispatch.getSummary(),
            timestamp: new Date().toISOString()
        });
    });

    return app;
}

const app = createApp({
    seedDemoCall: require.main === module
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('=======================================================');
        console.log(`⚡ GRACE MASTER HUB ONLINE - PORT ${PORT}`);
        console.log('📍 OPERATING BASE: LEHIGH VALLEY, PA (150-MILE RADAR LIVE)');
        console.log('=======================================================');
    });
}

module.exports = {
    app,
    createApp
};