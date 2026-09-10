import APIKey from '../models/APIKeys.js';
import APIStatus from '../models/APIStatus.js';

class ApiKeyManager {
    constructor() {
        this.pool = [];
        this.isInitialized = false;
        this.suspensionCache = new Map();
    }

    async loadKeys() {
        try {
            const keys = await APIKey.find({ isActive: true });
            if (!keys || keys.length === 0) {
                console.warn('⚠️ No active API Keys found in Database.');
                this.pool = [];
                return;
            }

            this.pool = keys.map(k => ({
                key: k.key,
                name: k.name,
                exhausted: false,
                lastUsed: 0
            }));

            this.isInitialized = true;
            console.log(`✅ Loaded ${this.pool.length} API Keys from DB.`);
        } catch (error) {
            console.error('❌ Failed to load API Keys:', error);
        }
    }

    async _getNextKey(modelId) {
        if (!this.isInitialized || this.pool.length === 0) {
            await this.loadKeys();
        }

        if (this.pool.length === 0) {
            throw new Error('No active API keys available.');
        }

        const validKeys = [];
        const now = Date.now();

        for (const entry of this.pool) {
            const cacheKey = `${entry.key}_${modelId}`;
            const suspendedUntil = this.suspensionCache.get(cacheKey);

            if (!suspendedUntil || suspendedUntil <= now) {
                validKeys.push(entry);
            }
        }

        if (validKeys.length === 0) {
            console.warn('All keys suspended, forcing DB reload...');
            await this.loadKeys();

            // Re-check after reload
            const retryValidKeys = [];
            for (const entry of this.pool) {
                const cacheKey = `${entry.key}_${modelId}`;
                const suspendedUntil = this.suspensionCache.get(cacheKey);
                if (!suspendedUntil || suspendedUntil <= now) {
                    retryValidKeys.push(entry);
                }
            }

            if (retryValidKeys.length === 0) {
                // Desperation: Try random key
                const desperateKey = this.pool[Math.floor(Math.random() * this.pool.length)];
                console.warn("⚠️ All keys suspended. Trying a random key in desperation...");
                return desperateKey.key;
            }

            validKeys.push(...retryValidKeys);
        }

        // --- FAIRNESS LOGIC: RANDOM SELECTION ---
        const randomIndex = Math.floor(Math.random() * validKeys.length);
        const entry = validKeys[randomIndex];
        entry.lastUsed = now;
        return entry.key;
    }

    async suspendKey(key, modelId, ms, reason = 'RATE_LIMIT') {
        const until = Date.now() + ms;
        const cacheKey = `${key}_${modelId}`;
        this.suspensionCache.set(cacheKey, until);

        try {
            await APIStatus.findOneAndUpdate(
                { key, model: modelId },
                { suspendedUntil: until, reason: reason },
                { upsert: true }
            );
            console.warn(`⏳ Suspended key ...${key.slice(-4)} for ${Math.round(ms / 1000)}s on ${modelId} (${reason})`);
        } catch (e) {
            console.error('Failed to save APIStatus:', e);
        }
    }

    async markLeaked(key) {
        try {
            await APIKey.updateOne({ key }, { isActive: false, name: 'LEAKED - DISABLED' });
            console.error(`🚫 Key ...${key.slice(-4)} marked as LEAKED and disabled.`);
            await this.loadKeys();
        } catch (e) {
            console.error('Failed to mark key leaked:', e);
        }
    }

    async execute(modelId, task) {
        if (!this.isInitialized || this.pool.length === 0) {
            await this.loadKeys();
        }

        const MAX_RETRIES = this.pool.length > 0 ? this.pool.length * 2 : 5;
        let attempt = 0;
        let lastError = null;

        while (attempt < MAX_RETRIES) {
            let key;
            try {
                key = await this._getNextKey(modelId);
            } catch (e) {
                console.warn(`⚠️ ${e.message}`);
                throw e;
            }

            try {
                const result = await task(key);

                // --- SUCCESS UPDATE DB (Async) ---
                // Fire and forget update to not block response
                APIKey.updateOne({ key: key }, {
                    $inc: { usageCount: 1 },
                    $set: { lastUsed: Date.now() }
                }).exec().catch(err => console.error('Failed to update Key usage stats:', err));

                return result;
            } catch (e) {
                lastError = e;

                if (e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError) {
                    console.error(`❌ CODE BUG (NON-RETRYABLE): ${e.message}`, e.stack);
                    throw e;
                }

                const statusCode = e.status || 500;
                const errorMessage = e.message || '';

                let suspendMs = 0;
                let reason = 'ERROR';
                let shouldSuspend = false;

                // --- PRIORITY ERROR LOGIC ---
                if (statusCode === 429 || errorMessage.includes('429') || errorMessage.includes('quota')) {
                    suspendMs = 15 * 60 * 1000; // 15 mins
                    reason = 'RATE_LIMIT_429';
                    shouldSuspend = true;
                }
                else if (statusCode === 400 || errorMessage.includes('invalid_request') || errorMessage.includes('INVALID_ARGUMENT')) {
                    console.error(`❌ BAD REQUEST (NON-RETRYABLE): ${errorMessage}`);
                    shouldSuspend = false;
                    throw e; // Stop immediately
                }
                else if (statusCode === 503 || errorMessage.includes('503') || errorMessage.includes('overloaded')) {
                    suspendMs = 3 * 60 * 1000; // 3 mins
                    reason = 'SERVICE_UNAVAILABLE_503';
                    shouldSuspend = true;
                }
                else if (statusCode === 500 || errorMessage.includes('500')) {
                    suspendMs = 60 * 1000; // 1 min
                    reason = 'INTERNAL_ERROR_500';
                    shouldSuspend = true;
                }
                else if (statusCode === 403 || errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('API_KEY_INVALID')) {
                    await this.markLeaked(key);
                    shouldSuspend = false;
                } else {
                    const statusCodeText = statusCode ? statusCode.toString() : 'UNKNOWN';
                    console.warn(`⚠️ Generic error ${statusCodeText}: ${errorMessage}`);
                    suspendMs = 30 * 1000;
                    reason = `GENERIC_${statusCodeText}`;
                    shouldSuspend = true;
                }

                if (shouldSuspend && suspendMs > 0) {
                    await this.suspendKey(key, modelId, suspendMs, reason);
                }

                attempt++;

                const backoff = Math.min(1000 * Math.pow(1.5, attempt), 10000);
                if (attempt < MAX_RETRIES) {
                    console.log(`🔄 Retrying... (${attempt}/${MAX_RETRIES}) in ${Math.round(backoff)}ms`);
                    await new Promise(r => setTimeout(r, backoff));
                }
            }
        }

        throw new Error(`Failed after ${attempt} attempts. Last error: ${lastError?.message}`);
    }
}

export default new ApiKeyManager();