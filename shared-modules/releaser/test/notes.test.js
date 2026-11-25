// The repo's first tests.
//
// Every case here has broken this pipeline at least once — which is the argument for the
// extraction in the first place. They run against a REAL git repository built in a temp
// directory (see fixture.js), because the logic reads git: mocking `execSync` would only
// test the mock.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateNotes, mergedPRs, clean, categorize, diffReport, prFiles } from '../dist/index.js';
import { newRepo } from './fixture.js';

describe('generateNotes', () => {
  test('first release (no previous tag) says so, rather than dumping the whole history', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.mergePR(1, 'feat: something');
      // An empty `from` means there is no previous tag. Every PR ever merged would
      // otherwise qualify — hundreds of lines of churn that no user can read.
      assert.equal(generateNotes('', 'HEAD', repo.dir), '### New\n- Initial release.\n');
    } finally {
      repo.cleanup();
    }
  });

  test('a range with no PRs never publishes an empty body', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.commit('chore: tidy'); // a commit, but no merged PR
      const notes = generateNotes('v1.0.0', 'HEAD', repo.dir);
      assert.equal(notes, '### Improved\n- Maintenance and internal improvements.\n');
    } finally {
      repo.cleanup();
    }
  });

  test('one PR, bucketed and sentence-cased, with the conventional prefix stripped', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.mergePR(7, 'feat(notes): add a markdown preview');
      assert.equal(generateNotes('v1.0.0', 'HEAD', repo.dir), '### New\n- Add a markdown preview\n');
    } finally {
      repo.cleanup();
    }
  });

  test('a squash-merged PR IS read — its subject is "title (#N)" (#653)', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.squashMergePR(7, 'feat: squashed straight onto main');
      // This repo squash-merges: the PR is a single plain commit, not a merge commit. The
      // trailing (#N) is what marks it as a PR, so it belongs in the changelog.
      assert.equal(generateNotes('v1.0.0', 'HEAD', repo.dir), '### New\n- Squashed straight onto main\n');
    } finally {
      repo.cleanup();
    }
  });

  test('a direct-push commit with no PR number contributes nothing', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.directPush('feat: pushed straight to main, no PR');
      assert.equal(
        generateNotes('v1.0.0', 'HEAD', repo.dir),
        '### Improved\n- Maintenance and internal improvements.\n',
      );
    } finally {
      repo.cleanup();
    }
  });

  test('a merge commit with an empty body is skipped, not emitted as junk', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.mergeEmptyBody(9); // no PR title in the body
      repo.mergePR(10, 'fix: a real one');
      const notes = generateNotes('v1.0.0', 'HEAD', repo.dir);
      assert.equal(notes, '### Fixed\n- A real one\n');
    } finally {
      repo.cleanup();
    }
  });

  test('buckets in order, deduplicates, and filters noise', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.mergePR(1, 'fix: a broken thing');
      repo.mergePR(2, 'feat: a new thing');
      repo.mergePR(3, 'refactor: a tidier thing');
      repo.mergePR(4, 'feat: a new thing'); // duplicate title — must appear once
      repo.mergePR(5, 'Bump lodash from 1 to 2'); // dependabot noise
      // Release bookkeeping. Note the noise filter is `release\s+v?\d` — it wants
      // whitespace after "release", so it catches "Release v1.0.2" and "build: release
      // v0.4.0", NOT "chore(release): …". That is fine in practice: the release commit is
      // made directly on main by the release itself, so it never arrives as a merged PR.
      repo.mergePR(6, 'Release v1.0.0');

      const notes = generateNotes('v1.0.0', 'HEAD', repo.dir);
      assert.equal(notes, '### New\n- A new thing\n\n### Improved\n- A tidier thing\n\n### Fixed\n- A broken thing\n');
    } finally {
      repo.cleanup();
    }
  });
});

describe('mergedPRs', () => {
  test('parses the number, title, type and scope', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.mergePR(42, 'feat(notaboard): infinite canvas');
      const [pr] = mergedPRs('v1.0.0', 'HEAD', repo.dir);
      assert.equal(pr.number, '42');
      assert.equal(pr.title, 'feat(notaboard): infinite canvas');
      assert.equal(pr.type, 'feat');
      assert.equal(pr.scope, 'notaboard');
      // The merge commit, so a caller can ask what THIS PR changed without re-walking.
      assert.match(pr.sha, /^[0-9a-f]{40}$/);
    } finally {
      repo.cleanup();
    }
  });

  test('parses a squash-merged PR — subject "title (#N)", last ref is the PR (#653)', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      // A real GitHub squash subject can carry an earlier issue ref AND the PR number.
      repo.squashMergePR(632, 'feat(support): Web Push backend (#630)');
      const [pr] = mergedPRs('v1.0.0', 'HEAD', repo.dir);
      assert.equal(pr.number, '632', 'the LAST ref is the PR; the earlier (#630) is an issue');
      assert.equal(pr.title, 'feat(support): Web Push backend (#630)');
      assert.equal(pr.type, 'feat');
      assert.equal(pr.scope, 'support');
      assert.match(pr.sha, /^[0-9a-f]{40}$/);
    } finally {
      repo.cleanup();
    }
  });

  test('a PR appearing once, no duplicates across styles', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.squashMergePR(1, 'fix: a thing');
      repo.squashMergePR(2, 'feat: another');
      repo.directPush('chore: no PR here');
      const prs = mergedPRs('v1.0.0', 'HEAD', repo.dir);
      assert.deepEqual(
        prs.map((p) => p.number),
        ['2', '1'],
        'both squash PRs, newest first; the direct push is excluded',
      );
    } finally {
      repo.cleanup();
    }
  });

  test('prFiles reports what ONE PR changed — not the whole range', () => {
    const repo = newRepo();
    try {
      repo.commit('initial');
      repo.tag('v1.0.0');
      repo.mergePR(1, 'feat(notaboard): canvas', 'extension/src/apps/notaboard/index.ts');
      repo.mergePR(2, 'feat(notes): editor', 'extension/src/apps/notes/index.ts');

      const prs = mergedPRs('v1.0.0', 'HEAD', repo.dir);
      const board = prs.find((p) => p.scope === 'notaboard');
      const notes = prs.find((p) => p.scope === 'notes');

      // Each PR sees only its OWN files. Using the aggregate range would credit both PRs
      // with both apps' changes — which is how a bump proposal silently versions an app
      // that nobody touched.
      assert.ok(prFiles(board.sha, repo.dir).some((f) => f.includes('apps/notaboard/')));
      assert.ok(!prFiles(board.sha, repo.dir).some((f) => f.includes('apps/notes/')));
      assert.ok(prFiles(notes.sha, repo.dir).some((f) => f.includes('apps/notes/')));
    } finally {
      repo.cleanup();
    }
  });
});

describe('clean / categorize', () => {
  test('strips the conventional prefix and sentence-cases', () => {
    assert.equal(clean('feat(dock): add a badge'), 'Add a badge');
    assert.equal(clean('refactor(css)!: drop the old tokens'), 'Drop the old tokens');
    assert.equal(clean('fix: something (a1b2c3d4e5f)'), 'Something');
  });

  test('buckets by type, and by a leading verb when there is no prefix', () => {
    assert.equal(categorize('feat: x'), 'New');
    assert.equal(categorize('Add a thing'), 'New');
    assert.equal(categorize('fix(app): x'), 'Fixed');
    assert.equal(categorize('Fix a thing'), 'Fixed');
    assert.equal(categorize('refactor: x'), 'Improved');
    assert.equal(categorize('docs: x'), 'Improved');
  });
});

describe('diffReport', () => {
  let repo;
  before(() => {
    repo = newRepo();
    // Both apps must EXIST in the tree, because a scope only counts as an app when it
    // names a real app directory — otherwise `fix(www)` would invent an app called "www".
    repo.commit('initial', 'README.md');
    repo.commit('scaffold notes', 'extension/src/apps/notes/index.ts');
    repo.commit('scaffold notaboard', 'extension/src/apps/notaboard/index.ts');
    repo.tag('v1.0.0');

    // notaboard: touched by FILE PATH, and its scope ("ui") does NOT name it.
    repo.mergePR(1, 'fix(ui): tighten the board toolbar', 'extension/src/apps/notaboard/index.ts');
    // notes: touched ONLY by SCOPE — no file of its own changed in this range.
    repo.mergePR(2, 'docs(notes): clarify the collections model', 'docs/extension/apps/notes/x.md');
    // www: a real scope, but not an app. It must not become one.
    repo.mergePR(3, 'feat(www): a new pricing section', 'www/pages/index.vue');
    // A file at the repo ROOT. It has no workspace, and must not report itself as one.
    repo.mergePR(4, 'chore: tidy the Makefile', 'Makefile');
  });
  after(() => repo.cleanup());

  test('attributes apps by file path AND by commit scope, and invents none', () => {
    const r = diffReport('v1.0.0', 'HEAD', repo.dir);
    // notaboard: caught by path. notes: caught by scope. www: a workspace, NOT an app.
    assert.deepEqual(r.apps, ['notaboard', 'notes']);
    assert.ok(!r.apps.includes('www'), 'a non-app scope must not become an app');
  });

  test('reports the workspaces touched — a docs-only release needs no store submission', () => {
    const r = diffReport('v1.0.0', 'HEAD', repo.dir);
    // A root-level file (Makefile) has no workspace and must not report itself as one.
    assert.deepEqual(r.workspaces, ['docs', 'extension', 'www']);
    assert.ok(!r.workspaces.includes('Makefile'), 'a root file is not a workspace');
  });

  test('counts the PRs and the commits', () => {
    const r = diffReport('v1.0.0', 'HEAD', repo.dir);
    assert.equal(r.prs.length, 4);
    assert.ok(r.commits > 0);
  });

  test('with no previous tag, reports the whole history — not the uncommitted working tree', () => {
    // `git diff --name-only HEAD` degrades to "working tree vs HEAD" when there is no
    // `from`, which reports whatever happens to be uncommitted. That is not a release
    // report. This is the bug that only showed up when the CLI was actually run.
    const r = diffReport('', 'HEAD', repo.dir);
    assert.ok(r.files.includes('README.md'), 'must include files from before the first tag');
    assert.ok(r.files.includes('www/pages/index.vue'), 'and files from after it');
    assert.ok(r.commits > 4);
  });
});
