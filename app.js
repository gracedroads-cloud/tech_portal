const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const HUB_COORDINATES = { latitude: 40.6884, longitude: -75.2207 };
const BREAKDOWN_INGEST_TOKEN = (process.env.BREAKDOWN_INGEST_TOKEN || process.env.VR_INGEST_TOKEN || '').trim();
const ALLOWED_BREAKDOWN_SOURCES = new Set(['dispatch', 'dvir', 'manual', 'telematics', 'vehicle_repair', 'system']);
const ALLOWED_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

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

const breakdownsPath = path.join(dataDir, 'breakdowns_live.json');

function loadJsonArray(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }

        const raw = fs.readFileSync(filePath, 'utf8').trim();
        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error(`Error loading JSON array from ${filePath}:`, error);
        return [];
    }
}

const breakdownAlerts = loadJsonArray(breakdownsPath);

function persistJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeText(value, maxLength = 180) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeSeverity(value) {
    const normalized = normalizeText(value, 20).toUpperCase();
    return ALLOWED_SEVERITIES.has(normalized) ? normalized : 'HIGH';
}

function normalizeTimestamp(value) {
    const parsed = value ? new Date(value) : new Date();
    if (Number.isNaN(parsed.getTime())) {
        return new Date().toISOString();
    }

    return parsed.toISOString();
}

function normalizeSourceType(value, fallback = 'manual') {
    const sourceType = normalizeText(value, 40).toLowerCase().replace(/\s+/g, '_');
    return ALLOWED_BREAKDOWN_SOURCES.has(sourceType) ? sourceType : fallback;
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'y', '1'].includes(normalized)) {
            return true;
        }
        if (['false', 'no', 'n', '0'].includes(normalized)) {
            return false;
        }
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    return null;
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinates(payload) {
    const coordinates = payload && typeof payload.coordinates === 'object' ? payload.coordinates : {};
    const latitude = toNumber(
        coordinates.latitude ?? coordinates.lat ?? payload.latitude ?? payload.lat
    );
    const longitude = toNumber(
        coordinates.longitude ?? coordinates.lng ?? coordinates.lon ?? coordinates.long ?? payload.longitude ?? payload.lng ?? payload.lon ?? payload.long
    );

    if (latitude === null || longitude === null) {
        return null;
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return null;
    }

    return {
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6))
    };
}

function formatCoordinateLocation(coordinates) {
    if (!coordinates) {
        return '';
    }

    return `${coordinates.latitude}, ${coordinates.longitude}`;
}

function normalizeLocation(payload, coordinates) {
    const location = normalizeText(
        payload.location ||
        payload.locationDescription ||
        payload.sceneLocation ||
        payload.currentLocation ||
        payload.gpsLocation,
        240
    );

    return location || formatCoordinateLocation(coordinates);
}

function normalizeVehicle(payload) {
    return normalizeText(
        payload.vehicle ||
        payload.unit ||
        payload.asset ||
        payload.truck ||
        payload.tractor ||
        payload.vehicleId,
        120
    );
}

function normalizeIssue(payload) {
    const defects = Array.isArray(payload.defects)
        ? payload.defects.map((defect) => normalizeText(defect, 120)).filter(Boolean)
        : [];

    const textIssue = normalizeText(
        payload.issue ||
        payload.reason ||
        payload.defect ||
        payload.defectDescription ||
        payload.outOfServiceReason ||
        payload.notes,
        240
    );

    return defects.length > 0 ? defects.join('; ') : textIssue;
}

function normalizeTechnician(payload) {
    return normalizeText(
        payload.technician ||
        payload.technicianName ||
        payload.driver ||
        payload.operator ||
        payload.submittedBy,
        120
    );
}

function haversineMiles(start, end) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const earthRadiusMiles = 3958.8;
    const latitudeDelta = toRadians(end.latitude - start.latitude);
    const longitudeDelta = toRadians(end.longitude - start.longitude);
    const startLatitude = toRadians(start.latitude);
    const endLatitude = toRadians(end.latitude);

    const a = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(startLatitude) * Math.cos(endLatitude) *
        Math.sin(longitudeDelta / 2) ** 2;

    return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(coordinates) {
    if (!coordinates) {
        return 'UNKNOWN';
    }

    return `${haversineMiles(HUB_COORDINATES, coordinates).toFixed(1)} MI`;
}

function buildDuplicateKey({ vehicle, issue, location, sourceType }) {
    return [
        vehicle.toLowerCase(),
        issue.toLowerCase(),
        location.toLowerCase(),
        sourceType.toLowerCase()
    ].join('|');
}

function findRecentDuplicate(candidate) {
    const duplicateKey = buildDuplicateKey(candidate);
    const candidateTime = new Date(candidate.timestamp).getTime();
    const duplicateWindowMs = 15 * 60 * 1000;

    return breakdownAlerts.find((existingAlert) => {
        const existingKey = buildDuplicateKey({
            vehicle: existingAlert.vehicle || '',
            issue: existingAlert.issue || '',
            location: existingAlert.location || '',
            sourceType: existingAlert.sourceType || existingAlert.source || 'dispatch'
        });
        const existingTime = new Date(existingAlert.timestamp).getTime();

        return existingKey === duplicateKey &&
            Number.isFinite(existingTime) &&
            Math.abs(candidateTime - existingTime) <= duplicateWindowMs;
    });
}

function createBreakdownAlert(payload, options = {}) {
    const coordinates = parseCoordinates(payload);
    const sourceType = normalizeSourceType(payload.sourceType || payload.source, options.defaultSourceType || 'manual');
    const vehicle = normalizeVehicle(payload);
    const issue = normalizeIssue(payload);
    const location = normalizeLocation(payload, coordinates);
    const technician = normalizeTechnician(payload);
    const timestamp = normalizeTimestamp(payload.timestamp);
    const severity = normalizeSeverity(payload.severity);

    const errors = [];
    if (!vehicle) {
        errors.push('vehicle is required');
    }
    if (!issue) {
        errors.push('issue or defect description is required');
    }
    if (!location) {
        errors.push('location or coordinates are required');
    }
    if (errors.length > 0) {
        return { errors };
    }

    const alert = {
        id: `BD-${Date.now()}`,
        vehicle,
        issue,
        location,
        severity,
        timestamp,
        technician: technician || null,
        source: sourceType,
        sourceType,
        alertType: sourceType === 'vehicle_repair' ? 'vehicle_repair' : 'breakdown',
        coordinates,
        distance: formatDistance(coordinates)
    };

    if (payload.reportedBy || payload.operator) {
        alert.reportedBy = normalizeText(payload.reportedBy || payload.operator, 120);
    }

    if (payload.status) {
        alert.status = normalizeText(payload.status, 60);
    }

    return { alert };
}

function storeBreakdownAlert(alert) {
    breakdownAlerts.unshift(alert);
    if (breakdownAlerts.length > 100) {
        breakdownAlerts.length = 100;
    }
    persistJson(breakdownsPath, breakdownAlerts);
    return alert;
}

function getBreakdownScan(radiusMiles) {
    return breakdownAlerts
        .filter((alert) => {
            if (!radiusMiles || !alert.coordinates) {
                return true;
            }

            const distanceValue = haversineMiles(HUB_COORDINATES, alert.coordinates);
            return distanceValue <= radiusMiles;
        })
        .sort((left, right) => {
            if (left.coordinates && right.coordinates) {
                return haversineMiles(HUB_COORDINATES, left.coordinates) - haversineMiles(HUB_COORDINATES, right.coordinates);
            }

            return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
        });
}

function readIngestToken(req) {
    const authorization = req.get('authorization') || '';
    if (authorization.toLowerCase().startsWith('bearer ')) {
        return authorization.slice(7).trim();
    }

    return (req.get('x-breakdown-token') || '').trim();
}

function requireBreakdownIngestAuth(req, res, next) {
    if (!BREAKDOWN_INGEST_TOKEN) {
        return res.status(503).json({
            success: false,
            error: 'Breakdown ingestion is unavailable until BREAKDOWN_INGEST_TOKEN is configured.'
        });
    }

    if (readIngestToken(req) !== BREAKDOWN_INGEST_TOKEN) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized breakdown ingestion request.'
        });
    }

    return next();
}

// DVIR API Endpoint
app.post('/api/dvir', (req, res) => {
    try {
        const dvirData = req.body || {};
        const filePath = path.join(dataDir, `dvir_${Date.now()}.json`);
        fs.writeFileSync(filePath, JSON.stringify(dvirData, null, 2));

        let breakdownAlert = null;
        const warnings = [];
        const safeToOperate = normalizeBoolean(dvirData.safeToOperate);

        if (safeToOperate === false) {
            const alertResult = createBreakdownAlert(
                {
                    ...dvirData,
                    issue: normalizeIssue(dvirData),
                    source: 'dvir',
                    sourceType: 'dvir',
                    severity: dvirData.severity || 'CRITICAL'
                },
                { defaultSourceType: 'dvir' }
            );

            if (alertResult.errors) {
                warnings.push(`Unsafe DVIR was saved but no breakdown alert was created: ${alertResult.errors.join(', ')}`);
            } else {
                const duplicate = findRecentDuplicate(alertResult.alert);
                if (duplicate) {
                    warnings.push(`Unsafe DVIR matched existing breakdown alert ${duplicate.id}; duplicate alert was not created.`);
                    breakdownAlert = duplicate;
                } else {
                    breakdownAlert = storeBreakdownAlert(alertResult.alert);
                }
            }
        }

        res.status(200).json({
            success: true,
            message: 'DVIR record saved successfully',
            file: filePath,
            breakdownAlertPublished: safeToOperate === false && Boolean(breakdownAlert),
            breakdownAlert,
            warnings
        });
    } catch (error) {
        console.error('Error saving DVIR:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/breakdowns/ingest', requireBreakdownIngestAuth, (req, res) => {
    try {
        const payload = req.body || {};
        const requestedSource = normalizeSourceType(payload.sourceType || payload.source, 'manual');

        if (requestedSource === 'dispatch') {
            return res.status(400).json({
                success: false,
                error: 'Use a non-dispatch sourceType for vehicle-repair or operator/system alert ingestion.'
            });
        }

        const alertResult = createBreakdownAlert(payload, { defaultSourceType: requestedSource });
        if (alertResult.errors) {
            return res.status(400).json({
                success: false,
                error: 'Invalid breakdown alert payload.',
                details: alertResult.errors
            });
        }

        const duplicate = findRecentDuplicate(alertResult.alert);
        if (duplicate) {
            return res.status(200).json({
                success: true,
                duplicate: true,
                message: `Breakdown alert already exists as ${duplicate.id}.`,
                breakdown: duplicate
            });
        }

        const alert = storeBreakdownAlert(alertResult.alert);
        return res.status(201).json({
            success: true,
            message: 'Breakdown alert ingested successfully.',
            breakdown: alert
        });
    } catch (error) {
        console.error('Error ingesting breakdown alert:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/breakdowns/live', (req, res) => {
    res.json({
        success: true,
        count: breakdownAlerts.length,
        breakdowns: breakdownAlerts
    });
});

app.get('/api/breakdowns/scanner', (req, res) => {
    const requestedRadius = toNumber(req.query.radius);
    const radius = requestedRadius && requestedRadius > 0 ? requestedRadius : null;
    const breakdowns = getBreakdownScan(radius);

    res.json({
        success: true,
        radius: radius || 'ALL',
        hub: {
            base: 'Easton, PA',
            coordinates: HUB_COORDINATES
        },
        count: breakdowns.length,
        breakdowns
    });
});

app.get('/api/breakdowns/schema', (req, res) => {
    res.json({
        success: true,
        channel: 'breakdowns.live',
        version: '1.1',
        sourceTypes: Array.from(ALLOWED_BREAKDOWN_SOURCES),
        fields: {
            id: 'string',
            vehicle: 'string',
            issue: 'string',
            location: 'string',
            severity: 'LOW | MEDIUM | HIGH | CRITICAL',
            timestamp: 'ISO-8601 string',
            technician: 'string | null',
            source: 'string (legacy-compatible alias of sourceType)',
            sourceType: 'dispatch | dvir | manual | telematics | vehicle_repair | system',
            alertType: 'breakdown | vehicle_repair',
            coordinates: '{ latitude: number, longitude: number } | null',
            distance: 'string'
        },
        backwardCompatibility: {
            existingClientsCanContinueUsing: ['id', 'vehicle', 'issue', 'location', 'severity', 'distance', 'timestamp'],
            sourceDefaultsTo: 'dispatch when absent in older alert consumers'
        }
    });
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

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('=======================================================');
        console.log(`⚡ GRACE MASTER HUB ONLINE - PORT ${PORT}`);
        console.log('📍 OPERATING BASE: LEHIGH VALLEY, PA (150-MILE RADAR LIVE)');
        console.log('=======================================================');
    });
}

module.exports = app;
