// The stale-agent-tool-count guard, checked against what it must catch and what it must pass.
//
// The bug it exists for (#1099): four files stated the count by hand, no two agreed, and all
// four disagreed with the descriptors. So the wolves (a wrong figure, in the phrasings the
// four actually used, including one wrapped across lines inside a blockquote) must be caught,
// the sheep (the right figure, a docs token, an unrelated sentence about tools) must pass, and
// the real tree must be green today.
//
// The truth these cases are checked against is DELIBERATELY a fixture, not the repo's real
// count: a test that typed today's 93 out would be a fifth hand-maintained copy of the very
// number this guard exists to stop anyone copying. The real tree is checked against the
// derived count, at the bottom.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wrongCounts, flattenContinuations, SCANNED, ALLOWED } from './check-agent-tool-count.mjs';
import { countAgentTools, ROOT } from './agent-tool-count.mjs';

/** A made-up truth, so these cases never restate the repo's real count. */
const TRUTH = { tools: 40, apps: 7 };

test('a wrong count is caught, and both figures are reported', () => {
  const hits = wrongCounts('We ship **81 agent tools across 18 apps**, and every one is dormant.', TRUTH);
  assert.deepEqual(
    hits.map((h) => [h.what, h.said, h.actual]),
    [
      ['tools', 81, 40],
      ['apps', 18, 7],
    ],
  );
});

test('only the figure that is wrong is reported', () => {
  const hits = wrongCounts('79 tools across 7 apps', TRUTH);
  assert.deepEqual(
    hits.map((h) => h.what),
    ['tools'],
  );
});

test('the right count passes', () => {
  assert.deepEqual(wrongCounts('40 tools across 7 apps, all dormant.', TRUTH), []);
  assert.deepEqual(wrongCounts('We ship 40 agent tools.', TRUTH), []);
});

test('a count wrapped across lines inside a blockquote is still caught', () => {
  // The exact shape CLAUDE.md had. A per-line matcher, or one that did not blank the `>`,
  // reads straight past the sentence this guard exists for.
  const text =
    '   > **The agent does not run.** No shipped model can enter the loop, so all 81\n' +
    '   > tools across 18 apps are inert.\n';
  const hits = wrongCounts(text, TRUTH);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].line, 1, 'the failure is reported at the line the sentence starts on');
});

test('a count wrapped across a line comment is still caught', () => {
  const hits = wrongCounts('// We ship 79 agent\n// tools across 18 apps and they are all DORMANT.\n', TRUTH);
  assert.equal(hits.length, 2);
});

test('flattening keeps every index, so reported line numbers are the real ones', () => {
  const text = '  > one\n  // two\n   * three\n';
  const flat = flattenContinuations(text);
  assert.equal(flat.length, text.length);
  assert.equal(flat.split('\n').length, text.split('\n').length);
  assert.equal(flat, '    one\n     two\n     three\n');
});

test('a docs token has no figure to be wrong about', () => {
  assert.deepEqual(wrongCounts('— {{agentToolCount}} tools across {{agentToolAppCount}} apps —', TRUTH), []);
});

test('an unrelated sentence about tools or apps is not a hit', () => {
  // DevTools is a bag of developer utilities the docs also call tools, and the docs site
  // counts apps. A guard that fires on those teaches people to work around it.
  assert.deepEqual(wrongCounts('DevTools bundles 12 tools in one window.', TRUTH), []);
  assert.deepEqual(wrongCounts('The 14 core apps are free forever.', TRUTH), []);
  assert.deepEqual(wrongCounts('It measures six things against five real tools.', TRUTH), []);
});

test('every file type a count was found in is scanned', () => {
  // The four copies lived in Markdown and in a .mjs header comment; the descriptors and the
  // marketing site could grow a fifth.
  for (const file of ['CLAUDE.md', 'a/b.mjs', 'a/b.ts', 'a/b.js', 'a/b.vue']) {
    assert.ok(SCANNED.test(file), `${file} is not scanned`);
  }
  assert.equal(SCANNED.test('a/b.toml'), false);
});

test('only this test file is exempt, and only because a wrong count is its data', () => {
  // An allowlist is how a guard stops policing something. Keep it to the one file that has to
  // contain the stale figures — the guard's own modules deliberately do not.
  assert.deepEqual([...ALLOWED], ['scripts/check-agent-tool-count.test.mjs']);
  for (const file of ['scripts/agent-tool-count.mjs', 'scripts/check-agent-tool-count.mjs']) {
    assert.equal(ALLOWED.has(file), false, `${file} must not be exempt from its own rule`);
  }
});

test('no tracked file states a stale count today (the check is green on main)', () => {
  const truth = countAgentTools(ROOT);
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => SCANNED.test(f) && !ALLOWED.has(f));
  assert.ok(files.length > 100, `expected the repo's docs and sources, found ${files.length} files`);
  for (const file of files) {
    const hits = wrongCounts(readFileSync(join(ROOT, file), 'utf8'), truth);
    assert.deepEqual(hits, [], `${file} states a stale count: ${hits.map((h) => h.stated).join(', ')}`);
  }
});
