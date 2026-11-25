// Fails the build when a shipped npm package carries a compiled third-party artifact that
// nobody has recorded the licence of.
//
//   node scripts/check-embedded-licenses.mjs
//
// THE HOLE IT CLOSES. scripts/gen-third-party-notices.mjs reads each package's own
// `license` field, which describes what the package's author WROTE and says nothing about
// what it BUNDLES. `phonemizer` declares `"license": "Apache-2.0"` — correct for its own
// JavaScript — while shipping a 1.3 MB Emscripten build of GPL-3.0 eSpeak-NG inside
// `dist/phonemizer.js`. The generated notices would have reported it as Apache-2.0 and
// never named eSpeak-NG: a false notice for a copyleft component we conveyed to every
// user (#1092).
//
// WHY IT DOES NOT SCAN FOR LICENCE TEXT. Because that does not work. The GPL text is not
// in the compiled bundle; Emscripten does not carry it through, and the only literal "GPL"
// strings in phonemizer's dist are accidents of base64. Detecting the LICENCE is
// unreliable; detecting the ARTIFACT is not. So this finds every shipped package that
// contains a wasm blob, an Emscripten packaged filesystem or a native binary, and requires
// a human to have written down what is inside it in scripts/embedded-binaries.mjs.
//
// WHERE IT RUNS. The `test` job, not `conventions`: it reads node_modules, and the
// conventions job deliberately installs nothing (which is also why check-generated.mjs
// lives there). It therefore FAILS rather than skips when node_modules is missing — a
// guard that silently passes when it cannot look is worse than no guard, and this repo has
// paid for that lesson more than once.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED } from './embedded-binaries.mjs';
import { noticeComponents } from './check-npm-notices.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Extensions that are a compiled artifact on sight. `.data` is Emscripten's packaged
 *  filesystem — how espeak-ng-data would have travelled. */
const BINARY = /\.(wasm|so|dll|dylib|node|data|bin)$/i;

/** Markers of a foreign engine compiled INTO JavaScript. `FS_createPath` and
 *  `expectedDataFileDownloads` are the Emscripten file-packager's own symbols: their
 *  presence means the file carries a bundled filesystem, which is exactly what
 *  `espeak-ng-data` was. */
const COMPILED_JS = /_emscripten_|HEAPU8|wasmBinary|FS_createPath|expectedDataFileDownloads|Module\["asm"\]/;

/** JavaScript below this size is not a compiled engine; reading every small file of every
 *  package would make the check slow for nothing. */
const JS_MIN_BYTES = 200_000;

/** The packages the notices say we actually ship, with their declared licence. Read from
 *  the committed THIRD-PARTY-NOTICES.md because that file IS the bundler's answer to
 *  "what reaches a user" — re-deriving it here would be a second copy to drift.
 *
 *  Which is why the list is parsed by check-npm-notices.mjs and not a second time here: that
 *  guard is what keeps the file honest, and this one consumes its reading of it. Note the
 *  dependency between them — if the notices go stale, THIS check silently inspects the wrong
 *  set of packages, so a newly bundled engine would never be looked at at all (#1101). */
export const shippedPackages = (noticesText) => noticeComponents(noticesText).entries;

/**
 * The compiled artifacts in one package, as human-readable reasons.
 *
 * Pure over `[relativePath, sizeInBytes, readText]` triples so the test can drive it with
 * a fixture instead of a 100 MB node_modules tree; `readText` is called lazily and only
 * for large JavaScript.
 */
export function binaryEvidence(files) {
  const reasons = [];
  for (const [path, size, readText] of files) {
    if (BINARY.test(path)) {
      reasons.push(`${path} is a compiled binary`);
      continue;
    }
    if (/\.(js|cjs|mjs)$/.test(path) && size >= JS_MIN_BYTES && COMPILED_JS.test(readText())) {
      reasons.push(`${path} is JavaScript with a compiled engine inside it`);
    }
  }
  return reasons;
}

/** Every way the shipped set and the review ledger can disagree, as error lines. */
export function driftErrors({ shipped, evidence, ledger }) {
  const recorded = new Map(ledger.map((e) => [e.package, e]));
  const errors = [];

  for (const { name, license } of shipped) {
    const reasons = evidence.get(name) ?? [];
    const entry = recorded.get(name);
    if (reasons.length && !entry) {
      errors.push(
        `  ${name} (declared ${license})\n` +
          `    bundles a compiled artifact that nobody has recorded the licence of:\n` +
          reasons.map((r) => `      ${r}\n`).join('') +
          `    A package's own \`license\` field covers what its author wrote, not what it bundles.\n` +
          `    Open it, find out what is inside, and add an entry to scripts/embedded-binaries.mjs.`,
      );
    }
    if (entry?.copyleft) {
      errors.push(
        `  ${name}\n` +
          `    embeds ${entry.embeds}, which is ${entry.license} — copyleft.\n` +
          `    KimtOS is MIT-licensed, so a copyleft component cannot ship in it.\n` +
          `    Replace it with a permissively licensed component (see #1092 for the last one).`,
      );
    }
  }

  for (const entry of ledger) {
    if (!shipped.some((p) => p.name === entry.package)) {
      errors.push(
        `  ${entry.package}\n    is recorded in scripts/embedded-binaries.mjs but is no longer shipped — remove the stale entry.`,
      );
    }
  }
  return errors;
}

// --- CLI ---------------------------------------------------------------------------

function packageFiles(dir) {
  const files = [];
  const walk = (current, depth) => {
    if (depth > 8) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full, depth + 1);
      } else if (entry.isFile()) {
        const relative = full.slice(dir.length + 1);
        files.push([relative, statSync(full).size, () => readFileSync(full, 'latin1')]);
      }
    }
  };
  walk(dir, 0);
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const notices = join(ROOT, 'THIRD-PARTY-NOTICES.md');
  const shipped = shippedPackages(readFileSync(notices, 'utf8'));
  if (!shipped.length) {
    console.error('check-embedded-licenses: THIRD-PARTY-NOTICES.md lists no shipped packages — regenerate it.');
    process.exit(1);
  }

  const evidence = new Map();
  const missing = [];
  for (const { name } of shipped) {
    const dir = join(ROOT, 'node_modules', name);
    if (!existsSync(dir)) {
      missing.push(name);
      continue;
    }
    evidence.set(name, binaryEvidence(packageFiles(dir)));
  }

  // Never pass by default. A missing install means the check did not look, and a guard
  // that reports success when it could not look is the failure mode every check here
  // exists to stop.
  if (missing.length) {
    console.error(
      `check-embedded-licenses: ${missing.length} shipped package(s) are not installed, so nothing was\n` +
        `inspected: ${missing.join(', ')}.\nRun \`npm ci\` first — this check reads node_modules by design.`,
    );
    process.exit(1);
  }

  const errors = driftErrors({ shipped, evidence, ledger: EMBEDDED });
  if (errors.length) {
    console.error('check-embedded-licenses: a shipped package embeds code whose licence is unaccounted for.\n');
    for (const error of errors) console.error(`${error}\n`);
    process.exit(1);
  }

  const withBinaries = [...evidence.values()].filter((r) => r.length).length;
  console.log(
    `check-embedded-licenses: ${shipped.length} shipped packages inspected, ` +
      `${withBinaries} carry a compiled artifact, all recorded in scripts/embedded-binaries.mjs.`,
  );
}
