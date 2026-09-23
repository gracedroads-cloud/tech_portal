const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

class RagEngine {
    constructor(database) {
        if (!database) {
            throw new TypeError('RagEngine requires a SQLite database instance.');
        }
        this.database = database;
        this.initialize();
    }

    initialize() {
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS oem_manuals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_manual TEXT NOT NULL,
                chunk_text TEXT NOT NULL,
                page_number INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_oem_manuals_source_page ON oem_manuals(source_manual, page_number);
        `);
    }

    async ingestManual(filePath, manualName = path.basename(filePath)) {
        if (path.extname(filePath).toLowerCase() !== '.pdf') {
            throw new Error('Only PDF OEM manuals can be ingested.');
        }

        const pdfData = await pdfParse(fs.readFileSync(filePath));
        const chunks = chunkManualText(pdfData.text);
        const insert = this.database.prepare(
            'INSERT INTO oem_manuals (source_manual, chunk_text, page_number) VALUES (?, ?, ?)'
        );

        try {
            this.database.exec('BEGIN IMMEDIATE');
            chunks.forEach((chunk, index) => insert.run(manualName, chunk, Math.floor(index / 3) + 1));
            this.database.exec('COMMIT');
        } catch (error) {
            try {
                this.database.exec('ROLLBACK');
            } catch {
                // The original database error is the useful failure.
            }
            throw new Error(`Unable to ingest ${manualName}: ${error.message}`);
        }

        return { manualName, chunkCount: chunks.length };
    }

    search(query, limit = 3) {
        const keywords = [...new Set(String(query || '').toLowerCase().match(/[a-z0-9-]{4,}/g) || [])];
        if (keywords.length === 0) {
            return [];
        }

        const conditions = keywords.map(() => 'LOWER(chunk_text) LIKE ?').join(' OR ');
        const parameters = [...keywords.map(keyword => `%${keyword}%`), limit];
        return this.database.prepare(`
            SELECT source_manual, chunk_text, page_number
            FROM oem_manuals
            WHERE ${conditions}
            LIMIT ?
        `).all(...parameters);
    }
}

function chunkManualText(text, maximumCharacters = 1200) {
    const paragraphs = String(text || '')
        .split(/\n\s*\n/)
        .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
        .filter(paragraph => paragraph.length > 40);
    const chunks = [];
    let current = '';

    paragraphs.forEach(paragraph => {
        if (current && current.length + paragraph.length + 1 > maximumCharacters) {
            chunks.push(current);
            current = '';
        }
        current = current ? `${current}\n${paragraph}` : paragraph;
    });
    if (current) {
        chunks.push(current);
    }
    return chunks;
}

module.exports = RagEngine;
module.exports.RagEngine = RagEngine;
module.exports.chunkManualText = chunkManualText;
