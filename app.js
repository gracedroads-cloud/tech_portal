const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const {
    DEFAULT_WATCH_CENTER_RADIUS_MILES,
    DEFAULT_WATCH_CENTER_STALE_MS,
    LEHIGH_VALLEY_FALLBACK_CENTER,
    createWatchCenterStore
} = require('./watch-center');

const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const WATCH_CENTER_OPERATOR_TOKEN = process.env.WATCH_CENTER_OPERATOR_TOKEN || null;
const WATCH_CENTER_RADIUS_MILES = Number(process.env.WATCH_CENTER_RADIUS_MILES || DEFAULT_WATCH_CENTER_RADIUS_MILES);
const WATCH_CENTER_STALE_MS = Number(process.env.WATCH_CENTER_STALE_MS || DEFAULT_WATCH_CENTER_STALE_MS);
const LEHIGH_VALLEY_CENTER = {
    ...LEHIGH_VALLEY_FALLBACK_CENTER,
    latitude: Number(process.env.LEHIGH_VALLEY_LAT || LEHIGH_VALLEY_FALLBACK_CENTER.latitude),
    longitude: Number(process.env.LEHIGH_VALLEY_LNG || LEHIGH_VALLEY_FALLBACK_CENTER.longitude)
};

const BREAKDOWN_FEED = [
    {
        id: 'BD-101',
        vehicle: 'Freightliner Cascadia',
        issue: 'Blown Type 30/30 Brake Chamber',
        location: 'I-78 West MM 49.2 near Fogelsville',
        corridor: 'I-78 WEST • MM 49.2',
        latitude: 40.5667,
        longitude: -75.6317,
        severity: 'HIGH',
        quoteRate: '$0.00'
    },
    {
        id: 'BD-214',
        vehicle: 'Kenworth T680',
        issue: 'Trailer belly-line air leak',
        location: 'I-78 East MM 71 near Bethlehem',
        corridor: 'I-78 EAST • MM 71',
        latitude: 40.6514,
        longitude: -75.3557,
        severity: 'MEDIUM',
        quoteRate: '$150.00/hr'
    },
    {
        id: 'BD-330',
        vehicle: 'Volvo VNL 760',
        issue: 'Starter circuit no-crank diagnosis',
        location: 'Carlisle Pike freight yard',
        corridor: 'YARD LOT',
        latitude: 40.201,
        longitude: -77.1881,
        severity: 'LOW',
        quoteRate: '$175.00'
    },
    {
        id: 'BD-901',
        vehicle: 'Peterbilt 579',
        issue: 'DEF dosing fault',
        location: 'Richmond, VA freight corridor',
        corridor: 'OUT OF FILTER',
        latitude: 37.5407,
        longitude: -77.436,
        severity: 'HIGH',
        quoteRate: '$250.00'
    }
];

function ensureDataDir() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function createRateLimit({ windowMs, maxRequests }) {
    return rateLimit({
        windowMs,
        limit: maxRequests,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { success: false, error: 'Too many requests. Please try again shortly.' }
    });
}

function requireOperatorAuth(expectedToken) {
    return (req, res, next) => {
        if (!expectedToken) {
            return res.status(503).json({ success: false, error: 'Watch-center operator authorization is not configured.' });
        }

        const authorizationHeader = req.get('authorization') || '';
        const providedToken = authorizationHeader.startsWith('Bearer ')
            ? authorizationHeader.slice('Bearer '.length).trim()
            : '';

        if (!providedToken) {
            return res.status(401).json({ success: false, error: 'Operator authorization is required.' });
        }

        if (providedToken !== expectedToken) {
            return res.status(403).json({ success: false, error: 'Operator authorization is invalid.' });
        }

        return next();
    };
}

function createApp({ now = Date.now, operatorToken = WATCH_CENTER_OPERATOR_TOKEN } = {}) {
    ensureDataDir();

    const app = express();
    const pageReadRateLimit = createRateLimit({ windowMs: 60 * 1000, maxRequests: 120 });
    const apiWriteRateLimit = createRateLimit({ windowMs: 60 * 1000, maxRequests: 20 });
    const watchCenterStore = createWatchCenterStore({
        fallbackCenter: LEHIGH_VALLEY_CENTER,
        radiusMiles: WATCH_CENTER_RADIUS_MILES,
        staleMs: WATCH_CENTER_STALE_MS,
        now
    });

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cors());
    app.use(express.static(path.join(__dirname, 'public')));
    app.get('/', pageReadRateLimit, (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });
    app.get('/index.html', pageReadRateLimit, (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });
    app.get('/no_tow_authorization.html', pageReadRateLimit, (req, res) => {
        res.sendFile(path.join(__dirname, 'no_tow_authorization.html'));
    });

    app.post('/api/dvir', apiWriteRateLimit, (req, res) => {
        try {
            const dvirData = req.body;
            const filePath = path.join(dataDir, `dvir_${now()}_${randomUUID()}.json`);
            fs.writeFileSync(filePath, JSON.stringify(dvirData, null, 2));
            res.status(200).json({ success: true, message: 'DVIR record saved successfully', file: filePath });
        } catch (error) {
            console.error('Error saving DVIR:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/status', (req, res) => {
        res.json({
            status: 'ONLINE',
            base: 'Based in Lehigh Valley',
            service: 'mobile diesel repair for tractor-trailers and heavy-duty trucks',
            port: req.socket && req.socket.localPort ? req.socket.localPort : PORT,
            timestamp: new Date(now()).toISOString(),
            watchCenter: watchCenterStore.getCenter(now())
        });
    });

    app.get('/api/watch-center', (req, res) => {
        res.json(watchCenterStore.getCenter(now()));
    });

    app.post('/api/watch-center/location', apiWriteRateLimit, requireOperatorAuth(operatorToken), (req, res) => {
        try {
            const watchCenter = watchCenterStore.updateLiveLocation({
                latitude: req.body.latitude,
                longitude: req.body.longitude,
                recordedAt: req.body.recordedAt
            });

            res.status(200).json({ success: true, watchCenter });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    app.get('/api/breakdowns/scanner', (req, res) => {
        const { watchCenter, breakdowns } = watchCenterStore.filterBreakdowns(BREAKDOWN_FEED, now());

        res.json({
            radiusMiles: watchCenter.radiusMiles,
            watchCenter,
            breakdowns,
            timestamp: new Date(now()).toISOString()
        });
    });

    app.post('/api/stream/override', apiWriteRateLimit, (req, res) => {
        res.json({
            success: true,
            action: req.body.action || 'noop',
            timestamp: new Date(now()).toISOString()
        });
    });

    return {
        app,
        watchCenterStore
    };
}

function createServer(options = {}) {
    const { app } = createApp(options);
    const port = options.port || PORT;

    return app.listen(port, () => {
        console.log('=======================================================');
        console.log(`⚡ GRACE MASTER HUB ONLINE - PORT ${port}`);
        console.log(`🏢 BASED IN ${LEHIGH_VALLEY_CENTER.label.toUpperCase()} - ${WATCH_CENTER_RADIUS_MILES}-MILE WATCH FILTER READY`);
        console.log('=======================================================');
    });
}

if (require.main === module) {
    createServer();
}

module.exports = {
    BREAKDOWN_FEED,
    createApp,
    createServer,
    LEHIGH_VALLEY_CENTER,
    WATCH_CENTER_OPERATOR_TOKEN,
    WATCH_CENTER_RADIUS_MILES,
    WATCH_CENTER_STALE_MS
};
