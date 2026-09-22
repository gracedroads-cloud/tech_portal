const fs = require('fs');
const path = require('path');
const { createStorage } = require('./storage');

function usage() {
  process.stdout.write(
    'Usage:\n'
    + '  node src/backup-cli.js export --out /absolute/path/ops-backup.json\n'
    + '  node src/backup-cli.js restore --from /absolute/path/ops-backup.json\n'
  );
}

function parseFlag(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return process.argv[index + 1] || '';
}

function getDataDir() {
  if (process.env.ISOLATED_OPS_DATA_DIR) {
    return process.env.ISOLATED_OPS_DATA_DIR;
  }
  return path.resolve(__dirname, '..', 'data');
}

async function main() {
  const action = process.argv[2];
  const storage = createStorage(getDataDir());

  if (action === 'export') {
    const out = parseFlag('--out');
    if (!out || !path.isAbsolute(out)) {
      throw new Error('export requires --out with an absolute file path');
    }
    const snapshot = storage.exportSnapshot();
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    process.stdout.write(`Exported snapshot to ${out}\n`);
    return;
  }

  if (action === 'restore') {
    const from = parseFlag('--from');
    if (!from || !path.isAbsolute(from)) {
      throw new Error('restore requires --from with an absolute file path');
    }
    const parsed = JSON.parse(fs.readFileSync(from, 'utf8'));
    storage.restoreSnapshot(parsed);
    process.stdout.write(`Restored snapshot from ${from}\n`);
    return;
  }

  usage();
  throw new Error('unknown action');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
