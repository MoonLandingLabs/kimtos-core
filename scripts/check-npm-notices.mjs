// Fails the build when the npm half of THIRD-PARTY-NOTICES.md has gone stale.
//
//   node scripts/check-npm-notices.mjs             # dependency-free; runs in `conventions`
//   node scripts/check-npm-notices.mjs --bundle    # exact; needs node_modules, runs in `test`
//
// THIRD-PARTY-NOTICES.md has two halves. The on-device MODELS half is reconciled by
// check-model-notices.mjs. This is its npm-side sibling, and it exists because the other half
// had no guard at all: nothing ran scripts/gen-third-party-notices.mjs, and nothing diffed its
// output against the committed file, so the freshness of half a licence-compliance document
// rested on a line in CONTRIBUTING.md (#1101).
//
// It shipped exactly that way, twice, over one package. Voice Studio (#1090) added a runtime
// dependency on `phonemizer` that reached the bundle with NO notice — we distributed Apache-2.0
// code to end users without the attribution the licence requires, and nothing went red. Then
// #1098 removed the package again (it bundled GPL-3.0 eSpeak-NG, #1092) and the notices kept
// claiming we ship it: on main the file still said `13 components` and listed
// `phonemizer 1.2.1`, which was in no lockfile and in no bundle. A notice that is missing and a
// notice that is fictitious are the same defect — the file stopped describing what we ship.
//
// WHY IT DOES NOT JUST RE-RUN THE GENERATOR. It runs in the `conventions` CI job, which
// deliberately installs nothing (`npm ci` is ~600 MB and minutes; every other guard there reads
// committed files as text, and `npm run check` runs the same list on a plain checkout). The
// generator cannot work that way: it asks the BUNDLER which packages contributed code, so it
// needs a full install and a vite build. That exact diff IS worth having, so it is the same
// script's `--bundle` mode, run in the Unit tests job, which does install. The default mode
// below is the fast, dependency-free half that runs on every PR with no path filter and no
// install — and it is the half `npm run check` gives a developer on a plain checkout.
//
// The default mode proves four things from committed files alone:
//   1. Every component the notices list still exists in package-lock.json at exactly that
//      version and that licence. Catches a removed dependency (the live phonemizer case), an
//      upgrade nobody regenerated for, and a package that changed its licence under us.
//   2. Every npm package the shipped extension SOURCE imports has a component entry. Catches a
//      new runtime dependency reaching the bundle unattributed — the original defect.
//   3. The file is internally consistent: the `N components:` count matches the bullets, the
//      list is sorted and duplicate-free, and every bullet has a matching detail section
//      reproducing the same licence. Catches a hand-edit instead of a regeneration.
//   4. Tripwires: a scan that finds nothing fails rather than reporting success.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = 'extension/src';
const NOTICES = 'THIRD-PARTY-NOTICES.md';

/** What the failure messages tell the author to run. One string, so it cannot drift. */
export const REGENERATE = 'node scripts/gen-third-party-notices.mjs';

/** Our own workspace packages. They are compiled from source in this repo, are covered by the
 *  KimtOS licence, and are correctly absent from a THIRD-PARTY notices file. */
const WORKSPACE_SCOPE = '@kimtos/';

/** What gen-third-party-notices.mjs writes when a package's `license` field is not a plain
 *  string. It is not an SPDX id, so it is never comparable to the lockfile's. */
const GENERATOR_LICENSE_FALLBACK = 'see text below';

/** A plausible npm package name, used to reject regex noise (a comma inside a generated data
 *  string matched an early draft of the import scan). Uppercase is allowed even though npm
 *  has required lowercase since 2014: a handful of older packages predate the rule, and in a
 *  LICENCE guard a silent skip is the worst possible failure — the noise this rejects is
 *  punctuation, which uppercase does not reintroduce. */
const PACKAGE_NAME = /^(?:@[A-Za-z0-9-~][A-Za-z0-9-._~]*\/)?[A-Za-z0-9-~][A-Za-z0-9-._~]*$/;

/**
 * The npm components the notices declare: the `N components:` count and the bullet list under
 * it, bounded so the on-device model bullets that follow it cannot leak in.
 *
 * Pure over the file's text so check-npm-notices.test.mjs can drive it with fixtures.
 *
 * @param {string} noticesText the contents of THIRD-PARTY-NOTICES.md
 * @returns {{ declared: number | null, entries: { name: string, version: string, license: string }[] }}
 */
export function noticeComponents(noticesText) {
  const header = /^(\d+) components:$/m.exec(noticesText);
  if (!header) return { declared: null, entries: [] };
  const start = header.index + header[0].length;
  // Bounded by whichever boundary comes first, so a model bullet can never be read as a package.
  const ends = ['\n---', '\n# On-device models'].map((s) => noticesText.indexOf(s, start)).filter((i) => i !== -1);
  const block = noticesText.slice(start, ends.length ? Math.min(...ends) : undefined);
  const entries = [...block.matchAll(/^- (\S+) (\S+) — (.+)$/gm)].map(([, name, version, license]) => ({
    name,
    version,
    license: license.trim(),
  }));
  return { declared: Number(header[1]), entries };
}

/**
 * The per-component detail sections — `## <heading>` followed by `License: **<licence>**` —
 * keyed by heading. The model sections have the same shape but headings that are model names,
 * so they never collide with a `<name> <version>` key.
 *
 * @param {string} noticesText
 * @returns {Map<string, string>} heading to the licence it reproduces
 */
export function noticeDetails(noticesText) {
  return new Map([...noticesText.matchAll(/^## (.+)\n\nLicense: \*\*(.+)\*\*$/gm)].map((m) => [m[1], m[2]]));
}

/**
 * Every package npm has HOISTED to the root node_modules, with its locked version and licence.
 *
 * Hoisted only, deliberately: the generator reads `<root>/node_modules/<name>/package.json` and
 * silently skips a package it does not find there, so a component in the notices is proof the
 * package was hoisted. Falling back to a nested copy would paper over that skip and let a
 * version from a different tree position look correct.
 *
 * @param {string} lockText the contents of package-lock.json
 * @returns {Map<string, { version: string, license: string | null }>}
 */
export function lockedPackages(lockText) {
  const lock = JSON.parse(lockText);
  const packages = new Map();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/') || key.slice('node_modules/'.length).includes('node_modules/')) continue;
    packages.set(key.slice('node_modules/'.length), {
      version: entry.version ?? '',
      // npm writes a string for a plain SPDX id and omits the field for a few packages; only a
      // string is something we can compare, so anything else means "cannot verify", not "wrong".
      license: typeof entry.license === 'string' ? entry.license : null,
    });
  }
  return packages;
}

/**
 * Every npm package the shipped extension source imports, given the source files' contents.
 *
 * Comments are stripped first (a package named in a comment is documentation, not code we
 * bundle) and `import type` / `export type` statements are skipped, because a type-only import
 * is erased at build time and reaches no user. Relative, `node:` and `@kimtos/` specifiers are
 * ours or the platform's. A deep specifier is reduced to its package: `pdfjs-dist/build/pdf`
 * and `highlight.js/styles/github.css?inline` both attribute to their package.
 *
 * Pure over the texts so the test can drive it with fixtures.
 *
 * @param {string[]} texts
 * @returns {Set<string>} package names
 */
export function sourcePackages(texts) {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Four ways a specifier is written: `from '…'`, `import('…')`, `require('…')`, `import '…'`.
  const re =
    /(?:^|[\s;}])(?:import|export)\s+(type\s+)?[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]|(?:^|[\s;}])import\s+['"]([^'"]+)['"]/gm;
  const names = new Set();
  for (const text of texts) {
    for (const m of strip(text).matchAll(re)) {
      if (m[1]) continue; // `import type …` — erased at build time.
      const spec = m[2] ?? m[3] ?? m[4] ?? m[5];
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
      const parts = spec.split('/');
      const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      if (name.startsWith(WORKSPACE_SCOPE) || !PACKAGE_NAME.test(name)) continue;
      names.add(name);
    }
  }
  return names;
}

/**
 * Every way the committed notices, the lockfile and the shipped source can disagree, as
 * human-readable error lines. Empty means the npm half is in sync.
 *
 * @param {{ declared: number | null, entries: { name: string, version: string, license: string }[],
 *           details: Map<string, string>, locked: Map<string, { version: string, license: string | null }>,
 *           imported: Set<string> }} input
 * @returns {string[]}
 */
export function driftErrors({ declared, entries, details, locked, imported }) {
  const errors = [];
  const listed = new Set(entries.map((e) => e.name));

  // 3. Internal consistency — the count, the ordering and the duplicate check all catch the
  //    same thing: someone edited the list by hand instead of regenerating it.
  if (declared === null) {
    errors.push(`  ${NOTICES} has no "N components:" line — the npm half is missing entirely.`);
  } else if (declared !== entries.length) {
    errors.push(`  ${NOTICES} says "${declared} components:" but lists ${entries.length} — regenerate: ${REGENERATE}`);
  }
  const sorted = [...listed].sort();
  if (entries.some((e, i) => e.name !== sorted[i]) || listed.size !== entries.length) {
    errors.push(
      `  the component list is not the generator's output: it must be sorted by name and free of ` +
        `duplicates — regenerate: ${REGENERATE}`,
    );
  }

  for (const { name, version, license } of entries) {
    // 1. Still a real, hoisted, locked dependency at this exact version and licence.
    const lock = locked.get(name);
    if (!lock) {
      errors.push(
        `  ${name} ${version}\n    is listed in ${NOTICES} but is not in package-lock.json — the ` +
          `dependency was removed, so the notice describes something we no longer ship. Regenerate: ${REGENERATE}`,
      );
      continue;
    }
    if (lock.version !== version) {
      errors.push(
        `  ${name} ${version}\n    is locked at ${lock.version} — the notice reproduces the licence of a ` +
          `version we no longer ship. Regenerate: ${REGENERATE}`,
      );
    }
    // `see text below` is the generator's own fallback for a package whose `license` field is not
    // a plain string. Comparing it to the lockfile's would be a red nobody can clear: regenerating
    // reproduces the fallback, so the guard would demand a fix that does not exist.
    if (lock.license && license !== GENERATOR_LICENSE_FALLBACK && lock.license !== license) {
      errors.push(
        `  ${name} ${version}\n    is listed as ${license} but package-lock.json says ${lock.license} — a ` +
          `licence change is exactly what this file must not miss. Regenerate: ${REGENERATE}`,
      );
    }
    // 3 (continued). The bullet and its detail section must agree.
    const detail = details.get(`${name} ${version}`);
    if (detail === undefined) {
      errors.push(
        `  ${name} ${version}\n    has a bullet but no "## ${name} ${version}" section reproducing its ` +
          `licence text — the notice is a list entry with nothing behind it. Regenerate: ${REGENERATE}`,
      );
    } else if (detail !== license) {
      errors.push(
        `  ${name} ${version}\n    is listed as ${license} but its section says ${detail} — the file was ` +
          `hand-edited. Regenerate: ${REGENERATE}`,
      );
    }
  }

  // 2. Every package the shipped source imports is a package we distribute.
  for (const name of [...imported].sort()) {
    if (!listed.has(name)) {
      errors.push(
        `  ${name}\n    is imported by ${SRC} but has no entry in ${NOTICES} — its code reaches every ` +
          `user, and MIT, Apache-2.0 and BSD all require the notice to travel with what we distribute. ` +
          `Regenerate: ${REGENERATE}. If the generator does not add it, the bundler did not see the ` +
          `import reach the output — confirm with \`node scripts/check-npm-notices.mjs --bundle\`, ` +
          `which is the arbiter of what we ship.`,
      );
    }
  }

  return errors;
}

/** The contents of every shipped `.ts`/`.js` file under extension/src. Test files and the DOM
 *  test harness are excluded: a package a test imports is not a package we ship. Same walk as
 *  check-model-notices. Exported so the test can assert against the REAL source tree. */
export function extensionSourceTexts(dir = join(ROOT, SRC), out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'test') extensionSourceTexts(p, out);
    } else if (/\.(ts|js)$/.test(p) && !/\.test\.(ts|js)$/.test(p)) {
      out.push(readFileSync(p, 'utf8'));
    }
  }
  return out;
}

/**
 * How two versions of the notices differ, as component lines. Used to report the exact-mode
 * failure in the terms the author cares about — which package gained or lost a notice —
 * rather than dumping a 100 KB diff of licence texts.
 *
 * @param {string} beforeText the committed notices
 * @param {string} afterText what the generator produced
 * @returns {{ added: string[], removed: string[] }} each `name version — licence`
 */
export function componentDiff(beforeText, afterText) {
  const line = (e) => `${e.name} ${e.version} — ${e.license}`;
  const before = new Set(noticeComponents(beforeText).entries.map(line));
  const after = new Set(noticeComponents(afterText).entries.map(line));
  return {
    added: [...after].filter((l) => !before.has(l)).sort(),
    removed: [...before].filter((l) => !after.has(l)).sort(),
  };
}

/**
 * The exact check: run the real generator and require it to reproduce the committed file
 * byte for byte. This is what covers the two things the dependency-free half provably cannot
 * see, and the reason both halves exist rather than one:
 *
 *   - A package that reaches the bundle TRANSITIVELY. Four of the twelve components
 *     (@huggingface/jinja, @huggingface/tokenizers, onnxruntime-common, regenerator-runtime)
 *     are pulled in by a dependency and imported nowhere in our source.
 *   - A package imported by a SHARED MODULE the extension bundles rather than by
 *     extension/src. None do today, but widening the source scan to shared-modules/* would be
 *     wrong: not all of them are bundled into the extension (a removed widget's socket.io-client
 *     is not), and a hand-maintained list of which ones are is the same drift this guard exists
 *     to stop. Asking the bundler is the answer to "which of them are bundled".
 *
 * It needs a full install and a vite build, so it runs in the Unit tests job rather than
 * `conventions`, exactly as check-generated.mjs and check-embedded-licenses.mjs do. The
 * generator is deterministic on a fixed install (three consecutive runs produced identical
 * output) and costs about five seconds, so the exactness is close to free in a job that has
 * already installed.
 *
 * Like check-generated, it restores the file afterwards: a local run must not leave the
 * working tree dirty, and in CI "what is on disk" is "what is committed", which is the
 * assertion we want.
 */
function checkAgainstBundle() {
  const path = join(ROOT, NOTICES);
  const before = readFileSync(path, 'utf8');
  let after;
  let failure;
  // Nothing exits inside this try: process.exit() terminates synchronously and would skip the
  // `finally`, leaving the generator's output in the working tree on the one path where the
  // guard is already unhappy. Report after the file is back.
  try {
    execFileSync('node', [join(HERE, 'gen-third-party-notices.mjs')], { cwd: ROOT, stdio: 'pipe' });
    after = readFileSync(path, 'utf8');
  } catch (err) {
    failure = err;
  } finally {
    writeFileSync(path, before);
  }

  if (failure) {
    // A generator that cannot run is its own failure; passing here would be a silent skip.
    console.error(
      `check-npm-notices: \`${REGENERATE}\` failed, so the notices could not be verified against the ` +
        `bundle. It needs a full install (npm ci) and the shared modules built (make shared).\n` +
        (failure.stderr?.toString() || failure.message),
    );
    process.exit(1);
  }

  if (after !== before) {
    const { added, removed } = componentDiff(before, after);
    console.error(`check-npm-notices: ${NOTICES} is not what the generator produces from the shipped bundle.\n`);
    for (const l of added) console.error(`  + ${l}\n    reaches the bundle but has no notice.`);
    for (const l of removed) console.error(`  - ${l}\n    is in the notices but no longer reaches the bundle.`);
    if (!added.length && !removed.length) {
      console.error(`  the component list is unchanged, so a licence text or version detail differs.`);
    }
    console.error(`\nRegenerate it with \`${REGENERATE}\` and commit the result.`);
    process.exit(1);
  }

  console.log(`check-npm-notices: ${NOTICES} matches the generator's output for the shipped bundle.`);
}

// Only when run as a CLI — importing this file (the test does) must not process.exit.
function main() {
  // `--bundle` is the exact half, and needs node_modules. Without it this reads committed
  // files only, which is what lets it run in the no-install `conventions` job.
  if (process.argv.includes('--bundle')) return checkAgainstBundle();

  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const noticesText = read(NOTICES);
  const { declared, entries } = noticeComponents(noticesText);
  const imported = sourcePackages(extensionSourceTexts());

  // Tripwires. Both scans are regexes over text, so a change in how the notices are formatted
  // or how imports are written could make one match nothing — and a check that finds nothing
  // reports success while asserting nothing, which is the guard rotting into a no-op (#213).
  // The extension always ships several npm packages, so an empty result means the scan broke.
  if (entries.length === 0) {
    console.error(
      `check-npm-notices: found no components in ${NOTICES}. Either the npm half is gone or the ` +
        `parser no longer matches the generator's format. Fix it — do not ignore it.`,
    );
    process.exit(1);
  }
  if (imported.size === 0) {
    console.error(
      `check-npm-notices: found no npm imports in ${SRC}. The source scan has gone blind, so a new ` +
        `bundled dependency would ship unattributed (#1101). Fix the scan.`,
    );
    process.exit(1);
  }

  const errors = driftErrors({
    declared,
    entries,
    details: noticeDetails(noticesText),
    locked: lockedPackages(read('package-lock.json')),
    imported,
  });

  if (errors.length) {
    console.error(`check-npm-notices: ${NOTICES} does not describe the packages we ship.\n`);
    console.error(errors.join('\n'));
    console.error(
      `\nThis file is how KimtOS discharges the attribution duties of its dependencies. Going ` +
        `being open source does not remove them: MIT, Apache-2.0 and BSD all require the copyright and ` +
        `licence notice to be preserved in distributed copies. Regenerate it with \`${REGENERATE}\` ` +
        `and commit the result.`,
    );
    process.exit(1);
  }

  console.log(
    `check-npm-notices: ${entries.length} components, all locked at the stated version and licence; ` +
      `${imported.size} npm packages imported by ${SRC}, all attributed.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
