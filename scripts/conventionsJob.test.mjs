// The Conventions job runs with no `npm ci`. This is what holds it to that.
//
// `.github/workflows/test.yml` says so in a comment — "No `npm ci`: the checkers read
// `git ls-files` and need no dependencies" — and a comment is exactly as strong as the next
// person's attention. A checker added there that imports anything at all fails on a clean
// checkout with ERR_MODULE_NOT_FOUND: a red build, on a module path, for a job that was green
// locally because the author had node_modules.
//
// That is not hypothetical. check-favicons.mjs was added to that job in the first commit of
// #1322, removed in the next one (fc1da73a) for this reason, and added straight back in #1334 —
// where the local gate passed, because `npm run check` reads the job out of the workflow and
// runs it in a tree that HAS the dependencies. The same mistake twice, invisible both times
// until CI. So the constraint stops being prose here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const workflow = readFileSync(at('../.github/workflows/test.yml'), 'utf8');

/** The `node scripts/<x>.mjs` steps of the conventions job, in the order the job runs them. */
export function conventionsCheckers(yaml) {
  const job = /^ {2}conventions:\n([\s\S]*?)(?=^ {2}\S)/m.exec(yaml);
  if (!job) return [];
  return [...job[1].matchAll(/run:\s*node\s+(scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1]);
}

/** A bare specifier import — a package, not a relative file. `node:` builtins are always there. */
export function bareImports(src) {
  const out = [];
  for (const m of src.matchAll(/^\s*import\s+[\s\S]*?from\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of src.matchAll(/\bawait\s+import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out.filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'));
}

describe('the Conventions job needs no dependencies', () => {
  const checkers = conventionsCheckers(workflow);

  test('the job still has checkers, so this test cannot pass vacuously', () => {
    assert.ok(checkers.length > 5, `found only ${checkers.length} — has the job been renamed?`);
  });

  test('the job still installs nothing, which is the premise this rests on', () => {
    // A STEP, not a mention: the job's own comment says "No `npm ci`", so a plain text search
    // matches the very sentence that promises the opposite. (It failed exactly that way here.)
    // If someone genuinely adds an install, this constraint is void and the test above should be
    // deleted rather than quietly kept passing against a premise that no longer holds.
    const job = /^ {2}conventions:\n([\s\S]*?)(?=^ {2}\S)/m.exec(workflow)[1];
    const steps = job
      .split('\n')
      .filter((line) => /^\s*(-\s*)?(run|uses):/.test(line))
      .join('\n');
    assert.ok(!/npm ci|npm-ci/.test(steps), 'the conventions job now installs — revisit this test');
  });

  for (const checker of conventionsCheckers(workflow)) {
    test(`${checker} imports nothing that needs installing`, () => {
      const path = at(`../${checker}`);
      assert.ok(existsSync(path), `${checker} is in the workflow but not in the tree`);
      const bare = bareImports(readFileSync(path, 'utf8'));
      assert.deepEqual(
        bare,
        [],
        `${checker} imports ${bare.join(', ')}. The conventions job runs with no \`npm ci\`, so ` +
          `this fails on a clean checkout with ERR_MODULE_NOT_FOUND. Put the assertion in a test ` +
          `instead — the root \`npm test\` runs after an install (see check-favicons.test.mjs).`,
      );
    });
  }
});

describe('the import scanner itself', () => {
  test('finds a package import, and ignores relative and builtin ones', () => {
    const src = [
      "import { readFileSync } from 'node:fs';",
      "import { helper } from './helper.mjs';",
      "import { brandMarkSvg } from '@kimtos/icons';",
    ].join('\n');
    assert.deepEqual(bareImports(src), ['@kimtos/icons']);
  });

  test('finds a dynamic import too — a lazy one fails just as hard, only later', () => {
    assert.deepEqual(bareImports("const x = await import('marked');"), ['marked']);
    assert.deepEqual(bareImports("const y = await import('../www/scripts/gen-apps.mjs');"), []);
  });

  test('finds a multi-line import', () => {
    assert.deepEqual(bareImports("import {\n  a,\n  b,\n} from 'yaml';"), ['yaml']);
  });
});
