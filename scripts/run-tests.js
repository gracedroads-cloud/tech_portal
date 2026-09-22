#!/usr/bin/env node
// Root test entry point. Discovers *.test.js files under the three suite
// directories and runs them with node --test. Exists because:
//   - the default `node --test` discovery also picks up frontend/ Jest tests,
//     which Node cannot execute;
//   - glob arguments to `node --test` need Node 21+, while this repo supports
//     Node 20 (see .nvmrc and package.json engines).
// New test files under these directories are picked up automatically.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SUITE_DIRS = ['test', 'tests', path.join('isolated-ops-command', 'test')];
const TEST_FILE = /\.test\.(?:c|m)?js$/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        walk(full, out);
      }
    } else if (TEST_FILE.test(entry.name)) {
      out.push(full);
    }
  }
}

const files = [];
for (const dir of SUITE_DIRS) {
  walk(path.join(process.cwd(), dir), files);
}

if (!files.length) {
  console.error('No test files found under', SUITE_DIRS.join(', '));
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--test', ...extraArgs, ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
