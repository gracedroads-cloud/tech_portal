const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const DispatchStorage = require('./data/storage');
const apiKeyAuth = require('./utils/apiAuth');
const { operationsAccess } = require('./utils/apiAuth');
const { transcribeAudioBuffer, parseInspectionMetrics } = require('./utils/voiceTranscription');
const RagEngine = require('./automation/ragEngine');
const { analyzePartImage } = require('./utils/visionAnalyzer');
const { getTrafficStatus } = require('./utils/trafficStatus');
const { interpretMasterCommand } = require('./utils/masterCommands');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const dispatchStorage = new DispatchStorage();
const ragEngine = new RagEngine(dispatchStorage.getDatabase());
const voiceUpload = multer({
    limits: { fileSize: 5 * 1024 * 1024 },
    storage: multer.memoryStorage()
});
const visionUpload = multer({
    limits: { fileSize: 10 * 1024 * 1024 },
    storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.get('/operations.html', operationsAccess, (req, res) => {
    try {
        res.type('html').send(fs.readFileSync(path.join(__dirname, 'public', 'operations.html'), 'utf8'));
    } catch (error) {
        console.error('Unable to serve Operations Wall:', error);
        res.status(500).json({ success: false, error: 'Unable to load the Operations Wall.' });
    }
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use('/api', apiKeyAuth);

const eventClients = new Set();
function broadcastEvent(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    eventClients.forEach(client => client.write(message));
}

function toBreakdown(record) {
    const input = Array.isArray(record.input) ? record.input[0] || {} : record.input || {};
    const output = record.output || {};
    const latitude = toFiniteNumber(output.latitude ?? input.latitude);
    const longitude = toFiniteNumber(output.longitude ?? input.longitude);
    const priority = Number(output.priority ?? input.priority ?? 2);

    return {
        id: record.id,
        carrier: output.billing?.carrierAccount || input.carrier || 'STANDARD FLEET',
        vehicle: input.vehicle || input.asset || 'Fleet asset not recorded',
        cause: input.cause || input.userQuestion || input.issue || 'Service request',
        location: output.location || output.breakdownLocation || input.location || input.breakdownLocation || 'Location not recorded',
        priority: Number.isInteger(priority) ? priority : 2,
        latitude,
        longitude,
        timestamp: record.timestamp
    };
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function distanceInMiles(fromLatitude, fromLongitude, toLatitude, toLongitude) {
    const earthRadiusMiles = 3958.8;
    const toRadians = degrees => degrees * (Math.PI / 180);
    const deltaLatitude = toRadians(toLatitude - fromLatitude);
    const deltaLongitude = toRadians(toLongitude - fromLongitude);
    const a = Math.sin(deltaLatitude / 2) ** 2 +
        Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude)) *
        Math.sin(deltaLongitude / 2) ** 2;
    return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.get('/healthz', (req, res) => {
    res.status(200).json({
        service: 'Grace Dispatch Console',
        status: 'ok',
        uptimeSeconds: Math.floor(process.uptime())
    });
});

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

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

app.get('/api/automation/logs', (req, res) => {
    try {
        res.json({ success: true, logs: dispatchStorage.getRecent() });
    } catch (error) {
        console.error('Error reading automation logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/operations/live', operationsAccess, async (req, res) => {
    try {
        const [traffic, logs] = await Promise.all([
            getTrafficStatus(),
            Promise.resolve(dispatchStorage.getRecent(100))
        ]);
        res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            dispatches: logs,
            traffic
        });
    } catch (error) {
        console.error('Error reading live operations data:', error);
        res.status(500).json({ success: false, error: 'Unable to load live operations data.' });
    }
});

app.get('/api/master/status', async (req, res) => {
    try {
        const [traffic, recentDispatches, predictiveInsights] = await Promise.all([
            getTrafficStatus(),
            Promise.resolve(dispatchStorage.getRecent(100)),
            Promise.resolve(dispatchStorage.getPredictiveMaintenanceInsights())
        ]);
        res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            system: {
                status: 'ONLINE',
                uptimeSeconds: Math.floor(process.uptime()),
                sseClients: eventClients.size
            },
            modules: {
                dispatches: { status: 'ONLINE', count: recentDispatches.length },
                dvir: { status: 'ONLINE' },
                billingCompliance: { status: 'ONLINE' },
                voiceLogging: { status: process.env.WHISPER_API_KEY ? 'CONFIGURED' : 'DEVELOPMENT_MODE' },
                oemRag: { status: 'ONLINE' },
                vision: { status: process.env.VISION_ANALYZER_URL ? 'CONFIGURED' : 'DEVELOPMENT_MODE' },
                predictiveMaintenance: { status: 'ONLINE', insights: predictiveInsights.length },
                offlineSync: { status: 'CLIENT_MANAGED' },
                traffic
            }
        });
    } catch (error) {
        console.error('Error reading master status:', error);
        res.status(500).json({ success: false, error: 'Unable to load master system status.' });
    }
});

app.post('/api/master/commands', (req, res) => {
    const { command } = req.body || {};
    if (typeof command !== 'string' || command.trim().length === 0 || command.length > 500) {
        res.status(400).json({ success: false, error: 'A command between 1 and 500 characters is required.' });
        return;
    }

    res.json({
        success: true,
        command: interpretMasterCommand(command)
    });
});

app.get('/api/breakdowns/scanner', operationsAccess, (req, res) => {
    try {
        const breakdowns = dispatchStorage.getRecent(100).map(toBreakdown).map(breakdown => ({
            ...breakdown,
            issue: breakdown.cause,
            severity: String(breakdown.priority)
        }));
        res.json({ success: true, source: 'saved dispatch activity', breakdowns });
    } catch (error) {
        console.error('Error reading breakdown activity:', error);
        res.status(500).json({ success: false, error: 'Unable to load breakdown activity.' });
    }
});

app.get('/api/breakdowns/live', operationsAccess, (req, res) => {
    try {
        const baseLatitude = toFiniteNumber(req.query.latitude);
        const baseLongitude = toFiniteNumber(req.query.longitude);
        const requestedRadius = req.query.radius === undefined ? 150 : toFiniteNumber(req.query.radius);
        if (!Number.isFinite(requestedRadius) || requestedRadius <= 0 || requestedRadius > 500) {
            res.status(400).json({ success: false, error: 'Radius must be between 1 and 500 miles.' });
            return;
        }
        if ((baseLatitude === null) !== (baseLongitude === null)) {
            res.status(400).json({ success: false, error: 'Both latitude and longitude are required for radius filtering.' });
            return;
        }
        if (baseLatitude !== null && (Math.abs(baseLatitude) > 90 || Math.abs(baseLongitude) > 180)) {
            res.status(400).json({ success: false, error: 'Base coordinates are out of range.' });
            return;
        }

        const breakdowns = dispatchStorage.getRecent(500).map(toBreakdown).map(breakdown => {
            if (baseLatitude === null || breakdown.latitude === null || breakdown.longitude === null) {
                return { ...breakdown, distanceMiles: null };
            }
            return {
                ...breakdown,
                distanceMiles: Math.round(distanceInMiles(baseLatitude, baseLongitude, breakdown.latitude, breakdown.longitude) * 10) / 10
            };
        }).filter(breakdown => baseLatitude === null || (
            breakdown.distanceMiles !== null && breakdown.distanceMiles <= requestedRadius
        )).sort((left, right) => left.priority - right.priority || new Date(right.timestamp) - new Date(left.timestamp));

        res.json({
            success: true,
            source: 'real dispatch intake and saved dispatch activity',
            radiusMiles: requestedRadius,
            baseLocation: baseLatitude === null ? null : { latitude: baseLatitude, longitude: baseLongitude },
            breakdowns
        });
    } catch (error) {
        console.error('Error reading live breakdowns:', error);
        res.status(500).json({ success: false, error: 'Unable to load live breakdown activity.' });
    }
});

app.post('/api/breakdowns/intake', (req, res) => {
    try {
        const { carrier, vehicle, location, cause, priority = 2, latitude, longitude } = req.body || {};
        if (typeof location !== 'string' || location.trim() === '' || typeof cause !== 'string' || cause.trim() === '') {
            res.status(400).json({ success: false, error: 'Breakdown location and cause are required.' });
            return;
        }
        const normalizedPriority = Number(priority);
        const normalizedLatitude = latitude === undefined ? null : toFiniteNumber(latitude);
        const normalizedLongitude = longitude === undefined ? null : toFiniteNumber(longitude);
        if (!Number.isInteger(normalizedPriority) || normalizedPriority < 1 || normalizedPriority > 5) {
            res.status(400).json({ success: false, error: 'Priority must be an integer from 1 through 5.' });
            return;
        }
        if ((normalizedLatitude === null) !== (normalizedLongitude === null) ||
            (normalizedLatitude !== null && (Math.abs(normalizedLatitude) > 90 || Math.abs(normalizedLongitude) > 180))) {
            res.status(400).json({ success: false, error: 'Provide valid latitude and longitude together, or omit both.' });
            return;
        }

        const record = dispatchStorage.append({
            id: `BREAKDOWN-${Date.now()}`,
            timestamp: new Date().toISOString(),
            status: 'open',
            input: {
                carrier: typeof carrier === 'string' && carrier.trim() ? carrier.trim() : 'STANDARD FLEET',
                vehicle: typeof vehicle === 'string' ? vehicle.trim() : '',
                location: location.trim(),
                cause: cause.trim(),
                userQuestion: cause.trim(),
                priority: normalizedPriority,
                latitude: normalizedLatitude,
                longitude: normalizedLongitude
            },
            output: {
                location: location.trim(),
                priority: normalizedPriority,
                latitude: normalizedLatitude,
                longitude: normalizedLongitude
            }
        });
        res.status(201).json({ success: true, record: toBreakdown(record) });
    } catch (error) {
        console.error('Error creating breakdown intake:', error);
        res.status(500).json({ success: false, error: 'Unable to save breakdown intake.' });
    }
});

app.get('/api/events', (req, res) => {
    res.status(200);
    res.set({
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
});

app.get('/api/operations/events', operationsAccess, (req, res) => {
    res.status(200);
    res.set({
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
});

app.post('/api/automation/logs/:id/inspection', (req, res) => {
    try {
        const record = dispatchStorage.attachInspection(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Inspection saved to dispatch record', record });
    } catch (error) {
        console.error('Error saving dispatch inspection:', error);
        const status = error.message.startsWith('Dispatch record not found') ? 404 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

function handleVoiceUpload(req, res, next) {
    voiceUpload.single('audio')(req, res, error => {
        if (!error) {
            next();
            return;
        }

        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        res.status(status).json({
            success: false,
            error: error.code === 'LIMIT_FILE_SIZE'
                ? 'Audio payload exceeds the 5 MB limit.'
                : `Audio upload failed: ${error.message}`
        });
    });
}

app.post('/api/voice/transcribe-draft', handleVoiceUpload, async (req, res) => {
    if (!req.file || !req.file.buffer) {
        res.status(400).json({ success: false, error: 'Audio payload is required.' });
        return;
    }
    if (!req.file.mimetype.startsWith('audio/')) {
        req.file.buffer.fill(0);
        res.status(400).json({ success: false, error: 'Only audio uploads are accepted.' });
        return;
    }

    try {
        const transcript = await transcribeAudioBuffer(req.file.buffer, req.file.mimetype);
        res.json({
            success: true,
            status: 'DRAFT_READY',
            transcript,
            draftMetrics: parseInspectionMetrics(transcript)
        });
    } catch (error) {
        console.error('Voice transcription error:', error);
        res.status(502).json({ success: false, error: 'Unable to transcribe the voice note.' });
    } finally {
        req.file.buffer.fill(0);
    }
});

app.post('/api/voice/commit-dvir', (req, res) => {
    try {
        const { dispatchId, transcript, metrics } = req.body;
        if (typeof dispatchId !== 'string' || dispatchId.trim() === '') {
            res.status(400).json({ success: false, error: 'A completed dispatch ID is required.' });
            return;
        }
        if (typeof transcript !== 'string' || !metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
            res.status(400).json({ success: false, error: 'Reviewed transcript and metrics are required.' });
            return;
        }

        const record = dispatchStorage.attachInspection(dispatchId, {
            brakePadMeasurements: metrics.brakePadThickness || '',
            pushRodTravel: metrics.pushRodTravel || '',
            tireTreadDepths: metrics.tireTreadDepth || '',
            fluidLeakCheck: metrics.fluidContainmentAlert || '',
            notes: metrics.notes || '',
            voiceTranscript: transcript,
            reviewSource: 'voice'
        });
        res.status(200).json({ success: true, status: 'COMMITTED', record });
    } catch (error) {
        console.error('Voice DVIR commit error:', error);
        const status = error.message.startsWith('Dispatch record not found') ? 404 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

function handleVisionUpload(req, res, next) {
    visionUpload.single('partImage')(req, res, error => {
        if (!error) {
            next();
            return;
        }

        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        res.status(status).json({
            success: false,
            error: error.code === 'LIMIT_FILE_SIZE'
                ? 'Image payload exceeds the 10 MB limit.'
                : `Image upload failed: ${error.message}`
        });
    });
}

app.post('/api/vision/analyze-part', handleVisionUpload, async (req, res) => {
    if (!req.file || !req.file.buffer) {
        res.status(400).json({ success: false, error: 'Part image is required.' });
        return;
    }
    if (!req.file.mimetype.startsWith('image/')) {
        req.file.buffer.fill(0);
        res.status(400).json({ success: false, error: 'Only image uploads are accepted.' });
        return;
    }

    try {
        const analysis = await analyzePartImage(req.file.buffer, req.file.mimetype);
        res.json({ success: true, status: 'SUCCESS', analysis });
    } catch (error) {
        console.error('Vision analysis error:', error);
        res.status(502).json({ success: false, error: 'Unable to analyze the part image.' });
    } finally {
        req.file.buffer.fill(0);
    }
});

app.post('/api/rag/query', (req, res) => {
    try {
        const { faultCode = '', symptom = '' } = req.body || {};
        const query = `${faultCode} ${symptom}`.trim();
        if (!query) {
            res.status(400).json({ success: false, error: 'A fault code or symptom is required.' });
            return;
        }

        const oemReferences = ragEngine.search(query);
        res.json({
            success: true,
            status: 'SUCCESS',
            query,
            oemReferences: oemReferences.length > 0
                ? oemReferences
                : [{
                    source_manual: 'General Commercial Fleet Standards',
                    chunk_text: 'No indexed OEM manual section matched this query. Follow standard PA commercial roadside triage protocol.',
                    page_number: 1
                }]
        });
    } catch (error) {
        console.error('OEM manual retrieval error:', error);
        res.status(500).json({ success: false, error: 'Unable to retrieve OEM manual references.' });
    }
});

app.get('/api/analytics/predictive-maintenance', (req, res) => {
    try {
        res.json({
            success: true,
            status: 'SUCCESS',
            predictiveInsights: dispatchStorage.getPredictiveMaintenanceInsights()
        });
    } catch (error) {
        console.error('Predictive maintenance analytics error:', error);
        res.status(500).json({ success: false, error: 'Unable to generate predictive maintenance analytics.' });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        status: 'ONLINE',
        base: 'Lehigh Valley, PA',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

dispatchStorage.on('dispatch:created', record => broadcastEvent('dispatch-created', { id: record.id }));
dispatchStorage.on('dispatch:updated', record => broadcastEvent('dispatch-updated', { id: record.id }));

module.exports = { app, PORT, dispatchStorage, ragEngine };
