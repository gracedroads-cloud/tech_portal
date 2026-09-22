const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

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
        env: { ...process.env, PORT: String(port), DATA_DIR: tempDataDir },
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
        baseUrl,
        request,
        close: async () => {
            serverProcess.kill('SIGTERM');
            await new Promise((resolve) => {
                serverProcess.once('exit', () => resolve());
                setTimeout(resolve, 1500);
            });
            fs.rmSync(tempDataDir, { recursive: true, force: true });
        },
        tempDataDir
    };
}

test('Grace lifecycle enforces technician acceptance before work order creation', async () => {
    const server = await startTestServer();

    try {
        const answer = await server.request('/api/grace/call/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callerName: 'Fleet One',
                location: 'I-78 near Easton, PA',
                vehicleType: 'tractor-trailer',
                serviceType: 'mobile diesel repair'
            })
        });

        assert.equal(answer.response.status, 201);
        const callId = answer.body.call.id;

        await server.request('/api/grace/call/intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                unitNumber: 'F1-22',
                symptoms: 'Heavy-duty truck will not start.',
                requestedService: 'Mobile heavy-duty diesel repair'
            })
        });

        await server.request('/api/grace/call/scope-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                vehicleType: 'heavy-duty truck',
                requestedService: 'Mobile diesel repair',
                issueSummary: 'Class 8 no-start on interstate shoulder'
            })
        });

        await server.request('/api/grace/call/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                diagnosticsRequired: true,
                travelMiles: 12
            })
        });

        await server.request('/api/grace/call/payment-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                amount: 361,
                customerEmail: 'dispatch@fleetone.example'
            })
        });

        await server.request('/api/grace/call/technician-offer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                technicianId: 'LV-TECH-22',
                technicianName: 'Lehigh Valley Unit 22'
            })
        });

        const blockedWorkOrder = await server.request('/api/grace/call/work-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId })
        });

        assert.equal(blockedWorkOrder.response.status, 409);
        assert.match(blockedWorkOrder.body.error, /technician acceptance/i);

        const accepted = await server.request('/api/grace/call/technician-acceptance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                accepted: true
            })
        });

        assert.equal(accepted.response.status, 200);
        assert.equal(accepted.body.call.technician.accepted, true);

        const workOrder = await server.request('/api/grace/call/work-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId })
        });

        assert.equal(workOrder.response.status, 200);
        assert.equal(workOrder.body.call.workOrder.finalDispatchActionable, true);
        assert.equal(workOrder.body.call.workOrder.technicianAccepted, true);

        const closeout = await server.request('/api/grace/call/closeout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                diagnostics: 'Battery cable failure confirmed.',
                workPerformed: 'Replaced failed cable and verified charging system.',
                partsUsed: ['battery cable'],
                laborMinutes: 95,
                customerSignature: 'fleet-one-signer',
                proofPhotos: ['photo-1'],
                completionGps: '40.6884,-75.2207'
            })
        });

        assert.equal(closeout.response.status, 200);
        assert.equal(closeout.body.call.overallStatus, 'complete');

        const audit = await server.request(`/api/grace/call/${callId}/audit`);
        assert.equal(audit.response.status, 200);
        assert.ok(audit.body.auditLog.some((entry) => entry.approvalGate === 'technician_acceptance'));
        assert.ok(audit.body.auditLog.some((entry) => entry.approvalGate === 'dispatch_confirmation'));
    } finally {
        await server.close();
    }
});

test('Grace rejects out-of-scope towing and blocks raw card data capture', async () => {
    const server = await startTestServer();

    try {
        const answer = await server.request('/api/grace/call/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callerName: 'Blocked Fleet',
                vehicleType: 'tractor-trailer',
                serviceType: 'mobile diesel repair'
            })
        });
        const callId = answer.body.call.id;

        await server.request('/api/grace/call/intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                requestedService: 'Tow this truck off the shoulder'
            })
        });

        const blockedScope = await server.request('/api/grace/call/scope-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId,
                vehicleType: 'tractor-trailer',
                requestedService: 'Towing and winching',
                issueSummary: 'Needs tow to yard'
            })
        });

        assert.equal(blockedScope.response.status, 200);
        assert.equal(blockedScope.body.call.overallStatus, 'blocked');
        assert.equal(blockedScope.body.call.stages.find((stage) => stage.id === 'scope_check').status, 'blocked');

        const allowedAnswer = await server.request('/api/grace/call/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callerName: 'Secure Fleet',
                vehicleType: 'heavy-duty truck',
                serviceType: 'mobile diesel repair'
            })
        });
        const secureCallId = allowedAnswer.body.call.id;

        await server.request('/api/grace/call/intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId: secureCallId,
                requestedService: 'Heavy-duty diesel repair'
            })
        });

        await server.request('/api/grace/call/scope-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId: secureCallId,
                vehicleType: 'heavy-duty truck',
                requestedService: 'Heavy-duty diesel repair',
                issueSummary: 'Diesel no-start'
            })
        });

        await server.request('/api/grace/call/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId: secureCallId
            })
        });

        const blockedPayment = await server.request('/api/grace/call/payment-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callId: secureCallId,
                amount: 325,
                cardNumber: '4111111111111111'
            })
        });

        assert.equal(blockedPayment.response.status, 400);
        assert.match(blockedPayment.body.error, /secure payment link flow/i);
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

        for (let index = 0; index < 10; index += 1) {
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
        assert.match(blocked.body.error, /rate limit/i);
    } finally {
        await server.close();
    }
});
