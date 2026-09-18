import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

const isTermux = process.platform === 'android'
    || Boolean(process.env.TERMUX_VERSION)
    || String(process.env.PREFIX || '').includes('com.termux');

const checks = [];
const push = (name, ok, detail = '') => checks.push({ name, ok, detail });

push('Host Android/Termux', isTermux, `platform=${process.platform}, arch=${process.arch}`);
push('Node >= 20', Number(process.versions.node.split('.')[0]) >= 20, process.version);

const required = [
    ['discord.js', () => import('discord.js')],
    ['@google/genai', () => import('@google/genai')],
    ['mongoose', () => import('mongoose')],
    ['@napi-rs/canvas', () => import('@napi-rs/canvas')]
];

for (const [name, loader] of required) {
    try {
        await loader();
        push(name, true);
    } catch (error) {
        push(name, false, error?.message || String(error));
    }
}

const prefix = process.env.PREFIX || '/data/data/com.termux/files/usr';
const fontCandidates = [
    path.join(prefix, 'share/fonts/TTF/DejaVuSans.ttf'),
    path.join(prefix, 'share/fonts/truetype/dejavu/DejaVuSans.ttf')
];
push('Font tiếng Việt', fontCandidates.some(fs.existsSync), fontCandidates.find(fs.existsSync) || 'không tìm thấy DejaVuSans.ttf');

for (const item of checks) {
    console.log(`${item.ok ? '[OK]' : '[FAIL]'} ${item.name}${item.detail ? ` | ${item.detail}` : ''}`);
}

if (checks.some(item => !item.ok)) {
    process.exitCode = 1;
} else {
    console.log('[OK] Dolia sẵn sàng chạy trên Termux.');
}
