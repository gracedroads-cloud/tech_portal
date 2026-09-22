const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { LEHIGH_VALLEY_CENTER } = require('../app');
const { createWatchCenterStore, haversineMiles, isValidCoordinate } = require('../watch-center');

const repoRoot = path.resolve(__dirname, '..');

async function allocatePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

async function waitForServer(baseUrl, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/api/status`);
            if (response.ok) {
                return;
            }
        } catch (error) {
            // retry until timeout
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Server did not become ready in time');
}

async function withServer(envOverrides, callback) {
    const port = await allocatePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-portal-watch-center-'));
    const serverProcess = spawn('node', ['app.js'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: dataDir,
            ...envOverrides
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
        await waitForServer(baseUrl);
        await callback(baseUrl);
    } finally {
        serverProcess.kill('SIGTERM');
        await new Promise((resolve) => {
            serverProcess.once('exit', () => resolve());
            setTimeout(resolve, 1500);
        });
        fs.rmSync(dataDir, { recursive: true, force: true });
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
    await withServer({ WATCH_CENTER_OPERATOR_TOKEN: 'test-token' }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/watch-center/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: ['Bearer', 'test-token'].join(' ')
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
    await withServer({ WATCH_CENTER_OPERATOR_TOKEN: 'test-token' }, async (baseUrl) => {
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
                Authorization: ['Bearer', 'wrong-token'].join(' ')
            },
            body: JSON.stringify({ latitude: 40.7, longitude: -75.1 })
        });
        payload = await response.json();

        assert.equal(response.status, 403);
        assert.match(payload.error, /invalid/);
    });

    await withServer({ WATCH_CENTER_OPERATOR_TOKEN: '' }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/watch-center/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: ['Bearer', 'test-token'].join(' ')
            },
            body: JSON.stringify({ latitude: 40.7, longitude: -75.1 })
        });
        const payload = await response.json();

        assert.equal(response.status, 503);
        assert.match(payload.error, /not configured/);
    });
});

test('watch center falls back to Lehigh Valley when live GPS is absent or stale', async () => {
    await withServer({ WATCH_CENTER_OPERATOR_TOKEN: 'test-token' }, async (baseUrl) => {
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
                Authorization: ['Bearer', 'test-token'].join(' ')
            },
            body: JSON.stringify({
                latitude: 40.7101,
                longitude: -75.1022,
                recordedAt: '2026-09-19T18:00:00.000Z'
            })
        });
        payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.watchCenter.sourceMode, 'lehigh_valley_fallback');
        assert.equal(payload.watchCenter.gpsFreshness, 'stale');
        assert.equal(payload.watchCenter.lastUpdateTimestamp, '2026-09-19T18:00:00.000Z');

        response = await fetch(`${baseUrl}/api/watch-center`);
        payload = await response.json();

        assert.equal(payload.sourceMode, 'lehigh_valley_fallback');
        assert.equal(payload.gpsFreshness, 'stale');
        assert.equal(payload.fallbackState, 'active');
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
    });
});
