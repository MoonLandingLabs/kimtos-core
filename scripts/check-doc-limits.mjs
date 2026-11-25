// Fails the build when a Markdown doc types out a limit the extension declares.
//
// THE BUG. The size and length caps the apps enforce (how big a PDF may be, how big a
// wallpaper may be, how long a note page may be) were private consts beside the code that
// enforced them, and the numbers were then re-typed into the guides and the app handbooks.
// Raise a cap and every one of those sentences is confidently wrong, with nothing failing —
// the same class as a cap that shipped stale in the docs and the
// store link that shipped as "not available" (#1009), each of which took a human noticing
// (#1043).
//
// THE FIX THIS GUARDS. The value is declared once, in `extension/src/lib/limits.ts`, and the
// docs build substitutes it into the Markdown as a `{{token}}` (www-docs/scripts/build-content.mjs
// → DOC_TOKENS). That mechanism already fails the build on an unknown token and on a declared
// token no page uses. What it cannot see is a page that never used a token at all — a new
// sentence with the number typed straight in, which is exactly how every existing copy got
// there. This check closes that door.
//
// WHAT IT CHECKS. No tracked Markdown doc may contain the literal value of a declared limit,
// in any of the spellings a writer would naturally reach for (`50 MB`, `50MB`, `50,000`,
// `50000`). Matching is word-bounded, so "about 250 MB" is not a hit for "50 MB".
//
// WHAT IT DOES NOT CATCH, deliberately: a number typed WRONG (a page claiming 60 MB when the
// cap is 50). Nothing can distinguish that from ordinary prose. It catches the realistic path —
// a writer reads today's value off the product and types it — and after that the token pass
// keeps the page correct forever.
//
// It is dependency-free (no npm ci — it runs in the `conventions` CI job), so it reads the
// limits module as text rather than importing it.
//
//   node scripts/check-doc-limits.mjs

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const LIMITS_FILE = 'extension/src/lib/limits.ts';

/**
 * Every limit this guard polices, and the docs token that replaces it.
 *
 * `kind` says how a writer would spell the value in prose, which is what we search for:
 *   - `bytes` — stated as whole megabytes (`50 MB`, `50MB`)
 *   - `count` — stated as a plain number (`50,000`, `50000`)
 *
 * A constant in the limits module with no entry here is a limit nobody is policing, so
 * `missingEntries` below fails on it rather than letting it be silently unguarded.
 */
export const POLICED = [
  { name: 'PDF_MAX_BYTES', token: 'pdfMaxSize', kind: 'bytes' },
  { name: 'WALLPAPER_MAX_BYTES', token: 'wallpaperMaxSize', kind: 'bytes' },
  { name: 'NOTE_MAX_CHARS', token: 'noteMaxChars', kind: 'count' },
];

/**
 * The numeric constants a limits module exports, as `{ NAME: value }`.
 *
 * Values are products of plain integers (`50 * 1024 * 1024`, `50_000`) and are multiplied
 * out arithmetically — never eval'd. A declaration in any other shape is skipped rather
 * than guessed at, and `missingEntries` then reports it as unreadable.
 *
 * @param {string} source the contents of limits.ts
 * @returns {Record<string, number>}
 */
export function declaredLimits(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const out = {};
  for (const [, name, expr] of code.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*([\d_\s*]+);/g)) {
    const value = expr.split('*').reduce((total, part) => total * Number(part.replace(/_/g, '').trim()), 1);
    if (Number.isFinite(value) && value > 0) out[name] = value;
  }
  return out;
}

/**
 * The spellings of `value` a writer would plausibly type, as anchored regexes.
 *
 * @param {number} value
 * @param {'bytes'|'count'} kind
 * @returns {{ text: string, re: RegExp }[]}
 */
export function spellings(value, kind) {
  const forms =
    kind === 'bytes'
      ? [`${Number((value / (1024 * 1024)).toFixed(1))} MB`, `${Number((value / (1024 * 1024)).toFixed(1))}MB`]
      : [value.toString().replace(/\B(?=(\d{3})+$)/g, ','), value.toString()];
  // \b on both ends: "250 MB" must not match "50 MB", and "150000" must not match "50000".
  return forms.map((text) => ({ text, re: new RegExp(`\\b${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) }));
}

/**
 * Every hand-typed limit in `text`.
 *
 * @param {string} text the Markdown source
 * @param {Record<string, number>} limits the declared limits, from `declaredLimits`
 * @returns {{ line: number, spelling: string, name: string, token: string }[]}
 */
export function handTypedLimits(text, limits) {
  const hits = [];
  const lines = text.split('\n');
  for (const { name, token, kind } of POLICED) {
    if (!(name in limits)) continue;
    for (const { text: spelling, re } of spellings(limits[name], kind)) {
      lines.forEach((line, i) => {
        if (re.test(line)) hits.push({ line: i + 1, spelling, name, token });
      });
    }
  }
  return hits;
}

/**
 * The POLICED entries a limits module does not actually declare, and the constants it
 * declares that POLICED does not cover. Either direction means the guard and the source
 * have drifted apart, and a guard that quietly polices nothing is worse than none.
 *
 * @param {Record<string, number>} limits
 * @returns {{ unknown: string[], unpoliced: string[] }}
 */
export function missingEntries(limits) {
  const policed = new Set(POLICED.map((p) => p.name));
  return {
    unknown: POLICED.map((p) => p.name).filter((name) => !(name in limits)),
    unpoliced: Object.keys(limits).filter((name) => !policed.has(name)),
  };
}

// Only when run as a CLI — importing this file (the test does) must not process.exit.
function main() {
  const limits = declaredLimits(readFileSync(join(ROOT, LIMITS_FILE), 'utf8'));
  const { unknown, unpoliced } = missingEntries(limits);
  if (unknown.length || unpoliced.length) {
    console.error(`check-doc-limits: this check and ${LIMITS_FILE} disagree about what exists.\n`);
    for (const name of unknown) console.error(`  ${name} — policed here, but not declared (renamed? removed?)`);
    for (const name of unpoliced) console.error(`  ${name} — declared, but nothing stops the docs re-typing it`);
    console.error('\nUpdate POLICED in scripts/check-doc-limits.mjs so every declared limit has a docs token.');
    process.exit(1);
  }

  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => f.endsWith('.md'));

  const failures = [];
  for (const file of files) {
    for (const hit of handTypedLimits(readFileSync(join(ROOT, file), 'utf8'), limits)) {
      failures.push({ file, ...hit });
    }
  }

  if (failures.length) {
    console.error('check-doc-limits: a doc states a limit the extension already declares.\n');
    for (const { file, line, spelling, name, token } of failures) {
      console.error(`  ${file}:${line} — "${spelling}" is ${name}; write {{${token}}}`);
    }
    console.error(
      `\nThese caps are declared once, in ${LIMITS_FILE}. A doc that types the number is a second\n` +
        `copy that goes stale the moment the cap changes, with nothing failing (#1043). Pages under\n` +
        `www-docs/authored/ and docs/extension/apps/ are substituted at build time — use the token.\n` +
        `Anywhere else, name the constant instead of quoting its value.`,
    );
    process.exit(1);
  }

  console.log(`check-doc-limits: ${files.length} docs, no hand-typed limit (${POLICED.length} policed).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
