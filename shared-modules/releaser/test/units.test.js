// The releasable units — apps and deployables — and the bump proposal.
//
// The old mechanism was "remember to bump the version in meta.ts". It failed 19 times out
// of 19, for months, while the App Store showed users a number that was never true. These
// tests are what make the replacement trustworthy.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lockfileDrift,
  units,
  unitVersion,
  unitFirstReleased,
  readUnitChangelog,
  releaseUnit,
  hasChangelog,
  proposeBump,
} from '../dist/index.js';
import { proposeBumps } from '../dist/bump.js';
import { prepareRelease } from '../dist/release.js';
import { newRepo } from './fixture.js';

/** A repo-shaped temp dir: a couple of apps, a couple of deployables. */
function scaffold() {
  const root = mkdtempSync(join(tmpdir(), 'units-'));
  for (const app of ['notaboard', 'notes']) {
    mkdirSync(join(root, 'extension', 'src', 'apps', app), { recursive: true });
  }
  for (const d of ['www', 'www-docs']) mkdirSync(join(root, d), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('units', () => {
  test('discovers the apps and the deployables — and NOT the shared modules', () => {
    const { root, cleanup } = scaffold();
    try {
      const all = units(root);
      const apps = all.filter((u) => u.kind === 'app').map((u) => u.id);
      const deps = all.filter((u) => u.kind === 'deployable').map((u) => u.id);

      assert.deepEqual(apps, ['notaboard', 'notes']);
      assert.deepEqual(deps, ['www', 'www-docs']);

      // The extension is NOT a unit: it already has a version (manifest.json) and a
      // changelog (the root CHANGELOG.md). A third source would be the contradiction this
      // whole change exists to remove.
      assert.ok(!all.some((u) => u.id === 'extension'));
      // Shared packages are not units either: private, workspace-linked by "*", so a
      // version bump has no mechanical effect at all.
      assert.ok(!all.some((u) => u.id === 'config' || u.id === 'icons'));
    } finally {
      cleanup();
    }
  });
});

describe('the changelog owns the version', () => {
  test('the version IS the newest entry — there is nowhere else it is declared', () => {
    const { root, cleanup } = scaffold();
    try {
      const dir = join(root, 'extension', 'src', 'apps', 'notaboard');
      writeFileSync(
        join(dir, 'CHANGELOG.md'),
        '# Changelog\n\n## 1.2.0 — 2026-07-12\n\n- Canvas panning\n\n## 1.0.0 — 2026-05-01\n\n- Initial release.\n',
      );
      assert.equal(unitVersion(dir), '1.2.0');
      assert.equal(readUnitChangelog(dir).length, 2);
    } finally {
      cleanup();
    }
  });

  test('the first-release date IS the oldest entry — the mirror of the version', () => {
    const { root, cleanup } = scaffold();
    try {
      const dir = join(root, 'extension', 'src', 'apps', 'notaboard');
      writeFileSync(
        join(dir, 'CHANGELOG.md'),
        '# Changelog\n\n## 1.2.0 — 2026-07-12\n\n- Canvas panning\n\n## 1.0.0 — 2026-05-01\n\n- Initial release.\n',
      );
      // unitVersion reads the newest entry; unitFirstReleased the oldest. The "New" badge
      // counts 30 days from THIS date, so it must be the first ship, not the latest patch.
      assert.equal(unitFirstReleased(dir), '2026-05-01');
      assert.equal(unitVersion(dir), '1.2.0');
    } finally {
      cleanup();
    }
  });

  test('a single-release app is first-released on that one date', () => {
    const { root, cleanup } = scaffold();
    try {
      const dir = join(root, 'extension', 'src', 'apps', 'notes');
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 — 2026-07-23\n\n- Initial release.\n');
      assert.equal(unitFirstReleased(dir), '2026-07-23');
    } finally {
      cleanup();
    }
  });

  test('no changelog means no first-release date — empty, which reads as "not new"', () => {
    const { root, cleanup } = scaffold();
    try {
      const dir = join(root, 'extension', 'src', 'apps', 'notes');
      assert.equal(unitFirstReleased(dir), '');
    } finally {
      cleanup();
    }
  });

  test('no changelog means no version — NOT a silent 1.0.0', () => {
    const { root, cleanup } = scaffold();
    try {
      const dir = join(root, 'extension', 'src', 'apps', 'notes');
      // A silent fallback is exactly the bug being replaced: every app claimed 1.0.0
      // forever and the App Store showed it. Absence must be visible, so CI can fail.
      assert.equal(hasChangelog(dir), false);
      assert.equal(unitVersion(dir), '');
    } finally {
      cleanup();
    }
  });

  test('a wrapped bullet is ONE display bullet — continuation lines fold into it', () => {
    const { root, cleanup } = scaffold();
    try {
      const dir = join(root, 'extension', 'src', 'apps', 'notaboard');
      // Ordinary markdown (and prettier-formatted files) wrap one `- ` bullet across
      // several physical lines. Each continuation line used to become its own display
      // bullet, so one sentence rendered as three broken fragments (#974).
      writeFileSync(
        join(dir, 'CHANGELOG.md'),
        [
          '# Changelog',
          '',
          '## 1.1.0 — 2026-07-22',
          '',
          '- Deleting no longer removes favorites on a plain confirm: the confirm says how many of',
          '  them are favorites and asks you to acknowledge those explicitly. (#123)',
          '- Favorites keep their star while multi-selecting.',
          '',
        ].join('\n'),
      );
      const [release] = readUnitChangelog(dir);
      assert.deepEqual(release.lines, [
        'Deleting no longer removes favorites on a plain confirm: the confirm says how many of them are favorites and asks you to acknowledge those explicitly.',
        'Favorites keep their star while multi-selecting.',
      ]);
    } finally {
      cleanup();
    }
  });

  test('releaseUnit prepends, newest first, and refuses a duplicate version', () => {
    const { root, cleanup } = scaffold();
    try {
      const dir = join(root, 'extension', 'src', 'apps', 'notes');
      releaseUnit({ dir, version: '1.0.0', notes: '- Initial release.', date: '2026-05-01' });
      releaseUnit({ dir, version: '1.1.0', notes: '- Markdown preview', date: '2026-07-12' });

      const releases = readUnitChangelog(dir);
      assert.equal(releases[0].version, '1.1.0', 'newest first');
      assert.equal(releases[1].version, '1.0.0');
      assert.equal(unitVersion(dir), '1.1.0');

      // Releasing the same version twice is not a thing to let happen quietly.
      assert.throws(() => releaseUnit({ dir, version: '1.1.0', notes: '- again' }), /already has/);
    } finally {
      cleanup();
    }
  });
});

describe('proposeBump', () => {
  test('feat is a minor, everything else a patch — a major stays a human decision', () => {
    assert.equal(proposeBump('1.2.3', ['feat']), '1.3.0');
    assert.equal(proposeBump('1.2.3', ['fix']), '1.2.4');
    assert.equal(proposeBump('1.2.3', ['refactor', 'docs']), '1.2.4');
    assert.equal(proposeBump('1.2.3', ['fix', 'feat']), '1.3.0', 'any feat wins');
    // A breaking change is not something a commit type can be trusted to declare.
    assert.equal(proposeBump('1.2.3', ['feat!']), '1.2.4');
  });
});

describe('proposeBumps (the real thing, over a git history)', () => {
  test('attributes each PR to the unit it actually touched — not to every unit', () => {
    const repo = newRepo();
    try {
      // A repo-shaped fixture with two apps.
      repo.commit('scaffold notaboard', 'extension/src/apps/notaboard/index.ts');
      repo.commit('scaffold notes', 'extension/src/apps/notes/index.ts');
      for (const dir of ['notaboard', 'notes']) {
        writeFileSync(
          join(repo.dir, 'extension', 'src', 'apps', dir, 'CHANGELOG.md'),
          '# Changelog\n\n## 1.0.0 — 2026-05-01\n\n- Initial release.\n',
        );
      }
      repo.git('add -A');
      repo.git('commit -q -m "seed changelogs"');
      repo.tag('v1.0.0');

      repo.mergePR(1, 'feat(notaboard): infinite canvas', 'extension/src/apps/notaboard/index.ts');
      repo.mergePR(2, 'fix(notes): a crash', 'extension/src/apps/notes/index.ts');

      const bumps = proposeBumps('v1.0.0', 'HEAD', repo.dir);
      const board = bumps.find((b) => b.unit.id === 'notaboard');
      const notes = bumps.find((b) => b.unit.id === 'notes');

      // This is the bug I nearly shipped: using the range's AGGREGATE file list would have
      // credited BOTH PRs to BOTH apps, giving notes a spurious minor bump from
      // notaboard's feat. Attribution must be per-PR.
      assert.equal(board.to, '1.1.0', 'notaboard had a feat -> minor');
      assert.equal(notes.to, '1.0.1', 'notes had only a fix -> patch');
      assert.equal(board.changes.length, 1, 'one PR each, not two');
      assert.equal(notes.changes.length, 1);
    } finally {
      repo.cleanup();
    }
  });
});

describe('prepareRelease() actually bumps the units', () => {
  // This test exists because I shipped the opposite. `proposeBumps` was built, exported,
  // imported — and never called. The release did nothing to any app's version, while the
  // PR claimed it did. A code-quality bot caught the unused import; nothing else would
  // have, because no test asserted the release's EFFECT on the units.
  test('writes each touched unit a changelog entry, at the proposed version', async () => {
    const repo = newRepo();
    try {
      repo.commit('scaffold notaboard', 'extension/src/apps/notaboard/index.ts');
      writeFileSync(
        join(repo.dir, 'extension', 'src', 'apps', 'notaboard', 'CHANGELOG.md'),
        '# Changelog\n\n## 1.0.0 — 2026-05-01\n\n- Initial release.\n',
      );
      // The root changelog + manifest the release itself needs.
      writeFileSync(join(repo.dir, 'CHANGELOG.md'), '# Changelog\n\n<!-- releases below; newest first -->\n');
      mkdirSync(join(repo.dir, 'extension', 'src', 'data'), { recursive: true });
      writeFileSync(join(repo.dir, 'extension', 'manifest.json'), JSON.stringify({ version: '0.6.0' }));
      repo.git('add -A');
      repo.git('commit -q -m "seed"');
      repo.tag('v0.5.0');

      repo.mergePR(1, 'feat(notaboard): infinite canvas', 'extension/src/apps/notaboard/index.ts');
      repo.git('add -A');
      repo.git('commit -q --allow-empty -m "wip"');
      // On a branch, because `prepareRelease` refuses to write release notes on main (#1208).
      repo.git('checkout -q -b main_chore_release_0.6.0');

      const dir = join(repo.dir, 'extension', 'src', 'apps', 'notaboard');
      assert.equal(unitVersion(dir), '1.0.0', 'before: still 1.0.0');

      // `yes` skips the prompt. Nothing is caught: prepare neither pushes nor tags, so it has
      // no reason to fail with no remote configured.
      await prepareRelease('0.6.0', { root: repo.dir, yes: true });

      // The release must have bumped notaboard: a `feat` means a minor.
      assert.equal(unitVersion(dir), '1.1.0', 'after: the release bumped it');
      const [latest] = readUnitChangelog(dir);
      assert.ok(
        latest.lines.some((l) => /Infinite canvas/.test(l)),
        "and wrote the PR's own change into it",
      );
    } finally {
      repo.cleanup();
    }
  });
});

// The lockfile assertion behind `release.mjs check` (#1203).
//
// The root lockfile records every workspace's version, so a bump that misses it turns main
// red for everyone — the Makefile job asserts the two agree. v1.0.1 shipped with four
// deployables bumped in package.json and stale in the lockfile, and because the release
// tags and pushes in one breath, the tagged tree was the broken one.
describe('lockfileDrift', () => {
  /** A repo-shaped temp tree: workspaces with a package.json and a lockfile that may lie. */
  const tree = (pkgVersions, lockVersions) => {
    const dir = mkdtempSync(join(tmpdir(), 'lockdrift-'));
    for (const [id, version] of Object.entries(pkgVersions)) {
      mkdirSync(join(dir, id), { recursive: true });
      writeFileSync(join(dir, id, 'package.json'), JSON.stringify({ name: `@kimtos/${id}`, version }));
      writeFileSync(join(dir, id, 'CHANGELOG.md'), `# Changelog\n\n## ${version} — 2026-05-01\n\n- x.\n`);
    }
    const packages = {};
    for (const [id, version] of Object.entries(lockVersions)) packages[id] = { version };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
    return dir;
  };

  test('says nothing when every workspace agrees with the lockfile', () => {
    const dir = tree({ www: '1.2.0', extension: '1.0.1' }, { www: '1.2.0', extension: '1.0.1' });
    assert.deepEqual(lockfileDrift(dir), []);
  });

  test('names the workspace the release bumped and the lockfile did not — the v1.0.1 failure', () => {
    const dir = tree({ www: '1.2.0', extension: '1.0.1' }, { www: '1.1.0', extension: '1.0.1' });
    assert.deepEqual(lockfileDrift(dir), [{ id: 'www', pkg: '1.2.0', lock: '1.1.0' }]);
  });

  test('covers the extension, which is versioned by hand and is not a deployable unit', () => {
    const dir = tree({ www: '1.2.0', extension: '1.0.2' }, { www: '1.2.0', extension: '1.0.1' });
    assert.deepEqual(lockfileDrift(dir), [{ id: 'extension', pkg: '1.0.2', lock: '1.0.1' }]);
  });

  test('a workspace the lockfile does not record at all is drift, not a pass', () => {
    const dir = tree({ www: '1.2.0' }, {});
    assert.deepEqual(lockfileDrift(dir), [{ id: 'www', pkg: '1.2.0', lock: '' }]);
  });

  test('a workspace that is not checked out is skipped rather than reported as missing', () => {
    const dir = tree({ www: '1.2.0' }, { www: '1.2.0' });
    // No extension/ directory at all — every other deployable is absent too.
    assert.deepEqual(lockfileDrift(dir), []);
  });

  test('no lockfile means nothing to disagree with', () => {
    const dir = tree({ www: '1.2.0' }, { www: '9.9.9' });
    rmSync(join(dir, 'package-lock.json'));
    assert.deepEqual(lockfileDrift(dir), []);
  });
});
