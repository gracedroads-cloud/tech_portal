const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createServer } = require('../src/server');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-ops-'));
}

async function startTestServer(overrides = {}) {
  const dataDir = makeTempDir();
  const app = createServer({
    port: 0,
    dataDir,
    opsToken: 'test-token',
    simulationMode: true,
    secureBrowserAllowlist: ['https://portal.example.com'],
    mediaAllowlist: ['https://demo.example.com'],
    ...overrides,
    silent: true
  });
  const port = await app.start();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    app,
    baseUrl,
    dataDir,
    async stop() {
      await app.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

function authHeaders(extra = {}) {
  return {
    'content-type': 'application/json',
    'x-ops-token': 'test-token',
    ...extra
  };
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function rawRequest(baseUrl, pathname, body, headers = {}) {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: res.statusCode, text });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('requires auth for mutating APIs', async () => {
  const ctx = await startTestServer();
  try {
    const { response, body } = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Battery support needed', serviceType: 'battery_electrical_help' })
    });
    assert.equal(response.status, 401);
    assert.equal(body.error, 'Unauthorized');
  } finally {
    await ctx.stop();
  }
});

test('requires auth for operational state feeds', async () => {
  const ctx = await startTestServer();
  try {
    const state = await jsonRequest(ctx.baseUrl, '/api/state');
    const audit = await jsonRequest(ctx.baseUrl, '/api/audit');
    assert.equal(state.response.status, 401);
    assert.equal(audit.response.status, 401);
  } finally {
    await ctx.stop();
  }
});

test('rejects towing requests at the API layer and records audit history', async () => {
  const ctx = await startTestServer();
  try {
    const { response, body } = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ description: 'Truck needs towing from shoulder', serviceType: 'mobile_diagnostics' })
    });
    assert.equal(response.status, 422);
    assert.match(body.error, /NO TOWING and NO WINCHING/);

    const audit = await jsonRequest(ctx.baseUrl, '/api/audit', { headers: { 'x-ops-token': 'test-token' } });
    assert.ok(audit.body.events.some((event) => event.type === 'policy.rejected'));
  } finally {
    await ctx.stop();
  }
});

test('rejects Grace AI output that proposes towing', async () => {
  const aiServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      summary: 'Recommend towing to nearest lot',
      recommendedServiceType: 'towing',
      priority: 'high',
      requiresHumanApproval: false,
      allowedActions: ['draft_dispatch']
    }));
  });
  await new Promise((resolve) => aiServer.listen(0, resolve));
  const aiPort = aiServer.address().port;
  const ctx = await startTestServer({
    graceAiEndpoint: `http://127.0.0.1:${aiPort}/classify`,
    graceAiApiKey: 'fake-key'
  });

  try {
    const { response, body } = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ description: 'Engine issue with no tow requested', serviceType: 'mobile_diagnostics' })
    });
    assert.equal(response.status, 422);
    assert.equal(body.rejection.rejection.code, 'POLICY_REJECTED_NO_TOW_NO_WINCH');
  } finally {
    aiServer.close();
    await ctx.stop();
  }
});

test('requires human approval by default and allows explicit approval', async () => {
  const ctx = await startTestServer();
  try {
    const created = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ description: 'Battery diagnostics requested', serviceType: 'battery_electrical_help' })
    });
    assert.equal(created.response.status, 202);
    assert.equal(created.body.queueItem.status, 'awaiting_human_approval');
    assert.equal(created.body.queueItem.requiresHumanApproval, true);

    const missingOperator = await jsonRequest(ctx.baseUrl, `/api/dispatch/${created.body.queueItem.id}/approve`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    assert.equal(missingOperator.response.status, 400);

    const approved = await jsonRequest(ctx.baseUrl, `/api/dispatch/${created.body.queueItem.id}/approve`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ operator: 'Dispatcher One' })
    });
    assert.equal(approved.response.status, 200);

    const state = await jsonRequest(ctx.baseUrl, '/api/state', { headers: { 'x-ops-token': 'test-token' } });
    assert.equal(state.body.dispatchQueue[0].status, 'approved_dispatch');
  } finally {
    await ctx.stop();
  }
});

test('supports automation pause and reports it in state', async () => {
  const ctx = await startTestServer();
  try {
    const paused = await jsonRequest(ctx.baseUrl, '/api/automation/pause', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ paused: true, reason: 'Supervisor stop' })
    });
    assert.equal(paused.response.status, 200);
    assert.equal(paused.body.paused, true);

    const state = await jsonRequest(ctx.baseUrl, '/api/state', { headers: { 'x-ops-token': 'test-token' } });
    assert.equal(state.body.automationPaused, true);
    assert.equal(state.body.automationPauseReason, 'Supervisor stop');
  } finally {
    await ctx.stop();
  }
});

test('auto-dispatches only low-risk approved services when explicitly enabled', async () => {
  const aiServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      summary: 'Low-risk battery assist approved for auto dispatch',
      recommendedServiceType: 'battery_electrical_help',
      priority: 'low',
      requiresHumanApproval: false,
      allowedActions: ['draft_dispatch']
    }));
  });
  await new Promise((resolve) => aiServer.listen(0, resolve));
  const aiPort = aiServer.address().port;
  const ctx = await startTestServer({
    autoDispatchEnabled: true,
    graceAiEndpoint: `http://127.0.0.1:${aiPort}/classify`,
    graceAiApiKey: 'fake-key'
  });

  try {
    const created = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ description: 'Battery restart needed at depot', serviceType: 'battery_electrical_help' })
    });
    assert.equal(created.response.status, 202);
    assert.equal(created.body.queueItem.status, 'auto_dispatched');
    assert.equal(created.body.queueItem.requiresHumanApproval, false);

    const audit = await jsonRequest(ctx.baseUrl, '/api/audit', { headers: { 'x-ops-token': 'test-token' } });
    assert.ok(audit.body.events.some((event) => event.type === 'dispatch.auto_dispatched'));
  } finally {
    aiServer.close();
    await ctx.stop();
  }
});

test('rejects malformed JSON payloads', async () => {
  const ctx = await startTestServer();
  try {
    const result = await rawRequest(ctx.baseUrl, '/api/incidents', '{oops', {
      'content-type': 'application/json',
      'x-ops-token': 'test-token'
    });
    assert.equal(result.statusCode, 400);
    assert.match(result.text, /Malformed JSON payload/);
  } finally {
    await ctx.stop();
  }
});

test('rejects oversized payloads', async () => {
  const ctx = await startTestServer({ maxBodyBytes: 64 });
  try {
    const bigBody = JSON.stringify({ description: 'x'.repeat(300), serviceType: 'battery_electrical_help' });
    const result = await rawRequest(ctx.baseUrl, '/api/incidents', bigBody, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(bigBody),
      'x-ops-token': 'test-token'
    });
    assert.equal(result.statusCode, 413);
    assert.match(result.text, /Payload too large/);
  } finally {
    await ctx.stop();
  }
});

test('validates media sources against the allowlist and permits simulation mode', async () => {
  const ctx = await startTestServer();
  try {
    const denied = await jsonRequest(ctx.baseUrl, '/api/media/sources', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Unauthorized Feed',
        kind: 'video',
        type: 'EMBED',
        url: 'https://blocked.example.com/feed'
      })
    });
    assert.equal(denied.response.status, 400);
    assert.match(denied.body.error, /allowlisted/);

    const allowed = await jsonRequest(ctx.baseUrl, '/api/media/sources', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'SIM TV', kind: 'tv', type: 'EMBED', simulated: true })
    });
    assert.equal(allowed.response.status, 201);
    assert.equal(allowed.body.source.simulated, true);
  } finally {
    await ctx.stop();
  }
});

test('validates secure browser URLs against protocol and allowlist', async () => {
  const ctx = await startTestServer();
  try {
    const denied = await jsonRequest(ctx.baseUrl, '/api/secure-browser/launch', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url: 'javascript:alert(1)' })
    });
    assert.equal(denied.response.status, 400);

    const allowed = await jsonRequest(ctx.baseUrl, '/api/secure-browser/launch', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url: 'https://portal.example.com/workbench', mode: 'iframe' })
    });
    assert.equal(allowed.response.status, 201);
    assert.equal(allowed.body.session.hostname, 'portal.example.com');
  } finally {
    await ctx.stop();
  }
});

test('simulates Teams notifications without external secrets', async () => {
  const ctx = await startTestServer();
  try {
    const result = await jsonRequest(ctx.baseUrl, '/api/teams/notify', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ summary: 'Simulation alert' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.result.mode, 'simulation');
  } finally {
    await ctx.stop();
  }
});

test('streams monitor updates over SSE when simulation events occur', async () => {
  const ctx = await startTestServer();
  try {
    const url = new URL('/api/events', ctx.baseUrl);
    const req = http.request({
      method: 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'x-ops-token': 'test-token' }
    });
    req.end();
    const [res] = await once(req, 'response');

    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
    });

    await jsonRequest(ctx.baseUrl, '/api/simulate/tick', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({})
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.match(buffer, /snapshot/);
    assert.match(buffer, /incident_updated/);
    res.destroy();
  } finally {
    await ctx.stop();
  }
});
