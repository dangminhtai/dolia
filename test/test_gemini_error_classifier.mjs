import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGeminiError, extractRetryAfterMs, shouldStopModelFallback } from '../services/geminiErrorClassifier.js';

test('429 is project-model scoped and honors RetryInfo', () => {
    const error = Object.assign(new Error('RESOURCE_EXHAUSTED quota'), {
        status: 429,
        error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '4.2s' }] }
    });
    const result = classifyGeminiError(error);
    assert.equal(result.category, 'RATE_LIMIT');
    assert.equal(result.scope, 'PROJECT_MODEL');
    assert.equal(result.retryable, true);
    assert.equal(result.retryAfterMs, 4200);
});

test('503 is model scoped while timeout and network are host scoped', () => {
    assert.deepEqual(classifyGeminiError(Object.assign(new Error('high demand'), { status: 503 })).scope, 'MODEL');
    assert.equal(classifyGeminiError(Object.assign(new Error('deadline'), { _isTimeout: true })).category, 'TIMEOUT');
    assert.equal(classifyGeminiError(new Error('fetch failed: ECONNRESET')).category, 'NETWORK_ERROR');
    assert.equal(classifyGeminiError(new TypeError('fetch failed')).category, 'NETWORK_ERROR');
});

test('400 and application errors never retry or punish infrastructure', () => {
    const badRequest = classifyGeminiError(Object.assign(new Error('INVALID_ARGUMENT'), { status: 400 }));
    assert.equal(badRequest.scope, 'REQUEST');
    assert.equal(badRequest.retryable, false);
    const local = classifyGeminiError(new SyntaxError('Unexpected token'));
    assert.equal(local.scope, 'APPLICATION');
    assert.equal(local.retryable, false);
});

test('403 is not labeled leaked without credential evidence', () => {
    const permission = classifyGeminiError(Object.assign(new Error('PERMISSION_DENIED billing disabled'), { status: 403 }));
    assert.equal(permission.category, 'PERMISSION_DENIED');
    assert.equal(permission.scope, 'PROJECT');
    const invalid = classifyGeminiError(Object.assign(new Error('API_KEY_INVALID'), { status: 403 }));
    assert.equal(invalid.category, 'AUTH_INVALID');
    assert.equal(invalid.scope, 'KEY');
});

test('retry delay accepts structured seconds and nanos', () => {
    assert.equal(extractRetryAfterMs({ error: { details: [{ type: 'RetryInfo', retryDelay: { seconds: 2, nanos: 500000000 } }] } }), 2500);
});

test('request/application errors stop model fallback while model-not-found may switch model', () => {
    assert.equal(shouldStopModelFallback(classifyGeminiError(Object.assign(new Error('bad'), { status: 400 }))), true);
    assert.equal(shouldStopModelFallback(classifyGeminiError(new SyntaxError('bad json'))), true);
    assert.equal(shouldStopModelFallback(classifyGeminiError(Object.assign(new Error('model not found'), { status: 404 }))), false);
});

test('local scheduler exhaustion can switch model without pretending to be a remote error', () => {
    const error = Object.assign(new Error('NO_HEALTHY_PROJECT'), { code: 'NO_HEALTHY_PROJECT' });
    const result = classifyGeminiError(error);
    assert.equal(result.category, 'NO_CAPACITY');
    assert.equal(result.scope, 'MODEL');
    assert.equal(result.retryable, false);
    assert.equal(shouldStopModelFallback(result), false);
});
