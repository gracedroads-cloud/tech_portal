const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('main and backup dashboards align to Grace API and Lehigh Valley watch center', () => {
  const main = read('public/business_dashboard.html');
  const backupConsole = read('public/grace_dispatch_console.html');
  const backupScanner = read('public/breakdown_scanner.html');
  const backupStream = read('public/grace_stream_monitor.html');

  assert.match(main, /\/api\/grace\/call\/answer/);
  assert.match(main, /Lehigh Valley fallback/);

  assert.match(backupConsole, /\/api\/grace\/call\/answer/);
  assert.match(backupConsole, /\/api\/grace\/call\/work-order-create/);
  assert.match(backupConsole, /Heavy-duty mobile diesel repair only/);

  assert.match(backupScanner, /\/api\/watch-center/);
  assert.match(backupScanner, /\/api\/breakdowns\/scanner/);
  assert.match(backupScanner, /150 miles/);

  assert.match(backupStream, /\/api\/status/);
  assert.match(backupStream, /\/api\/stream\/override/);
  assert.match(backupStream, /\/api\/grace\/calls/);
});

test('cleanup removed sensitive-like routing/account strings and Easton-only legacy claims from backup pages', () => {
  const files = [
    'public/grace_dispatch_console.html',
    'public/breakdown_scanner.html',
    'public/grace_stream_monitor.html',
    'public/master_hub.html',
    'public/client_onboarding.html',
    'public/owners_draw_vault.html'
  ];

  const bannedPatterns = [
    /RTN\b/i,
    /routing\s*number/i,
    /\bACCT\b/i,
    /account\s*number/i,
    /Easton/i
  ];

  files.forEach((file) => {
    const content = read(file);
    bannedPatterns.forEach((pattern) => {
      assert.equal(pattern.test(content), false, `${file} contains banned pattern ${pattern}`);
    });
  });
});
