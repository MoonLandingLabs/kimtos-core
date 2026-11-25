// Fails the build when a colour emoji is committed anywhere in the tree.
//
// CLAUDE.md bans emoji "anywhere -- not in code, code comments, commit messages, issues,
// issue comments, PR titles or PR bodies", and notes that the keyboard glyphs already in
// the codebase (`⌘`, `▸`) are not emoji and are fine. That rule lived only in prose, so
// nothing stopped the next commit from adding another one, and the tree had accumulated
// several (#48).
//
// WHERE THE LINE IS. "Emoji" is not "non-ASCII". Unicode's Extended_Pictographic property
// is the tempting test and it is WRONG here: it matches `©`, so every copyright notice in
// the README, the site footer and THIRD-PARTY-NOTICES would fail. The honest test is
// whether the character RENDERS AS A COLOUR EMOJI:
//
//   Emoji_Presentation=Yes            colour by default        -> banned
//   pictographic + U+FE0F             colour via the selector  -> banned
//   text presentation  © ™ ⌘ ▸ ★ ✕ ✓ ⬇ ♪ ←   glyphs, not emoji -> allowed
//
// The allowed ones are load-bearing UI affordances with no icon asset behind them; banning
// them would regress the UI to satisfy a rule that was never about them.
//
// Note there are no banned characters written out above, and this file is NOT allowlisted.
// A checker that has to exempt itself is one edit away from exempting anything else.
//
// This is deliberately NOT an ESLint rule. ESLint sees JS/TS only, and the violations were
// just as often in Markdown (a workspace README), a Vue template (a landing-page component)
// and a docs booklet. A rule that cannot see three of the four places the bug occurs is not
// enforcement.
//
//   node scripts/check-emoji.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Emoji_Presentation covers the default-colour characters; the second alternative catches
// a text-presentation pictograph forced to colour with the variation selector (U+FE0F).
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/gu;

// Files exempt from the rule. None today: a checker that exempts files is one edit away from
// exempting anything.
const ALLOWED = new Set([]);

const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|onnx|bin|woff2?|ttf|zip|gz|pdf|traineddata)$/i;

const files = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n');
const failures = [];

for (const file of files) {
  if (ALLOWED.has(file) || BINARY.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable/binary -- say nothing rather than guess
  }
  text.split('\n').forEach((line, i) => {
    const found = [...new Set(line.match(EMOJI) ?? [])];
    if (found.length) failures.push({ file, line: i + 1, found, text: line.trim().slice(0, 72) });
  });
}

if (failures.length) {
  console.error('check-emoji: colour emoji are not allowed in this repo (CLAUDE.md).\n');
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  ${f.found.join(' ')}`);
    console.error(`    ${f.text}\n`);
  }
  console.error('Write the word instead, or use a plain Yes/No/- in a table. A glyph that is');
  console.error('doing a real job (a badge, a status) needs a real affordance -- text or an SVG,');
  console.error('not a pictograph. Typographic marks (© ⌘ ▸ ★ ✕ ✓ ⬇) are not emoji and are fine.');
  process.exit(1);
}

console.log(`check-emoji: ${files.length} tracked files, no colour emoji.`);
