const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const originalDataDir = process.env.DATA_DIR;
const originalOperatorToken = process.env.GRACE_OPERATOR_TOKEN;
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-portal-grace-persist-'));

process.env.DATA_DIR = testDataDir;
process.env.GRACE_OPERATOR_TOKEN = 'test-operator-token';

function loadFreshApp() {
  delete require.cache[require.resolve('../app')];
  const appModule = require('../app');
  return appModule.app || appModule;
}

function request(baseUrl, method, route, body, headers = {}) {
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
        resolve({
          status: res.statusCode,
          body: raw ? JSON.parse(raw) : {}
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startFreshServer() {
  process.env.DATA_DIR = testDataDir;
  process.env.GRACE_OPERATOR_TOKEN = 'test-operator-token';
  const app = loadFreshApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`
  };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test.after(async () => {
  delete require.cache[require.resolve('../app')];
  fs.rmSync(testDataDir, { recursive: true, force: true });

  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }

  if (originalOperatorToken === undefined) {
    delete process.env.GRACE_OPERATOR_TOKEN;
  } else {
    process.env.GRACE_OPERATOR_TOKEN = originalOperatorToken;
  }
});

test('loads persisted Grace calls after a fresh app load', async () => {
  const firstRun = await startFreshServer();
  const answered = await request(firstRun.baseUrl, 'POST', '/api/grace/answer', {
    caller: { phone: '+1-610-555-1111' }
  });
  assert.equal(answered.status, 200);
  const { callId } = answered.body;
  await stopServer(firstRun.server);

  const secondRun = await startFreshServer();
  const fetched = await request(
    secondRun.baseUrl,
    'GET',
    `/api/grace/calls/${callId}`,
    null,
    { 'x-operator-token': process.env.GRACE_OPERATOR_TOKEN }
  );
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.call.callId, callId);

  const intake = await request(secondRun.baseUrl, 'POST', '/api/grace/intake', {
    callId,
    carrierName: 'Restart Test Carrier',
    vehicleType: 'tractor-trailer',
    serviceCategory: 'diagnostics',
    issueDescription: 'no start after restart',
    requestedWork: 'restart-safe intake'
  });
  assert.equal(intake.status, 200);

  await stopServer(secondRun.server);
});
