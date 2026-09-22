const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

process.env.GRACE_OPERATOR_TOKEN ??= 'test-operator-token';

const appModule = require('../app');
const app = appModule.app || appModule;

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const graceDataDir = path.join(dataDir, 'grace_calls');
const auditLogPath = path.join(dataDir, 'grace_audit.log');

let server;
let baseUrl;

function request(method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(route, baseUrl);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0,
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = {};
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch (error) {
          return reject(error);
        }
        resolve({ status: res.statusCode, body: json });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createCallThroughIntake({ serviceCategory = 'air_brake_repair', vehicleType = 'tractor-trailer', issueDescription = 'air leak' } = {}) {
  const answered = await request('POST', '/api/grace/answer', { caller: { phone: '+1-610-555-1111' } });
  const callId = answered.body.callId;
  await request('POST', '/api/grace/intake', {
    callId,
    carrierName: 'Test Carrier',
    vehicleType,
    serviceCategory,
    issueDescription,
    requestedWork: issueDescription
  });
  return callId;
}

test.before(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(graceDataDir, { recursive: true });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test('rejects out-of-scope requests (towing/winching/passenger vehicle)', async () => {
  const callId = await createCallThroughIntake({
    vehicleType: 'passenger vehicle',
    issueDescription: 'need towing and winching support'
  });

  const scoped = await request('POST', '/api/grace/scope_check', { callId });
  assert.equal(scoped.status, 422);
  assert.equal(scoped.body.outOfScope, true);

  const persisted = JSON.parse(fs.readFileSync(path.join(graceDataDir, `${callId}.json`), 'utf8'));
  assert.equal(persisted.state, 'scope_rejected');
  assert.equal(persisted.stateHistory.at(-1).action, 'scope_check_rejected');
});

test('accepts in-scope heavy-duty diesel request', async () => {
  const callId = await createCallThroughIntake({
    vehicleType: 'heavy-duty truck',
    serviceCategory: 'diagnostics',
    issueDescription: 'diesel no-start diagnostic needed'
  });

  const scoped = await request('POST', '/api/grace/scope_check', { callId });
  assert.equal(scoped.status, 200);
  assert.equal(scoped.body.scopeApproved, true);
});

test('generates estimate from service + labor tier + mileage + fee schedule', async () => {
  const callId = await createCallThroughIntake();
  await request('POST', '/api/grace/scope_check', { callId });

  const quoted = await request('POST', '/api/grace/quote', {
    callId,
    serviceCategory: 'air_brake_repair',
    laborTier: 'emergency',
    laborHours: 2,
    mileage: 10,
    feeSchedule: 'standard'
  });

  assert.equal(quoted.status, 200);
  assert.equal(quoted.body.dispatchType, 'estimate');
  assert.equal(quoted.body.finalDispatchConfirmed, false);
  assert.equal(quoted.body.estimate.total, 680);
});

test('requires technician acceptance before final dispatch confirmation', async () => {
  const callId = await createCallThroughIntake();
  await request('POST', '/api/grace/scope_check', { callId });
  await request('POST', '/api/grace/quote', {
    callId,
    laborTier: 'standard',
    laborHours: 1,
    mileage: 5,
    feeSchedule: 'standard'
  });
  await request(
    'POST',
    '/api/grace/estimate_approval',
    { callId },
    { 'x-operator-token': process.env.GRACE_OPERATOR_TOKEN }
  );
  await request('POST', '/api/grace/payment_link', { callId });
  await request('POST', '/api/grace/technician_offer', { callId, technicianId: 'tech-1' });

  const blocked = await request('POST', '/api/grace/work_order_create', {
    callId,
    safetyCheckPassed: true
  }, {
    'x-operator-token': process.env.GRACE_OPERATOR_TOKEN
  });

  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.finalDispatchConfirmed, false);
  assert.ok(blocked.body.missingGates.includes('technicianAccepted'));
});

test('privileged Grace dispatch transitions require operator authentication', async () => {
  const callId = await createCallThroughIntake();
  await request('POST', '/api/grace/scope_check', { callId });
  await request('POST', '/api/grace/quote', {
    callId,
    laborTier: 'standard',
    laborHours: 1,
    mileage: 5,
    feeSchedule: 'standard'
  });
  await request(
    'POST',
    '/api/grace/estimate_approval',
    { callId },
    { 'x-operator-token': process.env.GRACE_OPERATOR_TOKEN }
  );
  await request('POST', '/api/grace/payment_link', { callId });
  await request('POST', '/api/grace/technician_offer', { callId, technicianId: 'tech-1' });

  const deniedAcceptance = await request('POST', '/api/grace/technician_acceptance', {
    callId,
    accepted: true
  });
  assert.equal(deniedAcceptance.status, 401);

  const deniedWorkOrder = await request('POST', '/api/grace/work_order_create', {
    callId,
    estimateApprovedOrAccepted: true,
    safetyCheckPassed: true
  });
  assert.equal(deniedWorkOrder.status, 401);
});

test('payment-link flow does not persist raw card data', async () => {
  const callId = await createCallThroughIntake();
  await request('POST', '/api/grace/scope_check', { callId });
  await request('POST', '/api/grace/quote', {
    callId,
    laborTier: 'standard',
    laborHours: 1,
    mileage: 0,
    feeSchedule: 'standard'
  });
  await request(
    'POST',
    '/api/grace/estimate_approval',
    { callId },
    { 'x-operator-token': process.env.GRACE_OPERATOR_TOKEN }
  );

  const paymentResp = await request('POST', '/api/grace/payment_link', {
    callId,
    cardNumber: '4242424242424242',
    cvv: '123'
  });

  assert.equal(paymentResp.status, 200);
  assert.equal(paymentResp.body.paymentLink.provider, 'pci-compliant-provider');

  const persisted = fs.readFileSync(path.join(graceDataDir, `${callId}.json`), 'utf8');
  assert.equal(persisted.includes('4242424242424242'), false);
  assert.equal(persisted.includes('"cvv": "123"'), false);

  const auditLog = fs.readFileSync(auditLogPath, 'utf8');
  assert.equal(auditLog.includes('4242424242424242'), false);
  assert.equal(auditLog.includes('"cvv":"123"'), false);
});

test('payment-link generation requires separate estimate approval after quote', async () => {
  const callId = await createCallThroughIntake();
  await request('POST', '/api/grace/scope_check', { callId });
  const quoted = await request('POST', '/api/grace/quote', {
    callId,
    laborTier: 'standard',
    laborHours: 1,
    mileage: 0,
    feeSchedule: 'standard',
    estimateApprovedOrAccepted: true
  });
  assert.equal(quoted.body.gates.pricingEstimateApprovedOrAccepted, false);

  const denied = await request('POST', '/api/grace/payment_link', { callId });
  assert.equal(denied.status, 409);
  assert.match(denied.body.error, /Estimate must be approved or accepted/i);
});

test('operator-authenticated estimate approval unlocks payment-link generation after quote', async () => {
  const callId = await createCallThroughIntake();
  await request('POST', '/api/grace/scope_check', { callId });
  await request('POST', '/api/grace/quote', {
    callId,
    laborTier: 'standard',
    laborHours: 1,
    mileage: 0,
    feeSchedule: 'standard'
  });

  const approved = await request(
    'POST',
    '/api/grace/estimate_approval',
    { callId, approvedBy: 'operator' },
    { 'x-operator-token': process.env.GRACE_OPERATOR_TOKEN }
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.body.gates.pricingEstimateApprovedOrAccepted, true);

  const paymentResp = await request('POST', '/api/grace/payment_link', { callId });
  assert.equal(paymentResp.status, 200);
});
