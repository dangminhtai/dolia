import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestScheduler } from '../services/apiRequestScheduler.js';

test('scheduler ranks healthy project-model pairs ahead of degraded pairs', () => {
    const scheduler = new ApiRequestScheduler();
    const entries = [
        { key: 'a', name: 'A', projectId: 'p1', priority: 0, lastUsed: 0 },
        { key: 'b', name: 'B', projectId: 'p2', priority: 0, lastUsed: 0 }
    ];
    scheduler.stateFor('p1', 'm').consecutiveFailures = 3;
    assert.equal(scheduler.rank(entries, 'm')[0].projectId, 'p2');
});

test('429 cooldown removes only the affected project-model pair', () => {
    const scheduler = new ApiRequestScheduler();
    const a = { key: 'a', name: 'A', projectId: 'p1' };
    const b = { key: 'b', name: 'B', projectId: 'p2' };
    scheduler.recordFailure(a, 'm', { category: 'RATE_LIMIT', scope: 'PROJECT_MODEL', statusCode: 429, retryAfterMs: 4200 });
    assert.equal(scheduler.isAvailable('p1', 'm'), false);
    assert.equal(scheduler.isAvailable('p2', 'm'), true);
    assert.equal(scheduler.rank([a, b], 'm')[0].projectId, 'p2');
});

test('repeated 503 across projects opens the model circuit', () => {
    const scheduler = new ApiRequestScheduler();
    const failure = { category: 'SERVICE_OVERLOADED', scope: 'MODEL', statusCode: 503, retryAfterMs: 0 };
    scheduler.recordFailure({ name: 'A', projectId: 'p1' }, 'm', failure);
    scheduler.recordFailure({ name: 'B', projectId: 'p2' }, 'm', failure);
    scheduler.recordFailure({ name: 'A', projectId: 'p1' }, 'm', failure);
    assert.equal(scheduler.modelStateFor('m').circuitState, 'OPEN');
    assert.equal(scheduler.isAvailable('p2', 'm'), false);
});

test('backoff applies exponential growth and jitter bounds', () => {
    const scheduler = new ApiRequestScheduler();
    assert.equal(scheduler.backoffMs(1, 0, () => 0), 250);
    assert.equal(scheduler.backoffMs(2, 0, () => 1), 1500);
    assert.equal(scheduler.backoffMs(3, 4200, () => 0), 4200);
});

test('metrics expose first-try, retry and latency percentiles', () => {
    const scheduler = new ApiRequestScheduler();
    scheduler.startRequest();
    scheduler.finishRequest({ success: true, attempts: 1 });
    scheduler.pushLatency(100);
    scheduler.pushLatency(300);
    const metrics = scheduler.snapshotMetrics();
    assert.equal(metrics.requests_success_first_try, 1);
    assert.equal(metrics.latency_p50, 300);
    assert.equal(metrics.latency_p95, 300);
});

test('request and application errors do not degrade infrastructure health', () => {
    const scheduler = new ApiRequestScheduler();
    const entry = { key: 'secret', name: 'A1', projectId: 'project-a', priority: 0 };
    const before = scheduler.healthScore(entry, 'model-x');

    scheduler.recordFailure(entry, 'model-x', {
        category: 'APPLICATION_ERROR', scope: 'APPLICATION', retryable: false, statusCode: 0
    });
    scheduler.recordFailure(entry, 'model-x', {
        category: 'INVALID_REQUEST', scope: 'REQUEST', retryable: false, statusCode: 400
    });

    const state = scheduler.stateFor('project-a', 'model-x');
    assert.equal(scheduler.healthScore(entry, 'model-x'), before);
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(state.circuitState, 'CLOSED');
});
