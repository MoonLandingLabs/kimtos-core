---
name: app-rename
description: >-
  Playbook for FULLY renaming a kimtos extension app in development — both its
  display name and its internal id/folder — with zero leftover references. Use
  whenever the user says "rename <App> to <X>", "totally/fully rename this app",
  or wants an app's id changed. Covers the folder/file move, the meta id+name,
  and every cross-cutting reference site (registry ownership, home-widget gate,
  Thoth sources, icon glyph, storage-key flag, shared-CSS comments, and the www
  marketing catalog + static copy), plus the rebuild + verification gate. We do a
  clean rename with NO legacy code fallbacks — but if the app's storage partitions
  are id-prefixed (convention 6), renaming the id RENAMES THE PARTITIONS and the
  rename MUST ship a one-time data migration. Check first; see below. Trigger on:
  "rename app", "rename <name> to", "change app id", "fully rename".
---

# kimtos — full app rename (development)

Renaming an app means changing its **id** (the folder name + the string used as
its identity everywhere) AND its **display name**. The id is referenced from
many places that a naive find-replace misses. This is the exact checklist —
follow it in order and finish with the verification gate.

Example runs this codifies: `doccoon` → `notes` (was "Books & Notes"),
`todaytodo` → `tasks` (was "TodayTodo").

## Prime directives

1. **Fully rename the CODE, no legacy.** No `oldid → newid` fallback mappings, no
   compatibility shims in the app's own logic. Every occurrence of the old id and
   old display name is gone when you're done.

   "No legacy" is about **code**, not about the user's **data**. A one-time data
   migration is not a legacy shim — it is the thing that makes the clean rename
   safe. See directive 2.

2. **CHECK THE STORAGE FIRST. The rename may destroy the user's data.**

   > This directive used to say _"No data migration needed — app data lives in
   > unprefixed partitions."_ **That was false**, and an agent that believed it
   > would have silently wiped a user's entire file system (#190). It generalised
   > from the legacy apps and missed the ones that follow the convention — so the
   > app it broke was the _compliant_ one.

   `CLAUDE.md` convention 6 requires every partition to be **prefixed with the app
   id** — records `<id>-<thing>`, blob/kv `<id>:<thing>` — because that is how
   AnubisDB attributes data to an app. **So for a compliant app, the id IS part of
   the storage key: renaming the id renames the partitions, and every row and blob
   the user ever saved stops existing.** There is no server copy to restore from;
   there is no server.

   Before you rename anything, open the app's `<id>.local.ts` (plus any
   `dataStore.kv` / `putBlob` keys) and look at the partition names:

   There are **three** cases, not two, and only one of them destroys data. Check
   which you are in before you touch anything:

   | What you find                                                                                      | Does the rename move the data?                                     | What you must do                                                                                                                |
   | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
   | **Unprefixed** — `todos`, `pages`, `boards`, `chats` (the legacy apps, which predate convention 6) | No. The key has no id in it.                                       | Ownership only: remap `RECORD_OWNER` in `apps/anubisdb/registry.ts`.                                                            |
   | **Prefixed, but NOT with the app id** — pdflib stores `pdf:<id>`                                   | No. `pdf` is a literal, not the id, so a rename does not touch it. | Ownership only: remap `PREFIX_OWNER` (`pdf: '<newid>'`). Easy to miss — the data is fine but becomes "Unmapped" if you skip it. |
   | **Id-prefixed** — `homefs-nodes`, `homefs:<id>` (convention 6)                                     | **YES. Renaming the id renames the partitions.**                   | **Ship a one-time migration** in the same change, or every row and blob the user saved is gone.                                 |

   As of writing, KimtFS is the only id-prefixed app — so the trap is rare, which is
   exactly why the skill got it wrong and why an agent will not notice it in passing.
   New apps must follow convention 6, so the id-prefixed case is the one that grows.

   Never leave the constants un-renamed "to preserve the data": the app then
   violates convention 6 and its data lands under **"Unmapped data"** in AnubisDB
   — which is exactly the signal that a store is named wrong.

   The reference implementation is **`extension/src/apps/kimtfs/migrate.ts`**
   (with `migrate.test.ts`), written for the `homefs → kimtfs` rename. Copy its two
   properties, which are what make it safe:
   - **Copy, then delete — never move.** Nothing old is dropped until its copy
     exists, so a tab closed mid-run costs duplicated effort, never data.
   - **Idempotent by construction** — the trigger is "does the old collection still
     have rows", so re-running is harmless.

   If the user would rather drop the data than migrate it, that is allowed — but it
   must be an **explicit, recorded decision**, never something they discover when
   the app opens empty.

3. **Rename identity, not internals.** Change the id/name/folder and the
   reference sites below. Leave internal variable/function names and generic
   nouns (`loadTodos`, the `todos` collection, "todo"/"book" copy) unless the
   user explicitly asks for a copy overhaul.
4. **Verify every step.** Not done until `typecheck + lint + build` pass for the
   extension, `typecheck` for www, `make build` is green, and a repo-wide grep
   for the old id AND old display name (including the `&amp;` entity form)
   returns nothing —

   **except the migration.** A migration must name the old partitions
   (`homefs-nodes`, `homefs:<id>`) — that is its entire job. Taken literally, the
   zero-grep rule tells you to delete the migration to get the grep to zero, which
   re-creates the data loss you just prevented. The old id survives in exactly two
   places: `migrate.ts` and its test. Nowhere else.

   And **verify it against the data, not just the compiler**: open AnubisDB after
   the rename and confirm the app's data appears **under the app** — not under
   "Unmapped data", and not missing. That single check catches both failure modes.

## Step 0 — discover every reference

Grep the WHOLE repo for the old id and the old display name before touching
anything. Include the HTML-entity form of `&` — `Books &amp; Notes` will not
match a search for `Books & Notes`.

```sh
grep -rn "<oldid>\|<Old Display Name>\|<Old &amp; Name>" . \
  --include='*.ts' --include='*.vue' --include='*.css' --include='*.mjs' --include='*.json' \
  | grep -v "node_modules\|/dist/\|words.txt\|/.git/"
```

`words.txt` is the spellcheck dictionary — ignore matches there (they're English
words, not references).

## Step 1 — rename the folder + files (preserve git history)

```sh
git mv extension/src/apps/<oldid>            extension/src/apps/<newid>
git mv extension/src/apps/<newid>/<oldid>.css        extension/src/apps/<newid>/<newid>.css
git mv extension/src/apps/<newid>/<oldid>.local.ts   extension/src/apps/<newid>/<newid>.local.ts
```

`index.ts`, `meta.ts`, `print.ts` etc. keep their names. `*.local.ts` is
auto-discovered by `import.meta.glob('/src/**/*.local.{js,ts}')` (see
`lib/localRoutes.ts`), so its new filename is picked up automatically.

## Step 2 — the app's own files

- **`apps/<newid>/meta.ts`** — `id: '<newid>'`, `name: '<New Name>'`. This is the
  single source of truth; the descriptor (`index.ts`) reads `appMeta.id`/`.name`,
  so the dock, App Store, onboarding, settings, and window title all update from
  this one change.
- **`apps/<newid>/index.ts`** — fix the CSS import (`import './<newid>.css'`), any
  `ctx.openApp('<oldid>')` self-open/handoff calls, an in-app help title if it
  hard-codes the name, and the header comment.
- **`apps/<newid>/<newid>.css` / `<newid>.local.ts` / `print.ts`** — update the
  header comments (`s/<Old Name>/<New Name>/; s/<oldid>/<newid>/`).

## Step 3 — cross-file references (the ones find-replace forgets)

- **`controllers/appController.ts`** — `HOME_GATES` maps app id → the store flag
  that gates its home widget (e.g. `tasks: 'homeTasks'`). Rename the KEY if the
  app has a home widget.
- **`apps/anubisdb/registry.ts`** — remap ownership (data is otherwise
  "Unmapped"):
  - `RECORD_OWNER`: legacy collection name → owner id (e.g. `todos: '<newid>'`,
    `pages/collections/notes: '<newid>'`).
  - `PREFIX_OWNER`: kv/blob prefix → owner id, only if the app uses a namespaced
    kv/blob prefix. If the new id itself is the prefix, the convention resolves it
    automatically (leading segment before `-`/`:`/`/` that matches an app id).
- **`apps/thoth/index.ts`** — `APP_NAMES` maps app id → short citation label;
  rename the KEY and set the label to the new name (e.g. `tasks: 'Tasks'`).
- **`apps/thoth/sources.ts`** — if the app is a Thoth knowledge-base source, fix
  `app: '<newid>'` and the `doc('<newid>', …)` call.
- **`shared-modules/icons/src/glyphs.ts`** — the app tile is looked up by app id.
  Rename BOTH the `AppId` union member and the `APP_GLYPHS` record key. Then
  **rebuild** `@kimtos/icons` (`npm run build -w @kimtos/icons`) or the extension
  keeps the stale glyph and the tile falls back to a monogram.
- **`shared-modules/config/src/ui.ts`** — ONLY if the app owns a `STORAGE_KEYS`
  entry (a kv/migration flag, e.g. `doccoonMigrated: "doccoon:migrated"`). Rename
  the entry name AND its value, update the references, and **rebuild**
  `@kimtos/config`. In dev, resetting the flag is harmless (the one-time
  migration re-runs as a no-op on empty legacy data).
- **Shared CSS/comments** — `styles/shell.css`, `styles/components.css`, other
  apps' `*.css`, `lib/markdown.ts`, etc. often name the app in comments. Sweep
  them for completeness (`s/<Old Name>/<New Name>/; s/<oldid>/<newid>/`).

## Step 4 — the www marketing site

- **Regenerate the catalog:** `node www/scripts/gen-apps.mjs` (regenerates
  `www/data/apps.ts` from every `meta.ts` — picks up the new id/name).
- **Static marketing copy** is NOT generated — grep `www/components/*.vue` (e.g.
  `AppGrid.vue`) and `www/pages/*.vue` for the old name and fix by hand.
  Watch for the `&amp;` entity form.

## Step 5 — verification gate

```sh
npm run build -w @kimtos/icons      # if the glyph changed
npm run build -w @kimtos/config     # if STORAGE_KEYS changed
npm run typecheck -w @kimtos/extension && npm run lint -w @kimtos/extension && npm run build -w @kimtos/extension
npm run typecheck -w @kimtos/www
make build
# final proof — must print NOTHING BUT the migration (see directive 4).
# migrate.ts and migrate.test.ts name the old partitions on purpose: that IS their job.
# Deleting them to make this grep silent re-creates the data loss you just prevented.
grep -rn "<oldid>\|<Old Name>\|<Old &amp; Name>" . \
  --include='*.ts' --include='*.vue' --include='*.css' --include='*.mjs' --include='*.json' \
  | grep -v "node_modules\|/dist/\|words.txt\|/.git/\|migrate.ts\|migrate.test.ts"
```

**Then verify against the DATA, not just the compiler.** A green build proves the code
compiles under the new id. It proves nothing about the bytes the user already has. Open
AnubisDB and confirm the app's records and blobs appear **under the app**. Two ways this
fails, and the build is green for both:

- the data is **gone** — the id was renamed and the partitions with it (no migration);
- the data sits under **"Unmapped data"** — the storage constants were left on the old id
  to "preserve" it, so the app now violates convention 6.

If the app is id-prefixed, run the migration once (open the app) and re-check.

## Known-acceptable leftovers (development only)

- A user whose stored `installedApps` / `dockPinned` array was customized to
  include the OLD id keeps a stale, ignored entry; the new id re-appears via
  `DEFAULT_APPS` for the common `installedApps: null` case. Fine in dev.
- Generic nouns and internal identifiers ("todo", "book", `loadTodos`, the
  `todos`/`pages` collection names) intentionally stay — this is a rename, not a
  copy/refactor pass.
