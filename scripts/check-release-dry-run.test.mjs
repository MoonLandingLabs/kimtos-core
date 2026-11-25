// The Release dry run is the only thing standing between a tag and finding out the workflow is
// broken, and it was itself broken for as long as it had been documented (#1201). These tests are
// mostly about the guard FAILING on that exact shape — a check that cannot go red is a green tick
// that means nothing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSteps, skippedOnDryRun, ifExpression, offendingSteps, DRY_RUN_ENV } from './check-release-dry-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const WORKFLOW = `
jobs:
  release:
    env:
      DRY_RUN: \${{ github.event_name == 'workflow_dispatch' }}
    steps:
      - uses: actions/checkout@v7

      - name: Verify manifest version matches the tag
        run: |
          jq -r .version extension/manifest.json

      - name: Verify the changelog has notes for this version
        if: env.DRY_RUN != 'true'
        run: |
          grep -qE "^## v" CHANGELOG.md

      - name: Publish to the Chrome Web Store
        if: env.DRY_RUN != 'true' && env.CWS_REFRESH_TOKEN != ''
        run: |
          curl -sS ...
`;

describe('reading the workflow', () => {
  test('splits the job into its steps', () => {
    const steps = splitSteps(WORKFLOW);
    assert.equal(steps.length, 4);
    assert.match(steps[1], /Verify manifest version/);
  });

  test('a step carries its own `if` and `run` together', () => {
    const [, , changelog] = splitSteps(WORKFLOW);
    assert.match(changelog, /CHANGELOG\.md/);
    assert.match(changelog, /if: env\.DRY_RUN/);
  });

  test('no steps block at all is empty, not a crash', () => {
    assert.deepEqual(splitSteps('name: Nothing\non: push\n'), []);
  });
});

describe('recognising a dry-run skip', () => {
  test('the plain form counts', () => {
    const step = ['      - name: X', "        if: env.DRY_RUN != 'true'", '        run: echo hi'].join('\n');
    assert.equal(skippedOnDryRun(step), true);
  });

  test('a compound condition still counts', () => {
    const step = [
      '      - name: Publish',
      "        if: env.DRY_RUN != 'true' && env.CWS_REFRESH_TOKEN != ''",
      '        run: echo hi',
    ].join('\n');
    assert.equal(skippedOnDryRun(step), true);
  });

  // The inverse condition means the step runs ONLY on a dry run — the opposite of a skip.
  test("`== 'true'` is not a skip", () => {
    const step = ['      - name: X', "        if: env.DRY_RUN == 'true'", '        run: echo hi'].join('\n');
    assert.equal(skippedOnDryRun(step), false);
  });

  test('no condition at all is not a skip', () => {
    assert.equal(skippedOnDryRun('      - name: X\n        run: echo hi'), false);
  });
});

describe('reading a wrapped condition', () => {
  // YAML lets a long `if:` wrap. Reading it line by line would call a correctly-gated step
  // ungated — the kind of false alarm that gets a guard deleted rather than fixed.
  test('a condition split across lines is folded into one', () => {
    const step = [
      '      - name: Publish',
      "        if: env.DRY_RUN != 'true' &&",
      "          env.CWS_REFRESH_TOKEN != ''",
      '        run: |',
      '          curl -sS ...',
    ].join('\n');

    assert.match(ifExpression(step), /DRY_RUN != 'true' && env\.CWS_REFRESH_TOKEN/);
    assert.equal(skippedOnDryRun(step), true);
  });

  test('the expression stops at the next key, not at the end of the step', () => {
    const step = [
      '      - name: X',
      "        if: env.DRY_RUN != 'true'",
      '        run: |',
      '          echo DRY_RUN',
    ].join('\n');
    assert.equal(ifExpression(step).includes('echo'), false);
  });

  test('a step with no condition has no expression', () => {
    assert.equal(ifExpression('      - name: X\n        run: echo hi'), '');
  });
});

describe('catching a dry run that cannot pass', () => {
  test('the fixed workflow has nothing to report', () => {
    assert.deepEqual(offendingSteps(WORKFLOW), []);
  });

  // THE regression, in the exact shape it shipped in: the guard with no condition.
  test('an unguarded changelog check is reported', () => {
    const broken = WORKFLOW.replace(
      "        if: env.DRY_RUN != 'true'\n        run: |\n          grep",
      '        run: |\n          grep',
    );

    assert.deepEqual(offendingSteps(broken), ['Verify the changelog has notes for this version']);
  });

  test('a NEW step that reads the changelog is caught too, not just the known one', () => {
    const extended = `${WORKFLOW}
      - name: Attach the notes to the package
        run: |
          cp CHANGELOG.md extension/dist/
`;
    assert.deepEqual(offendingSteps(extended), ['Attach the notes to the package']);
  });

  // Scanning only the first job would not check a second one and find it compliant — it would
  // not see it at all, which is a guard quietly narrowing its own scope.
  test('a violation in a SECOND job is caught too', () => {
    const twoJobs = `${WORKFLOW}
  notify:
    runs-on: self-hosted
    steps:
      - name: Post the notes
        run: |
          cat CHANGELOG.md | slack-post
`;
    assert.deepEqual(offendingSteps(twoJobs), ['Post the notes']);
  });

  // A `run: |` body is free-form script. A heredoc writes its content at column 0, and treating any
  // shallow line as the end of the steps block meant the first such line closed it — every step
  // after it became invisible, taking any violation with it. Found by running the parser, not by
  // reading it.
  test('a heredoc at column zero does not truncate the steps block', () => {
    const withHeredoc = `
jobs:
  release:
    steps:
      - name: Heredoc
        run: |
          cat <<'EOF' > x
notes at column zero
EOF
          echo done

      - name: Reads the changelog after it
        run: |
          grep -q x CHANGELOG.md
`;
    assert.equal(splitSteps(withHeredoc).length, 2, 'both steps are seen');
    assert.deepEqual(offendingSteps(withHeredoc), ['Reads the changelog after it']);
  });

  // A `run:` body is free-form text. A heredoc writing an example workflow contains
  // `if: env.DRY_RUN != 'true'` as DATA, and matching it made an unconditional step read as gated —
  // the guard skipping the very thing it exists to catch.
  test('an `if:` inside a run body does not make an ungated step look gated', () => {
    const impostor = `
jobs:
  x:
    steps:
      - name: Document the guard
        run: |
          cat <<'EOF' > example.yml
          if: env.DRY_RUN != 'true'
          EOF
          cat CHANGELOG.md
`;
    assert.deepEqual(offendingSteps(impostor), ['Document the guard'], 'it reads the changelog unconditionally');
  });

  // The other direction: a real `if:` at the step's own property indent must still count, or the
  // fix above would have cured the false negative by reporting everything.
  test('a real gated step is still recognised as skipped', () => {
    const gated = `
jobs:
  x:
    steps:
      - name: Verify
        if: env.DRY_RUN != 'true'
        run: |
          grep -q x CHANGELOG.md
`;
    assert.equal(skippedOnDryRun(splitSteps(gated)[0]), true);
    assert.deepEqual(offendingSteps(gated), []);
  });

  // A list item inside a heredoc is not a step boundary. It used to both truncate the real step and
  // invent a bogus one out of the fragment.
  test('a `- ` line inside a run body does not fabricate a step', () => {
    const checklist = `
jobs:
  x:
    steps:
      - name: Write checklist
        run: |
          cat <<'EOF' > c.md
- [ ] Bump the version
EOF
      - name: Real guarded step
        if: env.DRY_RUN != 'true'
        run: |
          grep -q x CHANGELOG.md
`;
    const steps = splitSteps(checklist);
    assert.equal(steps.length, 2, 'the list item is part of the first step, not a third one');
    assert.match(steps[1], /Real guarded step/);
    assert.deepEqual(offendingSteps(checklist), []);
  });

  // The rule is "names the file, or is gated", so a step that merely MENTIONS it is reported. That
  // is the loud direction on purpose: a false positive is one comment on a PR, a false negative is
  // how #1201 shipped in the first place.
  test('a step that names the file for any reason is reported, not quietly excused', () => {
    const mentions = `
jobs:
  x:
    steps:
      - name: Write checklist
        run: |
          echo '- [ ] Update CHANGELOG.md' > c.md
`;
    assert.deepEqual(offendingSteps(mentions), ['Write checklist']);
  });

  // Otherwise the comment explaining why a step is skipped would itself trip the guard, and the
  // only way to keep the build green would be to stop explaining.
  test('a mention in a comment is not a read', () => {
    const commented = `${WORKFLOW}
      - name: Something else
        run: |
          # CHANGELOG.md is deliberately not read here
          echo ok
`;
    assert.deepEqual(offendingSteps(commented), []);
  });
});

// Against the real file, so the check is green on main and stays that way.
describe('the workflow as it ships', () => {
  const yaml = readFileSync(join(HERE, '..', '.github', 'workflows', 'release.yml'), 'utf8');

  test('nothing blocks the dry run on release-only output', () => {
    assert.deepEqual(offendingSteps(yaml), []);
  });

  test(`it still defines ${DRY_RUN_ENV} — every dry-run condition keys off it`, () => {
    assert.match(yaml, new RegExp(`^\\s*${DRY_RUN_ENV}:`, 'm'));
  });

  // The guard must not have been "fixed" by making the changelog check run only on a dry run, nor
  // by deleting it: it is what stops a tagged package shipping without its own release notes (#416).
  test('the changelog check still runs on a real tag', () => {
    const step = splitSteps(yaml).find((s) => /Verify the changelog/.test(s));
    assert.ok(step, 'the guard must still exist');
    assert.equal(skippedOnDryRun(step), true, 'skipped on a dry run');
    assert.doesNotMatch(step, /if:.*DRY_RUN\s*==\s*'true'/, 'but NOT limited to dry runs');
  });
});
