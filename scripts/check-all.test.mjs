import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runCommands } from './check-all.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(join(repoRoot, '.github/workflows/test.yml'), 'utf8');

// The point of check-all.mjs is that it reads the list instead of restating it.
// If the parser silently returned nothing, `npm run check` would exit 0 having
// run no guard at all -- a green that means nothing, which is the failure mode
// #213 records for an untested checker.
test('reads the real Conventions job and finds its guards', () => {
  const commands = runCommands(workflow, 'conventions');
  assert.ok(commands.length >= 10, `expected the Conventions guards, got ${commands.length}`);
  assert.ok(commands.includes('node scripts/check-emoji.mjs'));
  assert.ok(commands.includes('node scripts/check-agent-claims.mjs'));
});

test('picks up a guard added to the job, with no edit here', () => {
  const withNewGuard = workflow.replace(
    '      - run: node scripts/check-emoji.mjs',
    '      - run: node scripts/check-emoji.mjs\n      - run: node scripts/check-invented.mjs',
  );
  assert.ok(runCommands(withNewGuard, 'conventions').includes('node scripts/check-invented.mjs'));
});

test('stops at the next job rather than running the whole workflow', () => {
  const commands = runCommands(workflow, 'conventions');
  // `prettier --check .` belongs to Formatting, and the workspace test runs to
  // Unit tests. Bleeding into them would make `npm run check` a whole-CI run.
  assert.ok(!commands.some((c) => c.includes('prettier')));
  assert.ok(!commands.some((c) => c.includes('-w @kimtos/extension')));
});

test('names the job it cannot find instead of passing vacuously', () => {
  assert.throws(() => runCommands(workflow, 'no-such-job'), /no-such-job/);
});
