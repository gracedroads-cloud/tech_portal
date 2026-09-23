const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

const originalDataDir = process.env.DATA_DIR;
delete process.env.DATA_DIR;

const appModule = require('../app');
const app = appModule.app || appModule;

if (originalDataDir !== undefined) {
  process.env.DATA_DIR = originalDataDir;
}

const dataDir = path.resolve(__dirname, '..', '..', 'data');
const graceDataDir = path.join(dataDir, 'grace_calls');
const auditLogPath = path.join(dataDir, 'grace_audit.log');
const hadDataDir = fs.existsSync(dataDir);
const hadGraceDataDir = fs.existsSync(graceDataDir);
const initialCallFiles = hadGraceDataDir ? new Set(fs.readdirSync(graceDataDir)) : new Set();
const initialAuditLog = fs.existsSync(auditLogPath) ? fs.readFileSync(auditLogPath) : null;

let server;
let baseUrl;

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(route, baseUrl);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));

  if (fs.existsSync(graceDataDir)) {
    for (const file of fs.readdirSync(graceDataDir)) {
      if (!initialCallFiles.has(file)) {
        fs.rmSync(path.join(graceDataDir, file), { force: true });
      }
    }
  }

  if (initialAuditLog === null) {
    fs.rmSync(auditLogPath, { force: true });
  } else {
    fs.writeFileSync(auditLogPath, initialAuditLog);
  }

  if (!hadGraceDataDir && fs.existsSync(graceDataDir) && fs.readdirSync(graceDataDir).length === 0) {
    fs.rmdirSync(graceDataDir);
  }
  if (!hadDataDir && fs.existsSync(dataDir) && fs.readdirSync(dataDir).length === 0) {
    fs.rmdirSync(dataDir);
  }
});

test('default Grace data files are not publicly readable', async () => {
  const answered = await request('POST', '/api/grace/answer', { caller: { phone: '+1-610-555-2222' } });
  assert.equal(answered.status, 200);

  const { callId } = JSON.parse(answered.body);
  assert.equal(fs.existsSync(path.join(graceDataDir, `${callId}.json`)), true);
  assert.equal(fs.existsSync(auditLogPath), true);

  const callFileResponse = await request('GET', `/data/grace_calls/${callId}.json`);
  assert.equal(callFileResponse.status, 404);

  const auditFileResponse = await request('GET', '/data/grace_audit.log');
  assert.equal(auditFileResponse.status, 404);
});
