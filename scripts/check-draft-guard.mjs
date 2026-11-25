// A CI workflow must not run on a draft pull request, and must run when one is marked ready.
//
// Both halves, because either alone is a bug:
//
//   - Without the draft guard, the whole suite runs on a draft and again on every push to it.
//     That is the normal path here, not an edge case: `.claude/skills/issue-workflow/SKILL.md`
//     requires every PR to be opened `--draft` and to take review commits before being marked
//     ready, so one issue burned three full suites nobody would ever read — on a self-hosted
//     pool that has no GitHub-hosted fallback (see cancel-merged.yml).
//   - Without `ready_for_review` in `types`, the guard turns into a worse bug. That event is
//     NOT in GitHub's default set (`opened`, `synchronize`, `reopened`), so a PR opened as a
//     draft and later marked ready fires nothing the workflow listens for, and sits with no
//     checks at all, forever.
//
// Eleven jobs across nine files is a hand-maintained list, and omission is the failure mode: a
// new workflow, or a new job in an existing one, silently goes back to running on drafts and
// the only symptom is a queue busier than it should be. So it is asserted here (#1188).
//
// NO DEPENDENCIES — a line scanner, not a YAML parser. Not a preference: the Conventions job runs
// with no `npm ci`, the root workspace declares no runtime deps, and no YAML parser is a declared
// dependency anywhere in the repo. check-all.mjs scans the same workflow by hand for the same reason.
//
// That constraint has a cost, and it was paid four times over: every review round on this file found
// a YAML shape the scanner did not model and therefore silently DROPPED, clearing a job that had no
// draft guard — a comment between jobs, a four-space indent, a BOM, YAML's `? key` form. So the
// design rule here is FAIL CLOSED. `unreadable` is reported before anything else, and `strayLines`
// reports any line the scanner cannot classify at all. A shape it does not understand must produce a
// loud failure telling someone to look; the one thing it must never do is stay quiet.
//
//   node scripts/check-draft-guard.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = '.github/workflows';

/** The expression a job must carry. `push` and `schedule` runs are unaffected by it. */
export const GUARD = "github.event_name != 'pull_request' || github.event.pull_request.draft == false";

/** The event that fires when a draft is marked ready. Absent from GitHub's default `types`. */
export const READY = 'ready_for_review';

/**
 * `cancel-in-progress` must be branch-aware, never a bare `true`.
 *
 * Cancelling a superseded run is right on a branch and wrong on `main`: a burst of merges there
 * destroys the verification of everything it lands on top of, and a cancelled run reports as a red
 * X with no failing step and no log — indistinguishable from a real failure (#1196). Nine
 * hand-edited lines with nothing asserting them is the drift this repo keeps paying for.
 */
export const CANCEL_NOT_MAIN = "github.ref != 'refs/heads/main'";

// Workflows that trigger on `pull_request` and are NOT subject to the rule. Every entry needs a
// REASON, and the reason must be about the EVENT — a workflow that only acts on a lifecycle
// transition a draft cannot be in has nothing to skip.
export const EXEMPT = {
  'cancel-merged.yml':
    'Triggers only on `types: [closed]` and acts only when `merged == true`. A draft cannot be merged, so there is no draft run to skip and no ready_for_review to wait for — the guard would be dead weight and `ready_for_review` would make it run on an event it does not handle.',
};

// A key line: leading indent, an optionally-quoted name, and whatever followed the colon.
//
// The indent class is `[ \t]*`, NOT `\s*`, and that is load-bearing. JavaScript's `\s` includes
// U+FEFF, so a file saved with a UTF-8 BOM had the BOM swallowed into the indent capture: the
// first key was no longer at column zero, `on:` was never found, and the whole workflow became
// invisible — a clean pass for every job in it. Only spaces and tabs are indentation.
const KEY = /^([ \t]*)['"]?([A-Za-z0-9_-]+)['"]?:(.*)$/;

/**
 * The lines that carry structure. Comments and blank lines are dropped BEFORE anything looks at
 * indentation, because a comment at column 0 is not a top-level key — and this repo writes long
 * column-0 comment blocks between jobs constantly, which is exactly how a naive scanner is fooled
 * into never seeing the job that follows one.
 */
function significantLines(yaml) {
  return yaml
    .replace(/^﻿/, '') // a BOM is not indentation
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^\s*#/.test(l));
}

/**
 * The body of one top-level key, plus whatever sat inline after its colon.
 *
 * @returns {{inline: string, body: string[]}|null} null when the key is absent
 */
function topLevelBlock(lines, name) {
  const at = lines.findIndex((l) => {
    const m = KEY.exec(l);
    return m && m[1] === '' && m[2] === name;
  });
  if (at === -1) return null;
  const body = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break; // the next top-level key ends this block
    body.push(line);
  }
  return { inline: (KEY.exec(lines[at])?.[3] ?? '').trim(), body };
}

/** A `types:`/list value in either YAML form: `[a, b]` inline, or `- a` lines beneath. */
function listValue(inline, body) {
  const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '');
  const flow = /^\[(.*)\]$/.exec(inline);
  if (flow) return flow[1].split(',').map(unquote).filter(Boolean);
  const items = body.filter((l) => /^\s*-\s/.test(l)).map((l) => unquote(l.replace(/^\s*-\s*/, '')));
  return items.length ? items : null;
}

/**
 * The DIRECT children of a block: the keys at its shallowest indent, each with its inline value
 * and its own body.
 *
 * Indentation is read RELATIVELY — the child indent is whatever the block actually uses, not a
 * hardcoded two spaces. YAML permits any consistent width, and hardcoding it was a false pass:
 * a workflow indented four spaces throughout is ordinary, valid YAML that GitHub reads exactly
 * as written, and the scanner did not see its `pull_request:` trigger at all, so it reported
 * nothing wrong about a job with no guard.
 */
function children(body) {
  const indents = body
    .map((l) => KEY.exec(l))
    .filter(Boolean)
    .map((m) => m[1].length);
  if (!indents.length) return [];
  const own = Math.min(...indents);
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const m = KEY.exec(body[i]);
    if (!m || m[1].length !== own) continue;
    const sub = [];
    for (let j = i + 1; j < body.length; j++) {
      // Any line at or above our own indent — a sibling key, or a list item belonging to the
      // parent — ends this child's body.
      if (/^(\s*)/.exec(body[j])[1].length <= own) break;
      sub.push(body[j]);
    }
    out.push({ name: m[2], inline: m[3].trim(), body: sub });
  }
  return out;
}

/** One named direct child, or undefined. */
const childNamed = (body, name) => children(body).find((c) => c.name === name);

/**
 * Is this `if:` value the guard, and ONLY the guard?
 *
 * Exact match on a normalised form — not a substring test, which is what this was and which is a
 * hole a `!` wide. `if: ${{ !(github.event_name != 'pull_request' || ...draft == false) }}` contains
 * the guard's exact text and means its precise opposite: the job would run only on drafts. `(GUARD)
 * == false` does the same. No amount of YAML parsing catches that, because the string a parser hands
 * back is identical; only comparing the whole expression does.
 *
 * Normalising unwraps `${{ }}` (equivalent and legitimate) and collapses whitespace. A compound
 * condition — the guard AND something else — is deliberately NOT accepted: no job here needs one,
 * and the honest response to the first one that does is a failure that makes someone think about it,
 * not a looser test. Same reason a block scalar (`if: >`) reports unguarded: it is the safe
 * direction, and being told to write the guard on one line costs nothing.
 */
/**
 * An Actions expression reduced to something comparable: `${{ }}` unwrapped, a trailing `#` comment
 * dropped, whitespace collapsed.
 *
 * Shared by BOTH exact-match checks below, deliberately. Each was written first as a substring test
 * and each was a hole: `${{ !(GUARD) }}` contains the guard and means its opposite, and
 * `cancel-in-progress: true  # switch to ${{ ...!= 'refs/heads/main' }} later` contains the safe
 * expression in a COMMENT while the real value is the bug. Comparing whole normalised values is the
 * only thing that closes that, so there is one normaliser rather than two that can drift.
 */
function normaliseExpr(value) {
  return String(value)
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
    .trim()
    .replace(/\s+/g, ' ');
}

function isGuard(value) {
  return normaliseExpr(value) === normaliseExpr(GUARD);
}

/** Does this `cancel-in-progress` value leave `main`'s verdict intact?
 *
 *  Two values do. The branch-aware expression is the usual one, matched EXACTLY for the reason
 *  above. A literal `false` also qualifies, and rejecting it was a blind spot: `false` cancels
 *  NOTHING, so it keeps main's verdict strictly more thoroughly than the expression does.
 *
 *  It is not a hypothetical distinction: a workflow that must never cancel a run in flight (a
 *  publish step that a cancel would leave half-done, say) evaluates the branch-aware expression
 *  TRUE when its ref is never main, so demanding that expression would require the one behaviour
 *  that is actually dangerous there.
 */
function keepsMainVerdict(value) {
  const expr = normaliseExpr(value);
  return expr === normaliseExpr(CANCEL_NOT_MAIN) || expr === 'false';
}

/**
 * Lines at a block's own indent that are neither a `key:` nor a `- item` — structure this scanner
 * does not model.
 *
 * This is the general answer to a specific, repeated failure. Four review rounds on #1188 each
 * found the same class of bug: a construct the scanner did not recognise was silently DROPPED, so
 * a job with no draft guard came back clean. The last was YAML's explicit-key form —
 *
 *     jobs:
 *       ? build
 *       : runs-on: ubuntu-latest
 *
 * — which every parser reads as an ordinary `build:` job and this scanner did not see at all.
 *
 * A real YAML parser would end the whole class, and there is not one available: the root workspace
 * declares no runtime dependencies and the Conventions job runs with no `npm ci` (the same
 * constraint check-all.mjs works under). So the scanner stays a text scanner, and the mitigation is
 * this: anything it cannot classify is REPORTED. A future exotic shape becomes a loud failure
 * telling someone to look, instead of a quiet pass over an unguarded job.
 */
function strayLines(body) {
  const indents = body
    .map((l) => KEY.exec(l))
    .filter(Boolean)
    .map((m) => m[1].length);
  if (!indents.length) return [];
  const own = Math.min(...indents);
  return body.filter((l) => /^[ \t]*/.exec(l)[0].length === own && !KEY.test(l) && !/^[ \t]*-[ \t]/.test(l));
}

/**
 * What one workflow declares, as far as this rule cares.
 *
 * `unreadable` is the important field: it is set when the file is shaped in a way this scanner
 * cannot judge, and the caller turns it into a FAILURE rather than a pass. A hand-rolled scanner
 * that guesses "probably fine" on a shape it does not understand is worse than no check, because
 * the thing it silently clears is a job running the whole suite on every draft.
 *
 * @param {string} yaml the workflow file contents
 * @returns {{pullRequest: boolean, types: string[]|null, jobs: {name: string, guarded: boolean}[], unreadable: string|null}}
 */
export function auditWorkflow(yaml) {
  const lines = significantLines(yaml);
  const on = topLevelBlock(lines, 'on');
  const jobsBlock = topLevelBlock(lines, 'jobs');
  // A workflow may legitimately have no `concurrency` block (release.yml, cancel-merged.yml) —
  // that is "this rule does not apply", not a finding.
  const concurrency = topLevelBlock(lines, 'concurrency');
  const cancelInProgress = concurrency ? (childNamed(concurrency.body, 'cancel-in-progress')?.inline ?? null) : null;

  let pullRequest = false;
  let types = null;
  let unreadable = null;

  if (!on) {
    // GitHub REQUIRES `on:` in every workflow, so a file here without one is a file this scanner
    // failed to read, not a workflow with no triggers. Reporting it is what would have caught the
    // BOM case above on its own, whatever the cause of the miss.
    return { pullRequest: false, types: null, jobs: [], unreadable: 'has no `on:` this check could find' };
  }

  if (on.inline) {
    // `on: [push, pull_request]` or `on: push`. A flow trigger cannot carry `types:`, so a
    // pull_request one CANNOT satisfy this rule and must be rewritten in block form.
    pullRequest = /\bpull_request\b/.test(on.inline);
    if (pullRequest) unreadable = 'writes `on:` in flow form, which cannot carry `types:` — use the block form';
  } else {
    const triggers = children(on.body);
    const stray = strayLines(on.body)[0];
    if (stray) {
      unreadable = `has a line under \`on:\` this check cannot read: \`${stray.trim()}\``;
    } else if (!triggers.length) {
      unreadable = 'has an `on:` block this check could read no trigger from';
    } else {
      const pr = triggers.find((t) => t.name === 'pull_request');
      if (pr) {
        pullRequest = true;
        const t = childNamed(pr.body, 'types');
        if (t) {
          types = listValue(t.inline, t.body);
          if (!types) unreadable = 'declares `types:` in a form this check cannot read';
        }
      }
    }
  }

  // Each job is a direct child of `jobs:`, and its guard is its own `if:`. Read relatively, so a
  // workflow indented four spaces is judged the same as one indented two.
  const jobs = children(jobsBlock?.body ?? []).map((job) => ({
    name: job.name,
    guarded: isGuard(childNamed(job.body, 'if')?.inline ?? ''),
  }));

  // A pull_request workflow whose jobs we could not fully read is the dangerous case: nothing to
  // report means a clean pass. Say so instead.
  if (pullRequest && !unreadable) {
    const stray = strayLines(jobsBlock?.body ?? [])[0];
    if (stray) unreadable = `has a line under \`jobs:\` this check cannot read: \`${stray.trim()}\``;
    else if (!jobs.length)
      unreadable = jobsBlock ? 'has a `jobs:` block this check could read no job from' : 'declares no `jobs:`';
  }

  return { pullRequest, types, jobs, unreadable, cancelInProgress };
}

/**
 * Everything wrong with one workflow, as human-readable lines. Empty means it complies.
 *
 * @param {string} file the workflow's basename
 * @param {string} yaml its contents
 * @returns {string[]}
 */
export function problemsFor(file, yaml) {
  if (EXEMPT[file]) return [];
  const { pullRequest, types, jobs, unreadable, cancelInProgress } = auditWorkflow(yaml);
  // Fail closed FIRST. A shape this scanner cannot judge is reported, never waved through — and
  // this has to precede the `!pullRequest` exit, because "I could not find the trigger" and "there
  // is no trigger" are the same value of `pullRequest` and only one of them is safe to pass.
  if (unreadable) return [unreadable];

  const problems = [];
  // Checked BEFORE the `!pullRequest` exit, deliberately: a push-only workflow cancels `main`'s
  // runs just as thoroughly as a pull_request one, so this rule is about the ref, not the trigger.
  // No `concurrency` block at all means the rule does not apply (release.yml has none).
  if (cancelInProgress !== null && !keepsMainVerdict(cancelInProgress)) {
    problems.push(
      `\`cancel-in-progress: ${cancelInProgress}\` cancels superseded runs on \`main\` too — ` +
        `use \`\${{ ${CANCEL_NOT_MAIN} }}\``,
    );
  }

  if (!pullRequest) return problems; // push / schedule / dispatch only — no draft to skip
  if (!types) problems.push(`declares no \`types:\`, so it takes the default set, which omits \`${READY}\``);
  else if (!types.includes(READY)) problems.push(`\`types:\` omits \`${READY}\``);
  for (const job of jobs) if (!job.guarded) problems.push(`job \`${job.name}\` has no draft guard`);
  return problems;
}

function main() {
  const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
  const failures = [];
  let checked = 0;
  let guarded = 0;
  let branchAware = 0;

  for (const file of files.sort()) {
    const yaml = readFileSync(join(DIR, file), 'utf8');
    for (const p of problemsFor(file, yaml)) failures.push(`${DIR}/${file}: ${p}`);
    if (EXEMPT[file]) continue;
    const audit = auditWorkflow(yaml);
    if (audit.cancelInProgress !== null && keepsMainVerdict(audit.cancelInProgress)) branchAware++;
    if (!audit.pullRequest) continue;
    checked++;
    guarded += audit.jobs.filter((j) => j.guarded).length;
  }

  if (!failures.length) {
    console.log(
      `check-draft-guard: ${checked} pull_request workflow(s), ${guarded} job(s) skip drafts and wake on ${READY}; ` +
        `${branchAware} keep \`main\`'s verdict (${Object.keys(EXEMPT).length} exempt with a reason).`,
    );
    return;
  }

  console.error(
    'check-draft-guard: a workflow trigger is wrong — a draft would run, a ready PR would not, or `main` would be cancelled.\n',
  );
  for (const f of failures) console.error(`  ${f}`);
  console.error(`
Every job that can be triggered by a pull_request needs BOTH:

  1. the guard, so a draft runs nothing:
       if: ${GUARD}

  2. \`${READY}\` in the trigger's types, so marking it ready starts the run. It is NOT in
     GitHub's default set, so the guard WITHOUT this leaves a PR with no checks at all:
       pull_request:
         types: [opened, synchronize, reopened, ${READY}]

And a \`concurrency\` block must not cancel on \`main\`:

       concurrency:
         cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}

     Cancelling is right on a branch and wrong on \`main\`, where a burst of merges throws away the
     verification of everything it lands on — and a cancelled run looks exactly like a failed one
     (#1196).

Or add the workflow to EXEMPT in this script, WITH A REASON about the event it handles.

The pool is self-hosted and has no fallback, and our own flow opens every PR as a draft and
pushes review commits to it — three throwaway suites per issue. That is why this check exists (#1188).`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
