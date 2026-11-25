# Creating a new app

An app is a folder under `extension/src/apps/<id>/` that is **auto-discovered** —
`apps/index.ts` globs `./*/index.{js,ts}`, so there is no central registry to
edit. Identity lives in `meta.ts`; behaviour and UI in `index.ts`. The shared
machinery is declarative, so most of an app is its own UI plus a few lines of
wiring — don't hand-roll what the conventions give you.

This is the human how-to. For the exact agent playbook see the `new-app` skill
(`.claude/skills/new-app/`); the per-app rules it enforces are the
[app conventions in `CLAUDE.md`](../../CLAUDE.md); the icon step is the
[`app-icons` skill](../../.claude/skills/app-icons/).

> An app isn't done when it renders — it's done when it follows all seven
> conventions **and** it's documented (glyph, booklet, README row) and the
> [verification gate](#verification) is green.

## 1. Identity — `meta.ts`

`meta.ts` is the single source of truth for id/name/accent and the marketing
card. Keep it free of DOM/chrome imports (the website generator imports it in
Node).

```ts
import { defineMeta } from '../meta';

export default defineMeta({
  id: '<id>', // lowercase, = the folder name
  name: '<Display Name>',
  accent: '#38bdf8',
  order: 40, // dock position, lower first
  // optIn: true, // ships uninstalled; added from the App Store (still free)
  marketing: {
    // omit to keep the app dock-only (off the site)
    tech: 'On-device · <lib>',
    desc: 'One-sentence pitch.',
    points: ['Highlight one', 'Highlight two', 'Highlight three'],
  },
});
```

**Every app is free.** Apps are installed out of the box unless `optIn: true`, in which case
they ship uninstalled and the user adds them from the App Store (this is about on-device
models and page scripts only running on request).

## 2. Behaviour — `index.ts`

`index.ts` default-exports the descriptor. It reads identity from `appMeta`, so
nothing is duplicated. `render(body, ctx)` builds the UI into `body` and returns
a teardown function.

```ts
import './<id>.css';
import { el } from '../../lib/dom.js';
import appMeta from './meta.js';

export default {
  id: appMeta.id,
  name: appMeta.name,
  accent: appMeta.accent,
  order: appMeta.order,
  description: 'Short description used in listings.',
  tip: 'One-time first-run hint.', // Convention 1
  tools: [], // Convention 5
  render(body, ctx) {
    const root = el('div', '<id>');
    body.replaceChildren(root);
    // …build UI…
    return () => {
      /* teardown */
    };
  },
};
```

## 3. The seven conventions

Every app must follow all seven (full detail in
[`CLAUDE.md`](../../CLAUDE.md)):

| #   | Convention     | How                                                                                                                                                                                                                                                                           |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First-time tip | `tip:` string on the descriptor (all apps except Calculator)                                                                                                                                                                                                                  |
| 2   | Batch delete   | `createBulkSelect` (custom lists) or `selectable`+`bulkConfirm`/`bulkUndo` (shared sidebar) — for any deletable list. A row's own Delete goes through the same component (`bulk.deleteOne`), never straight to the store. Add `isProtected` if the app has a "keep this" mark |
| 3   | System tip     | one ~55–65 char line in `src/data/tips.ts`                                                                                                                                                                                                                                    |
| 4   | Window sizing  | none — every app window mounts at the one standard size and is maximizable; there is no descriptor field to set                                                                                                                                                               |
| 5   | Agent tools    | MCP-shaped `tools` array (see below)                                                                                                                                                                                                                                          |
| 6   | Storage        | shared `dataStore`, id-prefixed partitions (see below)                                                                                                                                                                                                                        |
| 7   | Icon glyph     | `APP_GLYPHS` in `@kimtos/icons` (see below)                                                                                                                                                                                                                                   |

## 4. Storage

All persistent data goes through the shared `dataStore` (`lib/dataStore.ts`) —
never open your own IndexedDB or use `localStorage`. Route access through a
sibling `<id>.local.ts` (auto-discovered) so the UI (`getApi`/`jsonApi` from
`lib/api.ts`) and the agent tools share one path. **Prefix every partition with
the app id:**

- records collection → `<id>-<thing>` (e.g. `clipboard-items`)
- blob namespace / kv key → `<id>:<thing>` (e.g. `thoth:hashes`)
- media/history apps → `history:<id>`

Anything not id-prefixed shows up under **"Unmapped data"** in AnubisDB — the
signal you named a partition wrong.

## 5. Agent tools

Expose capabilities to the KimtAI agent as an MCP-shaped `tools` array;
`lib/agentTools.ts` auto-collects them from every installed app. Each
tool is `{ name, description, parameters (JSON-Schema), needs?, run(args, ctx) }`
and `run` returns `{ ok, result, summary, artifact? }`. Name them `verb_noun`
(`list_`, `get_`, `create_`, `update_`, `delete_`, `search_`), cover the whole
surface, and never throw — return `{ ok: false, … }` for not-found/validation.

## 6. Icon glyph

Add a 24×24 line-mark glyph to `APP_GLYPHS` in
`shared-modules/icons/src/glyphs.ts` (and the `AppId` union), keyed by the app
id, then rebuild `@kimtos/icons`. Follow the
[`app-icons` skill](../../.claude/skills/app-icons/) for the design rules. The
same glyph renders on the dock, the App Store, and the marketing grid.

## 7. Website

The site's app grid is generated from every `meta.ts`:

```sh
node www/scripts/gen-apps.mjs   # regenerates www/data/apps.ts
```

An app with a `marketing` block appears in `AppGrid.vue` automatically. It also
runs on the www predev/prebuild hooks.

## 8. Documentation

1. **Booklet** — `docs/extension/apps/<id>/booklet.toml` + `content/NN-*.md`
   chapters (overview / getting-started / architecture). **One `# H1` per file.**
   Mirror an existing booklet (e.g. `apps/tabs/`) and preview it with `make docs`.
2. **[`architecture.md`](architecture.md)** — add a note only if the app
   introduces a subsystem worth naming.

The public app catalog is the marketing site, generated from `meta.ts` (step 7) —
there is no app list in the README to update.

## Verification

```sh
npm run build -w @kimtos/icons                         # glyph added
npm run typecheck -w @kimtos/extension \
  && npm run lint -w @kimtos/extension \
  && npm run format:check -w @kimtos/extension \
  && npm run build -w @kimtos/extension
make docs-build                                        # docs site; FAILS if the booklet is missing
node www/scripts/gen-apps.mjs && npm run typecheck -w @kimtos/www
make build                                             # full build green
```

Then in the extension: the app appears in the App Store, installs (automatically, or from the App Store for `optIn` apps), opens with its tip, its data is attributed to it in
AnubisDB, and its tools show up for the KimtAI agent.
