import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAutomationSpec } from '../core/automation/ruleValidator.js';
import { automationTools } from '../schema/automationTools.js';

test('configured reaction derives capability and keeps a valid timezone', () => {
    const spec = validateAutomationSpec({
        name: 'Reaction riêng', trigger: { type: 'messageCreate' },
        conditions: [{ kind: 'author_is', userId: '123' }],
        steps: [{ kind: 'react', emoji: '❤️' }], timezone: 'Asia/Ho_Chi_Minh'
    });
    assert.deepEqual(spec.capabilityGrants, ['discord.react']);
    assert.equal(spec.risk, 'low');
});

test('message moderation cannot be created without an explicit spam threshold', () => {
    assert.throws(() => validateAutomationSpec({
        trigger: { type: 'messageCreate' }, steps: [{ kind: 'kick' }]
    }), error => error.code === 'SPAM_THRESHOLD_REQUIRED');
});

test('validated spam moderation is high risk and has bounded threshold', () => {
    const spec = validateAutomationSpec({
        trigger: { type: 'messageCreate' },
        conditions: [{ kind: 'spam_threshold', count: 5, windowSeconds: 10 }],
        steps: [{ kind: 'timeout', durationMinutes: 15 }]
    });
    assert.equal(spec.risk, 'high');
    assert.equal(spec.steps[0].durationMinutes, 15);
});

test('workflow expressions cannot read arbitrary fields', () => {
    assert.throws(() => validateAutomationSpec({
        type: 'workflow', trigger: { type: 'guildMemberAdd' },
        steps: [{ kind: 'filter', field: 'process.env', value: 'x' }]
    }), error => error.code === 'INVALID_WORKFLOW_FIELD');
});

test('generated rule can be represented but remains separately gated at runtime', () => {
    const spec = validateAutomationSpec({ type: 'generated', trigger: { type: 'once', config: { at: '2030-01-01T00:00:00Z' } } });
    assert.equal(spec.risk, 'generated');
    assert.deepEqual(spec.steps, []);
});

test('model-facing automation tools cannot supply owner, guild, approval or capability grants', () => {
    const actionTool = automationTools.find(tool => tool.name === 'automation_action');
    const topLevel = actionTool.parameters.properties;
    const spec = topLevel.spec.properties;
    for (const forbidden of ['ownerId', 'createdBy', 'approvedBy', 'guildId', 'capabilityGrants']) {
        assert.equal(Object.hasOwn(topLevel, forbidden), false);
        assert.equal(Object.hasOwn(spec, forbidden), false);
    }
});
