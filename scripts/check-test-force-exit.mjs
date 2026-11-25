// Fails the build when a test command asks node:test to force-exit.
//
// `--test-force-exit` tells the runner to kill the process the moment it believes the
// queue is drained. It does not know that: a suite whose tests register asynchronously
// -- the www component tests `await import` Vue and mount into
// happy-dom from an `--import` harness -- can still be registering when the flag fires,
// and whatever has not registered yet is dropped. Dropped, not failed: the run reports
// a SMALLER total with `fail 0`, so CI is green over tests that never executed.
//
// That is not theoretical. On one unchanged tree, ten runs of `npm run test -w
// @kimtos/www` reported 168, 153 and 143 tests (30, 28 and 26 suites) and every one of
// them passed (#1011). A regression in a dropped file ships behind a green gate, which
// is the exact failure mode every other guard in this job exists to stop.
//
// The fix is never the flag. If a suite genuinely hangs, something is holding the event
// loop open -- a timer, a socket, a watcher -- and the harness must close it in teardown.
// That is what the two harnesses that carried this flag now do: each closes the happy-dom
// window it opened in a root `after`, so the process exits because nothing is left running
// rather than because it was killed.
//
// SCOPE. Only files that can actually start a test run are read: package.json scripts,
// the Makefile, and the CI workflows and composite actions. Prose is deliberately out of scope, so a
// CHANGELOG entry or a doc explaining the ban is not itself a violation -- and this
// checker's own source is out of scope too, so it needs no allowlist. A checker that has
// to exempt itself is one edit away from exempting anything else (check-emoji.mjs makes
// the same argument). The one thing to remember: the workflow step that runs this is in
// scope, so name that step in words rather than quoting the flag.
//
//   node scripts/check-test-force-exit.mjs

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The banned flag. The leading `--` matters: it keeps this checker's own filename, which
 *  the workflow's `run:` line names, from matching. */
export const FLAG = '--test-force-exit';

/** Files that can configure how tests are run. Exported so the test can assert the scope
 *  has not quietly narrowed to nothing -- a guard that scans no files still prints
 *  success (#213).
 *  @param {string} file a repo-relative path from `git ls-files`
 *  @returns {boolean} */
export function configuresATestRun(file) {
  if (file === 'Makefile' || file.endsWith('/Makefile')) return true;
  if (file === 'package.json' || file.endsWith('/package.json')) return true;
  // Workflows AND composite actions: both hold `run:` steps, so both can start a test run.
  // `.github/dependabot.yml` and the issue templates cannot, and stay out.
  return /^\.github\/(workflows|actions)\/.+\.ya?ml$/.test(file);
}

/** Every line of every in-scope file that passes the banned flag.
 *  @param {string[]} files repo-relative paths
 *  @param {(file: string) => string} read reads a file's text
 *  @returns {{ file: string, line: number, text: string }[]} */
export function forceExitUses(files, read) {
  const found = [];
  for (const file of files.filter(configuresATestRun)) {
    read(file)
      .split('\n')
      .forEach((line, i) => {
        if (line.includes(FLAG)) found.push({ file, line: i + 1, text: line.trim().slice(0, 96) });
      });
  }
  return found;
}

function main() {
  const files = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n');
  const scanned = files.filter(configuresATestRun);
  // `git ls-files` reads the index, so it still lists a file deleted from the working tree.
  // Reading it would crash the guard on a developer's dirty checkout, which is not a
  // violation -- a file that is not there configures nothing.
  const uses = forceExitUses(scanned, (file) => (existsSync(file) ? readFileSync(file, 'utf8') : ''));

  if (uses.length) {
    console.error(`check-test-force-exit: ${FLAG} silently drops whole test files (#1011).\n`);
    for (const use of uses) {
      console.error(`  ${use.file}:${use.line}`);
      console.error(`    ${use.text}\n`);
    }
    console.error('The runner exits before asynchronously-registered suites have registered, so the run');
    console.error('reports a smaller total with fail 0 and CI goes green over tests that never ran.');
    console.error('Remove the flag. If the suite then hangs, find what is holding the event loop open');
    console.error('and close it in the harness teardown -- that is the bug the flag was hiding.');
    process.exit(1);
  }

  console.log(`check-test-force-exit: ${scanned.length} test-run configs, none force-exits.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
