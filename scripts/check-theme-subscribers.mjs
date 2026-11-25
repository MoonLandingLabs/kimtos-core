// A surface that reads the Appearance setting must SUBSCRIBE to it, or say why it does not have to.
//
// The theme is not a fact you can cache. The user changes it in Settings on the new tab, and every
// other surface of ours that is on screen at that moment has to retint — the write reaches them
// already, because `store` adopts cross-context writes through `chrome.storage.onChanged`. Only the
// DOM attribute has to be re-applied.
//
// Three surfaces render our palette, and two of them applied it once at startup and never again, so
// changing Appearance left them on the palette they booted with (#1174). The side panel is the one
// that cost something: it is pinned beside a tab and stays open for days.
//
// One shared helper stops the three current surfaces disagreeing; it does not stop a fourth surface
// reading the store directly and never subscribing. This does.
//
//   node scripts/check-theme-subscribers.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'extension/src';

// Reading either of these means "which palette should I be painting, RIGHT NOW" — the raw setting,
// or the resolved light/dark answer that folds in the OS preference in System mode.
export const READS = /\bresolvedTheme\s*\(|\bget\(\s*['"]theme['"]\s*\)/;

// Any of these means the module re-evaluates when the answer changes. `followTheme` is the intended
// API (lib/theme.ts); `store.subscribe` is what it is built on, so a module wiring its own is fine.
export const SUBSCRIBES = /\bfollowTheme\s*\(|\bstore\.subscribe\s*\(/;

// A CONTENT SCRIPT trips a DIFFERENT wire, and the pair above cannot see it. It runs in the
// visited page's document, so it has no `store` to read and no `:root` of ours to pin an
// attribute on: it injects `lib/contentTheme.ts`'s palette into its shadow root and lets
// `themeShadowHost` paint the attribute that selects the light half. Nothing in it ever matches
// READS, so checking READS first would wave every such file through — which is exactly what an
// earlier version of this guard did, while its own comment claimed the opposite.
//
// So state the invariant that actually breaks: a surface that ships the palette CSS and never
// paints the attribute is pinned to the dark default forever, on every site, which IS #1173.
export const USES_PALETTE = /\bCONTENT_THEME_CSS\b/;
export const PAINTS_PALETTE = /\bthemeShadowHost\s*\(|\bwatchContentTheme\s*\(/;

// Modules that read the theme and do NOT need to subscribe. Every entry needs a REASON, and the
// reason must be about lifetime — either the module is re-run whenever the theme could matter, or
// it is a one-shot answer to a question asked at that instant.
export const EXEMPT = {
  'lib/theme.ts': 'This IS the module. It defines both the question and followTheme.',
  'lib/contentTheme.ts':
    'This IS the content-script module. It defines the palette and themeShadowHost, so it names both halves of the invariant rather than being subject to it.',
  'controllers/backgroundController.ts':
    'Reads resolvedTheme() to pick the default wallpaper. Re-run by appController on every theme change (followTheme -> onThemeChange) and on an OS flip in System mode (its matchMedia listener).',
  'apps/notaboard/index.ts':
    'Stamps the theme onto a board record at creation. A one-shot answer per new board — the paper the board was made with, not a rendered surface that must follow the setting.',
};

// Strip comments before scanning: a mention in a comment is not a use.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Does this module take the theme once and never look again — by either route? */
export function isOffender(rel, source) {
  const src = stripComments(source);
  if (EXEMPT[rel]) return false;
  // Our own pages: read the setting, never subscribe.
  if (READS.test(src) && !SUBSCRIBES.test(src)) return true;
  // A page we do not own: ship the palette, never paint the attribute that switches it.
  if (USES_PALETTE.test(src) && !PAINTS_PALETTE.test(src)) return true;
  return false;
}

function sourceFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
    }
  };
  walk(root);
  return files;
}

function main() {
  const offenders = [];
  let subscribers = 0;
  for (const file of sourceFiles(SRC)) {
    const rel = file.slice(SRC.length + 1);
    const source = readFileSync(file, 'utf8');
    const src = stripComments(source);
    if (SUBSCRIBES.test(src) || PAINTS_PALETTE.test(src)) subscribers++;
    if (isOffender(rel, source)) offenders.push(rel);
  }

  if (!offenders.length) {
    console.log(
      `check-theme-subscribers: every surface that reads the theme re-applies it ` +
        `(${subscribers} subscribing, ${Object.keys(EXEMPT).length} exempt with a reason).`,
    );
    return;
  }

  console.error('check-theme-subscribers: a surface reads the theme but never re-applies it.\n');
  for (const f of offenders) console.error(`  ${SRC}/${f}`);
  console.error(`
Appearance changes WHILE THE SURFACE IS OPEN, and it changes on a DIFFERENT surface — the user
picks Light or Dark in Settings on the new tab. A side panel is pinned beside a tab for days; a
surface that applies the palette once at startup is still wearing the old one long afterwards.

Either:
  - on one of OUR pages, subscribe:
                followTheme()               (lib/theme.ts — applies now and on every change)
                followTheme(() => extra())  (pass the surface's own extra work, as the new tab does)
  - in a CONTENT SCRIPT, paint the attribute the palette switches on:
                themeShadowHost(host)       (lib/contentTheme.ts — returns an unsubscribe)
                watchContentTheme(fn)       (if you need the value rather than the attribute)
  - or add the file to EXEMPT in this script, WITH A REASON about its lifetime.

This shipped on two of the three surfaces we have (#1174), and on four of the five in-page ones
(#1173). That is why this check exists.`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
