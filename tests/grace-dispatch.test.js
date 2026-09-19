const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';

const {
    app,
    haversineMiles,
    resetInMemoryState,
    watchCenterState
} = require('../app');

let server;
let baseUrl;

async function postJson(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await response.json();
    return { response, data };
}

async function getJson(path) {
    const response = await fetch(`${baseUrl}${path}`);
    const data = await response.json();
    return { response, data };
}

test.before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
    resetInMemoryState();
});

test('resetInMemoryState is guarded outside test mode', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    assert.throws(() => resetInMemoryState(), /test-only/i);
    process.env.NODE_ENV = previous;
});

test('haversine and 150-mile scanner filtering work server-side', async () => {
    const distance = haversineMiles(40.6259, -75.3705, 41.6259, -75.3705);
    assert.ok(distance > 68 && distance < 70);

    const fullRange = await getJson('/api/breakdowns/scanner');
    const narrowRange = await getJson('/api/breakdowns/scanner?radius=50');
    assert.equal(fullRange.data.radiusMiles, 150);
    assert.ok(fullRange.data.breakdowns.length > 0);
    assert.ok(fullRange.data.breakdowns.every((item) => item.distanceMiles <= 150));
    assert.ok(narrowRange.data.breakdowns.every((item) => item.distanceMiles <= 50));
    assert.ok(fullRange.data.breakdowns.length > narrowRange.data.breakdowns.length);
});

test('watch-center rejects invalid coordinates and falls back when stale or absent', async () => {
    const initial = await getJson('/api/watch-center');
    assert.equal(initial.data.sourceMode, 'fallback_lehigh_valley');

    const invalid = await postJson('/api/watch-center/location', { lat: 999, lng: 20 });
    assert.equal(invalid.response.status, 400);

    const live = await postJson('/api/watch-center/location', { lat: 40.8, lng: -75.2 });
    assert.equal(live.response.status, 200);
    assert.equal(live.data.watchCenter.sourceMode, 'live_gps');

    watchCenterState.gps.updatedAt = new Date(Date.now() - (10 * 60 * 1000)).toISOString();
    const stale = await getJson('/api/watch-center');
    assert.equal(stale.data.sourceMode, 'fallback_lehigh_valley');
    assert.equal(stale.data.freshness, 'stale');
});

test('scope check rejects out-of-scope and accepts heavy-duty mobile diesel repair', async () => {
    const answered = await postJson('/api/grace/call/answer', {});
    const callId = answered.data.callId;

    const blocked = await postJson('/api/grace/call/scope-check', {
        callId,
        vehicleType: 'passenger vehicle',
        serviceType: 'towing',
        issue: 'needs winching'
    });
    assert.equal(blocked.response.status, 422);
    assert.equal(blocked.data.scope.accepted, false);

    const accepted = await postJson('/api/grace/call/scope-check', {
        callId,
        vehicleType: 'tractor-trailer',
        serviceType: 'mobile diesel repair',
        issue: 'starter fault'
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.data.scope.accepted, true);
});

test('estimate generation includes configured components and estimate labeling', async () => {
    const answered = await postJson('/api/grace/call/answer', {});
    const callId = answered.data.callId;

    await postJson('/api/grace/call/intake', {
        callId,
        vehicleType: 'tractor-trailer',
        serviceType: 'mobile diesel repair',
        issue: 'injector misfire'
    });
    await postJson('/api/grace/call/scope-check', {
        callId,
        vehicleType: 'tractor-trailer',
        serviceType: 'mobile diesel repair',
        issue: 'injector misfire'
    });

    const quote = await postJson('/api/grace/call/quote', {
        callId,
        laborTier: 'urgent',
        laborHours: 2,
        travelMiles: 32
    });

    assert.equal(quote.response.status, 200);
    assert.equal(quote.data.estimate.label, 'estimate_not_final');
    assert.ok(quote.data.estimate.serviceCall > 0);
    assert.ok(quote.data.estimate.laborSubtotal > 0);
    assert.ok(quote.data.estimate.travelSubtotal >= 0);
    assert.ok(quote.data.estimate.totalEstimate > 0);
});

test('payment-link rejects raw card/account fields and does not persist sensitive card fields', async () => {
    const answered = await postJson('/api/grace/call/answer', {});
    const callId = answered.data.callId;

    await postJson('/api/grace/call/scope-check', {
        callId,
        vehicleType: 'heavy-duty truck',
        serviceType: 'mobile diesel repair',
        issue: 'engine derate'
    });
    await postJson('/api/grace/call/quote', {
        callId,
        laborTier: 'standard',
        laborHours: 1.5,
        travelMiles: 10
    });

    const rejected = await postJson('/api/grace/call/payment-link', {
        callId,
        cardNumber: '4111111111111111',
        cvv: '123'
    });
    assert.equal(rejected.response.status, 400);

    const safe = await postJson('/api/grace/call/payment-link', {
        callId,
        sendTo: 'ops@example.com'
    });
    assert.equal(safe.response.status, 200);
    assert.equal(safe.data.payment.mode, 'mock_processor_handoff');
    assert.equal(safe.data.dispatchStatus, 'estimate');

    const call = await getJson(`/api/grace/call/${encodeURIComponent(callId)}`);
    const serialized = JSON.stringify(call.data);
    assert.equal(serialized.includes('4111111111111111'), false);
    assert.equal(serialized.includes('cvv'), false);
});

test('technician acceptance is required before work order dispatch confirmation', async () => {
    const answered = await postJson('/api/grace/call/answer', {});
    const callId = answered.data.callId;

    await postJson('/api/grace/call/scope-check', {
        callId,
        vehicleType: 'tractor trailer',
        serviceType: 'mobile diesel repair',
        issue: 'charging system fault'
    });
    await postJson('/api/grace/call/quote', {
        callId,
        laborTier: 'severe',
        laborHours: 2,
        travelMiles: 25
    });
    await postJson('/api/grace/call/payment-link', {
        callId,
        sendTo: 'fleet@example.com'
    });
    await postJson('/api/grace/call/technician-offer', {
        callId,
        technicianId: 'tech-77'
    });

    const blockedWorkOrder = await postJson('/api/grace/call/work-order-create', {
        callId,
        notes: 'Attempt before acceptance'
    });
    assert.equal(blockedWorkOrder.response.status, 409);
    assert.equal(blockedWorkOrder.data.dispatchStatus, 'pending_technician_acceptance');

    await postJson('/api/grace/call/technician-acceptance', {
        callId,
        technicianAccepted: true
    });

    const confirmedWorkOrder = await postJson('/api/grace/call/work-order-create', {
        callId,
        notes: 'Accepted dispatch'
    });
    assert.equal(confirmedWorkOrder.response.status, 201);
    assert.equal(confirmedWorkOrder.data.dispatchStatus, 'dispatch_confirmed');
});

test('department directory API exposes all requested EH Graced Roads departments', async () => {
    const response = await getJson('/api/departments');
    assert.equal(response.response.status, 200);
    assert.equal(response.data.totalDepartments, 9);

    const names = response.data.departments.map((department) => department.name);
    assert.ok(names.includes('EH Graced Roads HR Department'));
    assert.ok(names.includes('EH Graced Roads Legal Department'));
    assert.ok(names.includes('EH Graced Roads Marketing Department'));
    assert.ok(names.includes('EH Graced Roads Question and Answer & Suggestions Department'));
    assert.ok(names.includes('EH Graced Roads Leadership and Development Department'));
    assert.ok(names.includes('EH Graced Roads Uplift the Environment Department'));
    assert.ok(names.includes('EH Graced Roads Support of Military Veterans Department'));
    assert.ok(names.includes('EH Graced Roads Community Donation Department'));
    assert.ok(names.includes('EH Graced Roads Youth Athletic and Academic Sponsorship Department'));
});

test('Q&A and suggestions department accepts submissions and lists them', async () => {
    const submission = await postJson('/api/departments/qa-suggestions', {
        fromName: 'Ops Team',
        contact: 'ops@example.com',
        category: 'question',
        message: 'Can we schedule a monthly cross-department coordination review?'
    });

    assert.equal(submission.response.status, 201);
    assert.equal(submission.data.submission.departmentId, 'qa_suggestions');
    assert.equal(submission.data.submission.category, 'question');

    const listed = await getJson('/api/departments/qa-suggestions');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.data.totalSubmissions, 1);
    assert.equal(listed.data.submissions[0].message, 'Can we schedule a monthly cross-department coordination review?');
});
