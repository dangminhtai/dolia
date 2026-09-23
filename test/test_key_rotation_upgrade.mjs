import { test } from 'node:test';
import assert from 'node:assert/strict';
import apiKeyManager from '../class/apiKeyManager.js';

test('legacy key-rotation entrypoint exposes the reliability budget API', () => {
    const budget = apiKeyManager.createBudget(3);
    assert.deepEqual(
        { max: budget.max, used: budget.used, modelSwitches: budget.modelSwitches, projectSwitches: budget.projectSwitches },
        { max: 3, used: 0, modelSwitches: 0, projectSwitches: 0 }
    );
    assert.equal(typeof apiKeyManager.requestConfig, 'function');
    assert.equal(typeof apiKeyManager.getMetrics, 'function');
});
