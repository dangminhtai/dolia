import { GoogleGenAI } from '@google/genai';
import APIKey from '../models/APIKeys.js';
import APIStatus from '../models/APIStatus.js';

class ApiKeyManager {
    constructor() {
        this.pool = [];
        this.isInitialized = false;
        this.index = 0; // Round-Robin pointer
        this.suspensionCache = new Map(); // `${key}_${modelId}` -> timestamp (ms)
        this.clientPool = new Map(); // apiKey -> GoogleGenAI instance (connection reuse)
    }

    /**
     * Nạp toàn bộ API key từ biến môi trường (.env) và Database
     */
    async loadKeys() {
        const poolMap = new Map();

        // 1. Nạp từ process.env (hỗ trợ GEMINI_*_KEY và GEMINI_API_KEY)
        Object.entries(process.env).forEach(([envName, val]) => {
            if ((envName.startsWith('GEMINI_') && envName.endsWith('_KEY')) || envName === 'GEMINI_API_KEY') {
                if (val && typeof val === 'string' && val.trim()) {
                    const cleanKey = val.trim();
                    poolMap.set(cleanKey, {
                        key: cleanKey,
                        name: envName,
                        exhausted: false,
                        lastUsed: 0
                    });
                }
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
            console.warn('⚠️ Could not query API Keys from Database:', error.message);
        }

        // Giữ lại trạng thái exhausted nếu trước đó đã bị đánh dấu
        const prevExhausted = new Set(this.pool.filter(p => p.exhausted).map(p => p.key));
        this.pool = Array.from(poolMap.values()).map(entry => {
            if (prevExhausted.has(entry.key)) {
                entry.exhausted = true;
            }
            return entry;
        });

        if (this.pool.length === 0) {
            console.warn('⚠️ No active API Keys found in Environment (.env) or Database.');
            return;
        }

        this.isInitialized = true;
        console.log(`✅ Loaded ${this.pool.length} API Keys (${poolMap.size} available from env/DB).`);
    }

    /**
     * Kiểm tra xem key có đang bị suspend trên model cụ thể hay không
     */
    isSuspended(key, modelId, now = Date.now()) {
        const cacheKey = `${key}_${modelId}`;
        const until = this.suspensionCache.get(cacheKey);
        if (!until) return false;
        if (now >= until) {
            this.suspensionCache.delete(cacheKey);
            return false;
        }
        return true;
    }

    /**
     * Lấy hoặc tạo GoogleGenAI client instance từ pool (reuse connection, tránh TLS handshake mỗi request)
     * @param {string} apiKey
     * @returns {GoogleGenAI}
     */
    getClient(apiKey) {
        if (!this.clientPool.has(apiKey)) {
            this.clientPool.set(apiKey, new GoogleGenAI({ apiKey }));
        }
        return this.clientPool.get(apiKey);
    }

    /**
     * Lấy key tiếp theo theo thuật toán Round-Robin tuần tự.
     * Cân bằng tải hoàn hảo qua tất cả các key khả dụng mà không bị dồn tải.
     */
    async _getNextKey(modelId) {
        if (!this.isInitialized || this.pool.length === 0) {
            await this.loadKeys();
        }

        if (this.pool.length === 0) {
            throw new Error('No active API keys available in environment or database.');
        }

        const now = Date.now();
        const activePool = this.pool.filter(e => !e.exhausted);
        if (activePool.length === 0) {
            throw new Error('All API keys are permanently exhausted or marked leaked.');
        }

        // Quét tuần tự Round-Robin bắt đầu từ this.index
        for (let i = 0; i < activePool.length; i++) {
            const idx = (this.index + i) % activePool.length;
            const entry = activePool[idx];

            if (!this.isSuspended(entry.key, modelId, now)) {
                this.index = (idx + 1) % activePool.length;
                entry.lastUsed = now;
                return entry.key;
            }
        }

        // Nếu tất cả các keys đều đang cooldown cho model này:
        let minUntil = Infinity;
        for (const entry of activePool) {
            const cacheKey = `${entry.key}_${modelId}`;
            const until = this.suspensionCache.get(cacheKey) || 0;
            if (until < minUntil) {
                minUntil = until;
            }
        }

        const waitSec = Math.max(1, Math.round((minUntil - now) / 1000));
        throw new Error(`ALL_KEYS_SUSPENDED: All ${activePool.length} keys are cooling down for model ${modelId} (shortest wait: ${waitSec}s).`);
    }

    /**
     * Suspend key với thời gian xác định (ms)
     * Lưu trữ in-memory và cập nhật MongoDB bất đồng bộ (non-blocking)
     */
    suspendKey(key, modelId, ms, reason = 'RATE_LIMIT') {
        const until = Date.now() + ms;
        const cacheKey = `${key}_${modelId}`;
        this.suspensionCache.set(cacheKey, until);

        // Non-blocking update to Database
        APIStatus.findOneAndUpdate(
            { key, model: modelId },
            { suspendedUntil: until, reason: reason },
            { upsert: true }
        ).catch(e => console.warn(`[ApiKeyManager] Background APIStatus save error: ${e.message}`));

        console.warn(`⏳ Suspended key ...${key.slice(-4)} for ${Math.round(ms / 1000)}s on ${modelId} (${reason})`);
    }

    /**
     * Vô hiệu hóa vĩnh viễn key bị rò rỉ hoặc không hợp lệ (403)
     */
    async markLeaked(key) {
        try {
            console.error(`🚫 Key ...${key.slice(-4)} marked as LEAKED/INVALID and disabled.`);
            const entry = this.pool.find(e => e.key === key);
            if (entry) entry.exhausted = true;
            this.pool = this.pool.filter(e => e.key !== key);
            this.clientPool.delete(key); // Xóa cached client
            await APIKey.updateOne({ key }, { isActive: false, name: 'LEAKED - DISABLED' });
        } catch (e) {
            console.error('Failed to mark key leaked:', e);
        }
    }

    /**
     * Thực thi tác vụ gọi API Gemini với:
     * - Round-Robin load balancing
     * - Chuyển key tức thì (100ms) khi gặp 429/503/timeout
     * - Khớp thời gian cooldown 60s cho 429 (reset theo RPM của Google)
     * - Timeout guard (mặc định 25s) qua Promise.race
     * - Phát hiện quá tải 503 để kích hoạt model fallback
     */
    async execute(modelId, task, options = {}) {
        if (!this.isInitialized || this.pool.length === 0) {
            await this.loadKeys();
        }

        const maxRetries = options.maxRetries ?? Math.min(this.pool.length > 0 ? this.pool.length : 5, 5);
        const timeoutMs = options.timeoutMs ?? 15000;
        let attempt = 0;
        let count503 = 0;
        let lastError = null;

        while (attempt < maxRetries) {
            let key;
            try {
                key = await this._getNextKey(modelId);
            } catch (e) {
                // Toàn bộ key cho model này đang cooldown, throw để caller chuyển model fallback
                throw e;
            }

            try {
                // Timeout Guard bằng Promise.race để ngăn chặn việc bị treo socket
                let timer;
                const timeoutPromise = new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        reject(Object.assign(new Error(`KEY_TIMEOUT_${timeoutMs}ms`), { _isTimeout: true }));
                    }, timeoutMs);
                    timer.unref?.();
                });

                const result = await Promise.race([task(key), timeoutPromise]);
                if (timer) clearTimeout(timer);

                // Cập nhật thống kê sử dụng (Async non-blocking)
                APIKey.updateOne({ key: key }, {
                    $inc: { usageCount: 1 },
                    $set: { lastUsed: Date.now() }
                }).exec().catch(err => console.error('Failed to update Key usage stats:', err.message));

                return result;
            } catch (e) {
                lastError = e;

                // Xử lý khi request bị timeout
                if (e._isTimeout) {
                    console.warn(`⏱️ Key ...${key.slice(-4)} timed out sau ${timeoutMs}ms trên ${modelId}. Chuyển key ngay...`);
                    this.suspendKey(key, modelId, 30 * 1000, 'TIMEOUT_30s');
                    attempt++;
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, 100));
                    }
                    continue;
                }

                // Không retry với lỗi cú pháp code lập trình
                if (e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError) {
                    console.error(`❌ CODE / SYNTAX BUG (NON-RETRYABLE): ${e.message}`, e.stack);
                    throw e;
                }

                // Kiểm tra xem lỗi có phải thực sự xuất phát từ Google API hay không
                const isGoogleApiError = (
                    typeof e.status === 'number' || 
                    typeof e.status === 'string' || 
                    typeof e.statusCode === 'number' || 
                    !!e.httpMeta || 
                    !!e.error?.code || 
                    !!e.error?.status ||
                    (typeof e.message === 'string' && (
                        e.message.includes('GoogleGenAI') ||
                        e.message.includes('RESOURCE_EXHAUSTED') ||
                        e.message.includes('429') ||
                        e.message.includes('503') ||
                        e.message.includes('500') ||
                        e.message.includes('quota') ||
                        e.message.includes('overloaded') ||
                        e.message.includes('API_KEY_INVALID') ||
                        e.message.includes('PERMISSION_DENIED')
                    ))
                );

                if (!isGoogleApiError) {
                    console.error(`❌ APPLICATION LOGIC / PARSING ERROR (NOT GOOGLE API): ${e.message}`);
                    throw e; // Ném ra ngay, KHÔNG phạt key, KHÔNG retry tốn quota!
                }

                const statusCode = typeof e.status === 'number' 
                    ? e.status 
                    : (e.statusCode || e.httpMeta?.response?.status || e.error?.code || (e.status === 'RESOURCE_EXHAUSTED' ? 429 : 0));
                const errorMessage = (e.message || '') + ' ' + (e.error?.message || '');

                let suspendMs = 0;
                let reason = 'ERROR';
                let shouldSuspend = false;

                // --- 429: Rate Limit / Quota ---
                if (statusCode === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
                    let waitSeconds = 60; // Mặc định 60 giây (khớp chu kỳ 15 RPM/phút của Google)
                    try {
                        const retryInfo = e?.error?.details?.find?.(d => d['@type']?.includes('RetryInfo'));
                        if (retryInfo?.retryDelay) {
                            const parsed = parseFloat(retryInfo.retryDelay);
                            if (!isNaN(parsed) && parsed > 0) {
                                waitSeconds = Math.ceil(parsed) + 1;
                            }
                        }
                    } catch (_) {}

                    suspendMs = waitSeconds * 1000;
                    reason = 'RATE_LIMIT_429';
                    shouldSuspend = true;
                }
                // --- 400: Bad Request / Invalid Argument (Lỗi phía client/prompt) ---
                else if (statusCode === 400 || errorMessage.includes('invalid_request') || errorMessage.includes('INVALID_ARGUMENT')) {
                    console.error(`❌ BAD REQUEST (NON-RETRYABLE): ${errorMessage}`);
                    throw e; // Dừng ngay, không thử key khác
                }
                // --- 503: Service Unavailable / High Demand / Overloaded (Phía Google bị nghẽn) ---
                else if (statusCode === 503 || errorMessage.includes('503') || errorMessage.includes('overloaded') || errorMessage.includes('UNAVAILABLE') || errorMessage.includes('high demand')) {
                    suspendMs = 5 * 60 * 1000; // 5 phút
                    reason = 'SERVICE_UNAVAILABLE_503';
                    this.suspendKey(key, modelId, suspendMs, reason);
                    // Lỗi quá tải model xảy ra trên toàn bộ server Google cho model đó, không retry key khác mà chuyển model ngay
                    throw new Error(`MODEL_OVERLOADED: Model ${modelId} is currently experiencing high demand/overloaded (503 Service Unavailable).`);
                }
                // --- 500: Internal Server Error ---
                else if (statusCode === 500 || errorMessage.includes('500') || errorMessage.includes('INTERNAL')) {
                    suspendMs = 30 * 1000; // 30s
                    reason = 'INTERNAL_ERROR_500';
                    shouldSuspend = true;
                }
                // --- 403: Key bị thu hồi hoặc Permission Denied ---
                else if (statusCode === 403 || errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('API_KEY_INVALID')) {
                    await this.markLeaked(key);
                    shouldSuspend = false;
                }
                // --- Lỗi khác ---
                else {
                    const statusCodeText = statusCode ? statusCode.toString() : 'UNKNOWN';
                    console.warn(`⚠️ Generic error ${statusCodeText}: ${errorMessage}`);
                    suspendMs = 30 * 1000;
                    reason = `GENERIC_${statusCodeText}`;
                    shouldSuspend = true;
                }

                if (shouldSuspend && suspendMs > 0) {
                    this.suspendKey(key, modelId, suspendMs, reason);
                }

                attempt++;

                // Chuyển key kế tiếp tức thì chỉ sau 100ms (loại bỏ hoàn toàn exponential backoff vô lý)
                if (attempt < maxRetries) {
                    console.log(`🔄 Rotating key... (${attempt}/${maxRetries}) in 100ms`);
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }

        throw new Error(`Failed after ${attempt} attempts on model ${modelId}. Last error: ${lastError?.message}`);
    }
}

export default new ApiKeyManager();