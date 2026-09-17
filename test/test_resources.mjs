import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readResources, lookup, interpolate } from '../services/resourceStore.js';
import { t } from '../services/i18nService.js';
import Logger from '../class/Logger.js';

test('user edits win over generated text without removing sibling keys', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dolia-resources-'));
    try {
        const directories = ['base', 'sandbox', 'personal'].map(name => {
            const directory = path.join(root, name);
            fs.mkdirSync(directory);
            return directory;
        });
        const values = [{ panel: { title: 'Original', body: 'Keep me' } }, { panel: { title: 'AI edit' }, added: 'New' }, { panel: { title: 'My edit' } }];
        directories.forEach((directory, index) => fs.writeFileSync(path.join(directory, 'demo.json'), JSON.stringify(values[index])));
        const resources = readResources(directories);
        assert.equal(lookup(resources, 'demo.panel.title'), 'My edit');
        assert.equal(lookup(resources, 'demo.panel.body'), 'Keep me');
        assert.equal(lookup(resources, 'demo.added'), 'New');
        fs.writeFileSync(path.join(directories[2], 'demo.json'), '{broken');
        assert.throws(() => readResources(directories), SyntaxError);
        assert.equal(lookup(resources, 'demo.panel.title'), 'My edit');
        fs.writeFileSync(path.join(directories[2], 'demo.json'), '{"__proto__":{"polluted":"yes"}}');
        assert.throws(() => readResources(directories), /invalid key/);
        assert.equal({}.polluted, undefined);
        fs.writeFileSync(path.join(directories[2], 'demo.json'), '{"title":42}');
        assert.throws(() => readResources(directories), /expected an object or a string/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('parameter values are literal and are never substituted a second time', () => {
    assert.equal(interpolate('{{title}} / {count}', { title: '$& {{count}}', count: 2 }), '$& {{count}} / 2');
    assert.equal(interpolate('{{ name }} {NAME}', { name: 'Tài' }), 'Tài Tài');
    assert.equal(interpolate('{{missing}} {missing}'), ' {missing}');
    assert.equal(interpolate('{{value}}', { value: null }), '');
    assert.equal(interpolate('{{user}} {{value}}', { value: '{{user}}' }, () => 'Tài'), 'Tài {{user}}');
});

test('built-in text and owner restriction resolve instead of leaking resource keys', () => {
    assert.notEqual(t('self_dev.only_owner'), 'self_dev.only_owner');
    const value = t('music.play.priority_playlist', { name: '$& {{count}}', count: 15 });
    assert.ok(value.includes('$& {{count}}'));
    assert.equal(t('missing.resource'), 'missing.resource');
});

test('logger preserves errors and handles circular diagnostic objects', () => {
    const original = console.log;
    const output = [];
    console.log = value => output.push(value);
    try {
        const circular = {}; circular.self = circular;
        Logger.error('Failed:', new Error('diagnostic'), circular);
        Logger.success('Saved', { count: 2 });
    } finally { console.log = original; }
    assert.match(output[0], /diagnostic/);
    assert.match(output[0], /Circular/);
    assert.match(output[1], /count: 2/);
});

test('every built-in slash command builds a valid Discord payload offline', async () => {
    const directory = new URL('../commands/slash/', import.meta.url);
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.js'));
    assert.ok(files.length > 0);
    for (const filename of files) {
        const { default: command } = await import(new URL(filename, directory));
        const payload = command.data.toJSON();
        assert.ok(payload.description.length > 0 && payload.description.length <= 100, filename);
        assert.ok(!payload.description.startsWith('commands.'), filename);
    }
});
