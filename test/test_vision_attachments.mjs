import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDiscordAttachments, imageMimeOf } from '../helpers/discordAttachmentHelper.js';

function collection(values) {
    return new Map(values.map((value, i) => [String(i + 1), value]));
}

const bytes = value => Buffer.from(value, 'utf8');

function fakeFetch(routes) {
    return async url => {
        const value = routes[url];
        if (value === undefined) return { ok: false, status: 404 };
        const data = Buffer.isBuffer(value) ? value : bytes(value);
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
            text: async () => data.toString('utf8')
        };
    };
}

test('vision collects current + replied images and keeps image bytes out of text blocks', async () => {
    const currentPng = { id: 'a1', name: 'exercise.png', contentType: 'image/png', size: 4, url: 'mem://png' };
    const repliedJpg = { id: 'a2', name: 'reference.jpg', contentType: 'image/jpeg', size: 4, url: 'mem://jpg' };
    const repliedText = { id: 'a3', name: 'note.txt', contentType: 'text/plain', size: 5, url: 'mem://txt' };

    const message = {
        attachments: collection([currentPng]),
        reference: { messageId: 'm1' },
        channel: { messages: { fetch: async () => ({ attachments: collection([repliedJpg, repliedText]) }) } }
    };

    const result = await prepareDiscordAttachments(message, {
        fetchImpl: fakeFetch({ 'mem://png': bytes('png!'), 'mem://jpg': bytes('jpg!'), 'mem://txt': 'hello' })
    });

    assert.equal(result.imageParts.length, 2);
    assert.equal(result.imageParts[0].inlineData.mimeType, 'image/png');
    assert.equal(result.imageParts[1].inlineData.mimeType, 'image/jpeg');
    assert.match(result.imageParts[0].inlineData.data, /^[A-Za-z0-9+/=]+$/);
    assert.equal(result.textBlocks.length, 1);
    assert.match(result.textBlocks[0], /hello/);
    assert.equal(result.warnings.length, 0);
});

test('vision supports Gemini image MIME formats and infers MIME from extension', () => {
    assert.equal(imageMimeOf({ name: 'photo.HEIC', contentType: null }), 'image/heic');
    assert.equal(imageMimeOf({ name: 'photo.heif', contentType: 'application/octet-stream' }), 'image/heif');
    assert.equal(imageMimeOf({ name: 'photo.webp', contentType: 'image/webp' }), 'image/webp');
    assert.equal(imageMimeOf({ name: 'photo.gif', contentType: 'image/gif' }), null);
});

test('oversized image is skipped before download when Discord provides size', async () => {
    let fetched = false;
    const message = {
        attachments: collection([{ id: 'big', name: 'big.png', contentType: 'image/png', size: 9 * 1024 * 1024, url: 'mem://big' }]),
        channel: { messages: { fetch: async () => null } }
    };

    const result = await prepareDiscordAttachments(message, {
        maxVisionBytes: 8 * 1024 * 1024,
        fetchImpl: async () => { fetched = true; throw new Error('should not fetch'); }
    });

    assert.equal(fetched, false);
    assert.equal(result.imageParts.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.imageNotes[0], /quá lớn/);
});
