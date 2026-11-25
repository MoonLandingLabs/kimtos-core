// Keeps the Release dry run runnable.
//
// The documented procedure (docs/extension/releasing.md) is: bump the version, `make
// release-prepare` on a branch and merge that PR, DRY-RUN the Release workflow, then `make
// release-tag` — which pushes the tag and submits to the Chrome Web Store. The dry run exists for
// exactly one reason: so that tag is not the first time anyone finds out whether the workflow works.
//
// That order was impossible for as long as it was written down. A step verified that CHANGELOG.md
// had a `## vX.Y.Z` section — and writing that section is a different step of the release, so the
// dry run failed every single time, on the one check that could not yet pass (#1201). Both halves
// were individually right; nobody had run the documented order end to end.
//
// THE RULE: a step that NAMES `CHANGELOG.md` must be skipped when DRY_RUN is set. That file's
// release section only exists once the prepare PR is merged, and a dry run is meant to be runnable
// at any point — so a dry run that depends on it is green only when the release it was supposed to
// rehearse has already happened. Decorative, in other words.
//
// WHAT THIS CANNOT SEE, stated plainly because a guard that is trusted for more than it does is
// worse than one nobody trusts: it matches the literal filename inside a step's own text. A step
// that reached the file through a variable defined elsewhere would pass. So the rule is written as
// "name it directly, or gate it" rather than as a claim about every possible dependency — closing
// that hole properly needs a real YAML parser and expression evaluation, which this job cannot have
// (see below). Naming the file is how every step in this workflow has ever referred to it.
//
// Dependency-free line scanning rather than a YAML parser: this runs in the `conventions` CI job,
// which deliberately has no `npm ci`.
//
//   node scripts/check-release-dry-run.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(HERE, '..', '.github', 'workflows', 'release.yml');

/** The artifact only `make release-prepare` writes. A dry run may happen before it exists. */
export const RELEASE_ONLY_ARTIFACT = 'CHANGELOG.md';

/** The env var every dry-run condition keys off. */
export const DRY_RUN_ENV = 'DRY_RUN';

/**
 * Split every `steps:` block in the file into one string per step.
 *
 * A step starts at a `- ` item at the steps indent; everything up to the next one belongs to it,
 * which is what lets a step's `if:` and its `run:` be examined together.
 *
 * EVERY block, not the first. Stopping at the first one was fine while `release.yml` had a single
 * job, and would have silently stopped checking the moment a second was added — the steps would not
 * have been checked and found compliant, they would have been invisible. A guard that quietly
 * narrows its own scope is worse than one that was never written.
 */
export function splitSteps(yaml) {
  const lines = yaml.split('\n');
  const steps = [];
  const indentOf = (line) => (line.match(/^\s*/) ?? [''])[0].length;
  let current = null;
  let stepsIndent = -1; // -1 while outside a steps block
  let itemIndent = -1; // the column the block's `- ` items sit at, learned from the first one

  const flush = () => {
    if (current) steps.push(current.join('\n'));
    current = null;
  };

  for (const line of lines) {
    if (/^\s*steps:\s*$/.test(line)) {
      flush();
      stepsIndent = indentOf(line);
      itemIndent = -1;
      continue;
    }
    if (stepsIndent < 0) continue;

    // The block ends at a YAML KEY no deeper than `steps:` itself — the next job, or a top-level
    // key. Both halves of that test matter. Ending on "any shallow line" instead meant a `run: |`
    // body ended it: a heredoc writes its content at column 0, so the first such line closed the
    // block and every step after it became invisible, taking any violation with it. Requiring a
    // `key:` shape keeps free-form script text inside the step where it belongs.
    if (indentOf(line) <= stepsIndent && /^\s*[\w-]+\s*:/.test(line)) {
      flush();
      stepsIndent = -1;
      itemIndent = -1;
      continue;
    }

    // A `- ` item at EXACTLY the block's item column starts a new step. Not "at or above": a
    // `run:` body is free-form text and may contain list items of its own — a Markdown checklist
    // written into a heredoc sits at column 0 — and treating those as boundaries both truncated the
    // real step and invented a bogus one out of the fragment.
    if (/^\s*-\s/.test(line) && (itemIndent < 0 || indentOf(line) === itemIndent)) {
      if (itemIndent < 0) itemIndent = indentOf(line);
      flush();
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  flush();
  return steps;
}

/**
 * The step's `if:` expression, with any continuation lines folded onto one.
 *
 * YAML lets a long condition wrap, and a line-by-line match would read a wrapped condition as
 * absent — reporting a step that IS correctly gated, which is the kind of false alarm that gets a
 * guard deleted rather than fixed.
 */
export function ifExpression(step) {
  const lines = step.split('\n');
  const indentOf = (line) => (line.match(/^\s*/) ?? [''])[0].length;
  // A step's properties sit two columns in from its `- `. Requiring that exact indent is what
  // separates the step's OWN `if:` from a line that merely looks like one — a `run:` body is
  // free-form text, and a heredoc writing an example workflow contains `if: env.DRY_RUN != 'true'`
  // as data. Matching that made an unconditional step read as gated, so the guard skipped the very
  // thing it exists to catch.
  const propIndent = indentOf(lines[0]) + 2;

  const at = lines.findIndex((l) => indentOf(l) === propIndent && /^\s*if:/.test(l));
  if (at === -1) return '';
  const indent = indentOf(lines[at]);

  const parts = [lines[at].replace(/^\s*if:\s*/, '')];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) break;
    // A key at the same indent (`run:`, `name:`, `uses:`) ends the expression.
    if ((line.match(/^\s*/) ?? [''])[0].length <= indent && /^\s*[\w-]+:/.test(line)) break;
    parts.push(line.trim());
  }
  return parts.join(' ');
}

/** Is this step skipped when DRY_RUN is set? */
export function skippedOnDryRun(step) {
  // Matches `env.DRY_RUN != 'true'` in either quote style, inside `${{ }}` or bare.
  return new RegExp(`env\\.${DRY_RUN_ENV}\\s*!=\\s*['"]true['"]`).test(ifExpression(step));
}

/** A short label for a step, for the error message. */
const nameOf = (step) => step.match(/name:\s*(.+)/)?.[1]?.trim() ?? step.split('\n')[0].trim();

/**
 * Steps that would run on a dry run but read something only `make release-prepare` writes.
 *
 * Comments are stripped first, so the prose explaining WHY a step is skipped does not itself count
 * as reading the file — otherwise documenting the rule would violate it.
 */
export function offendingSteps(yaml) {
  return splitSteps(yaml)
    .filter((step) => {
      const code = step.replace(/^\s*#.*$/gm, '');
      return code.includes(RELEASE_ONLY_ARTIFACT) && !skippedOnDryRun(step);
    })
    .map(nameOf);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const yaml = readFileSync(WORKFLOW, 'utf8');
  const problems = [];

  // A renamed env would silently disable every dry-run condition in the file, including the ones
  // that keep the Chrome Web Store submission from firing on a rehearsal.
  if (!new RegExp(`^\\s*${DRY_RUN_ENV}:`, 'm').test(yaml))
    problems.push(
      `  release.yml no longer defines a \`${DRY_RUN_ENV}\` env.\n` +
        `      Every dry-run condition keys off it — without it a dry run would submit to the store.`,
    );

  for (const step of offendingSteps(yaml))
    problems.push(
      `  "${step}" reads ${RELEASE_ONLY_ARTIFACT} but is not skipped on a dry run.\n` +
        `      That section is written by \`make release-prepare\`, and a dry run is meant to be\n` +
        `      runnable before that PR is merged — so this step can never pass on one, and the dry\n` +
        `      run is what keeps a tag from being the first test of the workflow.\n` +
        `      Add: if: env.${DRY_RUN_ENV} != 'true'`,
    );

  if (problems.length) {
    console.error('check-release-dry-run: the Release dry run cannot pass as written.\n');
    console.error(problems.join('\n\n'));
    console.error('\nSee docs/extension/releasing.md and #1201.');
    process.exit(1);
  }

  const steps = splitSteps(yaml).length;
  console.log(`check-release-dry-run: ${steps} release steps, none blocks the dry run on release-only output.`);
}
