// Fails the build when a colour token is illegible against the ground it is used on,
// in EITHER theme.
//
// Why this exists: the same defect shipped three times (#72, #95, #96), and not one was
// caught by a user or by review — because each was fine in the theme the author happened
// to be looking at and broken in the other:
//
//   #72  AnubisDB `true` pill              1.11:1 in dark   (dark green on a green wash)
//   #95  AnubisDB records/blobs/kv pills   3.1-3.4:1 in light
//   #96  tag / onboarding badges            2.66 / 4.28 / 2.72:1
//
// A screenshot cannot show you this; only the number can. While fixing #72 my own first
// attempt measured 2.40:1 — it would have shipped a regression that looked fine.
//
// Nothing is registered by hand. The checks are DERIVED from the CSS, so a new pill in a
// new app is covered with no edit here (a hand-maintained list is the thing this repo
// keeps getting wrong). Three recipes are recognised:
//
//   A  self-wash  the same token is the text AND its background tint  (the kind pills)
//   B  ink pair   text is an --on-* token over a resolvable background (a solid badge)
//
// Deliberately NOT checked: a token used as text straight on the panel (an --accent link,
// a --danger label). Those are a different question — a brand colour's legibility on the
// page — and several are already below AA in light (filed separately). Folding them in here
// would mean this check could only go green by changing brand colours, so it would just be
// turned off. This checks the recipe that has actually shipped broken three times.
//
//   node scripts/check-contrast.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const APPS_DIR = join(SRC, 'apps');

// Read every SHIPPED app's accent straight from its meta.ts — same approach as
// gen-app-install.mjs: the metas import only the pure defineMeta helper, so esbuild can
// bundle them and we read the real values instead of scraping them.
async function appMetas() {
  const ids = readdirSync(APPS_DIR).filter(
    (d) =>
      statSync(join(APPS_DIR, d)).isDirectory() &&
      existsSync(join(APPS_DIR, d, 'meta.ts')) &&
      (existsSync(join(APPS_DIR, d, 'index.ts')) || existsSync(join(APPS_DIR, d, 'index.js'))),
  );
  const entry =
    ids.map((id, i) => `import m${i} from ${JSON.stringify(join(APPS_DIR, id, 'meta.ts'))}`).join('\n') +
    `\nexport const metas = [${ids.map((_, i) => `m${i}`).join(', ')}]`;
  const bundled = await build({
    stdin: { contents: entry, resolveDir: APPS_DIR, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const mod = await import(
    'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
  );
  return mod.metas.filter(Boolean);
}
const BASE = join(SRC, 'styles', 'base.css');
// Two thresholds, because WCAG asks two different things and conflating them is a bug in
// both directions. 1.4.3 wants 4.5:1 of small TEXT (every policed label here is 11-13px).
// 1.4.11 wants only 3:1 of GRAPHICAL OBJECTS and UI components — icons, glyphs, strokes.
// Holding an icon to the text rule is not "extra safe": it drags the accent toward --text
// until the icon is mud (Notes' amber came out #77541c). A rule declares which one it is by
// the ink token it mixes with — --accent-ink-ui-mix means "this is a graphic".
const MIN_TEXT = 4.5; // WCAG 1.4.3 — small text
const MIN_UI = 3.0; // WCAG 1.4.11 — non-text: icons, glyphs, UI component strokes
const UI_INK = '--accent-ink-ui-mix';
const minFor = (inkTokens) => (inkTokens.includes(UI_INK) ? MIN_UI : MIN_TEXT);
const why = (min) => (min === MIN_UI ? 'WCAG 1.4.11, non-text/icon' : 'WCAG AA 1.4.3, small text');

// ── colour maths ─────────────────────────────────────────────────────────────
const hex = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c) : [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)];
  return n.map((c) => parseInt(c, 16));
};
const parseColor = (c) => {
  const s = c.trim();
  if (s.startsWith('#')) return hex(s);
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = '1'] = m[1].split(',').map((v) => parseFloat(v));
    return [r, g, b, parseFloat(a)];
  }
  return null;
};
const over = (fg, bg) => {
  // Composite fg (which may carry alpha) onto an opaque bg.
  const a = fg[3] ?? 1;
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)));
};
const mix = (a, b, pct) => [0, 1, 2].map((i) => Math.round(a[i] * (pct / 100) + b[i] * (1 - pct / 100)));
const lum = (c) => {
  const [r, g, b] = c.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// ── the palettes ─────────────────────────────────────────────────────────────
// base.css declares :root (dark), then the light values twice (an @media block and a
// [data-theme='light'] block — plain CSS can't share a declaration list). Reading the
// LAST value a token gets in the light half gives that theme's palette.
// Comments MUST be stripped before any of this. base.css explains its tokens in prose
// ("unlike --on-accent: in dark, --new is PALE..."), and a naive `--token:` regex
// happily matches THAT, then runs on to the next `;` — swallowing the real declaration on
// the far side of the comment. It silently left an ink token and --kind-records unpoliced when
// this script was first written: exactly the quiet gap the script exists to close.
const decomment = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const read = (src) => {
  const out = {};
  for (const [, name, value] of src.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const c = parseColor(value);
    if (c) out[name] = c;
    // Percentages are tokens too (--accent-ink-mix), and the resolver needs them: accent
    // TEXT is color-mix(var(--accent) var(--accent-ink-mix), var(--text)), so a checker
    // that could not read the percentage would skip those rules and quietly police nothing.
    else if (/^\d+(\.\d+)?%$/.test(value.trim())) out[name] = parseFloat(value);
  }
  return out;
};

function palettes() {
  const css = decomment(readFileSync(BASE, 'utf8'));
  const mediaAt = css.indexOf('@media (prefers-color-scheme: light)');
  const attrAt = css.indexOf("[data-theme='light']");
  const dark = read(css.slice(0, mediaAt));

  // The light palette is written TWICE on purpose — once for `System` (the OS prefers
  // light) and once for an explicit `Light` pick — because plain CSS cannot share a
  // declaration list. They must agree, and nothing checked that: if they drift, a
  // System-light user and a Light user see different colours, and this script would only
  // ever test whichever block it read last. So assert they match before trusting either.
  const media = read(css.slice(mediaAt, attrAt));
  const attr = read(css.slice(attrAt));
  const drift = Object.keys({ ...media, ...attr }).filter((t) => String(media[t]) !== String(attr[t]));
  if (drift.length) {
    console.error('check-contrast: the two light palettes in base.css disagree.\n');
    for (const t of drift) {
      console.error(`  ${t}`);
      console.error(`    @media (prefers-color-scheme: light): ${media[t] ? `rgb(${media[t]})` : 'not set'}`);
      console.error(`    [data-theme='light']:                 ${attr[t] ? `rgb(${attr[t]})` : 'not set'}\n`);
    }
    console.error('A user on System-light and a user who picked Light would see different colours.');
    console.error('Keep the two blocks identical — they are duplicated only because CSS cannot');
    console.error('share a declaration list.');
    process.exit(1);
  }

  return { dark, light: { ...dark, ...attr } }; // light overrides only what it redefines
}

// ── resolve a CSS colour expression against one palette ──────────────────────
// Handles `var(--x)`, a literal, and `color-mix(in srgb, <A> N%, <B>)` — including
// `transparent`, which means "let the ground show through".
function resolve(expr, pal, ground) {
  const s = expr.trim();
  const mixMatch = s.match(/color-mix\(\s*in srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?%|var\(--[\w-]+\))\s*,\s*(.+?)\s*\)$/);
  if (mixMatch) {
    const [, aRaw, pctRaw, bRaw] = mixMatch;
    const a = resolve(aRaw, pal, ground);
    if (!a) return null;
    const b = bRaw.trim() === 'transparent' ? ground : resolve(bRaw, pal, ground);
    if (!b) return null;
    const pv = pctRaw.match(/^var\((--[\w-]+)\)$/);
    const pct = pv ? pal[pv[1]] : parseFloat(pctRaw);
    if (typeof pct !== 'number') return null;
    return mix(a, b, pct);
  }
  const v = s.match(/^var\((--[\w-]+)\)$/);
  if (v) return pal[v[1]] ? over(pal[v[1]], ground) : null;
  if (s === 'transparent') return ground;
  const lit = parseColor(s);
  return lit ? over(lit, ground) : null;
}

const tokensIn = (expr) => [...expr.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);

// ── walk the CSS ─────────────────────────────────────────────────────────────
function cssFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith('.css') && p !== BASE ? [p] : [];
  });
}

const { dark, light } = palettes();
const THEMES = [
  ['dark', dark],
  ['light', light],
];

// WHICH tokens does this check police? The ones the bug lives in: a colour that carries
// a DIFFERENT value in each palette. That is not a coincidence — a token gets two values
// precisely because it is used as text on a tint of itself, and one value cannot serve a
// dark and a light ground (#72/#95/#96 are all this). So the family is DERIVED, and a new
// semantic token is policed by default: forgetting to register it cannot silently skip it.
//
// The structural surfaces are excluded — they differ per theme too, but "--text on
// --panel" is the page itself, not a state pill. So are the theme-INVARIANT brand tokens
// (--accent, --danger, --on-accent): a single value used on both grounds is a different
// question, several are already below AA, and folding them in would mean this check could
// only go green by changing brand colours — so it would just be switched off.
const STRUCTURAL = new Set([
  '--text',
  '--text-secondary',
  '--panel',
  '--material',
  '--material-hover',
  '--surface',
  '--surface-hover',
  '--surface-strong',
  '--hairline',
  '--hairline-strong',
  '--field',
  '--scrim',
  '--shadow',
  '--app-icon-shadow',
  '--text-halo',
  '--bg-overlay',
]);
// Two ways in, because either alone has a hole:
//
//   per-theme  a token carrying a DIFFERENT value in each palette — it only got two
//              values because one could not serve both grounds.
//   self-wash  a token used as its own background tint ANYWHERE in the CSS.
//
// The union matters. Policing only per-theme tokens would mean that "fixing" a failure by
// collapsing a token back to ONE value silently removes it from the check — which is the
// exact pre-#72 state (a single green on both grounds, 1.11:1 in dark). Policing only
// self-wash tokens would miss an ink pair like --on-accent. Together they cannot be dodged.
const usedAsSelfWash = new Set();
for (const file of cssFiles(SRC)) {
  for (const [, , body] of decomment(readFileSync(file, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const ink = body.match(/(?:^|[\s;])color\s*:\s*([^;]+);/)?.[1];
    const bg = body.match(/(?:^|[\s;])background(?:-color)?\s*:\s*([^;]+);/)?.[1];
    if (!ink || !bg) continue;
    for (const t of tokensIn(ink)) if (tokensIn(bg).includes(t) && !STRUCTURAL.has(t)) usedAsSelfWash.add(t);
  }
}
// Known-failing today, so excluded — each with the issue that owns it. This is a
// LIST OF DEBTS, not a way to make the check quiet: every entry says what it measured
// and where it is tracked, and `grep EXCLUDED` shows all of them. Delete the entry when
// the issue lands; the check then guards the token forever after.
//
// Nothing is excluded outright any more. --danger/--warning were fixed in #128, and
// --accent/--on-accent in #129 (the brand blue darkened so white clears AA, and the ink
// derived from the accent at runtime by lib/accent.ts). Those entries are gone rather than
// commented out — the debts are paid.
const EXCLUDED = new Set([]);

// Nothing is exempt any more. --accent as TEXT was the last one (#135): accent text is now
// color-mix(var(--accent) var(--accent-ink-mix), var(--text)), which is legible on every
// accent in both themes — so it is checked like everything else.
const EXCLUDED_SELFWASH = new Set([]);

const POLICED = new Set(
  [
    ...Object.keys(dark).filter((t) => !STRUCTURAL.has(t) && light[t] && String(dark[t]) !== String(light[t])),
    ...usedAsSelfWash,
  ].filter((t) => !EXCLUDED.has(t)),
);

const failures = [];
let checked = 0;

for (const file of cssFiles(SRC)) {
  const css = decomment(readFileSync(file, 'utf8'));
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const color = body.match(/(?:^|[\s;])color\s*:\s*([^;]+);/)?.[1];
    if (!color) continue;
    const background = body.match(/(?:^|[\s;])background(?:-color)?\s*:\s*([^;]+);/)?.[1];

    const inkTokens = tokensIn(color);
    if (!inkTokens.length) continue; // a literal ink is stylelint's business (#95), not ours

    // Which recipe is this?
    const bgTokens = background ? tokensIn(background) : [];
    const selfWash = background && inkTokens.some((t) => bgTokens.includes(t)); // A
    const inkPair = inkTokens.some((t) => t.startsWith('--on-')) && background; // B
    // C  on panel — a policed token used as text with no background of its own. It sits on
    //    --panel. This was the blind spot that let 43 accent-text rules fail unseen (#135):
    //    they are not self-wash, so nothing looked at them.
    const onPanel = !background && inkTokens.some((t) => POLICED.has(t));
    if (!selfWash && !inkPair && !onPanel) continue;
    if (selfWash && !inkPair && inkTokens.every((t) => EXCLUDED_SELFWASH.has(t))) continue;
    if (![...inkTokens, ...bgTokens].some((t) => POLICED.has(t))) continue;

    for (const [theme, pal] of THEMES) {
      const ground = pal['--panel'];
      if (!ground) continue;
      const fg = resolve(color, pal, ground);
      const bg = background ? resolve(background, pal, ground) : ground;
      if (!fg || !bg) continue; // an expression we can't resolve — say nothing rather than lie
      checked++;
      const r = ratio(fg, bg);
      const min = minFor(inkTokens);
      if (r < min) {
        failures.push({
          file: relative(SRC, file),
          selector: selector.trim().split('\n').pop().trim(),
          theme,
          ratio: r,
          min,
          tokens: [...new Set([...inkTokens, ...bgTokens])].join(', '),
        });
      }
    }
  }
}

// ── ink on a SOLID accent is always white, so the GROUND must carry it ───────
// The palette walk above cannot see these: an app overrides --accent from its meta.ts, so
// the colour never appears in the CSS. That override is where this bug has now lived twice
// — white ink failed AA on all nineteen accents (#129), and the luminance-derived ink that
// replaced it came out black on fifteen of them, in both themes (#151).
//
// The ink is white now, unconditionally, and lib/accent.ts derives a DARKENED ground for it
// (--accent-solid / --accent-solid-ui, via groundFor() in @kimtos/icons).
//
// WHAT IS WORTH ASSERTING HERE, AND WHAT IS NOT. "The derived ground carries white at 4.5:1"
// is NOT worth asserting: groundFor() darkens until exactly that is true, so measuring it
// here only re-measures the algorithm's own postcondition. It can never fail. A check that
// cannot fail is not a check — it is a green light wired to nothing, and this repo has
// shipped enough of those.
//
// In fact EVERY hue can be darkened to carry white — the derivation cannot fail, so there is
// nothing to assert about legibility here at all. What is real is the PRICE: how much of the
// brand colour legibility costs. A pale accent only gets a legible button by being darkened
// so far that the button is no longer recognisably the app's colour, and nothing else in the
// codebase states that limit.
//
// Today's worst is Grammit's green at 40%. The limit is 45%: it passes everything we ship,
// with margin, and fails a pastel a new app might reach for (a cream #fde68a needs 49%).
const WHITE = [255, 255, 255];
const MAX_DARKEN = 45; // beyond this the ground is no longer recognisably the accent
const darkenNeeded = (c, min) => {
  for (let k = 0; k <= 100; k++) {
    if (ratio(WHITE, mix(c, [0, 0, 0], 100 - k)) >= min) return k;
  }
  return 100;
};
const metas = await appMetas();
for (const { id, accent } of metas) {
  const c = parseColor(accent);
  if (!c) continue;

  const need = darkenNeeded(c, MIN_TEXT);
  if (need > MAX_DARKEN) {
    failures.push({
      file: `apps/${id}/meta.ts`,
      selector: `accent: '${accent}' is too pale to be a solid ground`,
      theme: 'both',
      ratio: ratio(WHITE, c),
      min: MIN_TEXT,
      tokens:
        `white text needs it ${need}% darker (limit ${MAX_DARKEN}%), by which point the button ` +
        `is no longer this app's colour — pick a deeper accent`,
    });
  }

  // And the other direction: this accent used as ink. Accent ink is
  // color-mix(accent <mix>, --text), on the panel or on a tint of itself (#135) — as TEXT
  // (--accent-ink-mix, 4.5:1) and, since the icons were split off it, as an ICON
  // (--accent-ink-ui-mix, 3:1). The CSS walk only ever sees the BRAND accent, so without
  // this an app could ship an accent whose own ink is illegible and nothing would catch it.
  // Both are checked: the icon mix keeps MORE accent, so it is the one closer to the edge.
  for (const [theme, pal] of THEMES) {
    const panel = pal['--panel'];
    const text = pal['--text'];
    if (!panel || !text) continue;
    for (const [token, min, role] of [
      ['--accent-ink-mix', MIN_TEXT, 'TEXT'],
      [UI_INK, MIN_UI, 'an ICON'],
    ]) {
      const pct = pal[token];
      if (typeof pct !== 'number') continue;
      const ink = mix(c, over(text, panel), pct);
      const onPanel = ratio(ink, panel);
      const onTint = ratio(ink, mix(c, panel, 14)); // the heaviest accent wash in the CSS
      const worst = Math.min(onPanel, onTint);
      if (worst < min) {
        failures.push({
          file: `apps/${id}/meta.ts`,
          selector: `accent: '${accent}' used as ${role}`,
          theme,
          ratio: worst,
          min,
          tokens: `color-mix(accent ${pct}%, --text) is illegible on the panel or its own tint`,
        });
      }
    }
  }
}

// ── no rule may put ink on a RAW --accent ────────────────────────────────────
// The measurements above only mean anything if the CSS actually USES the derived grounds.
// A rule that inks a bare `background: var(--accent)` is the bug itself: --accent is the
// true brand colour and half the palette is too light to carry white (#151). Every app and
// every button must go through --accent-solid (text) or --accent-solid-ui (glyph), so this
// is a structural check, not a measurement — it is what keeps the apps consistent with each
// other as new ones are added.
//
// Only INKED rules are policed. A bare accent fill with no ink of its own (a progress bar,
// a dot, a switch track) is fine and stays on --accent.
for (const file of cssFiles(SRC)) {
  const css = decomment(readFileSync(file, 'utf8'));
  for (const block of css.split('}')) {
    const [selector, body = ''] = block.split('{');
    if (!body) continue;
    const bg = /background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
    if (!bg || !/^var\(--accent\)(\s|$)/.test(bg)) continue;
    const ink = /(?:^|\s|;)color\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
    if (!ink) continue; // a fill with no ink — nothing to be illegible
    failures.push({
      file: relative(SRC, file),
      selector: selector.trim().split('\n').pop().trim(),
      theme: 'both',
      ratio: 0,
      min: MIN_UI,
      tokens: `inks a raw var(--accent) ground (color: ${ink}) — use var(--accent-solid) for text, var(--accent-solid-ui) for a glyph`,
    });
  }
}

if (failures.length) {
  console.error('check-contrast: ink is illegible against its own background.\n');
  for (const f of failures) {
    const min = f.min ?? MIN_TEXT;
    console.error(`  ${f.file}  ${f.selector}`);
    console.error(`    ${f.theme}: ${f.ratio.toFixed(2)}:1  (needs ${min}:1 — ${why(min)})`);
    console.error(`    tokens: ${f.tokens}\n`);
  }
  console.error('A colour that reads in one theme can be invisible in the other — that is how');
  console.error('#72 (1.11:1), #95 (3.1:1) and #96 (2.66:1) all shipped. Retune the token in');
  console.error('styles/base.css for the failing theme, and MEASURE it. See #106.');
  process.exit(1);
}

console.log(
  `check-contrast: ${checked} token/ground pairs pass in both themes ` +
    `(text ${MIN_TEXT}:1, icons ${MIN_UI}:1; policing ${[...POLICED].sort().join(', ')}).`,
);
