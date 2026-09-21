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

    const duplicateApproval = await jsonRequest(ctx.baseUrl, `/api/dispatch/${created.body.queueItem.id}/approve`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ operator: 'Dispatcher Two' })
    });
    assert.equal(duplicateApproval.response.status, 200);
    assert.equal(duplicateApproval.body.idempotent, true);

    const state = await jsonRequest(ctx.baseUrl, '/api/state', { headers: { 'x-ops-token': 'test-token' } });
    assert.equal(state.body.dispatchQueue[0].status, 'approved_dispatch');
  } finally {
    await ctx.stop();
  }
});

test('applies internal technician ETA windows for dispatch eligibility', async () => {
  const ctx = await startTestServer({
    dispatchEtaPreferredMinutes: 90,
    dispatchEtaMaxMinutes: 120
  });
  try {
    const preferred = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        description: 'Preferred-window roadside support',
        serviceType: 'battery_electrical_help',
        technicianEtaMinutes: 85,
        locationState: 'TX'
      })
    });
    assert.equal(preferred.response.status, 202);
    assert.equal(preferred.body.queueItem.availabilityTier, 'preferred_eta_window');
    assert.equal(preferred.body.queueItem.technicianEtaMinutes, 85);

    const extended = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        description: 'Extended-window roadside support',
        serviceType: 'battery_electrical_help',
        technicianEtaMinutes: 115,
        locationState: 'CA'
      })
    });
    assert.equal(extended.response.status, 202);
    assert.equal(extended.body.queueItem.availabilityTier, 'extended_eta_window');

    const state = await jsonRequest(ctx.baseUrl, '/api/state', { headers: { 'x-ops-token': 'test-token' } });
    assert.equal(state.response.status, 200);
    assert.ok(state.body.dispatchQueue.some((item) => item.locationState === 'TX'));
    assert.ok(state.body.dispatchQueue.some((item) => item.availabilityTier === 'extended_eta_window'));
  } finally {
    await ctx.stop();
  }
});

test('rejects incident intake when technician ETA exceeds internal threshold', async () => {
  const ctx = await startTestServer({
    dispatchEtaPreferredMinutes: 90,
    dispatchEtaMaxMinutes: 120
  });
  try {
    const denied = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        description: 'No local technician available within threshold',
        serviceType: 'battery_electrical_help',
        technicianEtaMinutes: 121,
        locationState: 'WA'
      })
    });
    assert.equal(denied.response.status, 422);
    assert.equal(denied.body.code, 'ETA_THRESHOLD_EXCEEDED');
    assert.equal(denied.body.thresholdMinutes, 120);

    const audit = await jsonRequest(ctx.baseUrl, '/api/audit', { headers: { 'x-ops-token': 'test-token' } });
    assert.ok(audit.body.events.some((event) => event.type === 'dispatch.eta_threshold_exceeded'));
  } finally {
    await ctx.stop();
  }
});

test('supports full work-order transitions through closeout with idempotency', async () => {
  const ctx = await startTestServer();
  try {
    const created = await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ description: 'Battery diagnostics requested', serviceType: 'battery_electrical_help' })
    });
    const queueId = created.body.queueItem.id;
    await jsonRequest(ctx.baseUrl, `/api/dispatch/${queueId}/approve`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ operator: 'Dispatcher One' })
    });
    await jsonRequest(ctx.baseUrl, `/api/work-orders/${queueId}/transition`, {
      method: 'POST',
      headers: authHeaders({ 'idempotency-key': 'assign-1' }),
      body: JSON.stringify({ transition: 'technician_assigned', operator: 'Dispatcher One', technician: 'Tech 9' })
    });
    await jsonRequest(ctx.baseUrl, `/api/work-orders/${queueId}/transition`, {
      method: 'POST',
      headers: authHeaders({ 'idempotency-key': 'in-progress-1' }),
      body: JSON.stringify({ transition: 'in_progress', operator: 'Tech 9' })
    });
    await jsonRequest(ctx.baseUrl, `/api/work-orders/${queueId}/transition`, {
      method: 'POST',
      headers: authHeaders({ 'idempotency-key': 'completed-1' }),
      body: JSON.stringify({ transition: 'completed', operator: 'Tech 9', completionNotes: 'Battery cables repaired and verified.' })
    });
    const closed = await jsonRequest(ctx.baseUrl, `/api/work-orders/${queueId}/transition`, {
      method: 'POST',
      headers: authHeaders({ 'idempotency-key': 'closed-1' }),
      body: JSON.stringify({ transition: 'closed', operator: 'Dispatcher One', customerSafeSummary: 'Service complete and unit ready.' })
    });
    assert.equal(closed.response.status, 200);
    const replay = await jsonRequest(ctx.baseUrl, `/api/work-orders/${queueId}/transition`, {
      method: 'POST',
      headers: authHeaders({ 'idempotency-key': 'closed-1' }),
      body: JSON.stringify({ transition: 'closed', operator: 'Dispatcher One', customerSafeSummary: 'Service complete and unit ready.' })
    });
    assert.deepEqual(replay.body, closed.body);
    const state = await jsonRequest(ctx.baseUrl, '/api/state', { headers: { 'x-ops-token': 'test-token' } });
    assert.equal(state.body.dispatchQueue[0].status, 'closed');
    assert.equal(state.body.dispatchQueue[0].assignedTechnician, 'Tech 9');
  } finally {
    await ctx.stop();
  }
});

test('replays the original idempotent incident response shape and status', async () => {
  const ctx = await startTestServer();
  try {
    const options = {
      method: 'POST',
      headers: authHeaders({ 'idempotency-key': 'fixed-key' }),
      body: JSON.stringify({ description: 'Battery diagnostics requested', serviceType: 'battery_electrical_help' })
    };
    const first = await jsonRequest(ctx.baseUrl, '/api/incidents', options);
    const replay = await jsonRequest(ctx.baseUrl, '/api/incidents', options);
    assert.equal(first.response.status, 202);
    assert.equal(replay.response.status, 202);
    assert.deepEqual(replay.body, first.body);
  } finally {
    await ctx.stop();
  }
});

test('recovers persisted state after restart', async () => {
  const dataDir = makeTempDir();
  const first = createServer({
    port: 0,
    dataDir,
    opsToken: 'test-token',
    simulationMode: true,
    secureBrowserAllowlist: ['https://portal.example.com'],
    mediaAllowlist: ['https://demo.example.com'],
    silent: true
  });
  const firstPort = await first.start();
  const firstBase = `http://127.0.0.1:${firstPort}`;
  await jsonRequest(firstBase, '/api/incidents', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ description: 'Restart persistence test', serviceType: 'battery_electrical_help' })
  });
  await first.stop();

  const second = createServer({
    port: 0,
    dataDir,
    opsToken: 'test-token',
    simulationMode: true,
    secureBrowserAllowlist: ['https://portal.example.com'],
    mediaAllowlist: ['https://demo.example.com'],
    silent: true
  });
  const secondPort = await second.start();
  try {
    const secondBase = `http://127.0.0.1:${secondPort}`;
    const state = await jsonRequest(secondBase, '/api/state', { headers: { 'x-ops-token': 'test-token' } });
    assert.equal(state.response.status, 200);
    assert.ok(state.body.dispatchQueue.length >= 1);
  } finally {
    await second.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
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

test('returns technician copilot response for authorized sources and escalates legal domain', async () => {
  const ctx = await startTestServer({ technicianKnowledgeSources: ['internal_sop'] });
  try {
    const denied = await jsonRequest(ctx.baseUrl, '/api/technician/copilot', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ source: 'unauthorized', engineVehicle: 'Volvo D13', codeFamily: 'SPN/FMI' })
    });
    assert.equal(denied.response.status, 403);

    const allowed = await jsonRequest(ctx.baseUrl, '/api/technician/copilot', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ source: 'internal_sop', domain: 'legal', engineVehicle: 'Volvo D13', codeFamily: 'SPN/FMI' })
    });
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.result.source, 'internal_sop');
    assert.equal(allowed.body.result.escalation, 'professional_review_required');
  } finally {
    await ctx.stop();
  }
});

test('supports backup export and restore APIs', async () => {
  const ctx = await startTestServer();
  try {
    await jsonRequest(ctx.baseUrl, '/api/incidents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ description: 'Backup export test', serviceType: 'battery_electrical_help' })
    });
    const exported = await jsonRequest(ctx.baseUrl, '/api/admin/backup/export', {
      method: 'GET',
      headers: { 'x-ops-token': 'test-token' }
    });
    assert.equal(exported.response.status, 200);
    assert.ok(Array.isArray(exported.body.audit));
    assert.ok(exported.body.state.dispatchQueue.length >= 1);

    exported.body.state.dispatchQueue = [];
    const restore = await jsonRequest(ctx.baseUrl, '/api/admin/backup/restore', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(exported.body)
    });
    assert.equal(restore.response.status, 202);
    const state = await jsonRequest(ctx.baseUrl, '/api/state', { headers: { 'x-ops-token': 'test-token' } });
    assert.equal(state.response.status, 200);
    assert.equal(state.body.dispatchQueue.length, 0);
  } finally {
    await ctx.stop();
  }
});

test('rejects malformed backup restore payloads', async () => {
  const ctx = await startTestServer();
  try {
    const malformed = await jsonRequest(ctx.baseUrl, '/api/admin/backup/restore', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ state: { bad: true }, audit: ['not-an-object'] })
    });
    assert.equal(malformed.response.status, 400);
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

test('expires authenticated SSE sessions when the TTL is reached', async () => {
  const ctx = await startTestServer({ sseSessionTtlMs: 50 });
  try {
    const url = new URL('/api/events', ctx.baseUrl);
    const req = http.request({
      method: 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'x-ops-token': 'test-token', connection: 'close' }
    });
    req.end();
    const [res] = await once(req, 'response');
    res.resume();
    await once(res, 'end');
  } finally {
    await ctx.stop();
  }
});

test('can stop safely before the server starts listening', async () => {
  const dataDir = makeTempDir();
  const app = createServer({ port: 0, dataDir, opsToken: 'test-token', silent: true });
  await app.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
