const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const auditWriteQueues = new Map();

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonAtomic(filePath, data) {
  const directory = path.dirname(filePath);
  await ensureDir(directory);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

function safeId(prefix) {
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  return `${prefix}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

async function storeRecord({ dataDir, collection, prefix, record }) {
  if (!/^[a-z0-9_-]+$/i.test(collection)) {
    throw new Error('invalid_collection_name');
  }

  const id = safeId(prefix);
  const createdAt = new Date().toISOString();
  const fullRecord = { ...record, id, createdAt };

  const collectionDir = path.resolve(dataDir, collection);
  const filePath = path.join(collectionDir, `${id}.json`);
  await writeJsonAtomic(filePath, fullRecord);

  const auditDir = path.resolve(dataDir, 'audit');
  await ensureDir(auditDir);
  const auditPath = path.join(auditDir, `${collection}.ndjson`);
  const auditEntry = JSON.stringify({ id, createdAt, collection, version: 1 });
  const previous = auditWriteQueues.get(auditPath) || Promise.resolve();
  const next = previous.then(() =>
    fs.appendFile(auditPath, `${auditEntry}\n`, { encoding: 'utf8', mode: 0o600 }),
  );
  auditWriteQueues.set(auditPath, next.catch(() => {}));
  await next;

  return fullRecord;
}

module.exports = {
  ensureDir,
  storeRecord,
};
