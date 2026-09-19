const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function atomicWriteJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + os.EOL, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw new Error(`Unable to parse persisted JSON state at ${filePath}: ${error.message}`);
  }
}

function readJsonLines(filePath, limit = 100) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      return { type: 'parse_error', at: new Date().toISOString() };
    }
  });
}

function createStorage(dataDir) {
  ensureDir(dataDir);
  const statePath = path.join(dataDir, 'ops-state.json');
  const auditPath = path.join(dataDir, 'audit.log.jsonl');

  return {
    auditPath,
    dataDir,
    loadState(defaultState) {
      return readJson(statePath, defaultState);
    },
    probeWritable() {
      ensureDir(dataDir);
      const probePath = path.join(dataDir, `.write-probe-${randomUUID()}.tmp`);
      fs.writeFileSync(probePath, 'ok', 'utf8');
      fs.rmSync(probePath, { force: true });
    },
    saveState(state) {
      atomicWriteJson(statePath, state);
    },
    appendAudit(event) {
      ensureDir(path.dirname(auditPath));
      fs.appendFileSync(auditPath, JSON.stringify(event) + os.EOL, 'utf8');
    },
    readAudit(limit) {
      return readJsonLines(auditPath, limit);
    },
    exportSnapshot() {
      return {
        exportedAt: new Date().toISOString(),
        schemaVersion: 1,
        state: readJson(statePath, {}),
        audit: readJsonLines(auditPath, Number.MAX_SAFE_INTEGER)
      };
    },
    restoreSnapshot(snapshot) {
      const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const state = safeSnapshot.state && typeof safeSnapshot.state === 'object'
        ? safeSnapshot.state
        : {};
      const audit = Array.isArray(safeSnapshot.audit) ? safeSnapshot.audit : [];
      atomicWriteJson(statePath, state);
      const content = audit.map((entry) => JSON.stringify(entry)).join(os.EOL);
      fs.writeFileSync(auditPath, content ? content + os.EOL : '', 'utf8');
    },
    paths: { statePath, auditPath }
  };
}

module.exports = { createStorage };
