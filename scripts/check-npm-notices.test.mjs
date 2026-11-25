// The npm-attribution drift guard, checked against what it must catch and what it must pass.
//
// The bug it exists for (#1101): nothing ran scripts/gen-third-party-notices.mjs in CI and nothing
// diffed its output against the committed file, so the npm half of THIRD-PARTY-NOTICES.md drifted
// silently — in BOTH directions over one package. `phonemizer` reached the bundle with no notice at
// all (#1090), and after it was removed again (#1098) the notices went on listing it. So the sheep
// (a list that matches the lockfile and covers every imported package) must pass, and every wolf —
// a removed dependency, an un-regenerated version bump, a licence change, a hand-edited list, a new
// bundled import with no entry — must fail. The real tree must be green today.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  noticeComponents,
  noticeDetails,
  lockedPackages,
  sourcePackages,
  driftErrors,
  componentDiff,
  extensionSourceTexts,
} from './check-npm-notices.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// --- Parsing the committed notices ----------------------------------------------------------

const NOTICES = [
  '# Third-party notices',
  '',
  '2 components:',
  '',
  '- marked 18.0.7 — MIT',
  '- webm-muxer 5.1.4 — MIT',
  '',
  '---',
  '',
  '# On-device models',
  '',
  '- **Widget** — Apache-2.0 — used by X',
  '',
  '## Widget',
  '',
  'License: **Apache-2.0**',
  '',
  '---',
  '',
  '## marked 18.0.7',
  '',
  'License: **MIT**',
  '',
  '## webm-muxer 5.1.4',
  '',
  'License: **MIT**',
  '',
].join('\n');

test('noticeComponents reads the count and the bullets, and stops at the model section', () => {
  const { declared, entries } = noticeComponents(NOTICES);
  assert.equal(declared, 2);
  assert.deepEqual(entries, [
    { name: 'marked', version: '18.0.7', license: 'MIT' },
    { name: 'webm-muxer', version: '5.1.4', license: 'MIT' },
  ]);
});

test('noticeComponents reports an absent npm half rather than pretending it is empty-but-fine', () => {
  assert.deepEqual(noticeComponents('# Third-party notices\n\nnothing here\n'), { declared: null, entries: [] });
});

test('noticeDetails keys the per-package sections by heading, model sections included', () => {
  const details = noticeDetails(NOTICES);
  assert.equal(details.get('marked 18.0.7'), 'MIT');
  assert.equal(details.get('webm-muxer 5.1.4'), 'MIT');
  assert.equal(details.get('Widget'), 'Apache-2.0');
});

test('lockedPackages takes the hoisted entry only, so a nested copy cannot stand in for it', () => {
  const locked = lockedPackages(
    JSON.stringify({
      packages: {
        '': { name: 'root' },
        'node_modules/marked': { version: '18.0.7', license: 'MIT' },
        'node_modules/a/node_modules/marked': { version: '4.0.0', license: 'MIT' },
        'node_modules/nolicense': { version: '1.0.0' },
      },
    }),
  );
  assert.deepEqual(locked.get('marked'), { version: '18.0.7', license: 'MIT' });
  // A field npm did not write is "cannot verify", not "wrong".
  assert.deepEqual(locked.get('nolicense'), { version: '1.0.0', license: null });
  assert.equal(locked.size, 2);
});

// --- The import scan ------------------------------------------------------------------------

test('sourcePackages finds every way a specifier is written, and reduces deep paths', () => {
  const names = sourcePackages([
    "import { marked } from 'marked';\n",
    "const t = await import('tesseract.js');\n",
    "const w = require('webm-muxer');\n",
    "import 'highlight.js/styles/github.css?inline';\n",
    "export { x } from '@huggingface/transformers';\n",
    "import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';\n",
  ]);
  assert.deepEqual([...names].sort(), [
    '@huggingface/transformers',
    'highlight.js',
    'marked',
    'pdfjs-dist',
    'tesseract.js',
    'webm-muxer',
  ]);
});

test('sourcePackages ignores what never reaches a user: comments, types, relatives, node: and our own scope', () => {
  const names = sourcePackages([
    "// we used to import 'phonemizer' here\n",
    "/* import { x } from 'gone-package'; */\n",
    "import type { Token } from 'marked';\n",
    "export type { A } from 'some-types-only-pkg';\n",
    "import { store } from './models/store';\n",
    "import { readFile } from 'node:fs';\n",
    "import { DEFAULTS } from '@kimtos/config';\n",
  ]);
  assert.deepEqual([...names], []);
});

test('sourcePackages keeps a legacy uppercase package name — a skip here is an unattributed licence', () => {
  assert.deepEqual([...sourcePackages(["import { encode } from 'Base64';\n"])], ['Base64']);
});

test('sourcePackages rejects a specifier that is not a valid package name', () => {
  // A generated data file full of quoted prose matched an early draft of this scan.
  assert.deepEqual([...sourcePackages(['const s = "import x from \\",\\"";\n'])], []);
});

// --- The drift rules ------------------------------------------------------------------------

/** A minimal in-sync world: one component, locked at that version and licence, imported. */
const inSync = () => ({
  declared: 1,
  entries: [{ name: 'marked', version: '18.0.7', license: 'MIT' }],
  details: new Map([['marked 18.0.7', 'MIT']]),
  locked: new Map([['marked', { version: '18.0.7', license: 'MIT' }]]),
  imported: new Set(['marked']),
});

test('a list that matches the lockfile and covers every import passes', () => {
  assert.deepEqual(driftErrors(inSync()), []);
});

test('a component that is no longer in the lockfile fails — the phonemizer removal (#1098)', () => {
  const input = inSync();
  input.declared = 2;
  input.entries.push({ name: 'phonemizer', version: '1.2.1', license: 'Apache-2.0' });
  input.details.set('phonemizer 1.2.1', 'Apache-2.0');
  const errors = driftErrors(input);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /phonemizer 1\.2\.1[\s\S]*not in package-lock\.json/);
});

test('a package imported by the source with no entry fails — the phonemizer addition (#1090)', () => {
  const input = inSync();
  input.imported.add('phonemizer');
  const errors = driftErrors(input);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /phonemizer[\s\S]*imported by extension\/src but has no entry/);
});

test('a version bump nobody regenerated for fails', () => {
  const input = inSync();
  input.locked.set('marked', { version: '19.0.0', license: 'MIT' });
  const errors = driftErrors(input);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /locked at 19\.0\.0/);
});

test('a package that changed its licence under us fails', () => {
  const input = inSync();
  input.locked.set('marked', { version: '18.0.7', license: 'GPL-3.0' });
  const errors = driftErrors(input);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /listed as MIT but package-lock\.json says GPL-3\.0/);
});

test('a lockfile with no licence field is not treated as a mismatch', () => {
  const input = inSync();
  input.locked.set('marked', { version: '18.0.7', license: null });
  assert.deepEqual(driftErrors(input), []);
});

test("the generator's own `see text below` fallback is not a mismatch — a red nobody could clear", () => {
  const input = inSync();
  input.entries[0].license = 'see text below';
  input.details = new Map([['marked 18.0.7', 'see text below']]);
  assert.deepEqual(driftErrors(input), []);
});

test('a count that does not match the bullets fails', () => {
  const input = inSync();
  input.declared = 12;
  const errors = driftErrors(input);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /says "12 components:" but lists 1/);
});

test('a missing npm half fails rather than passing vacuously', () => {
  const errors = driftErrors({ ...inSync(), declared: null });
  assert.match(errors.join('\n'), /no "N components:" line/);
});

test('an unsorted or duplicated list fails — it is not what the generator emits', () => {
  const unsorted = {
    declared: 2,
    entries: [
      { name: 'webm-muxer', version: '5.1.4', license: 'MIT' },
      { name: 'marked', version: '18.0.7', license: 'MIT' },
    ],
    details: new Map([
      ['marked 18.0.7', 'MIT'],
      ['webm-muxer 5.1.4', 'MIT'],
    ]),
    locked: new Map([
      ['marked', { version: '18.0.7', license: 'MIT' }],
      ['webm-muxer', { version: '5.1.4', license: 'MIT' }],
    ]),
    imported: new Set(),
  };
  assert.match(driftErrors(unsorted).join('\n'), /sorted by name and free of duplicates/);
});

test('a bullet with no detail section fails — a list entry with nothing behind it', () => {
  const input = inSync();
  input.details = new Map();
  const errors = driftErrors(input);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no "## marked 18\.0\.7" section/);
});

test('a bullet whose detail section reproduces a different licence fails', () => {
  const input = inSync();
  input.details.set('marked 18.0.7', 'Apache-2.0');
  const errors = driftErrors(input);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /its section says Apache-2\.0/);
});

// --- Reporting the exact (--bundle) failure --------------------------------------------------

test('componentDiff names the package that gained or lost a notice, not the licence text', () => {
  const without = NOTICES.replace('- webm-muxer 5.1.4 — MIT\n', '');
  assert.deepEqual(componentDiff(without, NOTICES), { added: ['webm-muxer 5.1.4 — MIT'], removed: [] });
  assert.deepEqual(componentDiff(NOTICES, without), { added: [], removed: ['webm-muxer 5.1.4 — MIT'] });
});

test('componentDiff reports a version or licence move as one out and one in', () => {
  const bumped = NOTICES.replace('- marked 18.0.7 — MIT', '- marked 19.0.0 — MIT');
  assert.deepEqual(componentDiff(NOTICES, bumped), {
    added: ['marked 19.0.0 — MIT'],
    removed: ['marked 18.0.7 — MIT'],
  });
});

test('componentDiff is empty when only the licence bodies differ, so the caller can say so', () => {
  assert.deepEqual(componentDiff(NOTICES, NOTICES + '\n```\nextra licence text\n```\n'), { added: [], removed: [] });
});

// --- The real tree --------------------------------------------------------------------------

test('both halves are actually wired into CI', () => {
  // A guard nothing runs is a guard that does not exist, which is the whole shape of #1101:
  // the generator was real, documented and correct, and no job ever invoked it.
  const workflow = read('.github/workflows/test.yml');
  assert.match(workflow, /run: node scripts\/check-npm-notices\.mjs$/m, 'the conventions half is not in CI');
  assert.match(workflow, /run: node scripts\/check-npm-notices\.mjs --bundle$/m, 'the exact half is not in CI');
});

test('the committed notices describe the packages we really ship', () => {
  const noticesText = read('THIRD-PARTY-NOTICES.md');
  const { declared, entries } = noticeComponents(noticesText);
  // Sanity: an empty parse would make every assertion below vacuous.
  assert.ok(entries.length >= 8, `expected the shipped npm components, found ${entries.length}`);
  const imported = sourcePackages(extensionSourceTexts());
  assert.ok(imported.size >= 5, `expected the extension's npm imports, found ${imported.size}`);
  const errors = driftErrors({
    declared,
    entries,
    details: noticeDetails(noticesText),
    locked: lockedPackages(read('package-lock.json')),
    imported,
  });
  assert.deepEqual(errors, [], errors.join('\n'));
});
