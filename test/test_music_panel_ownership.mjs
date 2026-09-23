import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderMusicPanel } from '../utils/PanelRenderer.js';

const rendererSource = fs.readFileSync(new URL('../utils/PanelRenderer.js', import.meta.url), 'utf8');
const handlerSource = fs.readFileSync(new URL('../events/client/interactionCreate.js', import.meta.url), 'utf8');
const stateSource = fs.readFileSync(new URL('../models/PanelState.js', import.meta.url), 'utf8');
const blockAgentSource = fs.readFileSync(new URL('../commands/slash/block-agent.js', import.meta.url), 'utf8');
const blockModelSource = fs.readFileSync(new URL('../commands/slash/block-model.js', import.meta.url), 'utf8');

test('every persistent music-panel component carries its owner token', () => {
    const customIdCalls = [...rendererSource.matchAll(/\.setCustomId\(([^\n]+?)\)/g)].map(match => match[1]);
    assert.ok(customIdCalls.length > 0);
    assert.ok(customIdCalls.every(call => call.startsWith("componentId('music_")));
    assert.match(rendererSource, /MUSIC_PANEL_OWNER_REQUIRED/);
});

test('rendered music-panel IDs carry the concrete owner at runtime', async () => {
    const payload = await renderMusicPanel('ownership-test-guild', {
        currentTab: 'home', radioPage: 1, queuePage: 1, selectedPlaylistId: null
    }, '123456789');
    const ids = payload.components.flatMap(row => row.components.map(component => component.data.custom_id));
    assert.ok(ids.length > 0);
    assert.ok(ids.every(id => id.endsWith(':123456789')));
});

test('music-panel handler verifies token and persisted owner before mutations', () => {
    assert.match(stateSource, /ownerId:\s*\{\s*type:\s*String,\s*required:\s*true/);
    assert.match(handlerSource, /interaction\.user\.id\s*!==\s*ownerId/);
    assert.match(handlerSource, /PanelState\.findOne\(\{\s*messageId:\s*interaction\.message\.id,\s*ownerId\s*\}\)/);
});

test('playlist reads and deletes are scoped to the component owner', () => {
    assert.doesNotMatch(handlerSource, /UserPlaylist\.findById(?:AndDelete)?\(/);
    assert.match(handlerSource, /UserPlaylist\.findOneAndDelete\(\{\s*_id:\s*state\.selectedPlaylistId,\s*userId:\s*ownerId\s*\}\)/);
    const ownedReads = handlerSource.match(/UserPlaylist\.findOne\(\{\s*_id:\s*state\.selectedPlaylistId,\s*userId:\s*ownerId\s*\}\)/g) || [];
    assert.ok(ownedReads.length >= 2);
});

test('24/7 radio mutations keep the same Administrator gate as slash commands', () => {
    assert.match(handlerSource, /ADMIN_RADIO_ACTIONS\.has\(customId\)/);
    assert.match(handlerSource, /memberPermissions\?\.has\?\.\(PermissionFlagsBits\.Administrator\)/);
    for (const action of ['music_radio_add_current', 'music_modal_radio_add', 'music_modal_radio_remove']) {
        assert.ok(handlerSource.includes(`'${action}'`));
    }
});

test('owner-only model menus are bound to the owner who opened them', () => {
    for (const source of [blockAgentSource, blockModelSource]) {
        assert.match(source, /setCustomId\(`block(?:agent|chat)_[^`]+:\$\{interaction\.user\.id\}`\)/);
        assert.match(source, /menuOwnerId\s*!==\s*interaction\.user\.id/);
    }
});

test('block-agent omits optional emoji when its resource is blank', () => {
    assert.match(blockAgentSource, /\.trim\(\)/);
    assert.match(blockAgentSource, /\.\.\.\(emoji\s*\?\s*\{\s*emoji\s*\}\s*:\s*\{\}\)/);
});
