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

async function collectFrontendHtmlFiles() {
  const targets = [process.cwd(), path.join(process.cwd(), 'public')];
  const htmlFiles = [];

  for (const directory of targets) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.html')) {
        htmlFiles.push(path.relative(process.cwd(), path.join(directory, entry.name)));
      }
    }
  }

  return htmlFiles;
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

test('demo write mode is disabled in production without an operator token', async () => {
  const { app } = await makeTestApp({ env: 'production', allowDemoWriteMode: true });

  const ready = await request(app).get('/readyz').expect(200);
  assert.equal(ready.body.writeMode, 'disabled');

  const response = await request(app)
    .post('/api/stream/override')
    .send({ action: 'pickup' })
    .expect(503);

  assert.equal(response.body.error.code, 'writes_disabled');
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
  assert.ok(response.body.breakdowns.length > 0);
  assert.equal(typeof response.body.breakdowns[0].id, 'string');
  assert.equal(typeof response.body.breakdowns[0].distance, 'string');
});

test('waiver endpoint rejects impossible calendar dates', async () => {
  const { app } = await makeTestApp();
  const response = await request(app)
    .post('/api/submit-job')
    .send({
      carrier: 'Carrier One',
      unitAsset: 'Unit-9',
      agent: 'Agent Name',
      executionDate: '2026-02-31',
      signature: 'Agent Name',
    })
    .expect(400);

  assert.equal(response.body.error.code, 'validation_failed');
});

test('onboarding taxReference accepts masked values and rejects raw tax IDs', async () => {
  const { app } = await makeTestApp();

  await request(app)
    .post('/api/onboarding')
    .send({
      carrierName: 'Carrier One',
      billingEmail: 'ops@example.com',
      paymentTerms: 'Net 30',
      taxReference: 'XX1234',
    })
    .expect(201);

  await request(app)
    .post('/api/onboarding')
    .send({
      carrierName: 'Carrier One',
      billingEmail: 'ops@example.com',
      paymentTerms: 'Net 30',
      taxReference: '123456789',
    })
    .expect(400);

  await request(app)
    .post('/api/onboarding')
    .send({
      carrierName: 'Carrier One',
      billingEmail: 'ops@example.com',
      paymentTerms: 'Net 30',
      taxReference: '123-45-6789',
    })
    .expect(400);
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

test('unknown API routes return JSON 404 envelopes', async () => {
  const { app } = await makeTestApp();
  const response = await request(app).get('/api/does-not-exist').expect(404);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, 'not_found');
});

test('frontend API calls have backend route parity', async () => {
  const { app } = await makeTestApp();
  const routeResponse = await request(app).get('/api/routes').expect(200);
  const routeSet = new Set(routeResponse.body.frontendRouteInventory.map((entry) => `${entry.method} ${entry.path}`));

  const filesToScan = await collectFrontendHtmlFiles();

  for (const relPath of filesToScan) {
    const filePath = path.join(process.cwd(), relPath);
    const content = await fs.readFile(filePath, 'utf8');
    const callPatterns = [
      /fetch\(\s*['"`](\/api\/[^'"`]+)['"`]\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/gi,
      /apiRequest\(\s*['"`](\/api\/[^'"`]+)['"`]\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/gi,
    ];

    for (const pattern of callPatterns) {
      const calls = content.matchAll(pattern);
      for (const match of calls) {
        const endpointWithQuery = match[1];
        const optionsChunk = match[2] || '';
        const endpoint = endpointWithQuery.split('?')[0];
        const methodMatch = optionsChunk.match(/method\s*:\s*['"`]([A-Za-z]+)['"`]/i);
        const method = (methodMatch ? methodMatch[1] : 'GET').toUpperCase();
        const routeKey = `${method} ${endpoint}`;
        assert.equal(routeSet.has(routeKey), true, `Missing backend route for ${routeKey} referenced in ${relPath}`);
      }
    }
  }
});
