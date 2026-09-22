const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class CompanySafeError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.name = 'CompanySafeError';
        this.status = status;
    }
}

class CompanySafe {
    constructor(options = {}) {
        this.dataDir = options.dataDir || __dirname;
        this.filePath = options.filePath || path.join(this.dataDir, 'company_safe.json');
        fs.mkdirSync(this.dataDir, { recursive: true });
    }

    isInitialized() {
        return fs.existsSync(this.filePath);
    }

    initialize(code) {
        this.validateCode(code);
        if (this.isInitialized()) {
            throw new CompanySafeError('The Company Safe has already been created.', 409);
        }

        const salt = crypto.randomBytes(16);
        const key = this.deriveKey(code, salt);
        try {
            this.writeEncrypted({ version: 1, entries: [] }, salt, key);
        } finally {
            key.fill(0);
        }
    }

    unlock(code) {
        this.validateCode(code);
        const encrypted = this.readEncrypted();
        const key = this.deriveKey(code, Buffer.from(encrypted.salt, 'base64'));
        try {
            return this.decrypt(encrypted, key);
        } catch (error) {
            if (error instanceof CompanySafeError) {
                throw error;
            }
            throw new CompanySafeError('The unlock code is not valid.', 401);
        } finally {
            key.fill(0);
        }
    }

    addEntry(code, entry) {
        const vault = this.unlock(code);
        const normalizedEntry = this.normalizeEntry(entry);
        vault.entries.push(normalizedEntry);
        this.save(code, vault);
        return normalizedEntry;
    }

    removeEntry(code, id) {
        const vault = this.unlock(code);
        const index = vault.entries.findIndex(entry => entry.id === id);
        if (index === -1) {
            throw new CompanySafeError('Safe entry not found.', 404);
        }
        vault.entries.splice(index, 1);
        this.save(code, vault);
    }

    validateCode(code) {
        if (typeof code !== 'string' || code.length < 12 || code.length > 256) {
            throw new CompanySafeError('Use an unlock code between 12 and 256 characters.', 400);
        }
    }

    normalizeEntry(entry) {
        const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
        const category = typeof entry?.category === 'string' ? entry.category.trim() : '';
        const secret = typeof entry?.secret === 'string' ? entry.secret : '';
        const notes = typeof entry?.notes === 'string' ? entry.notes : '';
        if (!title || title.length > 120 || !category || category.length > 60) {
            throw new CompanySafeError('A title and category are required.', 400);
        }
        if (secret.length > 10000 || notes.length > 10000) {
            throw new CompanySafeError('Safe entry content is too large.', 400);
        }
        return {
            id: crypto.randomUUID(),
            title,
            category,
            secret,
            notes,
            createdAt: new Date().toISOString()
        };
    }

    save(code, vault) {
        const encrypted = this.readEncrypted();
        const salt = Buffer.from(encrypted.salt, 'base64');
        const key = this.deriveKey(code, salt);
        try {
            this.writeEncrypted(vault, salt, key);
        } finally {
            key.fill(0);
        }
    }

    readEncrypted() {
        if (!this.isInitialized()) {
            throw new CompanySafeError('The Company Safe has not been created yet.', 404);
        }
        let encrypted;
        try {
            encrypted = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        } catch (error) {
            throw new CompanySafeError(`The Company Safe file cannot be read: ${error.message}`);
        }
        if (!encrypted || encrypted.version !== 1 || !encrypted.salt || !encrypted.iv || !encrypted.tag || !encrypted.ciphertext) {
            throw new CompanySafeError('The Company Safe file is corrupted.');
        }
        return encrypted;
    }

    deriveKey(code, salt) {
        return crypto.scryptSync(code, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    }

    decrypt(encrypted, key) {
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
            decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
            const plaintext = Buffer.concat([
                decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
                decipher.final()
            ]);
            const vault = JSON.parse(plaintext.toString('utf8'));
            if (!Array.isArray(vault.entries)) {
                throw new Error('Vault entries are invalid.');
            }
            return vault;
        } catch {
            throw new CompanySafeError('The unlock code is not valid.', 401);
        }
    }

    writeEncrypted(vault, salt, key) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(vault), 'utf8'), cipher.final()]);
        const payload = {
            version: 1,
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            ciphertext: ciphertext.toString('base64'),
            updatedAt: new Date().toISOString()
        };
        const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            fs.writeFileSync(temporaryPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(temporaryPath, this.filePath);
        } catch (error) {
            if (fs.existsSync(temporaryPath)) {
                fs.unlinkSync(temporaryPath);
            }
            throw new CompanySafeError(`Unable to save the Company Safe: ${error.message}`);
        }
    }
}

module.exports = { CompanySafe, CompanySafeError };
