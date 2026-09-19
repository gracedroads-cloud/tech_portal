const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/server');

async function makeTestApp(overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tech-portal-test-'));
  const { app } = createApp({
    dataDir,
    allowDemoWriteMode: true,
    ...overrides,
  });

  return { app, dataDir };
}

test('health and status endpoints respond with operational metadata', async () => {
  const { app } = await makeTestApp();

  const health = await request(app).get('/healthz').expect(200);
  assert.equal(health.body.ok, true);

  const status = await request(app).get('/api/status').expect(200);
  assert.equal(status.body.ok, true);
  assert.equal(status.body.integrations.breakdownFeed.source, 'simulated_demo_data');
});

test('mutating routes require token when operator token is configured', async () => {
  const { app } = await makeTestApp({ allowDemoWriteMode: false, operatorToken: 'secret-token' });

  await request(app)
    .post('/api/stream/override')
    .send({ action: 'pickup' })
    .expect(401);

  const ok = await request(app)
    .post('/api/stream/override')
    .set('x-operator-token', 'secret-token')
    .send({ action: 'pickup' })
    .expect(201);

  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.override.action, 'pickup');
});

test('DVIR validation failures and successful persistence', async () => {
  const { app, dataDir } = await makeTestApp({ operatorToken: 'token', allowDemoWriteMode: false });

  const bad = await request(app)
    .post('/api/dvir')
    .set('x-operator-token', 'token')
    .send({ vehicleId: '', defects: [] })
    .expect(400);

  assert.equal(bad.body.error.code, 'validation_failed');

  const good = await request(app)
    .post('/api/dvir')
    .set('x-operator-token', 'token')
    .send({
      vehicleId: 'VH-22',
      driverName: 'Alex Driver',
      defects: ['Air leak'],
      odometer: 120331,
      safeToOperate: false,
      notes: 'Needs immediate brake chamber repair',
    })
    .expect(201);

  assert.equal(good.body.ok, true);
  assert.match(good.body.id, /^DVIR-/);

  const files = await fs.readdir(path.join(dataDir, 'dvir_reports'));
  assert.equal(files.length, 1);
});

test('scanner endpoint returns expected demo response shape', async () => {
  const { app } = await makeTestApp();
  const response = await request(app).get('/api/breakdowns/scanner?radius=150').expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.source, 'simulated_demo_data');
  assert.ok(Array.isArray(response.body.breakdowns));
  assert.equal(typeof response.body.breakdowns[0].id, 'string');
  assert.equal(typeof response.body.breakdowns[0].distance, 'string');
});

test('malformed JSON request gets 400 and oversized payload gets 413', async () => {
  const { app } = await makeTestApp({ requestSizeLimit: '1kb' });

  await request(app)
    .post('/api/dvir')
    .set('Content-Type', 'application/json')
    .send('{"broken":')
    .expect(400);

  const hugeNotes = 'x'.repeat(5000);
  await request(app)
    .post('/api/dvir')
    .send({
      vehicleId: 'VH-100',
      driverName: 'Driver One',
      defects: ['test defect'],
      odometer: 123,
      safeToOperate: true,
      notes: hugeNotes,
    })
    .expect(413);
});

test('frontend API calls have backend route parity', async () => {
  const { app } = await makeTestApp();
  const routeResponse = await request(app).get('/api/routes').expect(200);
  const routeSet = new Set(routeResponse.body.frontendRouteInventory.map((entry) => entry.path));

  const filesToScan = [
    'public/business_dashboard.html',
    'public/client_onboarding.html',
    'public/owners_draw_vault.html',
    'public/grace_dispatch_console.html',
    'no_tow_authorization.html',
  ];

  for (const relPath of filesToScan) {
    const filePath = path.join(process.cwd(), relPath);
    const content = await fs.readFile(filePath, 'utf8');
    const matches = content.match(/\/api\/[a-z0-9/_-]+/gi) || [];
    for (const endpoint of matches) {
      assert.equal(routeSet.has(endpoint), true, `Missing backend route for ${endpoint} referenced in ${relPath}`);
    }
  }
});
