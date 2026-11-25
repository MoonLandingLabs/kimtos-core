// Fails the build when a `var(--x)` references a custom property its workspace never
// defines and gives no fallback.
//
// The class behind #521 (#535): a removed admin page used
// `var(--text-secondary)` and `var(--hairline)` — tokens the EXTENSION's theme defines
// but the admin theme does not. A `var()` whose property is undefined and has no
// fallback is invalid at computed-value time, so the whole declaration is silently
// dropped: no error, no wrong value, just a missing border or an inherited colour.
// It spread by copy-paste precisely because nothing failed. The extension has
// stylelint; www has no CSS linting.
//
// WHERE THE LINE IS. The check is per WORKSPACE: a token defined in the extension does
// not satisfy a use in www — that cross-workspace assumption IS the bug.
// Within a workspace, a definition anywhere counts (`:root` in main.css, a component's
// scoped block, an inline style, a JS `setProperty`/style-object), because that is
// where the cascade can genuinely supply it. `var(--x, fallback)` always passes — the
// fallback is the author saying "this may be absent", and that is valid CSS.
//
// This is deliberately a dependency-free script, not a stylelint plugin: the uses live
// in .vue <style> blocks, .vue inline styles and .css alike, and the Conventions job
// runs with no npm install and no path filter — a PR cannot dodge it by touching a
// single workspace.
//
//   node scripts/check-css-vars.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Workspaces with no CSS linting of their own. The extension is covered by stylelint.
const WORKSPACES = ['www'];

// Tokens defined OUTSIDE a workspace's own source — injected at runtime by a library
// the scanner cannot see. Add sparingly, and name the definer.
const EXTERNAL = new Set([]);

/** CSS/Vue text with comments removed, so a commented-out var() is not a violation. */
export function stripComments(text) {
  // Loop until stable so a comment revealed by removing an outer one can't survive a single
  // pass (js/incomplete-multi-character-sanitization).
  let out = text;
  let prev;
  do {
    prev = out;
    out = out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  } while (out !== prev);
  return out;
}

/** Every custom property the text DEFINES: `--x: value` declarations (a style block or
 *  an inline style attr), `'--x':` style-object keys, and `setProperty('--x', ...)`. */
export function definedTokens(text) {
  const out = new Set();
  // `--x: value` in a style block or inline style, AND `'--x':` as a style-object key
  // (Vue's `:style="{ '--x': v }"`) — the optional closing quote before the colon is
  // what the object-key form adds. Generous on purpose: an over-matched definition can
  // only make the checker more permissive, never fail a valid use.
  for (const m of text.matchAll(/(?:^|[{;,\s"'`(])(--[A-Za-z0-9_-]+)['"`]?\s*:/gm)) out.add(m[1]);
  for (const m of text.matchAll(/setProperty\(\s*['"`](--[A-Za-z0-9_-]+)['"`]/g)) out.add(m[1]);
  return out;
}

/** Every `var(--x)` use WITHOUT a fallback, with its 1-based line number.
 *  `var(--x, anything)` has a comma before the closing paren and never matches. */
export function fallbackless(text) {
  const out = [];
  for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)) {
    out.push({ token: m[1], line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

function files(workspace) {
  return execSync(`git ls-files -- '${workspace}'`, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function main() {
  const failures = [];
  for (const ws of WORKSPACES) {
    const all = files(ws);
    // Definitions can live in styles OR in script (style objects, setProperty).
    const defSources = all.filter((f) => /\.(vue|css|ts|js|mjs)$/.test(f));
    // Uses that can silently drop a declaration live in stylesheets and components.
    const useSources = all.filter((f) => /\.(vue|css)$/.test(f));

    const defined = new Set();
    for (const f of defSources) {
      for (const t of definedTokens(stripComments(readFileSync(f, 'utf8')))) defined.add(t);
    }
    for (const f of useSources) {
      const text = stripComments(readFileSync(f, 'utf8'));
      for (const { token, line } of fallbackless(text)) {
        if (!defined.has(token) && !EXTERNAL.has(token)) failures.push({ file: f, line, token });
      }
    }
  }

  if (failures.length) {
    console.error('Undefined CSS custom properties used without a fallback:\n');
    for (const { file, line, token } of failures) {
      console.error(`  ${file}:${line}  var(${token}) — never defined in this workspace`);
    }
    console.error(
      `\n${failures.length} violation(s). Define the token in the workspace theme, use one it does` +
        `\ndefine, or give an explicit fallback: var(${failures[0].token}, <value>). A var() with no` +
        '\ndefinition and no fallback silently drops the whole declaration (#521).',
    );
    process.exit(1);
  }
  console.log(`check-css-vars: every var(--x) in ${WORKSPACES.join(' + ')} resolves. OK`);
}

// Import-safe for the tests; run only as a script.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
