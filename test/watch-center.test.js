const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp, LEHIGH_VALLEY_CENTER } = require('../app');
const { createWatchCenterStore, haversineMiles, isValidCoordinate } = require('../watch-center');

async function withServer(options, callback) {
    const { app } = createApp(options);
    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address();

    try {
        await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('haversine distance and 150-mile boundary behavior use the active watch center', () => {
    const store = createWatchCenterStore({
        fallbackCenter: LEHIGH_VALLEY_CENTER,
        radiusMiles: 150,
        staleMs: 5 * 60 * 1000,
        now: () => Date.parse('2026-09-19T18:00:00.000Z')
    });
    const insideBoundary = {
        id: 'inside',
        latitude: LEHIGH_VALLEY_CENTER.latitude + (149 / 69.172),
        longitude: LEHIGH_VALLEY_CENTER.longitude
    };
    const outsideBoundary = {
        id: 'outside',
        latitude: LEHIGH_VALLEY_CENTER.latitude + (151 / 69.172),
        longitude: LEHIGH_VALLEY_CENTER.longitude
    };
    const invalidBreakdown = {
        id: 'invalid',
        latitude: 999,
        longitude: LEHIGH_VALLEY_CENTER.longitude
    };

    assert.ok(haversineMiles(LEHIGH_VALLEY_CENTER, insideBoundary) < 150, 'expected inside point to be within 150 miles');
    assert.ok(haversineMiles(LEHIGH_VALLEY_CENTER, outsideBoundary) > 150, 'expected outside point to be beyond 150 miles');

    const filtered = store.filterBreakdowns([insideBoundary, outsideBoundary, invalidBreakdown]);

    assert.equal(filtered.watchCenter.sourceMode, 'lehigh_valley_fallback');
    assert.deepEqual(filtered.breakdowns.map((breakdown) => breakdown.id), ['inside']);
    assert.match(filtered.breakdowns[0].distance, /mi$/);
});

test('coordinate validation rejects invalid latitude and longitude values', () => {
    assert.equal(isValidCoordinate(40.5, -75.4), true);
    assert.equal(isValidCoordinate(95, -75.4), false);
    assert.equal(isValidCoordinate(40.5, -190), false);
});

test('watch-center API rejects invalid coordinates for authorized updates', async () => {
    await withServer({ operatorToken: 'test-token' }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/watch-center/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': ['Bearer', 'test-token'].join(' ')
            },
            body: JSON.stringify({ latitude: 120, longitude: -75.3 })
        });
        const payload = await response.json();

        assert.equal(response.status, 400);
        assert.equal(payload.success, false);
        assert.match(payload.error, /Invalid latitude/);
    });
});

test('watch-center API enforces operator authorization branches', async () => {
    await withServer({ operatorToken: 'test-token' }, async (baseUrl) => {
        let response = await fetch(`${baseUrl}/api/watch-center/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: 40.7, longitude: -75.1 })
        });
        let payload = await response.json();

        assert.equal(response.status, 401);
        assert.match(payload.error, /required/);

        response = await fetch(`${baseUrl}/api/watch-center/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': ['Bearer', 'wrong-token'].join(' ')
            },
            body: JSON.stringify({ latitude: 40.7, longitude: -75.1 })
        });
        payload = await response.json();

        assert.equal(response.status, 403);
        assert.match(payload.error, /invalid/);
    });

    await withServer({ operatorToken: null }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/watch-center/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': ['Bearer', 'test-token'].join(' ')
            },
            body: JSON.stringify({ latitude: 40.7, longitude: -75.1 })
        });
        const payload = await response.json();

        assert.equal(response.status, 503);
        assert.match(payload.error, /not configured/);
    });
});

test('watch center falls back to Lehigh Valley when live GPS is absent or stale', async () => {
    let currentNow = Date.parse('2026-09-19T18:00:00.000Z');

    await withServer({ now: () => currentNow, operatorToken: 'test-token' }, async (baseUrl) => {
        let response = await fetch(`${baseUrl}/api/watch-center`);
        let payload = await response.json();

        assert.equal(payload.sourceMode, 'lehigh_valley_fallback');
        assert.equal(payload.watchCenterLabel, 'Lehigh Valley fallback');
        assert.equal(payload.lastUpdateTimestamp, null);
        assert.equal(payload.gpsFreshness, 'unavailable');

        response = await fetch(`${baseUrl}/api/watch-center/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': ['Bearer', 'test-token'].join(' ')
            },
            body: JSON.stringify({
                latitude: 40.7101,
                longitude: -75.1022,
                recordedAt: '2026-09-19T18:00:00.000Z'
            })
        });
        payload = await response.json();

        assert.equal(payload.watchCenter.sourceMode, 'live_gps');
        assert.equal(payload.watchCenter.watchCenterLabel, 'Live GPS');

        currentNow += (6 * 60 * 1000);
        response = await fetch(`${baseUrl}/api/watch-center`);
        payload = await response.json();

        assert.equal(payload.sourceMode, 'lehigh_valley_fallback');
        assert.equal(payload.gpsFreshness, 'stale');
        assert.equal(payload.fallbackState, 'active');
        assert.equal(payload.lastUpdateTimestamp, '2026-09-19T18:00:00.000Z');
    });
});

test('breakdown scanner response includes center metadata and server-calculated distances', async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/breakdowns/scanner?radius=999`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.radiusMiles, 150);
        assert.equal(payload.watchCenter.sourceMode, 'lehigh_valley_fallback');
        assert.ok(payload.breakdowns.length >= 1);
        assert.ok(payload.breakdowns.every((breakdown) => typeof breakdown.distanceMiles === 'number'));
        assert.ok(payload.breakdowns.every((breakdown) => /mi$/.test(breakdown.distance)));
        assert.ok(payload.breakdowns.every((breakdown) => breakdown.distanceMiles <= 150));
        assert.ok(payload.breakdowns.every((breakdown) => breakdown.id !== 'BD-901'));
    });
});
