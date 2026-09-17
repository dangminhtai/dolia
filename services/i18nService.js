import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatString } from '../helpers/placeHolder.js';
import { readResources, lookup, interpolate } from './resourceStore.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const resourceDirectories = [
    path.join(root, 'resources/vi'),
    path.join(root, 'sandbox/i18n'),
    path.join(root, 'resources/overrides/vi')
];
let resources;

export function initI18n() {
    // Publish only after every file has parsed: failed reloads keep the last valid snapshot.
    const next = readResources(resourceDirectories);
    resources = next;
    return resources;
}

export function reloadI18n() {
    return initI18n();
}

export function t(key, params = {}, context = null) {
    if (!resources) initI18n();
    let template = lookup(resources, key);
    // Compatibility for generated sandbox commands using unqualified keys.
    if (template === undefined) {
        for (const namespace of Object.values(resources)) {
            if (Object.hasOwn(namespace, key) && typeof namespace[key] === 'string') {
                template = namespace[key];
                break;
            }
        }
    }
    if (template === undefined) return key;
    return interpolate(template, params, context ? token => formatString(token, context) : null);
}

export function getLocale() { return 'vi'; }

export default { t, initI18n, reloadI18n, getLocale };
