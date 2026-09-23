import APIStatus from '../models/APIStatus.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class ApiRequestScheduler {
    constructor() {
        this.maxGlobalInFlight = Math.max(1, Number(process.env.GEMINI_MAX_IN_FLIGHT) || 3);
        this.maxPairInFlight = Math.max(1, Number(process.env.GEMINI_MAX_PAIR_IN_FLIGHT) || 1);
        this.globalInFlight = 0;
        this.projectModelState = new Map();
        this.modelState = new Map();
        this.waiters = new Set();
        this.hydrated = false;
        this.metrics = this.createMetrics();
    }

    createMetrics() {
        return {
            requestsTotal: 0,
            requestsSuccessFirstTry: 0,
            requestsSuccessAfterRetry: 0,
            requestsFailed: 0,
            categoryCounts: {},
            attemptsPerRequest: [],
            modelSwitches: 0,
            projectSwitches: 0,
            latencies: []
        };
    }

    pairKey(projectId, modelId) {
        return `${projectId || 'unknown'}::${modelId}`;
    }

    stateFor(projectId, modelId) {
        const key = this.pairKey(projectId, modelId);
        if (!this.projectModelState.has(key)) {
            this.projectModelState.set(key, {
                projectId: projectId || 'unknown', modelId, inFlight: 0,
                consecutive429: 0, consecutive5xx: 0, consecutiveTimeout: 0,
                consecutiveFailures: 0, consecutiveSuccesses: 0,
                totalFailures: 0, totalSuccesses: 0,
                ewmaLatencyMs: 0, cooldownUntil: 0, circuitState: 'CLOSED',
                circuitUntil: 0, halfOpenProbe: false, lastSuccessAt: null, lastFailureAt: null
            });
        }
        return this.projectModelState.get(key);
    }

    async hydrate() {
        if (this.hydrated || APIStatus.db.readyState !== 1) return;
        this.hydrated = true;
        const now = new Date();
        try {
            const rows = await APIStatus.find({
                $or: [{ cooldownUntil: { $gt: now } }, { circuitUntil: { $gt: now } }]
            }).lean();
            for (const row of rows) {
                const state = this.stateFor(row.projectId || 'unknown', row.modelId || row.model);
                state.cooldownUntil = row.cooldownUntil ? new Date(row.cooldownUntil).getTime() : 0;
                state.circuitUntil = row.circuitUntil ? new Date(row.circuitUntil).getTime() : 0;
                state.circuitState = state.circuitUntil > Date.now() ? 'OPEN' : 'CLOSED';
                state.consecutiveFailures = row.consecutiveFailures || 0;
                state.consecutiveSuccesses = row.consecutiveSuccesses || 0;
                state.ewmaLatencyMs = row.ewmaLatencyMs || 0;
                state.lastFailureAt = row.lastFailureAt || null;
                state.lastSuccessAt = row.lastSuccessAt || null;
            }
        } catch (_) {
            this.hydrated = false;
        }
    }

    modelStateFor(modelId) {
        if (!this.modelState.has(modelId)) {
            this.modelState.set(modelId, { circuitState: 'CLOSED', circuitUntil: 0, recent503: [] });
        }
        return this.modelState.get(modelId);
    }

    refreshCircuit(state, now = Date.now()) {
        if (state.circuitState === 'OPEN' && now >= state.circuitUntil) {
            state.circuitState = 'HALF_OPEN';
            state.halfOpenProbe = false;
        }
    }

    isAvailable(projectId, modelId, now = Date.now()) {
        const pair = this.stateFor(projectId, modelId);
        const model = this.modelStateFor(modelId);
        this.refreshCircuit(pair, now);
        this.refreshCircuit(model, now);
        if (pair.cooldownUntil > now || pair.circuitState === 'OPEN' || model.circuitState === 'OPEN') return false;
        if ((pair.circuitState === 'HALF_OPEN' || model.circuitState === 'HALF_OPEN') && (pair.halfOpenProbe || model.halfOpenProbe)) return false;
        return true;
    }

    healthScore(entry, modelId) {
        const state = this.stateFor(entry.projectId, modelId);
        const priority = Number(entry.priority) || 0;
        const latencyPenalty = state.ewmaLatencyMs ? Math.min(30, state.ewmaLatencyMs / 500) : 0;
        return 100 + priority * 10 + state.consecutiveSuccesses * 2
            - state.consecutiveFailures * 12 - state.consecutive429 * 20
            - state.consecutive5xx * 15 - state.consecutiveTimeout * 6 - latencyPenalty;
    }

    rank(entries, modelId, exclusions = {}) {
        const excludedProjects = exclusions.projects || new Set();
        const excludedKeys = exclusions.keys || new Set();
        return entries
            .filter(entry => !excludedProjects.has(entry.projectId) && !excludedKeys.has(entry.key))
            .filter(entry => this.isAvailable(entry.projectId, modelId))
            .sort((a, b) => this.healthScore(b, modelId) - this.healthScore(a, modelId)
                || (a.lastUsed || 0) - (b.lastUsed || 0));
    }

    async acquire(projectId, modelId, { maxWaitMs = 10000 } = {}) {
        const started = Date.now();
        const state = this.stateFor(projectId, modelId);
        while (true) {
            if (!this.isAvailable(projectId, modelId)) {
                const error = new Error(`CIRCUIT_OPEN: ${projectId}/${modelId}`);
                error.code = 'CIRCUIT_OPEN';
                throw error;
            }
            if (this.globalInFlight < this.maxGlobalInFlight && state.inFlight < this.maxPairInFlight) {
                this.globalInFlight += 1;
                state.inFlight += 1;
                if (state.circuitState === 'HALF_OPEN') state.halfOpenProbe = true;
                const model = this.modelStateFor(modelId);
                if (model.circuitState === 'HALF_OPEN') model.halfOpenProbe = true;
                let released = false;
                return () => {
                    if (released) return;
                    released = true;
                    this.globalInFlight = Math.max(0, this.globalInFlight - 1);
                    state.inFlight = Math.max(0, state.inFlight - 1);
                    for (const wake of this.waiters) wake();
                    this.waiters.clear();
                };
            }
            if (Date.now() - started >= maxWaitMs) {
                const error = new Error(`SCHEDULER_QUEUE_TIMEOUT: ${projectId}/${modelId}`);
                error._isTimeout = true;
                throw error;
            }
            await new Promise(resolve => {
                const timer = setTimeout(() => { this.waiters.delete(wake); resolve(); }, 100);
                timer.unref?.();
                const wake = () => { clearTimeout(timer); resolve(); };
                this.waiters.add(wake);
            });
        }
    }

    recordSuccess(entry, modelId, latencyMs) {
        const state = this.stateFor(entry.projectId, modelId);
        state.consecutiveFailures = 0;
        state.consecutive429 = 0;
        state.consecutive5xx = 0;
        state.consecutiveTimeout = 0;
        state.consecutiveSuccesses += 1;
        state.totalSuccesses += 1;
        state.lastSuccessAt = new Date();
        state.ewmaLatencyMs = state.ewmaLatencyMs ? state.ewmaLatencyMs * 0.8 + latencyMs * 0.2 : latencyMs;
        state.circuitState = 'CLOSED';
        state.halfOpenProbe = false;
        const model = this.modelStateFor(modelId);
        model.circuitState = 'CLOSED';
        model.halfOpenProbe = false;
        this.pushLatency(latencyMs);
        this.persist(entry, modelId, state, null);
    }

    recordFailure(entry, modelId, classification) {
        const now = Date.now();
        const state = this.stateFor(entry.projectId, modelId);
        const pairWasHalfOpen = state.circuitState === 'HALF_OPEN';
        const model = this.modelStateFor(modelId);
        const modelWasHalfOpen = model.circuitState === 'HALF_OPEN';
        state.totalFailures += 1;
        state.lastFailureAt = new Date(now);
        const affectsInfrastructureHealth = [
            'RATE_LIMIT',
            'SERVICE_OVERLOADED',
            'INTERNAL_SERVER_ERROR',
            'TIMEOUT',
            'NETWORK_ERROR'
        ].includes(classification.category);
        if (affectsInfrastructureHealth) {
            state.consecutiveFailures += 1;
            state.consecutiveSuccesses = 0;
        }
        if (classification.category === 'RATE_LIMIT') {
            state.consecutive429 += 1;
            state.cooldownUntil = Math.max(state.cooldownUntil, now + Math.max(1000, classification.retryAfterMs || 60000));
        }
        if (classification.category === 'TIMEOUT') state.consecutiveTimeout += 1;
        if (classification.category === 'SERVICE_OVERLOADED' || classification.category === 'INTERNAL_SERVER_ERROR') {
            state.consecutive5xx += 1;
        }
        if (state.consecutive5xx >= 3) {
            state.circuitState = 'OPEN';
            state.circuitUntil = now + 45000;
        }
        if (classification.category === 'SERVICE_OVERLOADED') {
            model.recent503 = model.recent503.filter(item => now - item.at < 60000);
            model.recent503.push({ projectId: entry.projectId, at: now });
            const projects = new Set(model.recent503.map(item => item.projectId));
            if (model.recent503.length >= 3 && projects.size >= 2) {
                model.circuitState = 'OPEN';
                model.circuitUntil = now + 45000;
            }
        }
        if (pairWasHalfOpen && affectsInfrastructureHealth) {
            state.circuitState = 'OPEN';
            state.circuitUntil = now + 45000;
        }
        if (modelWasHalfOpen && affectsInfrastructureHealth) {
            model.circuitState = 'OPEN';
            model.circuitUntil = now + 45000;
        }
        state.halfOpenProbe = false;
        model.halfOpenProbe = false;
        this.metrics.categoryCounts[classification.category] = (this.metrics.categoryCounts[classification.category] || 0) + 1;
        this.persist(entry, modelId, state, classification);
    }

    startRequest() {
        this.metrics.requestsTotal += 1;
    }

    finishRequest({ success, attempts, projectSwitches = 0, modelSwitches = 0 }) {
        if (success && attempts === 1) this.metrics.requestsSuccessFirstTry += 1;
        else if (success) this.metrics.requestsSuccessAfterRetry += 1;
        else this.metrics.requestsFailed += 1;
        this.metrics.attemptsPerRequest.push(attempts);
        if (this.metrics.attemptsPerRequest.length > 500) this.metrics.attemptsPerRequest.shift();
        this.metrics.projectSwitches += projectSwitches;
        this.metrics.modelSwitches += modelSwitches;
    }

    pushLatency(value) {
        this.metrics.latencies.push(value);
        if (this.metrics.latencies.length > 500) this.metrics.latencies.shift();
    }

    snapshotMetrics() {
        const sorted = [...this.metrics.latencies].sort((a, b) => a - b);
        const percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
        const attempts = this.metrics.attemptsPerRequest;
        return {
            requests_total: this.metrics.requestsTotal,
            requests_success_first_try: this.metrics.requestsSuccessFirstTry,
            requests_success_after_retry: this.metrics.requestsSuccessAfterRetry,
            requests_failed: this.metrics.requestsFailed,
            '429_count': this.metrics.categoryCounts.RATE_LIMIT || 0,
            '503_count': this.metrics.categoryCounts.SERVICE_OVERLOADED || 0,
            timeout_count: this.metrics.categoryCounts.TIMEOUT || 0,
            attempts_per_user_request: attempts.length ? attempts.reduce((sum, value) => sum + value, 0) / attempts.length : 0,
            model_switches: this.metrics.modelSwitches,
            project_switches: this.metrics.projectSwitches,
            latency_p50: percentile(0.5),
            latency_p95: percentile(0.95),
            success_rate_by_project_model: [...this.projectModelState.values()].map(state => ({
                projectId: state.projectId,
                modelId: state.modelId,
                successes: state.totalSuccesses,
                failures: state.totalFailures,
                successRate: (state.totalSuccesses + state.totalFailures)
                    ? state.totalSuccesses / (state.totalSuccesses + state.totalFailures) : 0,
                ewmaLatencyMs: Math.round(state.ewmaLatencyMs || 0),
                circuitState: state.circuitState
            }))
        };
    }

    persist(entry, modelId, state, classification) {
        if (APIStatus.db.readyState !== 1) return;
        APIStatus.findOneAndUpdate(
            { projectId: entry.projectId, keyAlias: entry.name, modelId },
            {
                $set: {
                    key: entry.name, model: modelId,
                    projectId: entry.projectId, keyAlias: entry.name, modelId,
                    scope: classification?.scope || 'PROJECT_MODEL', state: state.circuitState,
                    cooldownUntil: state.cooldownUntil ? new Date(state.cooldownUntil) : null,
                    circuitUntil: state.circuitUntil ? new Date(state.circuitUntil) : null,
                    suspendedUntil: state.cooldownUntil ? new Date(state.cooldownUntil) : new Date(0),
                    lastStatusCode: classification?.statusCode || null,
                    lastErrorCategory: classification?.category || null,
                    consecutiveFailures: state.consecutiveFailures,
                    consecutiveSuccesses: state.consecutiveSuccesses,
                    lastFailureAt: state.lastFailureAt,
                    lastSuccessAt: state.lastSuccessAt,
                    ewmaLatencyMs: state.ewmaLatencyMs
                }
            },
            { upsert: true }
        ).exec().catch(() => {});
    }

    backoffMs(attempt, retryAfterMs = 0, random = Math.random) {
        if (retryAfterMs > 0) return retryAfterMs;
        const base = Math.min(6000, 500 * (2 ** Math.max(0, attempt - 1)));
        return Math.round(base * (0.5 + random()));
    }

    async backoff(attempt, retryAfterMs = 0) {
        await sleep(this.backoffMs(attempt, retryAfterMs));
    }
}

export { ApiRequestScheduler };
export default new ApiRequestScheduler();
