// The hand-typed-limit guard, checked against what it must catch and what it must pass.
//
// The bug it exists for: a doc restates a cap the extension declares, and goes stale the
// moment the cap changes. So the wolves (the number typed into prose, in any ordinary
// spelling) must be caught, the sheep (a token, a different number, a longer number that
// merely contains this one) must pass, and the real tree must be green today.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  declaredLimits,
  spellings,
  handTypedLimits,
  missingEntries,
  POLICED,
  ROOT,
  LIMITS_FILE,
} from './check-doc-limits.mjs';

const LIMITS = declaredLimits(readFileSync(join(ROOT, LIMITS_FILE), 'utf8'));

test('a limits module is read as numbers, whatever arithmetic declares it', () => {
  const limits = declaredLimits(
    `export const A_BYTES = 50 * 1024 * 1024;\nexport const B_CHARS = 50_000;\nexport const C_BYTES = 1024;\n`,
  );
  assert.deepEqual(limits, { A_BYTES: 52428800, B_CHARS: 50000, C_BYTES: 1024 });
});

test('non-numeric and commented-out declarations are not mistaken for limits', () => {
  const limits = declaredLimits(
    `// export const GHOST_BYTES = 1;\n` +
      `/* export const BLOCK_BYTES = 2; */\n` +
      `export const megabytes = (b) => b;\n` +
      `export const NAME = 'x';\n` +
      `export const REAL_BYTES = 8;\n`,
  );
  assert.deepEqual(limits, { REAL_BYTES: 8 });
});

test('a byte limit is spelled the way a writer would type it', () => {
  assert.deepEqual(
    spellings(50 * 1024 * 1024, 'bytes').map((s) => s.text),
    ['50 MB', '50MB'],
  );
  // A cap that stops being a round number keeps its decimal rather than rounding away
  // the difference between what the docs say and what the app enforces.
  assert.deepEqual(
    spellings(Math.round(12.5 * 1024 * 1024), 'bytes').map((s) => s.text),
    ['12.5 MB', '12.5MB'],
  );
});

test('a count limit is spelled grouped and ungrouped', () => {
  assert.deepEqual(
    spellings(50000, 'count').map((s) => s.text),
    ['50,000', '50000'],
  );
});

test('a hand-typed limit is caught, and reported with its token', () => {
  const hits = handTypedLimits('Files are capped at **50 MB**, and non-PDF files are rejected.\n', LIMITS);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
  assert.equal(hits[0].name, 'PDF_MAX_BYTES');
  assert.equal(hits[0].token, 'pdfMaxSize');
});

test('every spelling of every policed limit is caught', () => {
  for (const { name, kind, token } of POLICED) {
    for (const { text } of spellings(LIMITS[name], kind)) {
      const hits = handTypedLimits(`A line saying ${text} in passing.\n`, LIMITS);
      assert.ok(
        hits.some((h) => h.token === token),
        `"${text}" should be caught as ${token}`,
      );
    }
  }
});

test('a token, and a number that merely contains one, both pass', () => {
  // The whole point of the fix: the token itself must never be flagged.
  assert.deepEqual(handTypedLimits('Files are capped at **{{pdfMaxSize}}**.\n', LIMITS), []);
  // Word boundaries: the model-download table really does say "about 250 MB".
  assert.deepEqual(handTypedLimits('Grammit fetches about 250 MB when deep grammar is on.\n', LIMITS), []);
  assert.deepEqual(handTypedLimits('A corpus of 150000 words.\n', LIMITS), []);
  // A different cap is ordinary prose, not this one.
  assert.deepEqual(handTypedLimits('Some other thing is capped at 64 MB.\n', LIMITS), []);
});

test('the guard and the limits module agree about what exists', () => {
  assert.deepEqual(missingEntries(LIMITS), { unknown: [], unpoliced: [] });
});

test('no tracked doc states a limit by hand today (the check is green on main)', () => {
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 50, `expected the docs tree, found ${files.length} Markdown files`);
  for (const file of files) {
    const hits = handTypedLimits(readFileSync(join(ROOT, file), 'utf8'), LIMITS);
    assert.deepEqual(hits, [], `${file} states a limit by hand: ${hits.map((h) => h.spelling).join(', ')}`);
  }
});
