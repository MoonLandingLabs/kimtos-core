// The draft-guard check, against what it must catch and what it must pass.
//
// Two bugs, not one, so both directions are asserted: a job that runs on drafts, and a workflow
// whose `types:` omits `ready_for_review` (which would leave a PR with no checks at all — the
// worse of the two, and the one a careless fix introduces). Every shipped workflow must also
// pass today, or the check disagrees with the tree it is guarding.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { auditWorkflow, problemsFor, GUARD, READY, EXEMPT, CANCEL_NOT_MAIN } from './check-draft-guard.mjs';

const wf = (on, jobs) => `name: X\n\non:\n${on}\njobs:\n${jobs}`;
const PR_OK = `  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n    types: [opened, synchronize, reopened, ${READY}]\n`;
const JOB_OK = `  build:\n    name: Build\n    if: ${GUARD}\n    runs-on: self-hosted\n    steps:\n      - run: echo hi\n`;
const JOB_BARE = `  build:\n    name: Build\n    runs-on: self-hosted\n    steps:\n      - run: echo hi\n`;

test('a compliant workflow passes', () => {
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, JOB_OK)), []);
});

test('a job with no draft guard is caught', () => {
  const problems = problemsFor('x.yml', wf(PR_OK, JOB_BARE));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /job `build` has no draft guard/);
});

test('EVERY job is checked, not just the first — test.yml has three', () => {
  const problems = problemsFor('x.yml', wf(PR_OK, JOB_OK + JOB_BARE.replace('build:', 'lint:')));
  assert.deepEqual(problems, ['job `lint` has no draft guard']);
});

test('omitting ready_for_review is caught — the guard alone leaves a PR with NO checks', () => {
  const noReady = `  pull_request:\n    branches: [main]\n    types: [opened, synchronize, reopened]\n`;
  assert.match(problemsFor('x.yml', wf(noReady, JOB_OK))[0], /omits `ready_for_review`/);

  // No `types:` at all is the same bug: the default set does not include it.
  const noTypes = `  pull_request:\n    branches: [main]\n`;
  assert.match(problemsFor('x.yml', wf(noTypes, JOB_OK))[0], /declares no `types:`/);
});

test('a workflow with no pull_request trigger is not the guard’s business', () => {
  const pushOnly = `  push:\n    branches: [main]\n  schedule:\n    - cron: '0 3 * * 1'\n`;
  assert.deepEqual(problemsFor('release.yml', wf(pushOnly, JOB_BARE)), [], 'nothing to skip on a push');
  assert.equal(auditWorkflow(wf(pushOnly, JOB_BARE)).pullRequest, false);
});

test('an exempt workflow passes, and every exemption carries a reason about the event', () => {
  assert.deepEqual(problemsFor('cancel-merged.yml', wf(PR_OK, JOB_BARE)), []);
  for (const [file, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > 60, `${file}: an exemption needs a real reason, not a shrug`);
  }
});

test('the `on:` scan does not confuse push’s keys with pull_request’s', () => {
  // `push` also has `branches:`, and BOTH blocks may carry `paths:`. A scanner that tracked only
  // "am I under `on:`" would read push's keys as pull_request's.
  const pushHasTypesLike = `  push:\n    branches: [main]\n    paths:\n      - 'x/**'\n  pull_request:\n    branches: [main]\n    types: [opened, synchronize, reopened, ${READY}]\n    paths:\n      - 'x/**'\n`;
  const audit = auditWorkflow(wf(pushHasTypesLike, JOB_OK));
  assert.deepEqual(audit.types, ['opened', 'synchronize', 'reopened', READY]);
  assert.deepEqual(problemsFor('x.yml', wf(pushHasTypesLike, JOB_OK)), []);
});

test('a `steps:` key is never mistaken for a job', () => {
  // Job keys are two-space; a step's `- name:` is deeper. Getting this wrong would invent jobs
  // and fail every workflow.
  const audit = auditWorkflow(wf(PR_OK, JOB_OK));
  assert.deepEqual(
    audit.jobs.map((j) => j.name),
    ['build'],
  );
});

// --- the shapes that fooled the first version of this scanner ---------------------------------
//
// All four were found by the self-review on #1190, and three of them were FALSE PASSES: the check
// reported green on a job that had no draft guard at all. A guard that clears the thing it exists
// to catch is worse than no guard, so each shape gets a test.

test('a column-0 comment between jobs does not hide the job after it', () => {
  // This repo writes long column-0 comment blocks between jobs. The first scanner treated any
  // unindented line as a new top-level key, so a comment "ended" the jobs section and every job
  // after it became invisible — a clean pass for an unguarded job.
  const jobs =
    JOB_OK +
    '\n# A comment explaining the next job, in this repo’s usual style.\n' +
    JOB_BARE.replace('build:', 'second:');
  const audit = auditWorkflow(wf(PR_OK, jobs));
  assert.deepEqual(
    audit.jobs.map((j) => j.name),
    ['build', 'second'],
    'both jobs must be seen',
  );
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, jobs)), ['job `second` has no draft guard']);
});

test('flow-style `on: [push, pull_request]` is reported, not waved through', () => {
  // A flow trigger cannot carry `types:`, so it can never satisfy this rule. The first scanner
  // only matched a block `on:`, so it decided the workflow had no pull_request trigger and passed.
  const yaml = 'name: X\n\non: [push, pull_request]\njobs:\n' + JOB_BARE;
  assert.equal(auditWorkflow(yaml).pullRequest, true);
  assert.match(problemsFor('x.yml', yaml)[0], /flow form/);
});

test('a quoted `"on":` key is still the trigger', () => {
  // YAML 1.1 makes `on` a boolean, so quoting it is legitimate — and invisible to a bare /^on:/.
  const yaml = 'name: X\n\n"on":\n' + PR_OK + 'jobs:\n' + JOB_BARE;
  assert.equal(auditWorkflow(yaml).pullRequest, true);
  assert.deepEqual(problemsFor('x.yml', yaml), ['job `build` has no draft guard']);
});

test('block-style `types:` is read, not misreported as absent', () => {
  // The safe-direction bug: valid YAML that the check called non-compliant.
  const blockTypes = `  pull_request:\n    branches: [main]\n    types:\n      - opened\n      - synchronize\n      - reopened\n      - ${READY}\n`;
  assert.deepEqual(auditWorkflow(wf(blockTypes, JOB_OK)).types, ['opened', 'synchronize', 'reopened', READY]);
  assert.deepEqual(problemsFor('x.yml', wf(blockTypes, JOB_OK)), []);
});

test('CRLF line endings do not defeat the scan', () => {
  const yaml = wf(PR_OK, JOB_BARE).replace(/\n/g, '\r\n');
  assert.deepEqual(problemsFor('x.yml', yaml), ['job `build` has no draft guard']);
});

test('it fails CLOSED: a pull_request workflow with no readable job is reported', () => {
  // The whole class of bug above shared one shape — "found nothing, so nothing is wrong". An
  // unreadable file must be a finding, never a pass.
  const noJobs = 'name: X\n\non:\n' + PR_OK + 'jobs:\n';
  assert.match(problemsFor('x.yml', noJobs)[0], /could read no job|declares no `jobs:`/);
  assert.equal(auditWorkflow(noJobs).unreadable !== null, true);
});

test('a step-level `if:` does not count as the job’s guard', () => {
  // The guard has to be on the JOB. An `if:` on a step would leave the job running (and holding a
  // runner) on every draft.
  const stepIf = `  build:\n    name: Build\n    runs-on: self-hosted\n    steps:\n      - if: ${GUARD}\n        run: echo hi\n`;
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, stepIf)), ['job `build` has no draft guard']);
});

test('indentation is read relatively — a four-space workflow is judged the same as a two-space one', () => {
  // The second false pass found on #1190, and the sharpest: the scanner hardcoded two- and
  // four-space widths, so a workflow indented four spaces throughout — ordinary, valid YAML that
  // GitHub reads exactly as written — had its `pull_request:` trigger go unseen entirely, and an
  // unguarded job was reported as fine.
  const four =
    'on:\n    pull_request:\n        types: [opened, synchronize, reopened, ready_for_review]\njobs:\n    build:\n        runs-on: self-hosted\n';
  assert.equal(auditWorkflow(four).pullRequest, true, 'the trigger must be found at any indent');
  assert.deepEqual(problemsFor('x.yml', four), ['job `build` has no draft guard']);

  // Three spaces, to prove nothing is special about four.
  const three =
    'on:\n   pull_request:\n      types: [opened, ready_for_review]\njobs:\n   build:\n      runs-on: self-hosted\n';
  assert.deepEqual(problemsFor('x.yml', three), ['job `build` has no draft guard']);

  // And the same shape WITH the guard must pass, or the fix is just a blanket failure.
  const guarded = four.replace('        runs-on:', `        if: ${GUARD}\n        runs-on:`);
  assert.deepEqual(problemsFor('x.yml', guarded), []);
});

test('an unreadable `on:` block is reported, not read as "no pull_request trigger"', () => {
  // `problemsFor` used to exit on `!pullRequest` BEFORE consulting `unreadable`, so "I could not
  // find the trigger" passed exactly like "there is no trigger". Only one of those is safe.
  const audit = auditWorkflow('on:\n  - something\njobs:\n  build:\n    runs-on: self-hosted\n');
  assert.equal(audit.unreadable !== null, true);
  assert.deepEqual(problemsFor('x.yml', 'on:\n  - something\njobs:\n  build:\n    runs-on: self-hosted\n'), [
    audit.unreadable,
  ]);
});

test('the guard string inside a comment does not mark a job guarded', () => {
  const commented = `  build:\n    name: Build\n    # if: ${GUARD}\n    runs-on: self-hosted\n`;
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, commented)), ['job `build` has no draft guard']);
});

test('a UTF-8 BOM is not indentation', () => {
  // The third false pass found on #1190. JavaScript's `\s` includes U+FEFF, so a file saved with a
  // BOM had it swallowed into the indent capture: the first key was not at column zero, `on:` was
  // never found, and the entire workflow went unexamined — every job in it cleared.
  const body = `on:\n  pull_request:\n    types: [opened, synchronize, reopened, ${READY}]\njobs:\n  unsafe:\n    runs-on: self-hosted\n`;
  assert.deepEqual(problemsFor('x.yml', '﻿' + body), ['job `unsafe` has no draft guard']);

  // And a BOM'd file that IS compliant must still pass, or the fix is a blanket failure.
  const ok = ('﻿' + body).replace('    runs-on:', `    if: ${GUARD}\n    runs-on:`);
  assert.deepEqual(problemsFor('x.yml', ok), []);
});

test('a workflow with no readable `on:` is reported — GitHub requires one', () => {
  // The structural half of the BOM fix, and what would have caught it whatever the cause: a file
  // in .github/workflows without an `on:` is a file this scanner failed to read, not a workflow
  // with no triggers. "Found nothing" must never be "nothing is wrong".
  assert.match(problemsFor('x.yml', 'jobs:\n  build:\n    runs-on: self-hosted\n')[0], /no `on:`/);
});

test('YAML’s explicit-key form is reported, not dropped', () => {
  // The fourth false pass on #1190, and the one that settled the design. `? build` / `: value` is
  // spec-legal and every parser reads it as an ordinary `build:` job — this scanner did not see it
  // at all, so an unguarded job came back clean.
  const explicitKey = `on:\n  pull_request:\n    types: [opened, ${READY}]\njobs:\n  ? build\n  : runs-on: self-hosted\n  test:\n    if: ${GUARD}\n    runs-on: self-hosted\n`;
  assert.match(problemsFor('x.yml', explicitKey)[0], /cannot read: `\? build`/);
});

test('ANY unclassifiable line at a block’s own indent is reported', () => {
  // The general rule behind the test above, which is the whole mitigation: this is a text scanner,
  // not a YAML parser (no parser is available — the Conventions job installs nothing), so the one
  // thing it must never do is stay quiet about a shape it does not model. Every one of the four
  // false passes found on #1190 was "found nothing, so nothing is wrong".
  const weird = `on:\n  pull_request:\n    types: [opened, ${READY}]\njobs:\n  &anchor\n  build:\n    if: ${GUARD}\n    runs-on: self-hosted\n`;
  assert.ok(problemsFor('x.yml', weird).length, 'an unmodelled line must be reported');
});

test('the guard must be the WHOLE condition, not merely contained in it', () => {
  // The fifth finding on #1190, and the only one no YAML parser would have caught: `guarded` was a
  // substring test, so an expression CONTAINING the guard passed however it used it. One `!` turns
  // the guard into its exact opposite — a job that runs only on drafts — and it read as compliant.
  const job = (iff) => `  build:\n    if: ${iff}\n    runs-on: self-hosted\n`;
  const negated = `\${{ !(${GUARD}) }}`;
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, job(negated))), ['job `build` has no draft guard']);
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, job(`(${GUARD}) == false`))), ['job `build` has no draft guard']);

  // `${{ }}` around it is equivalent and legitimate, so it must still pass.
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, job(`\${{ ${GUARD} }}`))), []);

  // A compound condition is rejected ON PURPOSE. No job here needs one, and the honest response to
  // the first that does is a failure someone has to think about, not a looser test.
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, job(`${GUARD} && github.actor != 'bot'`))), [
    'job `build` has no draft guard',
  ]);
});

test('every shipped workflow complies today', () => {
  // Not a tautology: this is the assertion that fails if someone adds a workflow, or a job to an
  // existing one, without the guard.
  const dir = '.github/workflows';
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 5, 'expected the real workflow directory');
  for (const f of files) {
    assert.deepEqual(problemsFor(f, readFileSync(join(dir, f), 'utf8')), [], `${f} must comply`);
  }
});

// --- `main` must keep its verdict (#1196) -------------------------------------------------------
//
// Cancelling a superseded run is right on a branch and wrong on `main`, where a burst of merges
// throws away the verification of everything it lands on. Nine hand-edited lines with nothing
// asserting them is the drift this repo keeps paying for, so the rule is checked here too.

const CONCURRENCY = (cancel) =>
  `concurrency:\n  group: \${{ github.workflow }}-\${{ github.ref }}\n  cancel-in-progress: ${cancel}\n`;
const withConcurrency = (cancel, on = PR_OK, jobs = JOB_OK) =>
  `name: X\n\n${CONCURRENCY(cancel)}\non:\n${on}\njobs:\n${jobs}`;

test('a bare `cancel-in-progress: true` is caught — it cancels main too', () => {
  const problems = problemsFor('x.yml', withConcurrency('true'));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /cancels superseded runs on `main` too/);
});

test('the branch-aware expression passes', () => {
  assert.deepEqual(problemsFor('x.yml', withConcurrency(`\${{ ${CANCEL_NOT_MAIN} }}`)), []);
});

test('a literal `cancel-in-progress: false` passes — it cancels nothing at all', () => {
  // Rejecting `false` was a blind spot, and not a harmless one. auto_deploy_staging.yml must never
  // cancel a run in flight: `make deploy` rm -rf's the remote tree before extracting, so a
  // cancelled deploy can leave the box with no tree. Its ref is never `main`, so the branch-aware
  // expression evaluates TRUE there — demanding it would have required exactly the dangerous
  // behaviour. `false` keeps main's verdict more thoroughly than the expression does.
  assert.deepEqual(problemsFor('x.yml', withConcurrency('false')), []);
});

test('no `concurrency` block at all is not this rule’s business', () => {
  // release.yml and cancel-merged.yml have none. Absent is not the same as wrong.
  assert.deepEqual(problemsFor('x.yml', wf(PR_OK, JOB_OK)), []);
});

test('the rule applies to a PUSH-only workflow too', () => {
  // Deliberately checked before the pull_request exit: a push-only workflow cancels `main`'s runs
  // just as thoroughly, so this is about the ref, not the trigger.
  const pushOnly = `  push:\n    branches: [main]\n`;
  const problems = problemsFor('x.yml', withConcurrency('true', pushOnly, JOB_BARE));
  assert.equal(problems.length, 1, 'the concurrency finding, and no draft findings');
  assert.match(problems[0], /cancels superseded runs on `main` too/);
});

test('the concurrency check is EXACT, not a substring — the hole this file already had once', () => {
  // Round one of #1207's review found `.includes(CANCEL_NOT_MAIN)`, which is the same class of bug
  // `isGuard` was fixed for: an expression can CONTAIN the safe text while doing the opposite, and
  // a trailing comment can contain it while the real value is the bug.
  const commented = `true  # TODO switch to \${{ ${CANCEL_NOT_MAIN} }} per #1196`;
  assert.match(problemsFor('x.yml', withConcurrency(commented))[0], /cancels superseded runs on `main` too/);

  // Negated: cancels main, spares branches — the mirror image of the bug being fixed.
  const negated = `\${{ !(${CANCEL_NOT_MAIN}) }}`;
  assert.match(problemsFor('x.yml', withConcurrency(negated))[0], /cancels superseded runs on `main` too/);

  // And the legitimate forms still pass, including sloppy whitespace.
  assert.deepEqual(problemsFor('x.yml', withConcurrency(`\${{   github.ref  !=  'refs/heads/main'   }}`)), []);
});
