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

async function login(baseUrl, techId, pin) {
  const res = await fetch(`${baseUrl}/api/field/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ techId, pin })
  });
  assert.equal(res.status, 200);
  return res.json();
}

let serverProcess;
let baseUrl;
const repoRoot = path.resolve(__dirname, '..');
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-portal-dvir-'));

// The field DVIR API (/api/field/auth/login, /api/field/dvir, /api/breakdowns/live)
// was written on copilot/live-monitoring-command-center but did not survive the
// merge into this branch; src/server.js has no /api/field routes. These tests
// are skipped, not deleted, so the gap stays visible in every test run. See
// docs/GRACE_AI_INVENTORY.md section E for the owner decision.
const FIELD_API_AVAILABLE = false;
const FIELD_API_SKIP_REASON = 'field API routes missing from src/server.js (docs/GRACE_AI_INVENTORY.md section E)';

test.before(async () => {
  const port = await allocatePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn('node', ['app.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), DATA_DIR: testDataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer(baseUrl);
});

test.after(async () => {
  if (!serverProcess) return;
  serverProcess.kill('SIGTERM');
  await new Promise((resolve) => {
    serverProcess.once('exit', () => resolve());
    setTimeout(resolve, 1500);
  });
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('rejects DVIR submission with missing required fields', { skip: !FIELD_API_AVAILABLE && FIELD_API_SKIP_REASON }, async () => {
  const auth = await login(baseUrl, 'tech-101', '1101');
  const res = await fetch(`${baseUrl}/api/field/dvir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + auth.token
    },
    body: JSON.stringify({
      vehicleId: 'UNIT-77',
      safeToOperate: true,
      lat: 40.7,
      lng: -75.2
    })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'DVIR submission blocked. Missing required fields.');
  assert.ok(Array.isArray(body.missing));
  assert.ok(body.missing.includes('odometer'));
  assert.ok(body.missing.includes('defectsSummary'));
});

test('unsafe DVIR escalates to breakdown alert', { skip: !FIELD_API_AVAILABLE && FIELD_API_SKIP_REASON }, async () => {
  const auth = await login(baseUrl, 'tech-202', '2202');
  const dvirRes = await fetch(`${baseUrl}/api/field/dvir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + auth.token
    },
    body: JSON.stringify({
      vehicleId: 'UNIT-99',
      odometer: '123456',
      defectsSummary: 'Severe brake leak found',
      safeToOperate: false,
      outOfServiceReason: 'Brake system unsafe',
      lat: 40.6884,
      lng: -75.2207
    })
  });
  assert.equal(dvirRes.status, 201);
  const dvirBody = await dvirRes.json();
  assert.ok(dvirBody.report?.id);

  const alertsRes = await fetch(`${baseUrl}/api/breakdowns/live?lat=40.6884&lng=-75.2207&radius=150`);
  assert.equal(alertsRes.status, 200);
  const alertsBody = await alertsRes.json();
  const escalated = (alertsBody.alerts || []).find((item) => item.sourceRef === dvirBody.report.id);
  assert.ok(escalated, 'Expected breakdown alert emitted from unsafe DVIR');
  assert.equal(escalated.source, 'field_dvir');
});
