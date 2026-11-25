// Fails the build when a file states an agent-tool count the descriptors do not support.
//
// THE BUG (#1099). "How many agent tools do we ship?" was typed out by hand in four places —
// the project notes, the bench write-up, the KimtAI handbook and the bench harness — and no
// two of them agreed. All four were also wrong: the descriptors held a fifth, larger number.
// Nothing derived it and nothing checked it, so every new app moved the truth and none of the
// four sentences: Voice Studio (#1090) added an app with four tools and all four copies stayed
// exactly where they were. One of the four is a docs booklet, so the wrong figure was
// published to the docs site.
//
// (Note that this file states none of those numbers, and is not allowlisted below. A guard
// whose own prose is exempt from it is not a guard.)
//
// THE FIX THIS GUARDS. The count has one home now — the descriptors — read by
// scripts/agent-tool-count.mjs. The KimtAI handbook states it as a `{{agentToolCount}}` token
// that the docs build substitutes (www-docs/scripts/build-content.mjs → DOC_TOKENS), so the
// published page derives it. The three files the docs build does not process state the RULE
// instead of a figure, because a fact restated where it cannot be derived is a copy waiting
// to go stale.
//
// WHAT IT CHECKS. Any file that spells the count out — "<n> tools across <m> apps", "<n> agent
// tools" — must spell out the real one. It VERIFIES rather than forbids, because unlike a
// size cap (see check-doc-limits.mjs, which cannot tell a wrong number from prose) this
// phrasing carries both figures, so a wrong one is decidable. A sentence that uses the token,
// or names no figure at all, has nothing to check and passes.
//
// It is dependency-free (no npm ci — it runs in the `conventions` CI job).
//
//   node scripts/check-agent-tool-count.mjs

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, countAgentTools } from './agent-tool-count.mjs';

/** The file types a count is stated in: docs, and the source comments that describe them. */
export const SCANNED = /\.(md|mjs|ts|js|vue)$/;

/**
 * The one file where a wrong count is the data rather than a claim: this guard's own tests,
 * which must contain the stale figures in order to prove they are caught. Same shape, and the
 * same reasoning, as check-emoji.mjs's allowlist for the support widget's emoji picker.
 *
 * Nothing else is exempt — including this file and scripts/agent-tool-count.mjs, which
 * deliberately describe the drift without spelling any of the stale numbers out.
 */
export const ALLOWED = new Set(['scripts/check-agent-tool-count.test.mjs']);

/**
 * Line-leading markers that continue a wrapped sentence rather than interrupting it: a
 * Markdown blockquote (`>`), a line comment (`//`) and a JSDoc/list continuation (`*`).
 */
const CONTINUATION = /^([ \t]*)(?:(?:>|\/\/|\*)[ \t]*)+/gm;

/**
 * Blank out the markers that wrap a sentence across lines, so a phrase split by one is still
 * one phrase. LENGTH-PRESERVING (marker characters become spaces), so match indices — and
 * therefore the reported line numbers — stay those of the real file.
 *
 * This is not a nicety: the project notes stated the count inside a blockquote and wrapped it
 * mid-phrase, between the number and the word "tools", so a matcher that did not do this would
 * read straight past the very sentence this guard exists for. That exact case is a test.
 *
 * @param {string} text
 * @returns {string}
 */
export function flattenContinuations(text) {
  return text.replace(CONTINUATION, (match) => ' '.repeat(match.length));
}

/**
 * The phrasings that state a count, and which figures each one carries.
 *
 * `\s+` rather than a literal space throughout, because prose wraps.
 */
const PHRASES = [
  // "<n> tools across <m> apps", with or without "agent" — the shape all four copies used, and
  // the only one that carries both figures.
  { re: /\b(\d+)\s+(?:agent\s+)?tools\s+across\s+(\d+)\s+apps\b/g, carries: ['tools', 'apps'] },
  // "<n> agent tools" on its own.
  { re: /\b(\d+)\s+agent\s+tools\b(?!\s+across)/g, carries: ['tools'] },
  // "all <n> tools" / "the <n> tools". The determiner is what makes a bare "tools" a claim about
  // the whole suite rather than about one app's utilities, and it is the shape the project notes
  // used, so dropping "across" from that sentence must not become a way around the guard. An
  // UNqualified "<n> tools" is deliberately still not matched: DevTools is a bag of developer
  // utilities the docs also call tools, and a guard that fires on an unrelated sentence teaches
  // people to work around it. The two patterns are disjoint — "all <n> agent tools" matches only
  // the one above — so no phrasing is reported twice.
  { re: /\b(?:all|the|its|these)\s+(\d+)\s+tools\b(?!\s+across)/g, carries: ['tools'] },
];

/**
 * Every stated count in `text` that disagrees with the truth.
 *
 * @param {string} text the file contents
 * @param {{ tools: number, apps: number }} truth the derived counts
 * @returns {{ line: number, stated: string, what: string, said: number, actual: number }[]}
 */
export function wrongCounts(text, truth) {
  const flat = flattenContinuations(text);
  const failures = [];
  for (const { re, carries } of PHRASES) {
    for (const match of flat.matchAll(re)) {
      carries.forEach((what, i) => {
        const said = Number(match[i + 1]);
        if (said !== truth[what]) {
          failures.push({
            line: flat.slice(0, match.index).split('\n').length,
            stated: match[0].replace(/\s+/g, ' '),
            what,
            said,
            actual: truth[what],
          });
        }
      });
    }
  }
  return failures.sort((a, b) => a.line - b.line);
}

// Only when run as a CLI — importing this file (the test does) must not process.exit.
function main() {
  const { tools, apps } = countAgentTools(ROOT);

  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => SCANNED.test(f) && !ALLOWED.has(f));

  const failures = [];
  for (const file of files) {
    for (const hit of wrongCounts(readFileSync(join(ROOT, file), 'utf8'), { tools, apps })) {
      failures.push({ file, ...hit });
    }
  }

  if (failures.length) {
    console.error('check-agent-tool-count: a file states an agent-tool count the descriptors do not support.\n');
    for (const { file, line, stated, what, said, actual } of failures) {
      console.error(`  ${file}:${line} — "${stated}" says ${said} ${what}; the descriptors declare ${actual}`);
    }
    console.error(
      `\nThe count is derived from extension/src/apps/*/index.ts — see scripts/agent-tool-count.mjs.\n` +
        `Pages under www-docs/authored/ and docs/extension/apps/ are substituted at build time: write\n` +
        `{{agentToolCount}} and {{agentToolAppCount}} there. Anywhere else, prefer stating the rule —\n` +
        `every app declares tools and all of them are dormant — over a figure that expires (#1099).`,
    );
    process.exit(1);
  }

  console.log(`check-agent-tool-count: ${files.length} files, no stale count (${tools} tools across ${apps} apps).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
