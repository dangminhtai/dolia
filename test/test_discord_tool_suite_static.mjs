import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const schema = fs.readFileSync(path.join(root, 'schema', 'discordTools.js'), 'utf8');
const impl = fs.readFileSync(path.join(root, 'utils', 'discordFunctions.js'), 'utf8');

function parseArray(name) {
  const match = schema.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `Missing ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

const queries = parseArray('queryActions');
const actions = parseArray('actionActions');
const cases = new Set([...impl.matchAll(/case '([^']+)'/g)].map(m => m[1]));

for (const name of [...queries, ...actions]) {
  assert.ok(cases.has(name), `Schema action has no executor case: ${name}`);
}

assert.equal(new Set(queries).size, queries.length, 'Duplicate query action');
assert.equal(new Set(actions).size, actions.length, 'Duplicate mutation action');
assert.ok(impl.includes("OWNER_ONLY"), 'Owner-only mutation guard missing');
assert.ok(impl.includes("allowedMentions: { parse: [] }"), 'Safe allowedMentions guard missing');

console.log(`Discord direct tools: ${queries.length} queries + ${actions.length} mutations = ${queries.length + actions.length} mapped actions`);
