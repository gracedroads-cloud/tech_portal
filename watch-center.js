const EARTH_RADIUS_MILES = 3958.7613;
const DEFAULT_WATCH_CENTER_RADIUS_MILES = Number(process.env.WATCH_CENTER_RADIUS_MILES || 150);
const DEFAULT_WATCH_CENTER_STALE_MS = Number(process.env.WATCH_CENTER_STALE_MS || 5 * 60 * 1000);
const LEHIGH_VALLEY_FALLBACK_CENTER = {
    label: 'Lehigh Valley',
    latitude: Number(process.env.LEHIGH_VALLEY_LAT || 40.6259),
    longitude: Number(process.env.LEHIGH_VALLEY_LNG || -75.3705)
};

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function normalizeCoordinate(name, value, min, max) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw new Error(`Invalid ${name}.`);
    }

    return parsed;
}

function isValidCoordinate(latitude, longitude) {
    try {
        normalizeCoordinate('latitude', latitude, -90, 90);
        normalizeCoordinate('longitude', longitude, -180, 180);
        return true;
    } catch (error) {
        return false;
    }
}

function normalizeRecordedAt(recordedAt, now) {
    if (recordedAt === undefined || recordedAt === null || recordedAt === '') {
        return now();
    }

    const parsed = typeof recordedAt === 'number' ? recordedAt : Date.parse(recordedAt);

    if (!Number.isFinite(parsed)) {
        throw new Error('Invalid recordedAt timestamp.');
    }

    return parsed;
}

function haversineMiles(origin, destination) {
    const originLat = normalizeCoordinate('latitude', origin.latitude, -90, 90);
    const originLng = normalizeCoordinate('longitude', origin.longitude, -180, 180);
    const destinationLat = normalizeCoordinate('latitude', destination.latitude, -90, 90);
    const destinationLng = normalizeCoordinate('longitude', destination.longitude, -180, 180);

    const latDelta = toRadians(destinationLat - originLat);
    const lngDelta = toRadians(destinationLng - originLng);
    const a =
        Math.sin(latDelta / 2) ** 2 +
        Math.cos(toRadians(originLat)) *
            Math.cos(toRadians(destinationLat)) *
            Math.sin(lngDelta / 2) ** 2;

    return 2 * EARTH_RADIUS_MILES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTimestamp(timestampMs) {
    return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
}

function createWatchCenterStore({
    fallbackCenter = LEHIGH_VALLEY_FALLBACK_CENTER,
    radiusMiles = DEFAULT_WATCH_CENTER_RADIUS_MILES,
    staleMs = DEFAULT_WATCH_CENTER_STALE_MS,
    now = Date.now
} = {}) {
    let liveLocation = null;

    function getLiveAge(referenceTimeMs) {
        return liveLocation ? Math.max(0, referenceTimeMs - liveLocation.recordedAt) : null;
    }

    function hasFreshLiveLocation(referenceTimeMs) {
        return Boolean(liveLocation && getLiveAge(referenceTimeMs) <= staleMs);
    }

    function buildSnapshot(referenceTimeMs) {
        const usingLiveGps = hasFreshLiveLocation(referenceTimeMs);
        const activeCenter = usingLiveGps ? liveLocation : fallbackCenter;
        const sourceMode = usingLiveGps ? 'live_gps' : 'lehigh_valley_fallback';
        const freshnessMs = getLiveAge(referenceTimeMs);
        const gpsFreshness = usingLiveGps
            ? 'fresh'
            : liveLocation
                ? 'stale'
                : 'unavailable';

        return {
            radiusMiles,
            latitude: activeCenter.latitude,
            longitude: activeCenter.longitude,
            sourceMode,
            lastUpdateTimestamp: formatTimestamp(liveLocation ? liveLocation.recordedAt : null),
            gpsFreshness,
            freshnessMs,
            fallbackState: sourceMode === 'live_gps' ? 'standby' : 'active',
            staleAfterMs: staleMs,
            baseLabel: fallbackCenter.label,
            watchCenterLabel: sourceMode === 'live_gps' ? 'Live GPS' : `${fallbackCenter.label} fallback`
        };
    }

    return {
        getCenter(referenceTimeMs = now()) {
            return buildSnapshot(referenceTimeMs);
        },
        updateLiveLocation({ latitude, longitude, recordedAt } = {}) {
            liveLocation = {
                latitude: normalizeCoordinate('latitude', latitude, -90, 90),
                longitude: normalizeCoordinate('longitude', longitude, -180, 180),
                recordedAt: normalizeRecordedAt(recordedAt, now)
            };

            return buildSnapshot(now());
        },
        filterBreakdowns(breakdowns, referenceTimeMs = now()) {
            const watchCenter = buildSnapshot(referenceTimeMs);
            const filteredBreakdowns = breakdowns
                .map((breakdown) => {
                    const distanceMiles = haversineMiles(watchCenter, breakdown);

                    return {
                        ...breakdown,
                        distanceMiles,
                        distance: `${distanceMiles.toFixed(1)} mi`
                    };
                })
                .filter((breakdown) => breakdown.distanceMiles <= radiusMiles)
                .sort((left, right) => left.distanceMiles - right.distanceMiles);

            return {
                watchCenter,
                breakdowns: filteredBreakdowns
            };
        }
    };
}

module.exports = {
    DEFAULT_WATCH_CENTER_RADIUS_MILES,
    DEFAULT_WATCH_CENTER_STALE_MS,
    LEHIGH_VALLEY_FALLBACK_CENTER,
    createWatchCenterStore,
    haversineMiles,
    isValidCoordinate
};
