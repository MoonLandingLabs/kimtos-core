// Assemble the VitePress source tree (content/) from the repo's Markdown — the
// single source of truth for docs lives in /docs, NOT here. This keeps the docs site
// in lockstep with the code docs without copy-paste drift.
//
// What it does:
//   1. Copies the shared brand favicons into content/public/.
//   2. Copies the authored site pages (authored/) — the home page and any hand-written
//      landing pages that belong to the docs site, not the repo — substituting their
//      `{{token}}` facts from @kimtos/config, the app metas and the extension's declared
//      limits on the way (see DOC_TOKENS).
//   3. Copies selected guide/platform/ops docs from /docs verbatim.
//   4. Assembles one page per app from its booklet.toml + numbered content/ chapters
//      (the same manifests the extension's per-app booklet uses), plus an apps index.
//      The chapters get the same `{{token}}` pass as the authored pages.
//
// content/ is fully generated (git-ignored). Run via `npm run build-content`
// (also a pre-dev / pre-build hook).

import { cpSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { build } from 'esbuild';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appGlyphSvg, appTileGradient, appTileSvg, brandMarkSvg, hasAppIcon } from '@kimtos/icons';
// The app's version + history + first-release date all live in its CHANGELOG.md — the single
// source (#132). unitFirstReleased is the oldest entry's date; it drives the "New" badge (#1114).
import { readUnitChangelog, unitVersion, unitFirstReleased } from '@kimtos/releaser';
// The site URL comes from the one config source, so a docs page can't
// drift from the marketing site (#30).
import { DEFAULTS, isNewApp, NEW_APP_DAYS } from '@kimtos/config';
import { interpolate, proseList, tokensIn } from './interpolate.mjs';
// How many agent tools the apps declare. Derived from the descriptors themselves — the KimtAI
// handbook used to type the figure out, and it was one of four hand-typed copies, no two of
// which agreed (#1099). See scripts/agent-tool-count.mjs.
import { countAgentTools } from '../../scripts/agent-tool-count.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..'); // www-docs/
const REPO = join(ROOT, '..'); // repo root
const DOCS = join(REPO, 'docs');
const APPS_DIR = join(DOCS, 'extension', 'apps');
const EXT_APPS = join(REPO, 'extension', 'src', 'apps'); // for each app's meta.ts (opt-in flag, changelog)

// ── reading the extension's own data modules ────────────────────────────────
// A handful of facts the docs state are declared in the EXTENSION, not in @kimtos/config:
// the KimtAI model catalog and the size/length limits the apps enforce. Those modules are
// deliberately data-only (no DOM, no chrome.*) so this build can bundle and import them
// instead of the docs re-typing what they say.
//
// Never guess a fallback. An unreadable module means the extension source is not in the
// checkout — fail the build rather than publish a page describing a product we could not read.
async function loadExtensionModule(file, what) {
  let bundled;
  try {
    bundled = await build({
      entryPoints: [file],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
    });
  } catch (err) {
    throw new Error(
      `Cannot read ${what}: ${file} (${err.message}).\n` + `It must be present in the repository checkout.`,
    );
  }
  return import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
}

// ── the extension's enforced limits ─────────────────────────────────────────
// How big a PDF or wallpaper may be, and how long a note page may be. Each used to be a
// private const beside the code enforcing it and was then re-typed into the guides, so
// raising one left the docs confidently wrong with nothing failing (#1043). The docs read
// the declaration instead — see extension/src/lib/limits.ts.
const LIMITS_TS = join(REPO, 'extension', 'src', 'lib', 'limits.ts');

async function extensionLimits() {
  const mod = await loadExtensionModule(LIMITS_TS, "the extension's limits");
  const { PDF_MAX_BYTES, WALLPAPER_MAX_BYTES, NOTE_MAX_CHARS, megabytes, grouped } = mod;
  // A zero or missing limit would publish "A PDF: 0 MB" — the shape of a module we read but
  // did not understand (a rename, a refactor into an object). Say so rather than print it.
  for (const [name, value] of [
    ['PDF_MAX_BYTES', PDF_MAX_BYTES],
    ['WALLPAPER_MAX_BYTES', WALLPAPER_MAX_BYTES],
    ['NOTE_MAX_CHARS', NOTE_MAX_CHARS],
  ]) {
    if (typeof value !== 'number' || !(value > 0)) {
      throw new Error(
        `${LIMITS_TS} does not export a positive ${name} (got ${value}).\n` +
          `  The docs state these limits from this module; publishing an absent one would tell ` +
          `readers the wrong cap. Fix the export, or update the token map in this file.`,
      );
    }
  }
  return {
    pdfMaxSize: megabytes(PDF_MAX_BYTES),
    wallpaperMaxSize: megabytes(WALLPAPER_MAX_BYTES),
    noteMaxChars: grouped(NOTE_MAX_CHARS),
  };
}

// ── the dormant agent tools ─────────────────────────────────────────────────
// How many tools the apps declare, and across how many apps. The KimtAI handbook describes the
// dormant agent runtime and stated the figure by hand; it was one of four hand-typed copies, no
// two of which agreed, and all four disagreed with the descriptors (#1099). The handbook is the
// only one of the four a reader ever sees, so it is the one that derives its number.
//
// Read as text from extension/src/apps/*/index.ts (the registry is assembled by Vite's
// `import.meta.glob`, which Node does not have), so this needs no bundling step — but it does
// need the app sources, which the repository checkout contains.
function agentToolTokens() {
  const { tools, apps } = countAgentTools(REPO);
  return { agentToolCount: tools, agentToolAppCount: apps };
}

// ── the KimtAI model catalog ────────────────────────────────────────────────
// The docs used to hand-write a "Model Library" — download several models, compare them, pick
// one — while exactly ONE model shipped. The models had been removed deliberately (Gemma for its
// licence, Qwen for a suspected output problem) and nobody told the docs (#245). A reader
// expected a choice that does not exist.
//
// So the list is DERIVED from the source. It is read from the extension's own
// catalog (lib/engines/kimtaiModels.ts), which is data-only precisely so this file can load it.
// Add a model there and the docs say so; remove one and they stop saying so. There is nothing
// left to keep in step by hand.
//
// Never guess. An unreadable catalog means the extension source is not in the checkout — fail the
// build rather than publish a page that describes a model set we cannot confirm.
const MODELS_TS = join(REPO, 'extension', 'src', 'lib', 'engines', 'kimtaiModels.ts');

async function shippedModels() {
  const mod = await loadExtensionModule(MODELS_TS, 'the KimtAI model catalog');
  const models = mod.MODELS;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('The KimtAI model catalog is empty. The docs cannot describe models we do not ship.');
  }
  return { models, defaultModel: mod.DEFAULT_MODEL };
}

/** The generated model section: a table of what actually ships, and prose that fits the count. */
function modelsSection({ models, defaultModel }) {
  const rows = models
    .map((m) => `| **${m.label}** | ${m.params} | ${m.size} | ${m.needsWebGPU ? 'Yes' : 'No'} | ${m.note} |`)
    .join('\n');
  const table =
    `| Model | Parameters | Download | Needs a GPU | What it is for |\n` + `| --- | --- | --- | --- | --- |\n${rows}`;

  // The prose adapts to the COUNT. With one model there is nothing to choose between, and saying
  // otherwise is the bug this section exists to prevent.
  const intro =
    models.length === 1
      ? `KimtAI ships **one** model today. It downloads on first use and is cached, so it is ` +
        `fetched only once — and it runs entirely on your device.\n\n${table}\n\n` +
        `More models are planned; when a second one ships, this page will list it and the app ` +
        `will let you switch between them.`
      : `KimtAI ships ${models.length} models. Download the ones you want, see each one's size ` +
        `on *your* device, and pick which to chat with. Each is fetched on demand and cached, so ` +
        `it is downloaded only once.\n\n${table}\n\n` +
        `**${models.find((m) => m.id === defaultModel)?.label ?? models[0].label}** is downloaded ` +
        `on install.`;
  return intro;
}

// Opt-in apps (`optIn: true` in meta.ts) ship uninstalled and are added from the App Store.
// They are still free; this only decides which apps are installed for you automatically.
function optInFor(id) {
  try {
    return /optIn:\s*true/.test(readFileSync(join(EXT_APPS, id, 'meta.ts'), 'utf8'));
  } catch {
    return false;
  }
}
const AUTHORED = join(ROOT, 'authored');
const OUT = join(ROOT, 'content');

// --- minimal flat-TOML reader (top-level `key = value` only). This is now the ONLY
// reader of booklet.toml: the extension carried a second renderer of these same
// booklets, unshipped and gitignored, and it was retired in #182. ---------------
function parseToml(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else {
      v = v.replace(/\s+#.*$/, '').trim();
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    }
    out[m[1]] = v;
  }
  return out;
}

const write = (rel, body) => {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body);
};
// Copy a REQUIRED source. This used to return `false` and carry on, and that silence
// is exactly what lets a missing input become a missing page with a green build.
// Every source we copy is one we chose to publish, so absence is a bug, not a case to
// handle. If a genuinely optional source ever appears, give it its own `copyOptional`
// at that call site — do not make silence the default again.
const copy = (fromAbs, rel) => {
  if (!existsSync(fromAbs)) {
    throw new Error(`Missing required source: ${fromAbs}\nIt would have been published as ${rel}.`);
  }
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(fromAbs, dest);
};
const esc = (s = '') => String(s).replace(/"/g, '&quot;');

// Every Markdown file under `dir`, as paths relative to it. Used to walk the authored tree,
// so a new guide gets the token pass with no edit here.
const markdownUnder = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md'));

// Push every Markdown heading down one level (so an app page has a single H1 =
// the app name and the chapters become H2 sections). Skips fenced code blocks.
function demoteHeadings(md) {
  let inFence = false;
  return md
    .split('\n')
    .map((line) => {
      const fence = line.match(/^\s*(```|~~~)/);
      if (fence) inFence = !inFence;
      if (inFence) return line;
      const h = line.match(/^(#{1,5})\s+(.*)$/);
      return h ? `#${h[1]} ${h[2]}` : line;
    })
    .join('\n');
}

// A booklet's chapters. An empty result is NOT a valid outcome: it would publish an
// app page with a heading and no words, and the build would still be green. If a
// booklet exists, it has chapters — say so, loudly.
const chapterFiles = (dir, appId) => {
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => join(dir, f))
    : [];
  if (!files.length) {
    throw new Error(
      `App "${appId}" has a booklet.toml but no chapters in ${dir}.\n` +
        `Add content/01-overview.md (see docs/extension/apps/README.md), or its page would publish empty.`,
    );
  }
  return files;
};

// Read every app's booklet manifest, sorted the way the dock/App Store sort
// (order, then title). Shared with .vitepress/config.mts's sidebar builder — the
// typedef below is that seam's contract: config.mts is type-checked (vue-tsc, #1050)
// and reads these fields off the plain-JS parseToml result, whose inferred type
// would otherwise be `{}`.
/**
 * @typedef {object} BookletApp
 * @property {string} id                  app id (the booklet's directory name)
 * @property {boolean} optIn              `optIn: true` in meta.ts: ships uninstalled, added from the App Store
 * @property {string} [firstReleased]     ISO date of the app's oldest CHANGELOG entry; drives the "New" badge (#1114)
 * @property {string} [title]             from booklet.toml
 * @property {string} [subtitle]          from booklet.toml
 * @property {string} [accent]            from booklet.toml
 * @property {number} [order]             from booklet.toml
 */
/** @returns {BookletApp[]} */
export function readApps() {
  // Zero apps is never a correct docs site — it is the shape of a missing input
  // (a build that cannot see the app metas would publish wrong badges). Fail rather than publish
  // an empty site.
  if (!existsSync(APPS_DIR)) {
    throw new Error(`No app booklets: ${APPS_DIR} does not exist. Is /docs in the checkout?`);
  }
  return readdirSync(APPS_DIR)
    .filter((d) => statSync(join(APPS_DIR, d)).isDirectory())
    .map((id) => ({
      id,
      ...parseToml(readFileSync(join(APPS_DIR, id, 'booklet.toml'), 'utf8')),
      optIn: optInFor(id),
      // The oldest CHANGELOG entry's date, read from the extension source (in the
      // checkout). Undefined for an app with no
      // changelog, which the badge reads as "not new".
      firstReleased: unitFirstReleased(join(EXT_APPS, id)) || undefined,
    }))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || (a.title || a.id).localeCompare(b.title || b.id));
}

// The public docs site is Home + Apps only — no internal guide/platform/ops
// pages are published. (Left intentionally empty; docCount stays 0.)
const DOC_PAGES = [];

// The app glyph as an inline <svg> tinted with the app's accent (currentColor).
// Falls back to the plain squircle dot when we have no glyph for the id.
const appIconMarkup = (a) =>
  hasAppIcon(a.id)
    ? `<span class="app-tile" style="background:${appTileGradient(a.accent || '#3b82f6')}">${appGlyphSvg(a.id)}</span>`
    : `<span class="app-dot" style="--app-accent:${esc(a.accent || '#3b82f6')}"></span>`;

// "New" pill — a freshly published app carries it for NEW_APP_DAYS from its first release
// (#1114), the same badge as the extension + www. The date is baked in here at build time;
// the client sweep in .vitepress/theme/index.ts reads `data-new-until` and removes the badge
// once that date has passed, so on this STATIC site it expires on its own instead of
// lingering until the next deploy. Empty string (no badge) when the app is not currently new
// or has no first-release date.
const newBadge = (app, now = new Date()) => {
  if (!isNewApp(app.firstReleased, now)) return '';
  const until = new Date(Date.parse(app.firstReleased) + NEW_APP_DAYS * 24 * 60 * 60 * 1000);
  return `<span class="new-badge" data-new-until="${until.toISOString().slice(0, 10)}">New</span>`;
};

// --- build ------------------------------------------------------------------
// Check the invariant before generating anything.
assertBookletsMatchApps();

// The app set, read ONCE: the authored pages' app tokens and the per-app pages all describe the same set, so they must all read the same list.
const apps = readApps();
const defaultApps = apps.filter((a) => !a.optIn);
const optInApps = apps.filter((a) => a.optIn);

// Every app is free, so the only split that matters is installed-for-you vs added from the
// App Store. An empty default set would publish an empty dash in the install guide, which
// means the metas were misread: fail rather than publish it.
if (apps.length && !defaultApps.length) {
  throw new Error(
    'Every app resolved to optIn — no installed-by-default apps found.\n' +
      'This comes from extension/src/apps/<id>/meta.ts; it means they were misread.',
  );
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. brand favicons (single source: www/public)
for (const f of ['favicon.svg', 'favicon.ico']) copy(join(REPO, 'www', 'public', f), join('public', f));

// 1b. home-page feature icons — the SHARED app-icon TILES (white glyph on the
// app's accent gradient, via appTileSvg) — the exact tile the app cards, the
// extension dock and www use — plus the brand mark for "the suite". Self-contained
// SVGs written to content/public/feature-icons/ → served at /feature-icons/ and
// shown via <img> in the hero.
const accentOf = Object.fromEntries(apps.map((a) => [a.id, a.accent || '#3b82f6']));
const FEATURE_ICONS = {
  'local.svg': appTileSvg('kimtfs', accentOf.kimtfs),
  'suite.svg': brandMarkSvg(),
  'ai.svg': appTileSvg('kimtai', accentOf.kimtai),
  'vault.svg': appTileSvg('anubisdb', accentOf.anubisdb),
};
for (const [name, svg] of Object.entries(FEATURE_ICONS)) write(join('public', 'feature-icons', name), svg);

// 2. authored site pages (home, guides). The home page lives here, so a missing
// authored/ is a site with no front door — not an optional extra.
//
// They are copied, then their `{{token}}` facts are filled in from the single source. The
// generated pages already read the config directly; the hand-written ones could not, so every
// fact they stated by hand was a second copy waiting to go stale — and the install guide
// went on telling readers KimtOS was not on the Chrome Web Store long after the listing
// went live (#1009). An unknown token fails the build (see interpolate.mjs).
//
// The pass runs over the app HANDBOOKS too (step 4), not just the authored pages: those are
// hand-written Markdown by exactly the same standard, and the PDF/Notes handbooks restated the
// same size and length caps the troubleshooting guide did (#1043). One map, one pass, one
// guarantee — a fact stated in two kinds of page is still one fact.
//
// Add an entry here only if it already has a SINGLE SOURCE in the repo — @kimtos/config for
// the product constants, each app's meta.ts (via `apps`) for the default/opt-in app sets (the same
// source the per-app pages read), and extension/src/lib/limits.ts for the caps the
// apps enforce. Never type a value here: a token whose value is hand-written is the drift
// this pass exists to remove, only one file further away (#878).
const DOC_TOKENS = {
  chromeWebStoreUrl: DEFAULTS.chromeWebStoreUrl,
  // KimtOS v1 is open source (MIT); the repository is the canonical source and the issue
  // tracker is the only support channel (no mailbox, chat or desk).
  repoUrl: 'https://github.com/MoonLandingLabs/kimtos-core',
  issuesUrl: 'https://github.com/MoonLandingLabs/kimtos-core/issues',
  defaultAppNames: proseList(defaultApps.map((a) => a.title || a.id)),
  optInAppNames: proseList(optInApps.map((a) => a.title || a.id)),
  ...(await extensionLimits()),
  ...agentToolTokens(),
};

// Every token any page actually used, filled in as the pages are written and asserted once
// after the handbooks are assembled — a token may legitimately be used by only one of the
// two kinds of page.
const tokensUsed = new Set();
const fillTokens = (src, where) => {
  for (const name of tokensIn(src)) tokensUsed.add(name);
  return interpolate(src, DOC_TOKENS, where);
};

if (!existsSync(AUTHORED)) {
  throw new Error(`Missing authored pages: ${AUTHORED} does not exist — the docs site would have no home page.`);
}
cpSync(AUTHORED, OUT, { recursive: true });
for (const rel of markdownUnder(AUTHORED)) {
  write(rel, fillTokens(readFileSync(join(AUTHORED, rel), 'utf8'), `authored/${rel}`));
}

// 3. repo docs, verbatim. These are listed by hand in DOC_PAGES, so a missing one
// means the list is wrong — copy() throws rather than publishing a shorter site.
let docCount = 0;
for (const [src, dest] of DOC_PAGES) {
  copy(join(DOCS, src), dest);
  docCount++;
}

// Every shipped app must have a docs booklet, and every booklet must have an app.
//
// The docs site is assembled from docs/extension/apps/, so an app with no booklet
// is an *omission*, not an error — it just never appears on the site, and nothing
// says so (that is how Retouch shipped undocumented). Assert the two sets match,
// in both directions, so the drift is a red build instead of a missing page.
// Runs on the raw directory listings, BEFORE readApps() reads each app's meta.ts.
function assertBookletsMatchApps() {
  // Check the inputs exist before reading them: a bare ENOENT from readdirSync tells
  // whoever is staring at a red CI log nothing about which input is missing or why.
  for (const [dir, what] of [
    [EXT_APPS, 'the extension apps (extension/src/apps) — is the extension source in the build context?'],
    [APPS_DIR, 'the docs booklets (docs/extension/apps) — is /docs in the build context?'],
  ]) {
    if (!existsSync(dir)) throw new Error(`Cannot find ${what}\n  Looked in: ${dir}`);
  }
  const shipped = readdirSync(EXT_APPS).filter((d) => existsSync(join(EXT_APPS, d, 'meta.ts')));
  const documented = readdirSync(APPS_DIR).filter((d) => existsSync(join(APPS_DIR, d, 'booklet.toml')));

  const undocumented = shipped.filter((id) => !documented.includes(id));
  const orphaned = documented.filter((id) => !shipped.includes(id));
  if (!undocumented.length && !orphaned.length) return;

  const lines = [];
  if (undocumented.length)
    lines.push(
      `  Shipped with no booklet: ${undocumented.join(', ')}\n` +
        `    -> add docs/extension/apps/<id>/booklet.toml + content/ (see docs/extension/apps/README.md)`,
    );
  if (orphaned.length)
    lines.push(
      `  Booklet with no app: ${orphaned.join(', ')}\n` +
        `    -> the app was removed or renamed; delete or rename the booklet to match`,
    );
  throw new Error(`Docs booklets are out of sync with the shipped apps.\n${lines.join('\n')}`);
}

// 4. per-app pages + apps index (over the one `apps` read at the top of the build)
// The app's release history, from `extension/src/apps/<id>/CHANGELOG.md` — the single place
// its version is declared (#132). Rendered as the last section of the app's page, so a
// reader can see what changed and when without leaving the docs.
function changelogSection(appId) {
  const releases = readUnitChangelog(join(EXT_APPS, appId));
  if (!releases.length) return '';
  // The <AppChangelog> component shows the latest few and opens the rest in a modal. Keep the
  // `## Changelog {#changelog}` heading so the sidebar outline and the /apps/<id>#changelog deep
  // link still resolve. Data is an escaped-JSON attribute (bullets contain `/` and `'`, e.g.
  // "Ctrl/Cmd+V", which would break a quoted JS-expression prop) — escape `&` then `"`.
  const json = JSON.stringify(releases).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `\n\n## Changelog {#changelog}\n\n<AppChangelog releases="${json}" />\n`;
}

// Every app is free and needs no account. An opt-in app ships uninstalled, so its page says
// where to get it. GENERATED from the app's meta.ts (optIn), so the docs cannot disagree with
// the product about which apps arrive installed.
const proNote = (app) =>
  !app.optIn
    ? ''
    : `> [!NOTE] ${esc(app.title || app.id)} is added from the App Store\n` +
      `> It is free and needs no account. It ships uninstalled so its models and scripts only\n` +
      `> run when you ask for them: open the App Store and install it. Everything runs\n` +
      `> **on your device**.\n\n`;

const MODELS_MARKER = '<!-- generated:kimtai-models -->';
const catalog = await shippedModels();
const modelsMd = modelsSection(catalog);

for (const app of apps) {
  // Handbook chapters get the same token pass as the authored pages: they are hand-written
  // Markdown that states the product's facts, so an untokenized one is the same second copy.
  // Substituted BEFORE the model list is spliced in, so the generated section is never rescanned.
  let chapters = chapterFiles(join(APPS_DIR, app.id, 'content'), app.id)
    .map((f) => demoteHeadings(fillTokens(readFileSync(f, 'utf8').trim(), relative(REPO, f))))
    .join('\n\n');

  // KimtAI's model list is generated from the extension's catalog (#245). The booklet carries a
  // marker where it goes; ASSERT the marker is there, because a well-meaning rewrite that drops
  // it would silently take the page back to hand-written claims about models we do not ship —
  // which is the whole bug.
  if (app.id === 'kimtai') {
    if (!chapters.includes(MODELS_MARKER)) {
      throw new Error(
        `The KimtAI booklet has lost its ${MODELS_MARKER} marker.\n` +
          `  The model list is GENERATED from extension/src/lib/engines/kimtaiModels.ts — the docs ` +
          `once described a "Model Library" of several models while one shipped (#245).\n` +
          `  Put the marker back where the list belongs; do not hand-write it.`,
      );
    }
    chapters = chapters.split(MODELS_MARKER).join(modelsMd);
  }
  const version = unitVersion(join(EXT_APPS, app.id));
  const page =
    `---\ntitle: ${JSON.stringify(app.title || app.id)}\n---\n\n` +
    `<div class="app-page-head">${appIconMarkup(app)}<h1>${esc(app.title || app.id)}</h1>${newBadge(app)}${version ? `<span class="app-version">v${esc(version)}</span>` : ''}</div>\n\n` +
    (app.subtitle
      ? `<p class="app-tagline" style="--app-accent:${esc(app.accent || '#3b82f6')}">${app.subtitle}</p>\n\n`
      : '') +
    proNote(app) +
    chapters +
    changelogSection(app.id) +
    '\n';
  write(`apps/${app.id}.md`, page);
}

// Every declared token is now either used or dead. An UNKNOWN token fails loudly at
// substitution time, but a page that DROPS its token fails silently — which is precisely how
// the install guide lost its Chrome Web Store link and went on saying the product could not
// be installed (#1009). Asserted here, after BOTH the authored pages and the handbooks have
// been written, because a token may legitimately be used by only one of the two.
const tokensUnused = Object.keys(DOC_TOKENS).filter((name) => !tokensUsed.has(name));
if (tokensUnused.length) {
  throw new Error(
    `Declared docs token(s) no page uses: ${tokensUnused.map((n) => `{{${n}}}`).join(', ')}.\n` +
      `  Either a page dropped the fact it was substituting — put the token back — or the entry is\n` +
      `  dead and should come out of DOC_TOKENS. A token is declared because a page needs it.`,
  );
}

// One app card: icon on the LEFT, then the title + New badge, with the
// description beneath. Used by the Apps index.
const appCard = (a) =>
  `  <a class="app-card" href="/apps/${a.id}" style="--app-accent:${esc(a.accent || '#3b82f6')}">\n` +
  `    ${appIconMarkup(a)}\n` +
  `    <span class="app-card-body">\n` +
  `      <span class="app-card-head"><span class="app-name">${esc(a.title || a.id)}</span>${newBadge(a)}</span>\n` +
  `      <span class="app-sub">${esc(a.subtitle || '')}</span>\n` +
  `    </span>\n` +
  `  </a>`;
const gridOf = (list) => `<div class="app-grid">\n${list.map(appCard).join('\n')}\n</div>`;

write(
  'apps/index.md',
  `---\ntitle: Apps\n---\n\n# Apps\n\n` +
    `The kimtos new-tab suite — every app runs **entirely on your device**. Pick one to read how it works.\n\n` +
    `${gridOf(apps)}\n`,
);

// 6. Assert we actually wrote the site we set out to write. The guards above catch a
// missing INPUT; this catches a missing OUTPUT — a page we forgot to write, or wrote
// somewhere unexpected. Cheap, and it is the last thing standing between a silent
// omission and a published site.
const expected = ['index.md', 'apps/index.md', ...apps.map((a) => `apps/${a.id}.md`)];
const missing = expected.filter((rel) => !existsSync(join(OUT, rel)));
if (missing.length) {
  throw new Error(`The docs build did not produce ${missing.length} expected page(s):\n  ${missing.join('\n  ')}`);
}

console.log(
  `✓ docs content assembled → content/ (${apps.length} apps: ${defaultApps.length} installed by default, ` +
    `${optInApps.length} opt-in; ${docCount} guide/platform/ops pages; ` +
    `${expected.length} pages verified)`,
);
