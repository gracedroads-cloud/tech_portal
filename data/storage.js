const { DatabaseSync } = require('node:sqlite');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class DispatchStorageError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'DispatchStorageError';
        this.cause = cause;
    }
}

class DispatchStorage extends EventEmitter {
    constructor(options = {}) {
        super();
        this.dataDir = options.dataDir || __dirname;
        this.filePath = options.filePath || path.join(this.dataDir, 'dispatches.sqlite');
        this.legacyFilePath = options.legacyFilePath || path.join(this.dataDir, 'radio_dispatch_logs.json');
        this.initialize();
    }

    initialize() {
        try {
            fs.mkdirSync(this.dataDir, { recursive: true });
            const shouldMigrateLegacyData = !fs.existsSync(this.filePath) && fs.existsSync(this.legacyFilePath);
            this.database = new DatabaseSync(this.filePath);
            this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
            this.database.exec(`
                CREATE TABLE IF NOT EXISTS dispatches (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    status TEXT NOT NULL,
                    input_json TEXT NOT NULL,
                    output_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS billing_line_items (
                    dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
                    label TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    PRIMARY KEY (dispatch_id, label)
                );
                CREATE TABLE IF NOT EXISTS compliance_records (
                    dispatch_id TEXT PRIMARY KEY REFERENCES dispatches(id) ON DELETE CASCADE,
                    pa_regulations TEXT,
                    safety_protocol TEXT,
                    epa_compliance TEXT,
                    audit_timestamp TEXT
                );
                CREATE TABLE IF NOT EXISTS dvir_inspections (
                    dispatch_id TEXT PRIMARY KEY REFERENCES dispatches(id) ON DELETE CASCADE,
                    inspection_json TEXT NOT NULL,
                    saved_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_dispatches_timestamp ON dispatches(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_dispatches_status_timestamp ON dispatches(status, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_billing_line_items_dispatch ON billing_line_items(dispatch_id);
                CREATE TABLE IF NOT EXISTS oem_manuals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_manual TEXT NOT NULL,
                    chunk_text TEXT NOT NULL,
                    page_number INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_oem_manuals_source_page ON oem_manuals(source_manual, page_number);
            `);

            if (shouldMigrateLegacyData) {
                this.migrateLegacyJson();
            }
        } catch (error) {
            throw new DispatchStorageError(`Unable to initialize dispatch storage: ${error.message}`, error);
        }
    }

    migrateLegacyJson() {
        let legacyRecords;
        try {
            legacyRecords = JSON.parse(fs.readFileSync(this.legacyFilePath, 'utf8'));
        } catch (error) {
            throw new DispatchStorageError(`Unable to migrate legacy dispatch storage: ${error.message}`, error);
        }

        if (!Array.isArray(legacyRecords)) {
            throw new DispatchStorageError('Legacy dispatch storage is invalid: expected a JSON array.');
        }

        legacyRecords.forEach(record => {
            const normalizedRecord = record.input || record.output
                ? record
                : {
                    ...record,
                    input: record,
                    output: {}
                };
            this.append(normalizedRecord);
        });
    }

    append(record) {
        if (!record || typeof record !== 'object' || Array.isArray(record) || !record.id) {
            throw new DispatchStorageError('Dispatch record must be an object with an ID.');
        }

        const now = new Date().toISOString();
        const inputJson = this.stringify(record.input || {});
        const outputJson = this.stringify(record.output || {});
        const billing = record.output && record.output.billing;
        const compliance = record.output && record.output.compliance;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            this.database.prepare(`
                INSERT INTO dispatches (id, timestamp, status, input_json, output_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(record.id, record.timestamp || now, record.status || 'completed', inputJson, outputJson, now, now);

            if (billing && billing.lineItems) {
                const insertLineItem = this.database.prepare(
                    'INSERT INTO billing_line_items (dispatch_id, label, amount) VALUES (?, ?, ?)'
                );
                Object.entries(billing.lineItems).forEach(([label, amount]) => {
                    insertLineItem.run(record.id, label, String(amount));
                });
            }

            if (compliance) {
                this.database.prepare(`
                    INSERT INTO compliance_records (dispatch_id, pa_regulations, safety_protocol, epa_compliance, audit_timestamp)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    record.id,
                    compliance.paRegulations || null,
                    compliance.safetyProtocol || null,
                    compliance.epasCompliance || null,
                    compliance.auditTimestamp || null
                );
            }
            this.database.exec('COMMIT');
        } catch (error) {
            this.rollback();
            throw new DispatchStorageError(`Unable to save dispatch record: ${error.message}`, error);
        }

        this.emit('dispatch:created', record);
        return record;
    }

    getRecent(limit = 50) {
        if (!Number.isInteger(limit) || limit < 1) {
            throw new DispatchStorageError('Log limit must be a positive integer.');
        }

        try {
            const rows = this.database.prepare(`
                SELECT id, timestamp, status, input_json, output_json
                FROM dispatches
                ORDER BY timestamp DESC
                LIMIT ?
            `).all(limit);
            return rows.map(row => this.deserializeRecord(row));
        } catch (error) {
            throw new DispatchStorageError(`Unable to read dispatch storage: ${error.message}`, error);
        }
    }

    attachInspection(id, inspection) {
        if (typeof id !== 'string' || id.trim() === '') {
            throw new DispatchStorageError('Dispatch ID is required for an inspection.');
        }
        if (!inspection || typeof inspection !== 'object' || Array.isArray(inspection)) {
            throw new DispatchStorageError('Inspection data must be an object.');
        }

        const savedAt = new Date().toISOString();
        const inspectionWithTimestamp = { ...inspection, savedAt };
        try {
            const result = this.database.prepare('SELECT id FROM dispatches WHERE id = ?').get(id);
            if (!result) {
                throw new DispatchStorageError(`Dispatch record not found: ${id}`);
            }
            this.database.exec('BEGIN IMMEDIATE');
            this.database.prepare(`
                INSERT INTO dvir_inspections (dispatch_id, inspection_json, saved_at)
                VALUES (?, ?, ?)
                ON CONFLICT(dispatch_id) DO UPDATE SET inspection_json = excluded.inspection_json, saved_at = excluded.saved_at
            `).run(id, this.stringify(inspectionWithTimestamp), savedAt);
            this.database.prepare('UPDATE dispatches SET updated_at = ? WHERE id = ?').run(savedAt, id);
            this.database.exec('COMMIT');
        } catch (error) {
            this.rollback();
            if (error instanceof DispatchStorageError) {
                throw error;
            }
            throw new DispatchStorageError(`Unable to save dispatch inspection: ${error.message}`, error);
        }

        const record = this.getDispatch(id);
        this.emit('dispatch:updated', record);
        return record;
    }

    getDispatch(id) {
        try {
            const row = this.database.prepare(`
                SELECT id, timestamp, status, input_json, output_json
                FROM dispatches
                WHERE id = ?
            `).get(id);
            return row ? this.deserializeRecord(row) : null;
        } catch (error) {
            throw new DispatchStorageError(`Unable to read dispatch record: ${error.message}`, error);
        }
    }

    getDatabase() {
        return this.database;
    }

    getPredictiveMaintenanceInsights() {
        try {
            const rows = this.database.prepare(`
                SELECT
                    COALESCE(
                        json_extract(output_json, '$.billing.carrierAccount'),
                        json_extract(input_json, '$.carrier'),
                        'STANDARD FLEET'
                    ) AS carrier,
                    COALESCE(
                        json_extract(output_json, '$.location'),
                        json_extract(output_json, '$.breakdownLocation'),
                        json_extract(input_json, '$.location'),
                        json_extract(input_json, '$.breakdownLocation'),
                        'Unknown corridor'
                    ) AS corridor,
                    COUNT(*) AS total_breakdowns,
                    MAX(timestamp) AS last_service
                FROM dispatches
                WHERE status = 'completed'
                GROUP BY carrier, corridor
                HAVING COUNT(*) >= 2
                ORDER BY total_breakdowns DESC, last_service DESC
            `).all();
            return rows.map(row => ({
                carrier: row.carrier,
                corridor: row.corridor,
                totalBreakdowns: row.total_breakdowns,
                lastService: row.last_service,
                riskScore: Math.min(row.total_breakdowns * 25, 100),
                recommendation: `Proactively schedule preventive aftertreatment and brake inspection for ${row.carrier} along ${row.corridor}.`
            }));
        } catch (error) {
            throw new DispatchStorageError(`Unable to generate predictive maintenance analytics: ${error.message}`, error);
        }
    }

    deserializeRecord(row) {
        const inspectionRow = this.database.prepare(
            'SELECT inspection_json FROM dvir_inspections WHERE dispatch_id = ?'
        ).get(row.id);
        return {
            id: row.id,
            timestamp: row.timestamp,
            status: row.status,
            input: this.parse(row.input_json, `dispatch ${row.id} input`),
            output: this.parse(row.output_json, `dispatch ${row.id} output`),
            ...(inspectionRow ? { inspection: this.parse(inspectionRow.inspection_json, `dispatch ${row.id} inspection`) } : {})
        };
    }

    stringify(value) {
        try {
            return JSON.stringify(value);
        } catch (error) {
            throw new DispatchStorageError(`Unable to serialize dispatch data: ${error.message}`, error);
        }
    }

    parse(value, context) {
        try {
            return JSON.parse(value);
        } catch (error) {
            throw new DispatchStorageError(`Dispatch storage contains malformed JSON for ${context}: ${error.message}`, error);
        }
    }

    rollback() {
        try {
            this.database.exec('ROLLBACK');
        } catch (error) {
            if (!String(error.message).includes('no transaction is active')) {
                console.error('Unable to roll back dispatch transaction:', error);
            }
        }
    }
}

module.exports = DispatchStorage;
module.exports.DispatchStorage = DispatchStorage;
module.exports.DispatchStorageError = DispatchStorageError;
