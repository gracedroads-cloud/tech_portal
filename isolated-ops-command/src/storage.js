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
    paths: { statePath, auditPath }
  };
}

module.exports = { createStorage };
