#!/usr/bin/env node
// Runs every guard the Conventions CI job runs, in the same order.
//
// The list is NOT restated here. It is read out of `.github/workflows/test.yml`,
// because a second copy of the list is exactly the drift this repo keeps paying
// for: the `issue-workflow` gate table listed no test command at all until #950,
// and three colour emoji reached `main` because the local gate people actually
// ran did not include `check-emoji.mjs` while CI's did. A convenience script that
// duplicated the list would have gone stale the first time a guard was added.
//
// So this parses the workflow and executes what it finds. Add a guard to the
// Conventions job and it runs here on the next invocation, with no edit.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = join(repoRoot, '.github/workflows/test.yml');

/**
 * Extract the `run:` commands of one job from a GitHub Actions workflow.
 *
 * Deliberately a small line scanner rather than a YAML dependency: the root
 * workspace has no runtime deps, and the Conventions job itself runs with no
 * `npm ci` for the same reason.
 *
 * @param {string} yaml the workflow file contents
 * @param {string} jobId the job key, e.g. `conventions`
 * @returns {string[]} every command the job runs, in order
 */
export function runCommands(yaml, jobId) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${jobId}:`);
  if (start === -1) throw new Error(`no job "${jobId}" in ${workflow}`);

  const commands = [];
  for (const line of lines.slice(start + 1)) {
    // A new top-level job key ends this one.
    if (/^ {2}\S/.test(line)) break;
    const match = /^\s*(?:- )?run: (.+)$/.exec(line);
    if (match) commands.push(match[1].trim());
  }
  return commands;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commands = runCommands(readFileSync(workflow, 'utf8'), 'conventions');
  const failed = [];

  for (const command of commands) {
    const [bin, ...args] = command.split(' ');
    try {
      execFileSync(bin, args, { cwd: repoRoot, stdio: 'inherit' });
    } catch {
      failed.push(command);
    }
  }

  if (failed.length) {
    console.error(`\ncheck-all: ${failed.length} of ${commands.length} guards failed:`);
    for (const command of failed) console.error(`  ${command}`);
    process.exit(1);
  }
  console.log(`\ncheck-all: ${commands.length} guards passed.`);
}
