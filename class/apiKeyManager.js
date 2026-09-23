import { t as tr } from '../services/i18nService.js';
import { GoogleGenAI } from '@google/genai';
import APIKey from '../models/APIKeys.js';
import APIStatus from '../models/APIStatus.js';
import apiRequestScheduler from '../services/apiRequestScheduler.js';
import { attachGeminiClassification, classifyGeminiError, CATEGORIES } from '../services/geminiErrorClassifier.js';

export class ApiKeyManager {
    constructor({ scheduler = apiRequestScheduler } = {}) {
        this.pool = [];
        this.isInitialized = false;
        this.index = 0;
        this.suspensionCache = new Map();
        this.clientPool = new Map();
        this.scheduler = scheduler;
    }

    envMetadata(envName) {
        const alias = envName === 'GEMINI_API_KEY' ? 'GEMINI' : envName.replace(/_KEY$/, '');
        return {
            name: alias,
            projectId: process.env[`${alias}_PROJECT`]?.trim() || 'unverified',
            projectNumber: process.env[`${alias}_PROJECT_NUMBER`]?.trim() || null,
            keyType: process.env[`${alias}_TYPE`]?.trim() || 'api_key',
            priority: Number(process.env[`${alias}_PRIORITY`]) || 0
        };
    }

    async loadKeys() {
        const poolMap = new Map();
        for (const [envName, value] of Object.entries(process.env)) {
            if (!((envName.startsWith('GEMINI_') && envName.endsWith('_KEY')) || envName === 'GEMINI_API_KEY')) continue;
            const key = typeof value === 'string' ? value.trim() : '';
            if (key) poolMap.set(key, { key, ...this.envMetadata(envName), exhausted: false, lastUsed: 0 });
        }
        try {
            const envKeys = [...poolMap.keys()];
            const query = envKeys.length
                ? { $or: [{ isActive: true }, { key: { $in: envKeys } }] }
                : { isActive: true };
            const keys = await APIKey.find(query).lean();
            for (const row of keys || []) {
                if (!row.key) continue;
                // Trạng thái vô hiệu hóa đã persist phải thắng .env sau khi bot restart.
                if (row.isActive === false) {
                    poolMap.delete(row.key);
                    this.clientPool.delete(row.key);
                    continue;
                }
                const previous = poolMap.get(row.key) || {};
                poolMap.set(row.key, {
                    key: row.key,
                    name: row.name || previous.name || 'DB_KEY',
                    projectId: row.projectId || previous.projectId || 'unverified',
                    projectNumber: row.projectNumber || previous.projectNumber || null,
                    keyType: row.keyType || previous.keyType || 'api_key',
                    priority: Number(row.priority ?? previous.priority) || 0,
                    exhausted: false,
                    lastUsed: previous.lastUsed || 0
                });
            }
        } catch (error) {
            console.warn(tr('logs.apikeymanager.warn_could_not_query_api_keys_from_database'), error.message);
        }
        const exhausted = new Set(this.pool.filter(entry => entry.exhausted).map(entry => entry.key));
        this.pool = [...poolMap.values()].map(entry => ({ ...entry, exhausted: exhausted.has(entry.key) }));
        this.isInitialized = this.pool.length > 0;
        await this.scheduler.hydrate?.();
        if (!this.pool.length) console.warn(tr('logs.apikeymanager.warn_no_active_api_keys_found_in_environment'));
        else console.log(tr('logs.apikeymanager.log_loaded_api_keys_available_from_env_db', { length: this.pool.length, size: poolMap.size }));
    }

    getClient(apiKey) {
        if (!this.clientPool.has(apiKey)) this.clientPool.set(apiKey, new GoogleGenAI({ apiKey }));
        return this.clientPool.get(apiKey);
    }

    entryForKey(key) {
        return this.pool.find(entry => entry.key === key) || null;
    }

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

    async ensurePool() {
        if (!this.isInitialized || !this.pool.length) await this.loadKeys();
        if (!this.pool.length) throw new Error('No active Gemini API keys are available.');
    }

    async _getNextEntry(modelId, exclusions = {}) {
        await this.ensurePool();
        const now = Date.now();
        const active = this.pool.filter(entry => !entry.exhausted && !this.isSuspended(entry.key, modelId, now));
        const ranked = this.scheduler.rank(active, modelId, exclusions);
        if (!ranked.length) {
            const error = new Error(`NO_HEALTHY_PROJECT: No eligible project/key for ${modelId}.`);
            error.code = 'NO_HEALTHY_PROJECT';
            throw error;
        }
        ranked[0].lastUsed = now;
        return ranked[0];
    }

    async _getNextKey(modelId) {
        return (await this._getNextEntry(modelId)).key;
    }

    suspendKey(key, modelId, ms, reason = 'RATE_LIMIT') {
        const until = Date.now() + ms;
        this.suspensionCache.set(`${key}_${modelId}`, until);
        const entry = this.entryForKey(key) || { name: 'UNKNOWN', projectId: 'unverified' };
        if (APIStatus.db.readyState !== 1) return;
        APIStatus.findOneAndUpdate(
            { projectId: entry.projectId, keyAlias: entry.name, modelId },
            { $set: {
                key: entry.name, model: modelId, projectId: entry.projectId, keyAlias: entry.name, modelId,
                scope: 'KEY', state: 'OPEN', cooldownUntil: new Date(until), suspendedUntil: new Date(until), reason
            } },
            { upsert: true }
        ).exec().catch(() => {});
    }

    async disableKey(key, reason = 'CREDENTIAL_INVALID') {
        const entry = this.entryForKey(key);
        if (entry) entry.exhausted = true;
        this.clientPool.delete(key);
        if (APIKey.db.readyState === 1) {
            await APIKey.updateOne({ key }, { $set: { isActive: false, disabledReason: reason, lastFailureAt: new Date() } });
        }
        console.error(tr('logs.apikeymanager.error_key_disabled', { alias: entry?.name || 'UNKNOWN', reason }));
    }

    async markCredentialInvalid(key, reason = 'CREDENTIAL_INVALID') {
        return this.disableKey(key, reason);
    }

    async markLeaked(key) {
        return this.disableKey(key, 'LEAKED_KEY_CONFIRMED');
    }

    createBudget(max = Number(process.env.GEMINI_MAX_API_ATTEMPTS) || 3) {
        return { max, used: 0, started: false, finalized: false, projectSwitches: 0, modelSwitches: 0 };
    }

    requestConfig(config = {}, requestContext = {}) {
        return {
            ...config,
            abortSignal: requestContext.abortSignal,
            httpOptions: {
                ...(config.httpOptions || {}),
                timeout: requestContext.timeoutMs,
                retryOptions: { ...(config.httpOptions?.retryOptions || {}), attempts: 1 }
            }
        };
    }

    async execute(modelId, task, options = {}) {
        await this.ensurePool();
        const configuredMax = options.maxAttempts ?? options.maxRetries ?? (Number(process.env.GEMINI_MAX_API_ATTEMPTS) || 3);
        const maxAttempts = Math.max(1, Math.min(configuredMax, 5));
        const ownsBudget = !options.budget;
        const budget = options.budget || this.createBudget(maxAttempts);
        const timeoutMs = Math.max(1000, options.timeoutMs || 25000);
        const excludedProjects = new Set();
        const excludedKeys = new Set();
        let attempts = 0;
        let projectSwitches = 0;
        let previousProject = null;
        let overloadAttempts = 0;
        let lastError = null;
        if (!budget.started) {
            this.scheduler.startRequest();
            budget.started = true;
        }

        while (attempts < maxAttempts && budget.used < budget.max) {
            let entry;
            try {
                entry = await this._getNextEntry(modelId, { projects: excludedProjects, keys: excludedKeys });
            } catch (selectionError) {
                if (!lastError) lastError = selectionError;
                break;
            }
            if (previousProject && previousProject !== entry.projectId) projectSwitches += 1;
            previousProject = entry.projectId;
            attempts += 1;
            budget.used += 1;
            const started = Date.now();
            const controller = new AbortController();
            let release;
            let timeout;
            try {
                release = await this.scheduler.acquire(entry.projectId, modelId, { maxWaitMs: options.queueTimeoutMs || 10000 });
                const timeoutError = new Error(`Gemini request timed out after ${timeoutMs}ms`);
                timeoutError._isTimeout = true;
                const timeoutPromise = new Promise((_, reject) => {
                    timeout = setTimeout(() => {
                        controller.abort();
                        reject(timeoutError);
                    }, timeoutMs);
                });
                const requestContext = {
                    abortSignal: controller.signal, timeoutMs, attempt: attempts,
                    keyAlias: entry.name, projectId: entry.projectId, modelId
                };
                const response = await Promise.race([task(entry.key, requestContext), timeoutPromise]);
                clearTimeout(timeout);
                this.scheduler.recordSuccess(entry, modelId, Date.now() - started);
                if (APIKey.db.readyState === 1) {
                    APIKey.updateOne({ key: entry.key }, {
                        $inc: { usageCount: 1, successCount: 1 },
                        $set: { lastUsed: new Date(), lastSuccessAt: new Date() }
                    }).exec().catch(() => {});
                }
                budget.projectSwitches += projectSwitches;
                if (ownsBudget) this.completeBudget(budget, true);
                return response;
            } catch (rawError) {
                clearTimeout(timeout);
                const classification = classifyGeminiError(rawError);
                const error = attachGeminiClassification(rawError, classification);
                lastError = error;
                this.scheduler.recordFailure(entry, modelId, classification);
                if (APIKey.db.readyState === 1) {
                    APIKey.updateOne({ key: entry.key }, {
                        $inc: { errorCount: 1 }, $set: { lastFailureAt: new Date() }
                    }).exec().catch(() => {});
                }

                if (classification.category === CATEGORIES.AUTH_INVALID) {
                    await this.markCredentialInvalid(entry.key, classification.reason);
                    excludedKeys.add(entry.key);
                } else if (classification.category === CATEGORIES.RATE_LIMIT) {
                    excludedProjects.add(entry.projectId);
                } else if (classification.category === CATEGORIES.SERVICE_OVERLOADED) {
                    overloadAttempts += 1;
                    if (overloadAttempts >= 2) break;
                }

                const retryAnotherCredential = classification.category === CATEGORIES.AUTH_INVALID;
                if ((!classification.retryable && !retryAnotherCredential) || ['REQUEST', 'APPLICATION'].includes(classification.scope)
                    || classification.category === CATEGORIES.MODEL_NOT_FOUND) {
                    budget.projectSwitches += projectSwitches;
                    if (ownsBudget) this.completeBudget(budget, false);
                    throw error;
                }
                if (attempts >= maxAttempts || budget.used >= budget.max) break;
                await this.scheduler.backoff(attempts, classification.retryAfterMs);
            } finally {
                clearTimeout(timeout);
                release?.();
            }
        }

        budget.projectSwitches += projectSwitches;
        if (ownsBudget) this.completeBudget(budget, false);
        throw attachGeminiClassification(lastError || new Error(`Gemini request failed for ${modelId}`));
    }

    getMetrics() {
        return this.scheduler.snapshotMetrics();
    }

    getModelCircuit(modelId) {
        const state = this.scheduler.modelStateFor(modelId);
        this.scheduler.refreshCircuit(state);
        return { state: state.circuitState, until: state.circuitUntil };
    }

    recordModelSwitch(budget = null) {
        if (budget) budget.modelSwitches += 1;
        else this.scheduler.metrics.modelSwitches += 1;
    }

    completeBudget(budget, success) {
        if (!budget || budget.finalized) return;
        budget.finalized = true;
        this.scheduler.finishRequest({
            success,
            attempts: budget.used,
            projectSwitches: budget.projectSwitches,
            modelSwitches: budget.modelSwitches
        });
    }
}

export default new ApiKeyManager();
