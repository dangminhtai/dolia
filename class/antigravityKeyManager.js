import { t as tr } from '../services/i18nService.js';
import APIKey from '../models/APIKeys.js';

/**
 * Quản lý API Key độc lập dành riêng cho Antigravity Agent.
 * Sử dụng chung các key từ GEMINI_*_KEY / GEMINI_API_KEY nhưng có vòng xoay,
 * bộ nhớ suspension cache, timeout (180s) và bộ nhớ đệm environment_id riêng biệt.
 */
class AntigravityKeyManager {
    constructor() {
        this.pool = [];
        this.isInitialized = false;
        this.index = 0;
        this.suspensionCache = new Map(); // `${key}_antigravity` -> timestamp (ms)
        this.cachedEnvironmentId = null;
        this.sessionEnvironments = new Map(); // sessionKey -> { environmentId, lastInteractionId, updatedAt }
    }

    /**
     * Nạp danh sách key từ process.env (ưu tiên ANTIGRAVITY_*_KEY, tiếp theo là GEMINI_*_KEY) và DB
     */
    async loadKeys() {
        const poolMap = new Map();

        // 1. Nạp từ process.env
        Object.entries(process.env).forEach(([envName, val]) => {
            const isAntiKey = envName.startsWith('ANTIGRAVITY_') && (envName.endsWith('_KEY') || envName.endsWith('_API_KEY'));
            const isGeminiKey = (envName.startsWith('GEMINI_') && envName.endsWith('_KEY')) || envName === 'GEMINI_API_KEY';
            
            if ((isAntiKey || isGeminiKey) && val && typeof val === 'string' && val.trim()) {
                const cleanKey = val.trim();
                poolMap.set(cleanKey, {
                    key: cleanKey,
                    name: envName,
                    exhausted: false,
                    lastUsed: 0
                });
            }
        });

        // 2. Nạp thêm từ Database nếu có
        try {
            const keys = await APIKey.find({ isActive: true });
            if (keys && keys.length > 0) {
                keys.forEach(k => {
                    if (k.key && !poolMap.has(k.key)) {
                        poolMap.set(k.key, {
                            key: k.key,
                            name: k.name || 'DB_KEY',
                            exhausted: false,
                            lastUsed: 0
                        });
                    }
                });
            }
        } catch (error) {
            console.warn(tr('logs.antigravitykeymanager.warn_antigravitykeymanager_could_not_query_api_keys_from'), error.message);
        }

        const prevExhausted = new Set(this.pool.filter(p => p.exhausted).map(p => p.key));
        this.pool = Array.from(poolMap.values()).map(entry => {
            if (prevExhausted.has(entry.key)) {
                entry.exhausted = true;
            }
            return entry;
        });

        if (this.pool.length === 0) {
            console.warn(tr('logs.antigravitykeymanager.warn_antigravitykeymanager_no_active_api_keys_found'));
            return;
        }

        this.isInitialized = true;
        console.log(tr('logs.antigravitykeymanager.log_antigravitykeymanager_loaded_api_keys_for_antigravity_agent', { length: this.pool.length }));
    }

    isSuspended(key, now = Date.now()) {
        const until = this.suspensionCache.get(key);
        if (!until) return false;
        if (now >= until) {
            this.suspensionCache.delete(key);
            return false;
        }
        return true;
    }

    suspendKey(key, durationMs = 60000, reason = 'COOLDOWN') {
        const until = Date.now() + durationMs;
        this.suspensionCache.set(key, until);
        const shortKey = key.slice(-4);
        console.log(tr('logs.antigravitykeymanager.log_antigravitykeymanager_suspended_key_for_s', { shortKey: shortKey, value: durationMs / 1000, reason: reason }));
    }

    async getNextKey() {
        if (!this.isInitialized || this.pool.length === 0) {
            await this.loadKeys();
        }

        if (this.pool.length === 0) {
            throw new Error('No active API keys available for Antigravity.');
        }

        const now = Date.now();
        const activePool = this.pool.filter(e => !e.exhausted);
        if (activePool.length === 0) {
            throw new Error('All API keys for Antigravity are permanently exhausted.');
        }

        for (let i = 0; i < activePool.length; i++) {
            const idx = (this.index + i) % activePool.length;
            const entry = activePool[idx];

            if (!this.isSuspended(entry.key, now)) {
                this.index = (idx + 1) % activePool.length;
                entry.lastUsed = now;
                return entry.key;
            }
        }

        // Nếu tất cả đang suspend, chọn key có thời gian chờ ngắn nhất
        let minUntil = Infinity;
        let chosenKey = null;
        for (const entry of activePool) {
            const until = this.suspensionCache.get(entry.key) || 0;
            if (until < minUntil) {
                minUntil = until;
                chosenKey = entry.key;
            }
        }

        const waitMs = Math.max(0, minUntil - now);
        if (waitMs > 0 && waitMs <= 10000) {
            console.log(tr('logs.antigravitykeymanager.log_antigravitykeymanager_all_keys_suspended_waiting_ms', { waitMs: waitMs }));
            await new Promise(r => setTimeout(r, waitMs));
            return chosenKey;
        }

        return activePool[this.index % activePool.length].key;
    }

    /**
     * Thực thi tác vụ Antigravity với timeout 180s và tối đa 2 lần thử (tránh kẹt 5 phút).
     */
    async execute(taskFn, options = {}) {
        const timeoutMs = options.timeoutMs || 180000; // 3 phút chuẩn cho Antigravity Cloud
        const maxRetries = options.maxRetries || 2; // Tối đa 2 lần thử
        let attempt = 0;
        let lastError = null;

        while (attempt < maxRetries) {
            const key = await this.getNextKey();
            const shortKey = key.slice(-4);

            let timeoutId = null;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    const err = new Error(`TIMEOUT_${timeoutMs / 1000}s: Antigravity task timed out after ${timeoutMs}ms`);
                    err.isTimeout = true;
                    reject(err);
                }, timeoutMs);
            });

            try {
                const executionPromise = taskFn(key);
                const result = await Promise.race([executionPromise, timeoutPromise]);
                clearTimeout(timeoutId);
                return result;
            } catch (error) {
                clearTimeout(timeoutId);
                lastError = error;

                if (error.isTimeout) {
                    console.warn(tr('logs.antigravitykeymanager.warn_antigravitykeymanager_key_timed_out_sau_ms_cooldown', { shortKey: shortKey, timeoutMs: timeoutMs }));
                    this.suspendKey(key, 30000, 'TIMEOUT');
                } else {
                    const msg = error.message || '';
                    if (msg.includes('429') || msg.includes('Quota exceeded') || msg.includes('RESOURCE_EXHAUSTED')) {
                        this.suspendKey(key, 60000, 'RATE_LIMIT_429');
                    } else if (msg.includes('403') || msg.includes('API_KEY_INVALID')) {
                        const entry = this.pool.find(p => p.key === key);
                        if (entry) entry.exhausted = true;
                    } else {
                        this.suspendKey(key, 20000, 'ERROR');
                    }
                }

                attempt++;
                if (attempt < maxRetries) {
                    console.log(tr('logs.antigravitykeymanager.log_antigravitykeymanager_retrying_with_next_key', { attempt: attempt, maxRetries: maxRetries }));
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }

        throw new Error(`Antigravity Agent failed after ${attempt} attempts. Last error: ${lastError?.message}`);
    }

    getEnvironmentId(sessionKey = null) {
        if (sessionKey && this.sessionEnvironments?.has(sessionKey)) {
            return this.sessionEnvironments.get(sessionKey);
        }
        return this.cachedEnvironmentId ? { environmentId: this.cachedEnvironmentId } : null;
    }

    setEnvironmentId(envId, sessionKey = null, interactionId = null) {
        this.cachedEnvironmentId = envId;
        if (sessionKey) {
            if (!this.sessionEnvironments) this.sessionEnvironments = new Map();
            const existing = this.sessionEnvironments.get(sessionKey) || {};
            this.sessionEnvironments.set(sessionKey, {
                environmentId: envId,
                lastInteractionId: interactionId || existing.lastInteractionId || null,
                updatedAt: Date.now()
            });
        }
    }

    clearEnvironmentId(sessionKey = null) {
        if (sessionKey && this.sessionEnvironments) {
            this.sessionEnvironments.delete(sessionKey);
        }
        this.cachedEnvironmentId = null;
    }
}

export default new AntigravityKeyManager();
