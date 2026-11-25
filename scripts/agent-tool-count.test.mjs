// The agent-tool counter, checked against the shapes real descriptors are written in.
//
// The bug it exists for (#1099): the count was typed by hand in four places, no two agreed,
// and all four disagreed with the descriptors. A derived count is only worth having if it is
// EXACT — a wrong derived number is published to the docs site just as confidently as a
// wrong typed one. So the scanner is tested against the things that break naive counting
// (nested objects, braces inside strings, template literals, regex literals, comments), and
// then cross-checked on the real tree against a completely independent method.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  countAgentTools,
  toolsIn,
  countArrayEntries,
  blankCommentsAndStrings,
  ROOT,
  APPS_DIR,
} from './agent-tool-count.mjs';

/** Wrap tool-object sources in the descriptor shape the scanner looks for. */
const descriptor = (...entries) => `export default {\n  id: 'x',\n  tools: [\n${entries.join(',\n')},\n  ],\n};\n`;

test('a descriptor with no tools array declares no tools', () => {
  assert.equal(toolsIn(`export default { id: 'kimtai', name: 'KimtAI' };\n`), 0);
});

test('each top-level object in the tools array is one tool', () => {
  assert.equal(toolsIn(descriptor(`    { name: 'a' }`, `    { name: 'b' }`, `    { name: 'c' }`)), 3);
});

test('a nested object is not another tool', () => {
  // `parameters.properties.name` is a legitimate shape, and counting `name:` keys reads it
  // as a second tool. Only objects that open at the array's own depth are entries.
  const src = descriptor(
    `    {
      name: 'list_notes',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      run: () => ({ ok: true, result: { name: 'x' } }),
    }`,
  );
  assert.equal(toolsIn(src), 1);
});

test('braces and brackets inside strings do not shift the depth', () => {
  const src = descriptor(
    `    { name: 'a', description: 'use {"tool": "a"} to call it]' }`,
    `    { name: 'b', description: "an unbalanced { in double quotes" }`,
    `    { name: 'c', description: 'an escaped quote \\' and a }' }`,
  );
  assert.equal(toolsIn(src), 3);
});

test('template literals, including nested expressions, are skipped whole', () => {
  const src = descriptor(
    '    { name: `a`, run: () => `no tool named "${name}" — try {${list.join(", ")}}` }',
    '    { name: `b`, run: () => `outer ${`inner ${x ? "{" : "]"}`} end` }',
  );
  assert.equal(toolsIn(src), 2);
});

test('a regex literal containing brackets is skipped, and a division is not mistaken for one', () => {
  const src = descriptor(
    `    { name: 'a', run: (t) => /^[{\\]]+$/.test(t) }`,
    `    { name: 'b', run: (n) => n / 2 / 3 }`,
  );
  assert.equal(toolsIn(src), 2);
});

test('a commented-out tool is not counted', () => {
  const src = descriptor(`    // { name: 'retired' }`, `    /* { name: 'also_retired' } */`, `    { name: 'live' }`);
  assert.equal(toolsIn(src), 1);
});

test('a tools array documented in a comment or a string is not mistaken for the real one', () => {
  // lib/agentTools.ts documents the descriptor shape as `tools: [{ name, … }]` in its header,
  // and a descriptor may well do the same above its own array. Matching the decoy would
  // bracket-match from inside a comment.
  const decoyed =
    `// Each app declares tools: [{ name, description, parameters, run }].\n` +
    `const usage = 'tools: [ { name } ]';\n` +
    descriptor(`    { name: 'real_one' }`, `    { name: 'real_two' }`);
  assert.equal(toolsIn(decoyed), 2);
});

test('blanking comments and strings keeps every index', () => {
  const src = `const a = 'hi'; // note\nconst b = \`t\`;\n`;
  const blanked = blankCommentsAndStrings(src);
  assert.equal(blanked.length, src.length);
  assert.equal(blanked.split('\n').length, src.split('\n').length);
  // The code survives; the comment body and the literals' contents do not.
  assert.match(blanked, /^const a = ' {2}'; +\nconst b = ` `;\n$/);
});

test('an unterminated tools array is an error, never a count', () => {
  // Silently returning what it managed to count is how a derived number becomes a
  // confidently wrong one. Fail instead.
  assert.throws(() => toolsIn(`export default { tools: [ { name: 'a' },\n`), /unterminated/);
  assert.throws(() => countArrayEntries('[ { /* never closed', 0), /unterminated/);
});

test('the real tree counts the same as an independent method', () => {
  // The second method: count the `name: '…'` keys that sit at a tool's own indentation,
  // which is how the issue counted them. Two methods that share no code agreeing on every
  // app is the evidence the published figure rests on.
  const { byApp, tools, apps } = countAgentTools(ROOT);
  const independent = {};
  for (const name of readdirSync(join(ROOT, APPS_DIR)).sort()) {
    const file = join(ROOT, APPS_DIR, name, 'index.ts');
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const start = /\n {2}tools:\s*\[/.exec(src);
    if (!start) continue;
    const count = (src.slice(start.index).match(/\n {6}name: '/g) || []).length;
    if (count) independent[name] = count;
  }

  assert.deepEqual(byApp, independent);
  assert.equal(
    tools,
    Object.values(independent).reduce((a, b) => a + b, 0),
  );
  assert.equal(apps, Object.keys(independent).length);
  assert.ok(tools > 0 && apps > 0, 'the descriptors declare no tools at all — the scanner has stopped working');
});

test('an unreadable apps directory fails rather than counting zero', () => {
  assert.throws(() => countAgentTools(join(ROOT, 'no', 'such', 'root')), /Cannot read the app descriptors/);
});
