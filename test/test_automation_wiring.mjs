import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalMessageEvent } from '../services/automationEventRouter.js';

test('message adapter stores only a reduced canonical event', () => {
    const event = canonicalMessageEvent({
        id: 'm1', guildId: 'g1', channelId: 'c1', createdAt: new Date('2026-01-01T00:00:00Z'),
        content: 'hello', webhookId: null, author: { id: 'u1', bot: false }
    });
    assert.deepEqual(Object.keys(event).sort(), ['actorId', 'channelId', 'data', 'eventId', 'guildId', 'occurredAt', 'source', 'subjectId', 'type'].sort());
    assert.equal(event.data.content, 'hello');
    assert.equal('client' in event, false);
});

test('automation dispatch happens before the #dolia AI chat gate', () => {
    const source = fs.readFileSync(new URL('../events/client/messageCreate.js', import.meta.url), 'utf8');
    assert.ok(source.indexOf('handleMessageAutomation(message)') < source.indexOf("message.channel.name !== 'dolia'"));
});

test('generated automation is not connected to host dynamic script execution', () => {
    const files = ['../services/automationRunner.js', '../services/automationService.js'];
    for (const file of files) {
        const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /runDynamicScript|selfDevService|import\(.*module/i);
    }
});

test('automation panel rejects components that do not belong to the current user', () => {
    const source = fs.readFileSync(new URL('../services/automationPanelService.js', import.meta.url), 'utf8');
    assert.match(source, /interaction\.user\.id !== ownerId/);
});
