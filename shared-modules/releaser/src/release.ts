// The release orchestration that used to be a shell heredoc in the Makefile.
//
// It was ~20 lines of `make` + `sh`: `$$` escaping, `\`-continuations, `mktemp`, a `read`
// prompt, then tag and push. Unreadable and untestable — and this flow was rebuilt three
// times in a week, each time by editing shell inside a Makefile.
//
// The GUARDS are the important part and they are preserved exactly: refuse a dirty tree,
// refuse an existing tag, and refuse a version that does not match the manifest. Each of
// those exists because releasing past it produces a broken artifact that is already tagged
// and pushed — the expensive kind of mistake.
//
// IT IS TWO COMMANDS, NOT ONE (#1208). `prepareRelease` writes the notes and commits them;
// `tagRelease` tags and pushes the tag. Nothing here pushes a branch any more.
//
// It used to be one function that wrote the changelogs, committed, pushed `main`, tagged and
// pushed the tag — five irreversible steps welded together. Two things were wrong with that.
// The push was the only place in the project where content reached `main` without a PR, which
// every other rule in the repo forbids. And because writing the notes and cutting the tag were
// one step, a bad changelog was discovered on a tag that already existed, against a Chrome Web
// Store version history that only ever goes forwards.
//
// So each half REFUSES to run where the other belongs: prepare errors on `main`, tag errors
// anywhere else. That is deliberate and it is the whole point — "the release commit goes
// through review" has to be something the tool will not let you skip, not a line in a doc that
// nobody can follow. #1201 is what a documented-but-unenforceable order costs.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addRelease, compile, compileAppChangelogs, formatFiles } from './changelog.js';
import { generateNotes, clean } from './notes.js';
import { proposeBumps } from './bump.js';
import { releaseUnit } from './units.js';

export interface ReleaseOptions {
  /** Repo root. */
  root?: string;
  /** Print what would happen, change nothing. */
  dryRun?: boolean;
  /** Skip the interactive confirm (CI, or a caller that has already confirmed). */
  yes?: boolean;
}

// Run git with an argument array — no shell, so a version/tag string can't be interpreted as
// a command (js/shell-command-constructed-from-input).
const git = (args: string[], cwd: string): string => execFileSync('git', args, { encoding: 'utf8', cwd }).trim();

/**
 * Re-resolve the root lockfile against the package.json files this release just bumped.
 *
 * The lockfile records every workspace's version too, so bumping a deployable's package.json
 * without this leaves the two disagreeing — and `.github/workflows/make.yml` asserts they
 * agree, so the release commit turns main red for everyone the moment it lands (#1203).
 * Because the release is tagged and pushed in the same breath, the TAGGED tree is the broken
 * one and only a commit on top of the tag can fix it.
 *
 * The flags are the CI guard's, byte for byte, so this produces exactly what that guard
 * demands rather than something merely similar. It is cheap: re-resolving a workspace version
 * bump reads the existing lockfile and rewrites one line per bumped workspace.
 *
 * Skipped when there is no lockfile, which is every repo that does not have one and every
 * fixture in the tests.
 *
 * A failure here THROWS, and that is the right way round: this runs after the changelogs and
 * package.json files are written but before the commit, so aborting leaves a dirty tree a
 * human can inspect and re-run, while continuing would commit and TAG the stale lockfile this
 * function exists to prevent. But npm's own message is the only thing that says why, so it is
 * captured and re-thrown — swallowing it leaves a bare "Command failed" at the point in the
 * flow where a maintainer most needs to know what happened.
 */
function refreshLockfile(root: string): string {
  if (!existsSync(join(root, 'package-lock.json'))) return 'skipped (no lockfile)';
  try {
    execFileSync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    // `stderr` is a string here because of `encoding: 'utf8'`, and carries npm's actual
    // diagnosis; `message` alone is the bare "Command failed". It is undefined when the spawn
    // itself failed rather than npm running and erroring, hence the fallback.
    const why = String((err as { stderr?: string }).stderr || (err as Error).message || err).trim();
    throw new Error(
      `npm install --package-lock-only failed, so package-lock.json would have been stale.\n${why}\n` +
        // Be exact about the state: saying "re-run the release" would be wrong, because
        // preflight refuses a dirty tree and this release's writes are sitting in one.
        `Nothing was committed, pushed or tagged, but this release's writes — the changelogs, the\n` +
        `deployables' package.json and the generated version data — are still in the working tree.\n` +
        `Fix the cause, discard them (git checkout -- .), then re-run the release.`,
    );
  }
  return 'refreshed';
}

/** The newest `v*` tag, or '' when there is none (the first release). */
export function previousTag(cwd = process.cwd()): string {
  const tags = git(['tag', '-l', 'v*', '--sort=-v:refname'], cwd);
  return tags.split('\n')[0] || '';
}

/** The branch a release is tagged from, and the one `prepareRelease` refuses to write on. */
export const RELEASE_BRANCH = 'main';

/** The branch checked out right now. `HEAD` when detached, which matches neither guard below. */
const currentBranch = (root: string): string => git(['rev-parse', '--abbrev-ref', 'HEAD'], root);

/**
 * `git tag -l` matches a glob, and `-l 'v1.0.2'` has no glob characters — so this is an exact
 * lookup. Kept as a helper because both halves ask the same question of it.
 */
const tagExists = (version: string, root: string): boolean => Boolean(git(['tag', '-l', `v${version}`], root));

/**
 * Everything the release must be true before it starts. Throws with the same messages the
 * Makefile printed, because they are good messages and people know them.
 *
 * `command` only names the right command in the "VERSION required" message — the two halves
 * share these guards but are invoked differently, and a message telling you to run the other
 * one is how you end up on `main` again.
 */
export function preflight(version: string, root: string, command = 'release-prepare'): void {
  if (!version) throw new Error(`VERSION required, e.g. make ${command} VERSION=0.6.0`);

  if (tagExists(version, root)) throw new Error(`tag v${version} already exists`);

  if (git(['status', '--porcelain'], root)) {
    throw new Error('working tree is dirty — commit or stash first');
  }

  const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8')) as {
    version: string;
  };
  if (manifest.version !== version) {
    throw new Error(`extension/manifest.json is not ${version} — bump manifest.json and package.json first`);
  }
}

/**
 * STEP ONE of two: generate the notes from the PRs merged since the last tag, write them into
 * every changelog, regenerate the data derived from them, and commit — on a branch.
 *
 * It does not push and it does not tag. The commit reaches `main` through a pull request, the
 * same way every other change in this repo does, which is the point of the split (#1208).
 *
 * Running this on `main` is refused rather than warned about. A warning would leave the old
 * behaviour one keypress away, and the old behaviour is what put an unreviewed commit on the
 * deploy branch.
 */
export async function prepareRelease(version: string, opts: ReleaseOptions = {}): Promise<void> {
  const root = opts.root ?? process.cwd();
  const v = version.replace(/^v/, '');

  // Before preflight, because "you are on main" is the structural problem and the one the user
  // has to fix first — telling them about a dirty tree, sending them to clean it, and only then
  // telling them to branch is two round trips for one mistake.
  if (!v) throw new Error('VERSION required, e.g. make release-prepare VERSION=0.6.0');
  const branch = currentBranch(root);
  if (branch === RELEASE_BRANCH) {
    throw new Error(
      `refusing to prepare a release on ${RELEASE_BRANCH} — the release notes are a reviewed change like any other.\n` +
        `  git checkout -b ${RELEASE_BRANCH}_chore_release_${v}\n` +
        `then re-run. This commit reaches ${RELEASE_BRANCH} through a pull request; \`make release-tag\` does the tagging afterwards.`,
    );
  }

  // Enforced on a dry run too. A rehearsal that passes where the real thing would fail is not a
  // rehearsal — that is exactly the trap #1201 recorded, one step further along.
  preflight(v, root, 'release-prepare');

  // Refuse a version the changelog already covers, HERE — before a single file is written.
  //
  // `addRelease` has always thrown on a duplicate section, but it runs after the loop that bumps
  // every touched unit's changelog and package.json, so the throw left a dirty tree with partial
  // writes and nothing committed. That was reachable by accident and is now reachable by
  // instruction: `tagRelease` tells you to re-run this command when `main` has moved on, and for
  // an already-committed version that advice used to walk straight into the half-written state.
  if (hasChangelogSection(v, root)) {
    throw new Error(
      `CHANGELOG.md already has a v${v} section, so there is nothing to prepare.\n` +
        `If v${v} is not tagged yet and you need the notes to cover newer PRs, drop that section and\n` +
        `re-run; otherwise prepare the next version instead. Nothing has been written.`,
    );
  }

  const prev = previousTag(root);
  const notes = generateNotes(prev, 'HEAD', root);

  process.stdout.write(
    `=== v${v} notes (from the PRs merged since ${prev || 'the beginning'}) ===\n` +
      `${notes}` +
      `===============================\n`,
  );

  // Each app and deployable this release touched, and what its version should become.
  // This is the whole point of #132: nobody has to remember to bump anything, because
  // remembering is the mechanism that left all 19 apps at 1.0.0 while users read that
  // number in the App Store and in every bug report.
  const bumps = proposeBumps(prev, 'HEAD', root);
  if (bumps.length) {
    process.stdout.write(`=== ${bumps.length} units to bump ===\n`);
    for (const b of bumps) {
      process.stdout.write(
        `  ${b.unit.kind.padEnd(11)}${b.unit.id.padEnd(18)}${b.from || '—'} -> ${b.to}  (${b.changes.length} PRs)\n`,
      );
    }
    process.stdout.write('===============================\n');
  }

  if (opts.dryRun) {
    process.stdout.write('Dry run — nothing written, nothing committed.\n');
    return;
  }

  if (!opts.yes && !(await confirm(`Write the notes for v${v} and commit them to ${branch}?`))) {
    throw new Error('aborted');
  }

  // Write each unit's own changelog entry, from the PRs actually attributed to it, and
  // keep the deployables' package.json in step — the changelog is the source of truth, so
  // package.json is derived from it, never the other way round.
  for (const b of bumps) {
    releaseUnit({ dir: b.unit.dir, version: b.to, notes: b.changes.map((c) => `- ${clean(c)}`).join('\n') });
    if (b.unit.kind === 'deployable') {
      const pkgPath = join(b.unit.dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      pkg.version = b.to;
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  }
  if (bumps.length) process.stdout.write(`Bumped ${bumps.length} units.\n`);

  addRelease(v, notes, root);

  // FINALIZE every file this release wrote, before committing, so the tagged commit is
  // self-consistent and already passes `prettier --check .` — no manual fixup after the tag
  // (#889). Two things drifted before: CHANGELOG.md (and the per-unit ones) are assembled by
  // string concatenation and failed the repo-wide Formatting gate, and appChangelogs.ts —
  // the per-app version data the extension imports — was never regenerated, so the tag
  // declared app versions its own committed data did not match. Format the human Markdown
  // FIRST, so the .ts files below are derived from the already-formatted sources.
  await formatFiles([
    join(root, 'CHANGELOG.md'),
    ...bumps.map((b) => join(b.unit.dir, 'CHANGELOG.md')),
    ...bumps.filter((b) => b.unit.kind === 'deployable').map((b) => join(b.unit.dir, 'package.json')),
  ]);
  const count = await compile(root);
  const appCount = await compileAppChangelogs(root);
  const lock = refreshLockfile(root);
  process.stdout.write(
    `CHANGELOG.md: added v${v}\n` +
      `extension/src/data/changelog.ts: ${count} releases\n` +
      `extension/src/data/appChangelogs.ts: ${appCount} apps\n` +
      `package-lock.json: ${lock}\n`,
  );

  // `git add -A` rather than a fixed list: the units' changelogs and package.json files are
  // part of this release too, and a hand-maintained list of paths is the very thing this
  // change exists to delete.
  git(['add', '-A'], root);
  git(['commit', '-m', `chore(release): v${v}`], root);

  process.stdout.write(
    `Prepared v${v} on ${branch}. Nothing is tagged and nothing is pushed.\n` +
      `Next:\n` +
      `  git push -u origin ${branch}\n` +
      `  open a PR, get it reviewed, merge it\n` +
      `  git checkout ${RELEASE_BRANCH} && git pull\n` +
      `  make release-tag VERSION=${v}\n`,
  );
}

/**
 * STEP TWO of two: tag the prepared commit and push the tag. That push is what builds the
 * extension and submits it to the Chrome Web Store, so it is the most irreversible thing in
 * the repo — the store will never accept this version number again.
 *
 * It touches nothing else. No writes, no commit, no branch push: by the time this runs, the
 * release commit is already on `main` because a human merged it.
 */
export async function tagRelease(version: string, opts: ReleaseOptions = {}): Promise<void> {
  const root = opts.root ?? process.cwd();
  const v = version.replace(/^v/, '');

  // Branch first, for the same reason `prepareRelease` checks it first: being on the wrong
  // branch is the structural mistake, and reporting a dirty tree ahead of it sends the user to
  // clean something up before telling them the real problem. The two halves check in the same
  // order on purpose — a guard order that disagrees with its sibling is how one of them ends up
  // with the worse message.
  if (!v) throw new Error('VERSION required, e.g. make release-tag VERSION=0.6.0');
  const branch = currentBranch(root);
  if (branch !== RELEASE_BRANCH) {
    throw new Error(
      `refusing to tag from ${branch} — a release is tagged from ${RELEASE_BRANCH}, after the prepare PR is merged.\n` +
        `  git checkout ${RELEASE_BRANCH} && git pull`,
    );
  }

  preflight(v, root, 'release-tag');

  // The guard that makes the split safe. `make release` used to write this section and tag in
  // one breath, so it could not be missing; now a human merges the PR in between and can simply
  // not have. Without this, the tag ships "No releases yet." to every user (#416) and the CI
  // guard in release.yml only catches it after the tag exists — which is far too late, because
  // the Chrome Web Store version history is one-way.
  requireChangelogSection(v, root);

  // THE TAG MUST BE THE PREPARED COMMIT, not merely a commit that happens to satisfy the checks
  // above.
  //
  // The old one-shot release generated the notes and tagged in a single execution, so the tagged
  // commit was necessarily the one the notes described. Splitting it opens a window — the PR
  // review — during which anything else can merge, and several agents merge into this repo at
  // once. Tag after that and the store gets a build containing changes no changelog mentions,
  // permanently, because the version history is one-way.
  //
  // So: the TREE at HEAD must be the tree the notes were written against — found via the last
  // commit to touch CHANGELOG.md, which is the one that landed the prepare PR.
  //
  // Trees, not commit shas. A sha comparison looked equivalent and was not: `git log -- <path>`
  // applies history simplification, so when the prepare PR lands as a MERGE commit it returns the
  // commit on the branch, while HEAD is the merge — different shas, identical content, and the
  // guard would have refused a perfectly good release. Comparing trees is also the honest
  // statement of what matters: not which commit is tagged, but whether the bytes being shipped
  // are the ones the changelog describes. Squash, fast-forward and merge all pass; an unrelated
  // PR landing afterwards does not, and the answer there is to re-run `release-prepare`.
  const notesCommit = git(['log', '-1', '--format=%H', '--', 'CHANGELOG.md'], root);
  const head = revParse('HEAD', root);
  if (notesCommit && treeOf(notesCommit, root) !== treeOf(head, root)) {
    throw new Error(
      `${RELEASE_BRANCH} has moved on since the v${v} notes were written, so the tag would ship changes the changelog does not mention.\n` +
        `  the notes landed in ${notesCommit.slice(0, 8)}, and HEAD is ${head.slice(0, 8)} with a different tree\n` +
        `Re-run \`make release-prepare VERSION=${v}\` on a branch so the notes cover what actually ships.`,
    );
  }

  // Local `main` must match the last-known `origin/${RELEASE_BRANCH}`. The old flow pushed the
  // branch immediately before tagging, so this held by construction; the split removes that push,
  // and tagging a local commit nobody has publishes a tag pointing into thin air.
  //
  // It reads the remote-TRACKING ref and does not fetch, so it is only as fresh as the last
  // `git pull` — deliberately, because a network call here would make the guard untestable and
  // fail closed on an offline machine. The documented order pulls immediately before tagging,
  // which is what keeps it honest. Skipped entirely when there is no such ref (a clone with no
  // `origin`, and every test fixture that does not ask for one).
  const remoteHead = revParse(`origin/${RELEASE_BRANCH}`, root);
  if (remoteHead && remoteHead !== head) {
    throw new Error(
      `${RELEASE_BRANCH} is not in step with origin/${RELEASE_BRANCH} — the tag would point at a commit nobody else has.\n` +
        `  git pull --ff-only`,
    );
  }

  if (opts.dryRun) {
    process.stdout.write(`Dry run — v${v} would be tagged at ${head.slice(0, 8)} and pushed.\n`);
    return;
  }

  if (!opts.yes && !(await confirm(`Tag v${v} and submit it to the Chrome Web Store?`))) {
    throw new Error('aborted');
  }

  git(['tag', '-a', `v${v}`, '-m', `v${v}`], root);
  git(['push', 'origin', `v${v}`], root);

  process.stdout.write(`Released v${v}. The tag builds the extension and submits it to the Chrome Web Store.\n`);
}

/** The tree a commit points at — the content, independent of how that commit came to be. */
const treeOf = (rev: string, root: string): string => git(['rev-parse', `${rev}^{tree}`], root);

/** A rev, or '' when it does not resolve — a missing remote-tracking ref is not an error here. */
function revParse(rev: string, root: string): string {
  try {
    return git(['rev-parse', '--verify', '--quiet', rev], root);
  } catch {
    return '';
  }
}

/**
 * Does CHANGELOG.md carry a section for this version?
 *
 * ONE definition, because the two halves ask the opposite question of it — prepare refuses when
 * it is true, tag refuses when it is false — and two regexes that drifted apart would let a
 * version be neither preparable nor taggable. The pattern is also the one
 * `.github/workflows/release.yml` greps for, deliberately: a local guard and a CI guard that
 * disagree about what counts as "has notes" is worse than one, because the local one would pass
 * and the CI one would fail after the tag was already pushed.
 */
function hasChangelogSection(version: string, root: string): boolean {
  const path = join(root, 'CHANGELOG.md');
  const body = existsSync(path) ? readFileSync(path, 'utf8') : '';
  return new RegExp(`^## v${version.replace(/\./g, '\\.')}\\b`, 'm').test(body);
}

/** Refuse a version CHANGELOG.md has no section for. */
function requireChangelogSection(version: string, root: string): void {
  if (!hasChangelogSection(version, root)) {
    throw new Error(
      `CHANGELOG.md has no section for v${version} — run \`make release-prepare VERSION=${version}\` and merge that PR first.\n` +
        `The in-app Release notes dialog is compiled from this file at build time, so tagging without it\n` +
        `ships "No releases yet." to every user (#416).`,
    );
  }
}

/**
 * The old one-shot release. It pushed `main` without review and tagged in the same breath;
 * both halves now exist separately and each refuses to do the other's job (#1208).
 *
 * Kept as a throw rather than deleted because it is exported API of this package, and someone
 * running it from muscle memory deserves the two commands rather than "not a function".
 */
export function release(): never {
  throw new Error(
    'release() is gone — it pushed main without review and tagged in one step (#1208).\n' +
      '  make release-prepare VERSION=x.y.z   write the notes, commit on a branch, open a PR\n' +
      '  make release-tag VERSION=x.y.z       tag it once that PR is merged',
  );
}

/** [y/N] on stdin — the same prompt the Makefile had. */
async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `);
  const answer = await new Promise<string>((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => resolve(String(d).trim()));
  });
  return answer === 'y' || answer === 'Y';
}
