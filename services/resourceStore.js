import fs from 'node:fs';
import path from 'node:path';

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function validateTree(value, location = 'resources') {
    if (typeof value === 'string') return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${location}: expected an object or a string`);
    }
    for (const [key, child] of Object.entries(value)) {
        if (forbiddenKeys.has(key) || key.includes('.')) throw new Error(`${location}: invalid key ${key}`);
        validateTree(child, `${location}.${key}`);
    }
}

export function mergeResources(base, overlay) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        merged[key] = typeof value === 'string' ? value : mergeResources(
            typeof base[key] === 'object' && base[key] !== null ? base[key] : {}, value
        );
    }
    return merged;
}

export function readResources(directories) {
    let result = {};
    for (const directory of directories) {
        if (!fs.existsSync(directory)) continue;
        for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort()) {
            const filename = path.join(directory, file);
            const data = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${filename}: expected an object`);
            const namespace = path.basename(file, '.json');
            validateTree({ [namespace]: data }, filename);
            result = mergeResources(result, { [namespace]: data });
        }
    }
    return result;
}

export function lookup(resources, key) {
    let value = resources;
    for (const part of key.split('.')) {
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
        value = value[part];
    }
    return typeof value === 'string' ? value : undefined;
}

// One pass prevents values containing $&, braces, or other parameters from being interpreted again.
export function interpolate(template, params = {}, resolveContext = null) {
    const values = Object.fromEntries(Object.entries(params || {}).map(([key, value]) => [key.toLowerCase(), value]));
    return template.replace(/\{\{\s*([\w.-]+)\s*\}\}|\{\s*([\w.-]+)\s*\}/g, (match, doubleKey, singleKey) => {
        const key = (doubleKey || singleKey).toLowerCase();
        if (Object.hasOwn(values, key)) return String(values[key] ?? '');
        if (resolveContext) {
            const value = resolveContext(match);
            if (value !== match) return value;
        }
        return doubleKey ? '' : match;
    });
}
