// The force-exit guard, checked against what it must catch and what it must pass.
//
// The bug it exists for: `--test-force-exit` kills the node:test process before
// asynchronously-registered suites have registered, so the run reports a smaller total
// with `fail 0` and CI is green over tests that never ran (#1011).
//
// The last three tests are the anti-rot ones. This guard scans a filtered subset of the
// tree, and a filter that quietly stops matching anything still prints success -- which
// is precisely how a guard decays into a no-op (#213). So the scope is asserted directly:
// it must cover the three kinds of file that can configure a test run, and it must NOT
// cover prose, because documenting the ban must not violate it.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAG, configuresATestRun, forceExitUses } from './check-test-force-exit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Reads from a fake tree, so no test touches the real one. */
const from = (tree) => (file) => tree[file];

test('a package.json test script passing the flag is caught, with its line', () => {
  const tree = {
    'www/package.json': [
      '{',
      '  "scripts": {',
      `    "test": "node --test ${FLAG} \\"test/**/*.test.ts\\""`,
      '  }',
      '}',
    ].join('\n'),
  };
  const uses = forceExitUses(Object.keys(tree), from(tree));
  assert.equal(uses.length, 1);
  assert.equal(uses[0].file, 'www/package.json');
  assert.equal(uses[0].line, 3, 'the offending line must be reported, not just the file');
});

test('a test script without the flag passes', () => {
  const tree = { 'www/package.json': '{ "scripts": { "test": "node --test \\"test/**/*.test.ts\\"" } }' };
  assert.deepEqual(forceExitUses(Object.keys(tree), from(tree)), []);
});

test('out-of-scope files are never read, so prose cannot make the guard crash or fire', () => {
  const readMustNotRun = (file) => {
    throw new Error(`read ${file}, which is out of scope`);
  };
  assert.deepEqual(forceExitUses(['README.md', 'docs/a.md', 'src/index.ts'], readMustNotRun), []);
});

test('a workflow step and a Makefile target are caught too, not just package.json', () => {
  const tree = {
    '.github/workflows/www.yml': `      - run: node --test ${FLAG} "test/**/*.test.ts"`,
    Makefile: `\ttest: node --test ${FLAG}`,
    'package.json': '{ "scripts": { "test": "node --test scripts/*.test.mjs" } }',
  };
  const files = forceExitUses(Object.keys(tree), from(tree)).map((u) => u.file);
  assert.deepEqual(files.sort(), ['.github/workflows/www.yml', 'Makefile']);
});

test('the scope covers every kind of file that can configure a test run', () => {
  for (const file of [
    'package.json',
    'www/package.json',
    'Makefile',
    '.github/workflows/test.yml',
    '.github/workflows/a.yaml',
    '.github/actions/npm-ci/action.yml',
  ]) {
    assert.equal(configuresATestRun(file), true, `${file} must be scanned`);
  }
});

test('prose, and anything that cannot start a test run, stays out of scope', () => {
  for (const file of [
    'CLAUDE.md',
    'docs/extension/architecture.md',
    'www/CHANGELOG.md',
    'scripts/check-test-force-exit.mjs',
    '.github/dependabot.yml',
  ]) {
    assert.equal(configuresATestRun(file), false, `${file} must not be scanned`);
  }
});

test('the real tree is clean, and the scan actually reaches files', () => {
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  const scanned = files.filter(configuresATestRun);
  assert.ok(scanned.includes('www/package.json'), 'the www test script must be in scope');
  assert.ok(scanned.includes('extension/package.json'), 'the extension test script must be in scope');
  assert.ok(scanned.includes('.github/workflows/test.yml'), 'the CI workflows must be in scope');
  assert.ok(scanned.length > 5, `the scan must reach real files, got ${scanned.length}`);
  assert.deepEqual(
    forceExitUses(files, (f) => readFileSync(join(ROOT, f), 'utf8')),
    [],
  );
});
