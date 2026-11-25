// Fails the build if a committed GENERATED data file no longer matches what its
// generator produces from source.
//
// extension/src/data/ holds three files that are derived, not authored: the release
// notes (from CHANGELOG.md), the per-app release notes (from every apps/*/CHANGELOG.md)
// and the app plan map (from every apps/*/meta.ts). They are committed because the
// extension is a browser bundle and cannot read files at runtime.
//
// Nothing asserted the committed copies still matched their sources, and one drifted on
// main: the v0.5.1 prettier fixup reformatted CHANGELOG.md but never re-ran the compile
// step, so changelog.ts kept the pre-format bodies (#905). Nothing went red — the stale
// file is still valid, prettier-clean TypeScript, and `typecheck` regenerates it into the
// working tree without ever diffing it against what is committed. The Extension workflow
// did assert two of the three inline, but it is path-filtered on `extension/**`, so an
// edit to the ROOT CHANGELOG.md never triggered it at all. That is why this guard lives
// in the Unit tests job, which has no path filters.
//
// It is NOT one of the `conventions` guards, and must not be moved there: that job
// installs nothing on purpose (its checkers only read `git ls-files`), whereas this one
// runs the real generators and needs the full node_modules. `npm run check` (#963)
// executes the conventions job's commands on a plain checkout, so adding this to that
// list would make the local gate fail for everyone.
//
// How it checks: it runs the real generator (the same npm script a developer runs) and
// compares the file before and after, then restores it — so a local run never leaves the
// working tree dirty, and a failure is reported against whatever is on disk. In CI, on a
// clean checkout, "on disk" is "what is committed", which is the assertion we want.
//
// A regenerate-into-a-temp-root would be tidier but is wrong here: every generator
// resolves prettier config and discovers apps relative to the repo root, so a fake root
// produces differently formatted output and the check would fail on files that are fine.
//
//   node scripts/check-generated.mjs

import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');

/**
 * The one command that runs every generator behind TARGETS. Running it once beats three
 * separate `npm run` spawns, each of which pays npm's startup and re-bundles the metas.
 * check-generated.test.mjs asserts it really does invoke every target's `fix`, so a
 * fourth target cannot be added and then silently never regenerated.
 */
export const REGENERATE = 'npm run gen -w @kimtos/extension';

/**
 * Every committed-but-generated data file, with the command that regenerates just it.
 * Adding a fourth is one entry — do not hand-roll a second check.
 *
 * `fix` is what the failure message tells the author to run; REGENERATE above is the
 * aggregate this guard runs.
 */
export const TARGETS = [
  {
    file: 'extension/src/data/changelog.ts',
    source: 'CHANGELOG.md',
    fix: 'npm run gen:changelog -w @kimtos/extension',
  },
  {
    file: 'extension/src/data/appChangelogs.ts',
    source: 'extension/src/apps/*/CHANGELOG.md',
    fix: 'npm run gen:app-changelogs -w @kimtos/extension',
  },
  {
    file: 'extension/src/data/appInstall.ts',
    source: 'extension/src/apps/*/meta.ts',
    fix: 'npm run gen:app-install -w @kimtos/extension',
  },
];

/**
 * The guard's core, with its IO injected so the test can drive it without running the
 * real generators. Returns the targets that are not in sync, each with a `reason`:
 *
 *   'stale'       committed content differs from what the generator produced
 *   'missing'     not committed at all; the generator does produce it
 *   'ungenerated' the generator does NOT produce it — the guard is watching a file
 *                 nothing generates any more, which would otherwise pass silently
 *                 (both before and after are absent, so a plain equality check is
 *                 green). That is the guard rotting into a no-op, so it fails too.
 *
 * `io.read(file)` returns the file's content, or null when it does not exist.
 * `io.restore(file, content)` puts it back — deleting it when `content` is null.
 * `io.regenerate()` runs every generator; it may throw, and every file is restored
 * either way.
 *
 * Exported and covered by check-generated.test.mjs: a guard nobody tests rots into a
 * no-op that passes anything (#213).
 */
export function driftedTargets(targets, io) {
  const before = new Map(targets.map((target) => [target.file, io.read(target.file)]));
  let drifted;
  try {
    io.regenerate();
    drifted = targets.flatMap((target) => {
      const was = before.get(target.file);
      const now = io.read(target.file);
      if (now === null) return [{ ...target, reason: 'ungenerated' }];
      if (was === null) return [{ ...target, reason: 'missing' }];
      return now === was ? [] : [{ ...target, reason: 'stale' }];
    });
  } finally {
    for (const target of targets) io.restore(target.file, before.get(target.file));
  }
  return drifted;
}

/** One line of the failure report, per reason. */
const WHY = {
  stale: (target) => `stale vs ${target.source} — run: ${target.fix}`,
  missing: (target) => `generated but never committed — run: ${target.fix}`,
  ungenerated: (target) => `nothing generates this any more; drop it from TARGETS or fix ${target.fix}`,
};

/** The real IO: read/write the repo tree, regenerate by running the documented command. */
export const repoIo = {
  read(file) {
    const path = join(ROOT, file);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  },
  restore(file, content) {
    const path = join(ROOT, file);
    if (content === null) rmSync(path, { force: true });
    else writeFileSync(path, content);
  },
  regenerate() {
    const result = spawnSync(REGENERATE, { cwd: ROOT, shell: true, stdio: 'pipe', encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(
        `check-generated: \`${REGENERATE}\` failed (exit ${result.status}).\n${result.stderr || result.stdout || ''}`,
      );
    }
  },
};

// Only when run as a CLI — importing this file (the test does) must not process.exit.
function main() {
  let drifted;
  try {
    drifted = driftedTargets(TARGETS, repoIo);
  } catch (err) {
    // A generator that cannot run is its own failure, and a stack trace buries the reason.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (drifted.length) {
    console.error('check-generated: a committed generated file does not match its source.\n');
    for (const target of drifted) {
      console.error(`  ${target.file} — ${WHY[target.reason](target)}`);
    }
    console.error('\nThese files are GENERATED and committed, because the extension is a browser bundle');
    console.error('and cannot read the sources at runtime. Editing a source without re-running its');
    console.error('generator ships a stale copy — wrong release notes, or an app gated on the wrong');
    console.error('tier. Run the command named above and commit the result.');
    process.exit(1);
  }

  console.log(`check-generated: ${TARGETS.length} generated files are in sync with their sources.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
