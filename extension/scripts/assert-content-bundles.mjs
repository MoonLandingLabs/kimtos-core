// Asserts that every content-script / service-worker bundle is SELF-CONTAINED.
//
// An MV3 content script cannot fetch a sibling chunk at runtime. If the bundler ever
// code-splits one, the build stays green and the script breaks on the user's pages —
// a runtime-only failure, on every site they visit. That is too quiet a way to lose
// Grammit Anywhere and Clipboard capture, so it is checked rather than trusted.
//
// The invariant used to rest on `inlineDynamicImports: true`, which Vite 8 (rolldown)
// deprecated and IGNORES. It is now `codeSplitting: false` in vite.content.config.ts —
// and this script is what makes sure that is actually true of the emitted files (#115).
//
//   node scripts/assert-content-bundles.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// Keep in step with ENTRIES in vite.content.config.ts.
const BUNDLES = ['writer.js', 'clipboard.js', 'fakeform.js', 'fakeform-fill.js', 'background.js'];

// A split bundle betrays itself by reaching for another file: a dynamic `import(...)`,
// a static `import ... from './chunk'`, or a bare `require('./…')`. An inlined bundle
// has none — everything it needs is already in the file.
const LEAKS = [
  { re: /\bimport\s*\(/, what: 'a dynamic import() — the chunk it loads will not exist for a content script' },
  { re: /\bfrom\s*["']\.{1,2}\//, what: 'a static import from a sibling file' },
  { re: /\brequire\s*\(\s*["']\.{1,2}\//, what: 'a require() of a sibling file' },
];

let failed = false;
for (const file of BUNDLES) {
  const path = join(DIST, file);
  if (!existsSync(path)) {
    console.error(`assert-content-bundles: ${file} is MISSING from dist/ — did the content build run?`);
    failed = true;
    continue;
  }
  const code = readFileSync(path, 'utf8');
  const found = LEAKS.filter(({ re }) => re.test(code));
  if (found.length) {
    failed = true;
    console.error(`assert-content-bundles: ${file} is NOT self-contained — it contains:`);
    for (const { what } of found) console.error(`  - ${what}`);
    console.error('  Fix: keep `codeSplitting: false` on the output in vite.content.config.ts.');
  }
}

if (failed) {
  console.error('\nA content script MUST be one self-contained file. See #115.');
  process.exit(1);
}
console.log(`assert-content-bundles: ${BUNDLES.length} bundles are self-contained.`);
