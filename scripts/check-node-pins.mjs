// Assert that every place pinning a Node version agrees with the SINGLE SOURCE
// OF TRUTH: .nvmrc. Run by `make lint`, so the Makefile CI job enforces it.
//
//   node scripts/check-node-pins.mjs
//
// The workflows DERIVE their version (`node-version-file: .nvmrc`), so they
// need no maintenance — this only catches someone reintroducing a hardcoded
// `node-version:`. The drift it guards against is not theoretical — the repo
// once shipped Node 22 in CI while declaring `>=22`, which let a contributor
// land on Node 24, where Nuxt's dev server dies inside Node's module loader
// (#149).
//
// Bump Node by editing .nvmrc; this check tells you if a workflow hardcodes a
// version instead of reading it.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');

const want = read('.nvmrc').trim();
if (!/^\d+$/.test(want)) {
  console.error(`.nvmrc must hold a bare major version (e.g. "22"), got "${want}"`);
  process.exit(1);
}

const errors = [];

// Workflows: must read .nvmrc, never hardcode the version.
const workflowDir = new URL('.github/workflows/', root);
for (const file of readdirSync(workflowDir).filter((f) => f.endsWith('.yml'))) {
  for (const [i, line] of read(`.github/workflows/${file}`).split('\n').entries()) {
    if (/^\s*node-version:/.test(line)) {
      errors.push(`.github/workflows/${file}:${i + 1}: hardcoded node-version — use \`node-version-file: .nvmrc\``);
    }
  }
}

if (errors.length) {
  console.error(`Node version pins disagree with .nvmrc (${want}):\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`node pins: .nvmrc (${want}), workflows — in sync.`);
