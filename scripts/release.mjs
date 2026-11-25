// The release CLI. All the logic lives in @kimtos/releaser, which has tests; this file is
// only the argument parsing, so the Makefile stays a one-liner.
//
//   node scripts/release.mjs notes                     # preview the pending notes
//   node scripts/release.mjs prepare 0.6.0             # write the notes and commit, on a branch
//   node scripts/release.mjs prepare 0.6.0 --dry-run   # show what it would do, change nothing
//   node scripts/release.mjs tag 0.6.0                 # tag and push the tag, from main
//   node scripts/release.mjs report                    # what the pending range actually touched
//   node scripts/release.mjs compile                   # CHANGELOG.md -> extension/src/data/changelog.ts
//
// `prepare` and `tag` are two commands on purpose, and each refuses to run where the other
// belongs — prepare errors on main, tag errors anywhere else (#1208).
//
// `compile` is what the extension's `prebuild` calls (see extension/package.json's
// `gen:changelog`), so the bundled notes are regenerated on every build.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateNotes,
  previousTag,
  diffReport,
  prepareRelease,
  tagRelease,
  compile,
  units,
  unitVersion,
  hasChangelog,
  proposeBumps,
  lockfileDrift,
} from '@kimtos/releaser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [command, version] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');

try {
  if (command === 'notes') {
    process.stdout.write(generateNotes(previousTag(ROOT), 'HEAD', ROOT));
  } else if (command === 'report') {
    const prev = previousTag(ROOT);
    const r = diffReport(prev, 'HEAD', ROOT);
    process.stdout.write(
      `Pending release (${r.from || 'the beginning'}..${r.to})\n` +
        `  ${r.prs.length} PRs, ${r.commits} commits, ${r.files.length} files\n` +
        `  workspaces: ${r.workspaces.join(', ') || 'none'}\n` +
        `  apps:       ${r.apps.join(', ') || 'none'}\n`,
    );
    // The versions this release would set. `make release-prepare` proposes exactly these and asks.
    const bumps = proposeBumps(prev, 'HEAD', ROOT);
    if (bumps.length) {
      process.stdout.write(`\nVersions this release would set:\n`);
      for (const b of bumps) {
        process.stdout.write(
          `  ${b.unit.kind.padEnd(11)}${b.unit.id.padEnd(18)}${b.from || '—'} -> ${b.to}  (${b.changes.length} PRs)\n`,
        );
      }
    }
  } else if (command === 'check') {
    // The assert that keeps this honest. Without it, a new app ships with no changelog,
    // its version silently becomes '', and we are back to a number nobody maintains —
    // which is exactly how all 19 apps sat at 1.0.0 for months while users read it.
    const all = units(ROOT);
    const missing = all.filter((u) => !hasChangelog(u.dir));
    const drifted = all
      .filter((u) => u.kind === 'deployable')
      .map((u) => {
        const pkg = join(u.dir, 'package.json');
        const declared = JSON.parse(readFileSync(pkg, 'utf8')).version;
        return { id: u.id, declared, actual: unitVersion(u.dir) };
      })
      .filter((u) => u.declared !== u.actual);

    if (missing.length) {
      process.stderr.write(
        `No CHANGELOG.md: ${missing.map((m) => `${m.kind} "${m.id}"`).join(', ')}\n` +
          `Every app and deployable must have one — its newest entry IS its version.\n`,
      );
      process.exit(1);
    }
    if (drifted.length) {
      process.stderr.write(
        drifted.map((d) => `${d.id}: package.json says ${d.declared}, CHANGELOG.md says ${d.actual}`).join('\n') +
          `\nRun \`node scripts/release.mjs sync\`. The changelog is the source of truth.\n`,
      );
      process.exit(1);
    }
    // …and the LOCKFILE agrees. It records every workspace's version too, so a bump that
    // misses it turns main red for everyone the moment it lands (#1203). `lockfileDrift`
    // owns the rule and has the tests; this file is only the argument parsing.
    const unlocked = lockfileDrift(ROOT);
    if (unlocked.length) {
      process.stderr.write(
        unlocked
          .map((w) => `${w.id}: package.json says ${w.pkg}, package-lock.json says ${w.lock || 'nothing'}`)
          .join('\n') + `\nRun \`npm install --package-lock-only\` and commit the result.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${all.length} units, all with a changelog, a matching version and a lockfile in step.\n`);
  } else if (command === 'sync') {
    // package.json's version is DERIVED from the changelog. It exists only because tooling
    // reads it; the changelog is what a human writes.
    for (const u of units(ROOT).filter((x) => x.kind === 'deployable')) {
      const pkgPath = join(u.dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const v = unitVersion(u.dir);
      if (v && pkg.version !== v) {
        pkg.version = v;
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        process.stdout.write(`${u.id}: package.json -> ${v}\n`);
      }
    }
  } else if (command === 'compile') {
    const count = await compile(ROOT);
    process.stdout.write(`extension/src/data/changelog.ts: ${count} release${count === 1 ? '' : 's'}\n`);
  } else if (command === 'prepare') {
    await prepareRelease(version, { root: ROOT, dryRun });
    process.exit(0); // the confirm prompt leaves stdin open
  } else if (command === 'tag') {
    await tagRelease(version, { root: ROOT, dryRun });
    process.exit(0); // ditto
  } else if (command === 'cut') {
    // `cut` was the one-shot release: notes, commit, push main, tag, push tag. It is split in
    // two (#1208). Answering with the replacement rather than the usage line, because someone
    // typing this has the old flow in their fingers and needs the new order, not a menu.
    process.stderr.write(
      `\`cut\` is gone — it pushed main without review and tagged in one step (#1208).\n` +
        `  make release-prepare VERSION=x.y.z   write the notes, commit on a branch, open a PR\n` +
        `  make release-tag VERSION=x.y.z       tag it once that PR is merged\n`,
    );
    process.exit(1);
  } else {
    process.stderr.write(
      'usage: release.mjs notes | report | check | sync | compile | prepare <version> [--dry-run] | tag <version> [--dry-run]\n',
    );
    process.exit(1);
  }
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
