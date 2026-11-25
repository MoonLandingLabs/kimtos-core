---
name: new-app
description: >-
  End-to-end playbook for adding a BRAND-NEW app to the kimtos extension — the
  scaffold (meta.ts + index.ts), all seven app conventions, storage, agent
  tools, the icon glyph, the marketing catalog, AND the docs booklet + README /
  architecture rows, plus the verification gate. Use whenever the user says
  "create/add a new app", "scaffold an app", "build a <thing> app", "new app
  <name>", or is starting an app folder from scratch. Not for renaming an
  existing app (see app-rename) or just its icon (see app-icons). Trigger on:
  "new app", "create app", "add an app", "scaffold app", "build an app".
---

# kimtos — create a new app

An app is a folder under `extension/src/apps/<id>/` that is **auto-discovered**
(`import.meta.glob('./*/index.{js,ts}')` in `apps/index.ts`) — there is no
central registry to edit. Identity lives in `meta.ts`; behaviour + UI in
`index.ts`. Because the shared machinery is declarative, a good app is a few
lines plus its own UI — do NOT hand-roll things the conventions give you.

A new app isn't done when it renders. It's done when it follows all seven
conventions **and** it's documented (glyph, booklet, README/architecture) and
the verification gate is green.

## Prime directives

1. **`meta.ts` is identity, `index.ts` is the descriptor.** Never duplicate
   id/name/accent — `index.ts` reads them from `appMeta`. The marketing site is
   GENERATED from `meta.ts`, so a `marketing` block = a site card with no www
   edits.
2. **Every app is free.** There is no tier, plan or paywall concept. An app is
   installed out of the box unless its `meta.ts` sets `optIn: true`, in which case
   it ships uninstalled and is added from the App Store (that only controls when
   on-device models and page scripts start running, never payment). Do not add a
   plan, tier, "pro" flag or badge to an app.
3. **Follow all seven app conventions** (see `CLAUDE.md`) — they're shared and
   declarative. Skipping one is the usual review finding.
4. **Everything your app stores lives in the ONE shared DB — and is read back
   from it.** All persistent data goes through `lib/dataStore.ts`, the single
   `kimtos` IndexedDB that **AnubisDB** is the console over. **Never** open your
   own IndexedDB, and never put app data in `localStorage`. Prefix every partition
   with the app id so AnubisDB attributes it to you automatically.
   - **Read it back from there too.** The store is the source of truth, not a
     write-behind cache: do not keep a second copy of user data in memory, in
     `localStorage`, or anywhere else, and never let the UI and the agent tools
     read from different places. Route both through the app's `<id>.local.ts` so
     there is exactly one path in and out (Step 3).
   - **The test is AnubisDB itself.** If the user cannot see, export and clear
     every last thing your app saved from AnubisDB, your app is storing data
     somewhere it should not be. Anything under **"Unmapped data"** means you
     named a partition wrong.
   - Model weights are the one thing that does NOT go in the DB (they are huge,
     immutable and re-downloadable) — they are cached in Cache Storage and must be
     registered separately so AnubisDB can still account for them. See Step 3b.
5. **Document it in the same change.** Glyph + booklet + README/architecture rows
   are part of "adding an app", not a follow-up. Not done until `make docs-build` and
   `make build` are green.
6. **Reuse before you write.** The suite already has the piece you are about to
   hand-roll. See the next section — read it before you build any UI.

## Reuse before you write — read this BEFORE building UI

The most common review finding is not a missing convention. It is an app that
**reimplemented something the suite already provides**, or reached for a native
browser API instead of ours. Retouch — the app most recently built from this
skill — shipped with the only `window.prompt()` calls left in the entire
extension, while five other apps were already using our themed `promptDialog`.

**Never use `window.prompt` / `window.confirm` / `window.alert`.** All three have
drop-in replacements that already exist:

| Instead of       | Use             | Where                        |
| ---------------- | --------------- | ---------------------------- |
| `window.prompt`  | `promptDialog`  | `components/promptDialog.ts` |
| `window.confirm` | `confirmDialog` | `components/confirm.ts`      |
| `window.alert`   | `infoDialog`    | `components/infoDialog.ts`   |

A native dialog **cannot be themed** — it ignores the CSS custom-property tokens
that make System/Light/Dark work — and it is unreliable inside the floating
(document-PiP) window that apps can opt into with `popout: true`.

**Shop `components/` and `lib/` before writing your own.** `components/` has 33
modules and is load-bearing, not a toybox — usage across apps today:

| Component      | Apps | Component        | Apps |
| -------------- | ---- | ---------------- | ---- |
| `confirm`      | 10   | `contextMenu`    | 4    |
| `popover`      | 8    | `historySidebar` | 3    |
| `resizer`      | 7    | `progressBar`    | 3    |
| `bulkSelect`   | 6    | `snackbar`       | 3    |
| `promptDialog` | 5    | `copyButton`     | 3    |

Also there: `sidebarShell`, `undoToast`, `pickerDialog`, `lightbox`, `spinner`,
`audioPlayer`, `videoPlayer`, `imageInput`, `imagePanel`, `imageCropper`,
`resultView`, `proGate`, `widgetCard`, `icons`. And in `lib/`:
`createMediaTextApp` (an entire app shape — see televoica/denoise), `api`,
`dataStore`, `appConfig`, `pip`.

If a component **nearly** fits, generalise it in place. A second near-copy is how
the suite ends up with two of everything.

### The shared modules — a fact lives in exactly ONE place

`shared-modules/*` is the single source of truth **across the workspaces** (the
extension, www, docs). If a value is there, do not restate it — a
second copy is a bug waiting to drift, and drift is this repo's defining failure.

**`@kimtos/config` — never hardcode any of these.** The extension already imports
from it in 12 places:

| Instead of a literal                       | Import from `@kimtos/config/ui`                |
| ------------------------------------------ | ---------------------------------------------- |
| `'transformers-cache'` / `'kimtos-models'` | `CACHE_NAMES` — model caches                   |
| `` `history:${id}` ``                      | `historyKey(appId)` — media/history partitions |
| a magic `z-index`                          | `Z_INDEX` — the whole layering system          |
| an ad-hoc kv key                           | `STORAGE_KEYS`                                 |

and from `@kimtos/config` itself: `DEFAULTS` (`docsUrl`, `chromeWebStoreUrl`). **Never hardcode a URL** — one literal in `DEFAULTS` is the single place it may live. Kimtos v1 has no backend:
an app never calls a Kimtos server.

**`@kimtos/icons` — ALL app iconography lives here. No image files, ever.** Inline
SVG only (the extension is offline-first). Note there are two distinct icon
surfaces, and they are not interchangeable:

| Surface                      | Module                                                                                         | What it is                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Your app's **icon**          | `@kimtos/icons` — `APP_GLYPHS`, `appGlyphSvg`, `appTileSvg`, `paintAppTile`                    | the glyph + accent-gradient tile, rendered identically by the dock, App Store, www and docs |
| **UI icons inside** your app | `components/icons.ts` (23 of them: `TRASH`, `PLUS`, `DOWNLOAD`, `PENCIL`, `COPY`, `SEARCH`, …) | the extension's in-app icon set                                                             |

Never inline your own SVG for either. If the icon you need does not exist, add it
to the shared set — do not keep it in your app.

**`@kimtos/prompts` — LLM prompts are Markdown files here, not template strings in
your app.** If your app prompts a model, add the prompt to the module and render it
with `renderPrompt` / `stripPreamble` (see `apps/rephrase/index.ts`). A prompt
buried in a TS string cannot be reviewed, reused or iterated on.

### Never hardcode a value — least of all a colour

**Every colour is a `var(--token)`. No exceptions in app code.** No `#hex`, no
`rgb()/rgba()`, no `hsl()` — not in your CSS, not in an inline `style`. This is not
a style preference: the app supports System / Light / Dark, and the light palette
works by **redefining the tokens**. A literal colour is therefore simply _wrong_ in
one of the two themes — usually invisible.

If the colour you need has no token, **add a token** (defined in the base palette
_and_ both light blocks in `extension/src/styles/base.css`) — never inline it. Reach
for the semantic ones first: `--accent`, `--danger`, `--warning`, `--text`,
`--text-secondary`, `--surface*`, `--hairline*`, `--material*`, `--panel`, `--field`,
`--on-accent`. Read the **`theming` skill** before you write a single colour.

There is a live example of getting this wrong: three apps each invented their own
green because no positive/success token existed, and one of them renders dark-green
text in dark mode, where it cannot be read (#72).

The same rule generalises: **a magic number is a bug in waiting.** A z-index, a cache
name, a storage key, a URL — if the value already exists in
`@kimtos/config` or `meta.ts`, import it. If it does not exist, define it once, in the
shared place, and import it.

### If you find an app breaking any of this, FILE AN ISSUE

These rules are only worth anything if they are enforced on the apps we already
shipped. **Whenever you notice an existing app violating this skill — an inline
colour, a native dialog, a hand-rolled copy of a component, a hardcoded value, a
missing booklet — open a GitHub issue for it.** Do not fix it inside
whatever branch you happen to be on (that is scope creep and it buries the finding),
and do not merely mention it in chat, where it is lost.

Verify it first, quote the file and line, and say what it costs the user. Every rule
above exists because an app broke it and nobody wrote it down: #62 (native dialogs),
#65 (the README table), #72 (inline colours).

## Step 0 — decide identity

Pick `id` (lowercase, the folder name), display `name`, `accent` (hex), and `order`
(dock position, lower first). Check the id isn't
taken (`ls extension/src/apps`) and that no other app shares the accent too
closely.

## Step 1 — `meta.ts` (identity + marketing)

```ts
// extension/src/apps/<id>/meta.ts
import { defineMeta } from '../meta';

export default defineMeta({
  id: '<id>',
  name: '<Display Name>',
  accent: '#38bdf8',
  order: 40,
  // optIn: true, // ships uninstalled; added from the App Store
  marketing: {
    // Omit the whole marketing block to keep an app dock-only (off the website).
    tech: 'On-device · <lib>',
    desc: 'One-sentence pitch of what it does.',
    points: ['Highlight one', 'Highlight two', 'Highlight three'],
    featured: false,
  },
});
```

**There is no `version` field** — an app's version is the newest entry in its own
`CHANGELOG.md`, and nowhere else (#132). Do not add one back; the type does not accept it.

Keep `meta.ts` free of DOM/chrome/runtime imports — the www generator imports it
in Node.

## Step 1b — `CHANGELOG.md` (the version AND the "New" badge)

Every app **must** ship a `CHANGELOG.md`, with a dated initial entry:

```md
# Changelog

## 1.0.0 — <YYYY-MM-DD>

- Initial release. <one line on what it does>
```

This one file is load-bearing twice over, which is why it is a first-class step and not an
afterthought:

- **It is the app's version.** The newest entry is the version the App Store, the docs site
  and every bug report show (#132). An app with no `CHANGELOG.md` has no version, and the
  build **fails loudly** (`compileAppChangelogs` throws) rather than pretending it is 1.0.0.
- **Its date earns the "New" badge.** The OLDEST entry's date is the app's first-release date,
  and a freshly published app carries a **`New` badge for `NEW_APP_DAYS` (30 days)** from it —
  automatically, on the App Store card + detail, the marketing grid and the docs app cards.
  The badge then expires on its own; there is nothing to remove later. The rule is
  `isNewApp` in `@kimtos/config`; the date is derived by `unitFirstReleased` in
  `@kimtos/releaser` and compiled into `appFirstReleased` (`src/data/appChangelogs.ts`).
  Get the date right and honest — it is a public claim about when the app shipped.

Use the **real** release date (today, when the app first ships), not a placeholder. No new
field on `meta.ts` carries this — the changelog is the single source, exactly as with the
version.

## Step 2 — `index.ts` (the descriptor + UI)

```ts
// extension/src/apps/<id>/index.ts
import './<id>.css';
import { el } from '../../lib/dom.js';
import appMeta from './meta.js';

interface Ctx {
  openApp?: (id: string) => void;
  openAppStore?: () => void;
}

const app = {
  id: appMeta.id,
  name: appMeta.name,
  accent: appMeta.accent,
  order: appMeta.order,
  description: 'Short description used in listings.',
  tip: 'One-time first-run hint (Convention 1). 1–2 sentences.', // shown once, dismissible
  dialog: { size: 'md' }, // Convention 4 — see sizing note below
  tools: [], // Convention 5 — MCP-shaped agent tools; fill in Step 4

  render(body: HTMLElement, ctx: Ctx = {}) {
    const root = el('div', '<id>');
    body.replaceChildren(root);
    // …build your UI into root…
    return () => {
      /* teardown: dispose engines, listeners */
    };
  },
};

export default app;
```

Now satisfy the **seven conventions** (full detail in `CLAUDE.md`):

1. **First-time tip** — the `tip:` string above (required for every app except
   Calculator). Don't hand-roll a banner.
2. **Batch delete** — for ANY list of user items you can delete. Use
   `createBulkSelect` (`components/bulkSelect.ts`) for custom lists, or pass
   `selectable: true` + `bulkConfirm`/`bulkUndo` to `createHistorySidebar` /
   `createMediaTextApp`. One confirm, one undo. (N/A if the app has no
   deletable list.) A row's OWN delete button goes through the same component —
   `bulk.deleteOne(entry)` — never straight to your delete route, or the single
   delete silently loses the confirm and the undo the batch one has (#724).
3. **System tip** — add ONE ~55–65 char single-line entry to
   `src/data/tips.ts` for the dock's rotating tip line.
4. **Window sizing** — nothing to do. Every app window mounts at the one standard
   size and is always maximizable; a descriptor has no `dialog` field to set.
5. **Agent tools** — Step 4.
6. **Storage** — Step 3.
7. **Icon glyph** — Step 5.

## Step 3 — storage (`<id>.local.ts` + `dataStore`)

Persist through the shared `dataStore` (`lib/dataStore.ts`) only. Route data
access through a sibling `<id>.local.ts` (auto-discovered by
`import.meta.glob('/src/**/*.local.{js,ts}')`) so the UI and agent tools share
one path; the UI calls it via `getApi`/`jsonApi`/`callApi`/`fileUrl`
(`lib/api.ts`). **Prefix every partition with the app id:**

- records collection → `<id>-<thing>` (e.g. `clipboard-items`)
- blob namespace / kv key → `<id>:<thing>` (e.g. `thoth:hashes`)
- media/history apps → `history:<id>` (handled by the shared sidebar)

Anything not id-prefixed lands under **"Unmapped data"** in AnubisDB — that's the
signal you named a partition wrong. No `apps/anubisdb/registry.ts` edit is needed
when you use the prefix.

**One path in, one path out.** `<id>.local.ts` is not a convenience wrapper — it is
the only route to your data. The UI reads through it, and so do the agent tools
(Step 4), which is what keeps them from drifting apart. Never read the DB directly
from a component, and never keep a shadow copy of user data outside the store.

**Verify it in AnubisDB, not in your own UI.** Open AnubisDB and confirm every
record, blob and kv key your app wrote is listed under your app's name, and that
Export and Clear round-trip it. That is the acceptance test for storage — if
AnubisDB cannot see it, the user cannot export it, and it is effectively invisible
data on their machine.

(For completeness: per-app _settings_ are the one standing exception — they live in
the sync `store` because the service worker and content scripts must read them, and
are mirrored into `dataStore.kv` under `settings:<id>` so they still appear in
AnubisDB and ride along in a backup.)

## Step 3b — on-device model? register it (AI apps only)

Model weights do NOT live in the shared DB — they are hundreds of MB of immutable,
re-downloadable binaries, so Transformers.js caches them in **Cache Storage**
(`transformers-cache`) and Tesseract in its own IndexedDB. AnubisDB surfaces them
in a separate **Model storage** panel, which shows each app's cached size and lets
the user free it.

That panel attributes a model to an app through `CACHE_GROUPS` in
`extension/src/lib/modelStorage.ts`. **Add an entry, or your model shows up under
"Other models"** — the user cannot see it belongs to your app, and cannot free it
per-app:

```ts
// extension/src/lib/modelStorage.ts
{ app: '<id>', label: '<Model> · <what it does>', cache: CACHE_NAMES.transformers,
  match: (u) => /<model-name-in-the-url>/i.test(u) },
```

Televoica (Whisper), Grammit (FLAN-T5), Thoth (MiniLM), KimtAI (chat models),
Denoise (DeepFilterNet) and SnapText (Tesseract) are all registered there — copy
the nearest one. Put the engine itself in `lib/engines/<id>.ts`, mirroring
`engines/transcribe.ts` (lazy `import('@huggingface/transformers')`, normalized
`onProgress`, `CACHE_NAMES.transformers`).

Also confirm the model's licence **and its training data's licence** before you
ship it, and note that the weights load from a third-party Hugging Face repo that can vanish
or change — pin the exact repo and file, and list it in `docs/extension/models.md`
(see the model-hosting section of `CLAUDE.md`).

## Step 3c — running anything in the background? register it with KimtManager

**Every piece of work that outlives the user's attention goes through the orchestrator,
`extension/src/lib/kimtManager.ts`. There are no exceptions, and "it's quick" is not one.**

A model download, a transcription, an export, a bulk import, a long re-index — if the user can
start it and then look away, it registers. Work that does not is _invisible_: it cannot be seen,
cannot be stopped, and cannot be told apart from the app having hung. That is the bug KimtManager
exists to make impossible (#1172), and an app that runs a promise on the side reintroduces it.

```ts
import { kimtManager } from '../../lib/kimtManager.js';

const job = kimtManager.start({
  appId: appMeta.id,
  title: `Transcribing ${name}`, // written for the USER, not for a log
  kind: 'compute', // 'download' | 'compute' | 'export' | 'other'
  run: async (ctx) => {
    const out = await engine(input, {
      onProgress: (p) => ctx.progress(p.ratio ?? null), // null when unmeasurable — never invent one
      signal: ctx.signal, // honour it, or Stop is a lie
    });
    if (ctx.signal.aborted) return; // do not save a partial result
    await save(out);
  },
});

await job.run(); // resolves when it settles; NEVER rejects
if (job.status() === 'failed') showError(job.error());
```

What you get for those few lines, and would otherwise have to build: a row in KimtManager and in
the switcher, live progress, a working Stop, queueing so two downloads do not fight over one
connection, and a failure the user is actually told about.

The API — `register`, `start`, `cancel`, `statusOf`, `get`, `list`, `running`, `queued`, `active`,
`jobFor`, `failedFor`, `clearFailed`, `subscribe`, `tasks` — plus the handle it hands back
(`job.run()`, `job.cancel()`, `job.status()`, `job.progress()`, `job.label()`, `job.error()`).

Rules that are easy to get wrong:

- **`cancellable: false` for work that cannot be safely interrupted** (an uninstall mid-delete).
  The row then offers no Stop, rather than a button that silently does nothing — which is exactly
  what an uninstall's Stop was before it was declared this way.
- **Honour `ctx.signal`.** A job that ignores it keeps running after the user stopped it, and the
  UI has already told them it stopped.
- **Do not invent progress.** `ctx.progress(null)` is the honest answer for work that cannot be
  measured; a bar that does not track anything is a lie the user plans around.
- **`run()` is idempotent** — calling it twice joins one outcome. Several surfaces can hold the
  same job, and none of them meant "do it twice".
- **Jobs are per app and per lane.** One job per `appId` at a time; downloads and compute queue
  separately, so a transcription the user just asked for never waits behind a model download.

### It does NOT replace `jobStore`

`lib/jobStore.ts` writes the work down **before it starts**, so work survives the page dying
(#314). The orchestrator is in memory and cannot. They are complementary and a long-running job
that owns user input should use both: `beginJob` for durability, `kimtManager.start` for
visibility and control. See `apps/denoise/index.ts` for the pattern.

## Step 4 — agent tools

Expose the app's capabilities to the KimtAI agent as an MCP-shaped `tools` array
on the descriptor. `lib/agentTools.ts` auto-collects the tools of every
_installed_ app — no wiring.

```ts
tools: [
  {
    name: 'list_<things>', // verb_noun; also get_/create_/update_/delete_/search_
    description: 'What it does, for the model.',
    parameters: { type: 'object', properties: { /* JSON-Schema */ }, required: [] },
    // needs: { attachment: 'image' | 'audio' }  // only for media/compute tools
    run: async (args, ctx) => {
      // go through the same <id>.local.ts routes the UI uses
      return { ok: true, result: '<string for the model>', summary: '<short label>' };
    },
  },
],
```

Rules: cover the whole user-facing surface (CRUD + get + search); `run` NEVER
throws to the user — return `{ ok: false, result, summary }` for
not-found/validation; keep `result` compact (it's re-fed to a small on-device
model). Media tools declare `needs: { attachment }` and read via
`ctx.attachment(kind)`. See `CLAUDE.md` Convention 5 for the full contract.

## Step 5 — icon glyph

Add a 24×24 line-mark glyph to `APP_GLYPHS` in
`shared-modules/icons/src/glyphs.ts` (and the `AppId` union), keyed by the app
id, then rebuild `@kimtos/icons`. **Follow the `app-icons` skill** for the design
rules and the exact edit + rebuild. Without a glyph the tile falls back to a
letter monogram.

## Step 6 — system tip

Append one entry to `extension/src/data/tips.ts` (Convention 3) — single line,
~55–65 chars, covering the headline feature.

## Step 7 — home widget (optional)

If the app contributes a home-dashboard card, add **three** things to the descriptor
and nothing else:

```ts
widgetLabel: 'Pin boards',                         // the Settings toggle's label
widgetHint: 'Show your recent whiteboards on the home',
async widget(ctx) { /* return the card, or null when there's nothing to show */ },
```

**The Settings ▸ Preferences toggle is generated from that declaration.** Do **not**
hand-write a toggle in `views/settings.ts`, do **not** add a boolean to `Settings`,
and do **not** register the app in a gate map — `HOME_GATES` no longer exists.

State lives in `store.homeWidgets` (`{ [appId]: false }` for hidden cards, keyed by
app id like `tipsSeen`); absent means shown.

Omitting `widgetLabel` is safe — the toggle still renders as `Pin <name>`. That is
deliberate: a card can never ship with no way to turn it off. It used to be four
hand-maintained lists that had to agree, and two apps (KimtAI, NotaBoard) shipped
cards the user could not remove at all, while a dock tip promised any card could be
unpinned (#83).

Return `null` from `widget()` when the app has no data — cards hide themselves when
empty rather than showing an empty shell.

## Step 8 — the generated catalogs (mostly nothing to do)

`meta.ts` is the single source of truth for your app's identity, and
**these catalogs derive from it**. You do not hand-edit any of them:

| Catalog                               | Generated by                               | What it feeds                                                         |
| ------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `www/data/apps.ts`                    | `www/scripts/gen-apps.mjs`                 | the marketing-site app grid (incl. `firstReleased` → the "New" badge) |
| `extension/src/data/appChangelogs.ts` | `extension/scripts/gen-app-changelogs.mjs` | per-app version + history + first-release date (the "New" badge)      |
| the docs-site app pages               | `www-docs/scripts/build-content.mjs`       | the docs site (incl. the "New" badge)                                 |

These run on their workspace's predev/prebuild hooks, so a normal build regenerates them.

Two more things worth knowing:

- **CI asserts the generated data files have not drifted.**
  `scripts/check-generated.mjs` re-runs each generator and fails if the committed
  output moved — `appChangelogs.ts` and `changelog.ts`. If you add an
  app and commit without building, the Extension and Unit tests
  jobs both fail. Run `npm run gen -w @kimtos/extension` and commit the result.
- **The docs build reads `extension/src/apps`** — that is where the metas live. If a
  catalog ever builds empty, that is why.

An app with a `marketing` block appears in the site grid automatically. Static
marketing copy (feature sections) is NOT generated; only touch it if the
app changes a headline claim.

## Step 9 — documentation booklet + README/architecture

1. **Booklet** — create `docs/extension/apps/<id>/booklet.toml` and
   `content/NN-*.md` chapters (typically `01-overview`, `02-getting-started`,
   `03-architecture`). **One `# H1` per file**, first line. Mirror an existing
   booklet (e.g. `docs/extension/apps/tabs/`).

   The booklet is not just internal docs: `www-docs` builds **one page per app on
   the docs site** from it. **This is enforced** — `build-content.mjs` runs
   `assertBookletsMatchApps()`, so a shipped app with no booklet **fails CI**
   (the Docs job), rather than quietly going missing from the public docs.

   ```sh
   make docs        # the docs site, live — read your booklet as it will publish
   make docs-build  # the same site, built — FAILS if the booklet is missing
   ```

   ### The public docs site is USER-FACING ONLY

   the docs site publishes exactly two things: the **app booklets** and the
   hand-written **user guides** (`www-docs/authored/guides/`). Nothing else.

   **Never publish internal or developer documentation there** — not
   `docs/extension/architecture.md`, not `creating-an-app.md`, not `releasing.md`,
   not a `*-app-plan.md`, not ops runbooks. `DOC_PAGES` in
   `www-docs/scripts/build-content.mjs` is deliberately **empty** and stays that
   way. Those documents are written for us, they name internal files and
   unreleased work, and the audience for them does not read the docs site.

   So when you add an app: the **booklet** is public (write it for a user), and any
   design note or plan you wrote along the way stays in `/docs`, unpublished. If a
   change genuinely belongs in front of users, it belongs in a **guide**, not in a
   developer doc that got promoted.

2. **Root `README.md`** — nothing to do. It no longer lists apps; the public catalog
   is the marketing site, **generated** from every `meta.ts`
   (`www/scripts/gen-apps.mjs` → `www/data/apps.ts`).
   Your row's copy comes from `marketing.desc` and `marketing.tech`, so fix the wording
   in `meta.ts` — it updates the website at once.
3. **`docs/extension/architecture.md`** — if the app introduces a new subsystem
   or file worth naming, add it; otherwise the booklet is enough.

## Step 10 — verification gate

```sh
npm run build -w @kimtos/icons                                   # glyph added
npm run typecheck -w @kimtos/extension \
  && npm run lint -w @kimtos/extension \
  && npm run format:check -w @kimtos/extension \
  && npm run build -w @kimtos/extension
node www/scripts/gen-apps.mjs && npm run typecheck -w @kimtos/www
make docs-build                                                  # docs site; FAILS if the booklet is missing
make build                                                       # full build green
```

`www-docs` has CI, the _Docs_ job, and it is what catches a missing booklet.

Then sanity-check in the extension: the app appears in the App Store, installs
(auto-installed, or after you add it from the App Store for an `optIn` app), opens with its tip, its data shows
under its own name in AnubisDB (not "Unmapped data"), **an on-device model shows
under YOUR app in AnubisDB's Model storage (not "Other models")**, and its tools
show up for the KimtAI agent.

## Checklist

- [ ] **Reused, not hand-rolled** — no `window.prompt`/`confirm`/`alert`; checked
      `components/` + `lib/` before writing any dialog, sidebar, list-selection,
      toast, progress bar, popover or context menu
- [ ] **Shared modules, not literals** — icons from `@kimtos/icons` /
      `components/icons.ts` (no image files, no inline SVG); `CACHE_NAMES`,
      `historyKey`, `Z_INDEX`, `STORAGE_KEYS` and any URL from `@kimtos/config`;
      LLM prompts in `@kimtos/prompts`
- [ ] **No inline colours** — every colour a `var(--token)`; verified in BOTH Light
      and Dark. No magic numbers anywhere (see the `theming` skill)
- [ ] **Filed an issue** for any existing app you saw breaking these rules
- [ ] `meta.ts` — id/name/accent/order (+ marketing); **no `version` field** (#132)
- [ ] `CHANGELOG.md` — dated `## 1.0.0 — YYYY-MM-DD` initial entry. It is the app's version
      AND its first-release date, which earns the `New` badge for 30 days on every surface
- [ ] `index.ts` — descriptor reads `appMeta`; `render` returns teardown
- [ ] Convention 1 — `tip`
- [ ] Convention 2 — batch delete (if it has a deletable list)
- [ ] Convention 3 — dock tip in `data/tips.ts`
- [ ] Convention 4 — `dialog` sizing
- [ ] **Background work registered with `kimtManager`** (Step 3c) — nothing long-running
      started on the side; `ctx.signal` honoured; `cancellable: false` where it cannot be stopped
- [ ] Convention 5 — agent `tools`
- [ ] Convention 6 — id-prefixed `dataStore` partitions via `<id>.local.ts`; every
      record/blob/kv the app wrote is visible under its own name in AnubisDB (not
      "Unmapped data"), and Export/Clear round-trip it. No shadow copy of user data
      anywhere else
- [ ] On-device model registered in `lib/modelStorage.ts` `CACHE_GROUPS` (AI apps),
      and its licence checked
- [ ] Convention 7 — glyph in `@kimtos/icons` (rebuilt)
- [ ] Convention 9 — home card (if applicable): `widget()` + `widgetLabel`. The
      Settings toggle is **generated** from that — never hand-add one, and there is no
      gate map to register in
- [ ] Generated catalogs rebuilt (www, docs site) — and the
      generated-data drift assert is green
- [ ] Docs booklet (CI-enforced) + architecture note
      and CI-asserted — do not hand-write it
- [ ] Verification gate green
