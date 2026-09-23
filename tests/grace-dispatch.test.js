const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const OPERATOR_TOKEN = 'test-operator-token';

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
            const res = await fetch(`${baseUrl}/api/status`);
            if (res.ok) return;
        } catch (error) {
            // retry until timeout
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Server did not become ready in time');
}

async function startTestServer() {
    const port = await allocatePort();
    const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-dispatch-'));
    const repoRoot = path.resolve(__dirname, '..');
    const serverProcess = spawn('node', ['app.js'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: tempDataDir,
            GRACE_OPERATOR_TOKEN: OPERATOR_TOKEN
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl);

    async function request(url, options = {}) {
        const response = await fetch(`${baseUrl}${url}`, options);
        const contentType = response.headers.get('content-type') || '';
        const body = contentType.includes('application/json')
            ? await response.json()
            : await response.text();
        return { response, body };
    }

    return {
        request,
        close: async () => {
            serverProcess.kill('SIGTERM');
            await new Promise((resolve) => {
                serverProcess.once('exit', () => resolve());
                setTimeout(resolve, 1500);
            });
            fs.rmSync(tempDataDir, { recursive: true, force: true });
        }
    };
}

async function createReadyCall(server) {
    const answer = await server.request('/api/grace/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            caller: { carrierName: 'Fleet One', location: 'I-78 near Easton, PA' }
        })
    });
    const callId = answer.body.callId;

    await server.request('/api/grace/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            callId,
            carrierName: 'Fleet One',
            vehicleType: 'tractor-trailer',
            serviceCategory: 'diagnostics',
            issueDescription: 'Diesel no-start',
            requestedWork: 'Heavy-duty diesel repair',
            location: 'I-78 near Easton, PA'
        })
    });

    await server.request('/api/grace/scope_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId })
    });

    await server.request('/api/grace/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            callId,
            serviceCategory: 'diagnostics',
            laborTier: 'standard',
            laborHours: 1,
            mileage: 12,
            feeSchedule: 'standard'
        })
    });

    await server.request('/api/grace/estimate_approval', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-operator-token': OPERATOR_TOKEN
        },
        body: JSON.stringify({ callId })
    });

    await server.request('/api/grace/payment_link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId })
    });

    await server.request('/api/grace/technician_offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            callId,
            technicianId: 'tech-22',
            technicianName: 'Lehigh Valley Unit 22',
            etaMinutes: 45
        })
    });

    return callId;
}

test('Grace progress compatibility endpoint reports ready and blocked calls', async () => {
    const server = await startTestServer();

    try {
        const readyCallId = await createReadyCall(server);

        const blockedAnswer = await server.request('/api/grace/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caller: { carrierName: 'Blocked Fleet' } })
        });
        const blockedCallId = blockedAnswer.body.callId;

        await server.request('/api/grace/intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId: blockedCallId,
                carrierName: 'Blocked Fleet',
                vehicleType: 'passenger vehicle',
                serviceCategory: 'diagnostics',
                issueDescription: 'Needs towing',
                requestedWork: 'Towing and winching',
                location: 'I-78 shoulder'
            })
        });

        const blockedScope = await server.request('/api/grace/scope_check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: blockedCallId })
        });
        assert.equal(blockedScope.response.status, 422);

        const activeCalls = await server.request('/api/grace/calls/active');
        assert.equal(activeCalls.response.status, 200);
        assert.equal(activeCalls.body.summary.ready, 1);
        assert.equal(activeCalls.body.summary.blocked, 1);

        const readyCall = activeCalls.body.calls.find((call) => call.id === readyCallId);
        assert.equal(readyCall.overallStatus, 'ready');
        assert.equal(readyCall.stages.find((stage) => stage.id === 'technician_offer').status, 'complete');
        assert.equal(readyCall.stages.find((stage) => stage.id === 'technician_acceptance').status, 'active');

        const blockedCall = activeCalls.body.calls.find((call) => call.id === blockedCallId);
        assert.equal(blockedCall.overallStatus, 'blocked');
        assert.equal(blockedCall.stages.find((stage) => stage.id === 'scope_check').status, 'blocked');
    } finally {
        await server.close();
    }
});

test('Grace compatibility detail and audit endpoints expose progress data for the dashboard', async () => {
    const server = await startTestServer();

    try {
        const callId = await createReadyCall(server);

        const detail = await server.request(`/api/grace/call/${callId}`);
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.call.id, callId);
        assert.equal(detail.body.call.carrierName, 'Fleet One');
        assert.equal(detail.body.call.stages.find((stage) => stage.id === 'payment_link').status, 'complete');

        const audit = await server.request(`/api/grace/call/${callId}/audit`);
        assert.equal(audit.response.status, 200);
        assert.equal(audit.body.callId, callId);
        assert.ok(audit.body.auditLog.some((entry) => entry.action === 'technician_offer'));
    } finally {
        await server.close();
    }
});

test('Business dashboard includes the Grace dispatch progress monitor pane', async () => {
    const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'business_dashboard.html'), 'utf8');

    assert.match(dashboardHtml, /GRACE DISPATCH PROGRESS/i);
    assert.match(dashboardHtml, /summary-ready/i);
    assert.match(dashboardHtml, /summary-active/i);
    assert.match(dashboardHtml, /summary-blocked/i);
    assert.match(dashboardHtml, /summary-complete/i);
    assert.match(dashboardHtml, /progress-stage-list/i);
});

test('Server only exposes explicit root pages and rate-limits DVIR writes', async () => {
    const server = await startTestServer();

    try {
        const home = await server.request('/');
        assert.equal(home.response.status, 200);

        const sourceExposure = await server.request('/app.js');
        assert.equal(sourceExposure.response.status, 404);

        const firstAllowed = await server.request('/api/dvir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inspection: 0 })
        });
        assert.equal(firstAllowed.response.status, 200);

        const limit = Number(firstAllowed.response.headers.get('ratelimit-limit') || '0');
        assert.ok(limit > 0);

        for (let index = 1; index < limit; index += 1) {
            const allowed = await server.request('/api/dvir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inspection: index })
            });
            assert.equal(allowed.response.status, 200);
        }

        const blocked = await server.request('/api/dvir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inspection: 'blocked' })
        });

        assert.equal(blocked.response.status, 429);
        assert.match(
            blocked.body.error || blocked.body.message || JSON.stringify(blocked.body),
            /(rate limit|too many requests)/i
        );
    } finally {
        await server.close();
    }
});
