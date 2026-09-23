import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiKeyManager, resolveProjectMetadata } from '../class/apiKeyManager.js';

function fakeScheduler() {
    const calls = { failures: [], successes: [], finished: [] };
    return {
        calls,
        metrics: { modelSwitches: 0 },
        rank(entries, _model, exclusions = {}) {
            const projects = exclusions.projects || new Set();
            const keys = exclusions.keys || new Set();
            return entries.filter(entry => !projects.has(entry.projectId) && !keys.has(entry.key))
                .sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
        },
        async acquire() { return () => {}; },
        recordSuccess(entry, model, latency) { calls.successes.push({ entry, model, latency }); },
        recordFailure(entry, model, classification) { calls.failures.push({ entry, model, classification }); },
        startRequest() {},
        finishRequest(value) { calls.finished.push(value); },
        async backoff() {},
        snapshotMetrics() { return calls; }
    };
}

function managerWithProjects() {
    const scheduler = fakeScheduler();
    const manager = new ApiKeyManager({ scheduler });
    manager.pool = [
        { key: 'key-a1', name: 'A1', projectId: 'project-a', exhausted: false, lastUsed: 0 },
        { key: 'key-a2', name: 'A2', projectId: 'project-a', exhausted: false, lastUsed: 0 },
        { key: 'key-b1', name: 'B1', projectId: 'project-b', exhausted: false, lastUsed: 0 }
    ];
    manager.isInitialized = true;
    return { manager, scheduler };
}

test('verified environment project metadata wins over stale database placeholders', () => {
    assert.deepEqual(
        resolveProjectMetadata(
            { projectId: 'unverified', projectNumber: null },
            { projectId: 'projects/486922974842', projectNumber: '486922974842' }
        ),
        { projectId: 'projects/486922974842', projectNumber: '486922974842' }
    );
});

test('database project metadata remains a fallback when environment metadata is absent', () => {
    assert.deepEqual(
        resolveProjectMetadata(
            { projectId: 'projects/27087077670', projectNumber: '27087077670' },
            { projectId: 'unverified', projectNumber: null }
        ),
        { projectId: 'projects/27087077670', projectNumber: '27087077670' }
    );
});

test('429 switches project instead of trying a second key in the same project', async () => {
    const { manager } = managerWithProjects();
    const used = [];
    const result = await manager.execute('model-x', async key => {
        used.push(key);
        if (key === 'key-a1') throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });
        return 'ok';
    }, { maxAttempts: 3 });
    assert.equal(result, 'ok');
    assert.deepEqual(used, ['key-a1', 'key-b1']);
});

test('400 stops immediately without key rotation', async () => {
    const { manager, scheduler } = managerWithProjects();
    let calls = 0;
    await assert.rejects(() => manager.execute('model-x', async () => {
        calls += 1;
        throw Object.assign(new Error('INVALID_ARGUMENT'), { status: 400 });
    }, { maxAttempts: 3 }), error => error.classification?.category === 'INVALID_REQUEST');
    assert.equal(calls, 1);
    assert.equal(scheduler.calls.failures.length, 1);
});

test('generic 403 does not disable or relabel a key as leaked', async () => {
    const { manager } = managerWithProjects();
    await assert.rejects(() => manager.execute('model-x', async () => {
        throw Object.assign(new Error('PERMISSION_DENIED billing config'), { status: 403 });
    }), error => error.classification?.category === 'PERMISSION_DENIED');
    assert.equal(manager.pool[0].exhausted, false);
});

test('credential-invalid response disables only its key', async () => {
    const { manager } = managerWithProjects();
    await assert.rejects(() => manager.execute('model-x', async () => {
        throw Object.assign(new Error('API_KEY_INVALID'), { status: 401 });
    }, { maxAttempts: 1 }));
    assert.equal(manager.pool[0].exhausted, true);
    assert.equal(manager.pool[1].exhausted, false);
});

test('credential-invalid key can fail over to another key without disabling its project', async () => {
    const { manager } = managerWithProjects();
    const used = [];
    const result = await manager.execute('model-x', async key => {
        used.push(key);
        if (key === 'key-a1') throw Object.assign(new Error('API_KEY_INVALID'), { status: 401 });
        return 'ok';
    }, { maxAttempts: 3 });
    assert.equal(result, 'ok');
    assert.deepEqual(used, ['key-a1', 'key-a2']);
    assert.equal(manager.pool[0].exhausted, true);
    assert.equal(manager.pool[1].exhausted, false);
});

test('503 retries once then returns a model-scoped error without disabling keys', async () => {
    const { manager } = managerWithProjects();
    let calls = 0;
    await assert.rejects(() => manager.execute('model-x', async () => {
        calls += 1;
        throw Object.assign(new Error('high demand'), { status: 503 });
    }, { maxAttempts: 3 }), error => error.classification?.scope === 'MODEL');
    assert.equal(calls, 2);
    assert.ok(manager.pool.every(entry => entry.exhausted === false));
});

test('shared request budget prevents a retry storm across calls', async () => {
    const { manager } = managerWithProjects();
    const budget = manager.createBudget(3);
    let calls = 0;
    await assert.rejects(() => manager.execute('model-x', async () => {
        calls += 1;
        throw Object.assign(new Error('fetch failed: ECONNRESET'), { code: 'ECONNRESET' });
    }, { maxAttempts: 5, budget }));
    assert.equal(calls, 3);
    assert.equal(budget.used, 3);
});

test('request config passes real SDK abort and timeout options', () => {
    const { manager } = managerWithProjects();
    const controller = new AbortController();
    const config = manager.requestConfig({ temperature: 0.2 }, { abortSignal: controller.signal, timeoutMs: 1234 });
    assert.equal(config.abortSignal, controller.signal);
    assert.equal(config.httpOptions.timeout, 1234);
    assert.equal(config.httpOptions.retryOptions.attempts, 1);
    assert.equal(config.temperature, 0.2);
});

test('timeout aborts the underlying task signal before returning', async () => {
    const { manager } = managerWithProjects();
    let aborted = false;
    await assert.rejects(() => manager.execute('model-x', async (_key, requestContext) => {
        return new Promise((_, reject) => {
            requestContext.abortSignal.addEventListener('abort', () => {
                aborted = true;
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            }, { once: true });
        });
    }, { maxAttempts: 1, timeoutMs: 1000 }), error => error.classification?.category === 'TIMEOUT');
    assert.equal(aborted, true);
});
