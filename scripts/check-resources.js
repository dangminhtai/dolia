import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readResources, lookup } from '../services/resourceStore.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
});
const placeholders = value => [...new Set([...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}|\{\s*([\w.-]+)\s*\}/g)]
    .map(match => match[1] || match[2]))].sort();

try {
    const builtIn = path.join(root, 'resources/vi');
    const directories = [builtIn, path.join(root, 'sandbox/i18n'), path.join(root, 'resources/overrides/vi')];
    const original = readResources(directories.slice(0, 2));
    const resources = readResources(directories);
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'resources/catalog.json'), 'utf8'));
    const errors = [];
    let references = 0;

    const compare = (tree, prefix = '') => {
        for (const [name, value] of Object.entries(tree)) {
            const key = prefix ? `${prefix}.${name}` : name;
            if (typeof value !== 'string') { compare(value, key); continue; }
            const current = lookup(resources, key);
            if (current === undefined) errors.push(`${key}: missing or replaced by an object`);
            else if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(current))) {
                errors.push(`${key}: override must preserve placeholders: ${placeholders(value).join(', ')}`);
            }
        }
    };
    compare(original);

    for (const [key, rule] of Object.entries(catalog)) {
        const value = lookup(resources, key);
        if (value === undefined) { errors.push(`${key}: missing (${rule.source})`); continue; }
        if (JSON.stringify(placeholders(value)) !== JSON.stringify([...rule.parameters].sort())) {
            errors.push(`${key}: expected placeholders: ${rule.parameters.join(', ') || '(none)'}`);
        }
        if (rule.maxLength && value.replace(/\{\{.*?\}\}/g, '').length > rule.maxLength) {
            errors.push(`${key}: static text exceeds ${rule.maxLength} characters`);
        }
        if (rule.maxLength && !value.trim()) errors.push(`${key}: display text cannot be empty`);
    }

    const files = ['commands', 'events', 'utils', 'services', 'class', 'helpers', 'core'].flatMap(name => walk(path.join(root, name)))
        .concat(['index.js', 'db.js', 'deployCommands.js', 'deployOnly.js'].map(name => path.join(root, name)));
    for (const filename of files.filter(name => name.endsWith('.js'))) {
        const source = fs.readFileSync(filename, 'utf8');
        for (const match of source.matchAll(/\b(?:t|tr)\(\s*['"]([^'"]+)['"]/g)) {
            references++;
            if (lookup(resources, match[1]) === undefined) errors.push(`${path.relative(root, filename)}: missing ${match[1]}`);
        }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Resources OK: ${Object.keys(catalog).length} contracts, ${references} references; JSON, placeholders and static limits checked.`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
