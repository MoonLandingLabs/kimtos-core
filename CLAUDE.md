# CLAUDE.md

**Kimtos v1 is free and open source (MIT) and has no accounts, no backend and no servers.** It is a Chrome
extension that runs entirely in the browser, plus a static marketing site (`www/`) and a static docs site
(`www-docs/`). Never add an account, sign-in, server call to a Kimtos-operated host, telemetry, or a
backend; the owner has ruled these out for v1.

Project notes for AI assistants and maintainers. See `docs/extension/architecture.md` for how
the app is built and `docs/extension/releasing.md` for the release flow.

## Skills — reach for the right one (ALL agents, ALWAYS)

This repo ships **skills** under `.claude/skills/<name>/SKILL.md`. Claude Code loads each skill's
description automatically and pulls in the full skill **on demand** when a task matches — but they
are on-demand, so this index (in the always-loaded CLAUDE.md) is your reminder that they exist and
when to use each. **Before starting work in an area below, invoke its skill.** One is
non-negotiable: **`issue-workflow`** — invoke it FIRST, not after you have started.

| Skill                  | Use it when…                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`issue-workflow`**   | The user gives you a GitHub issue (link, `#N`, or "work on / fix this"). **Invoke FIRST** — see the section below.                                    |
| **`issue-create`**     | You are about to FILE an issue — including the complex gaps the section below tells you to open. **Invoke FIRST**, never hand-roll `gh issue create`. |
| **`issue-triage`**     | Burning down the open backlog — "triage issues", "clear the backlog", "go through the open issues". Parallel agents, one issue each.                  |
| **`on-device-models`** | Adding/changing/removing an AI model or engine — model licensing, ONNX/dtype, the model catalog, the download gate, or the KimtAI system prompt.      |
| **`deploy-release`**   | The release changelog, the Makefile build targets, or Chrome Web Store publishing.                                                                    |
| **`new-app`**          | Adding a brand-new extension app (scaffold + the app conventions).                                                                                    |
| **`app-rename`**       | Fully renaming an app — display name AND internal id/folder.                                                                                          |
| **`dialogs`**          | Any modal / popup / window / overlay / confirm in the extension (always `createDialog`).                                                              |
| **`design-language`**  | Designing or restyling ANY Kimtos UI (www page, app window, mobile): the Material 3 Expressive look — tokens, type, shapes, components.               |
| **`theming`**          | Colour and theming in the extension — tokens, light/dark, over-wallpaper text.                                                                        |
| **`app-icons`**        | Adding or changing an app's icon glyph / tile (`@kimtos/icons` → `APP_GLYPHS`).                                                                       |
| **`use-icons`**        | Rendering the brand mark (logo/favicon) or app-icon tiles from `@kimtos/icons` on any surface.                                                        |

## How we work: issue → merged PR (ALL agents, ALWAYS)

**If the user gives you a GitHub issue — a link
(`github.com/MoonLandingLabs/kimtos-core/issues/<N>`), a number (`#25`), or any form of
"work on / implement / fix this issue" — invoke the `issue-workflow` skill FIRST,
before reading code, branching, or answering.** An issue link on its own is a complete
instruction: it means "run that workflow". Do not improvise a shortcut around it, and
do not start editing without it.

The skill is the standard pipeline every agent follows: claim the issue (labels,
assignee, project status, and a marker comment — **stop if another agent already
claimed it**) → branch in an isolated git worktree (`main_<type>_<slug>`) → plan as an
architect → get the user's sign-off → implement as tracked tasks → pass the same gate
CI runs (never disable a check) → open a PR → review your own PR with the `code-review`
skill and fix its findings until it is green → verify `main` after merge.

It lives in `.claude/skills/issue-workflow/SKILL.md`.

## Found a gap? Handle it by size (ALL agents, ALWAYS)

**Every gap you find gets handled — always, immediately, without being asked.**
A gap is anything the codebase gets wrong or leaves undone: a bug, a docs/code
mismatch, a shipped TODO, dead or unreachable code, a missing test or CI check, a
convention nothing enforces, a stale claim in the README or marketing copy. What
you never do is walk past it. **Triage it by size:**

- **Small — fix it on the fly, do not file it.** A typo, a stale comment, a dead
  link, a one-line doc/code mismatch, an obvious trivial gap: just fix it as part
  of the work in hand. Filing an issue for something you could have fixed in the
  time it took to write the issue is pure overhead. Note it in the PR body.
- **Complex — file it, do not fix it inline.** Anything non-trivial, anything that
  needs its own design decision, or a large change unrelated to what you were asked
  to do (that is scope creep): open a GitHub issue **with the `issue-create` skill**
  and pick it up through the `issue-workflow` skill. When in doubt about which bucket
  a gap falls in, file it — a filed issue is cheap to close, a bad inline change is not.

Rules for the complex ones you **do** file:

- **File it when you find it**, even mid-task and even if it is unrelated to what you
  were asked to do. An unfiled gap is a lost gap.
- **Check for a duplicate first** (`gh issue list`), and skip it if it is already open.
- **One issue per gap.** Cite `file:line`, show the failing case, name the root cause,
  and propose the fix. If the gap is one instance of a systemic problem, say so and
  prefer the structural fix.
- Label it (`bug`, `documentation`, `enhancement`), put it on the active milestone
  (**`0.7.0`**) if we mean to do it, and **no emojis** — see below. The `issue-create`
  skill carries all of this; use it rather than remembering it.

Report what you fixed on the fly and the issues you filed in your reply, with links.

## Writing conventions (ALL agents, ALWAYS)

- **No emojis. Anywhere.** Not in code, code comments, commit messages, issues,
  issue comments, PR titles or PR bodies. Write the word instead, or use a plain
  `Yes`/`No`/`-` in a table.

  **Where the line is** (this is enforced, not advisory — `scripts/check-emoji.mjs`
  runs in CI and fails the build):

  |                                                                                                         | Rule                                                                                                                                                                        |
  | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Colour emoji** — a sleeping symbol, a pushpin, a party popper, a padlock, a waving hand, a green tick | **Banned.** Formally: anything Unicode gives an emoji presentation by default (`Emoji_Presentation=Yes`), or that is forced to colour with the variation selector `U+FE0F`. |
  | **Typographic glyphs** — `⌘ ▸ ★ ✕ ✓ ⬇ ♪ © ·`                                                            | **Fine.** These are not emoji. Several are load-bearing UI with no icon asset behind them, and `©` must obviously survive in a copyright notice.                            |

  (The banned column is described in words rather than shown: this file is checked too,
  and a rule whose own statement is exempt from it is not a rule.)

  A glyph that is doing a real job needs a real affordance when you remove it — a
  word or an SVG, not a different pictograph. The Tabs badges became `Pinned` /
  `Asleep`; the onboarding padlock became a plain word.

  There is no exception: the allowlist in the checker is empty.

## Git commit conventions (ALL agents, ALWAYS)

- **Never add a `Co-Authored-By` trailer** (or any "Generated with…"/tool
  attribution) to commits. Commit messages contain only the change description.
- Use **Conventional Commits** (`type(scope): summary`), matching the existing
  history (`feat(www): …`, `fix(extension): …`, `chore(infra): …`).
- Commit/push only when the user asks. `main` is the default branch and the
  release branch.

## Releasing and versioning (ALL agents, ALWAYS)

The full flow is `docs/extension/releasing.md` (and the `deploy-release` skill);
what every agent must know without opening it:

- The extension version lives in **two files that must always match**:
  `extension/manifest.json` and `extension/package.json`. After bumping both, run
  `npm install --package-lock-only` so the root lockfile follows. The release
  workflow fails if the tag does not match the manifest.
- The published line is **`1.0.x`** — routine releases bump the patch
  (`1.0.2`, `1.0.3`, …). A minor/major bump is the owner's call, never an agent's.
- **Version history is one-way**: the Chrome Web Store refuses any version lower
  than or equal to the one already published. Never lower or reuse a version.
- **A release is two commands, not one** (#1208). `make release-prepare VERSION=x.y.z`
  writes the changelog from the merged PR titles and commits it **on a branch** — it
  refuses to run on `main`, so those notes go through a PR like every other change.
  `make release-tag VERSION=x.y.z` then tags the merged commit and pushes the tag, and
  refuses to run anywhere but `main`, on a dirty tree, or without a changelog section for
  that version. Between them, dry-run the Release workflow. Agents do not tag or release
  on their own initiative. Full order: `docs/extension/releasing.md`.

## App conventions (apply to EVERY app, current and new)

Every app (the default export in `extension/src/apps/<id>/index.ts`) MUST follow these.
They are intentionally declarative/shared so a new app is a few lines, not a rewrite.

1. **First-time tip.** Add a `tip: '…'` string to the app descriptor. The apps
   controller (`src/controllers/appsController.ts` → `maybeFirstTimeTip`) shows it once
   as a dismissible banner at the top of the window; "I understand" or ✕ hides it
   forever (persisted in `store.tipsSeen[appId]`). Keep it to 1–2 sentences. Required
   for every app **except Calculator** (its use is self-evident). Do NOT hand-roll a
   per-app tip — just declare the string.

2. **Multi-select → batch delete ("patch delete")** for any list of user items the app
   lets you delete. One confirm, one undo that restores all.

   **Every delete of a user item goes through the same component — including a
   single-row one.** An app must never call its own delete route from a row's trash
   button: it calls `bulk.deleteOne(entry, { confirmMessage?, undoMessage? })` (custom
   lists) or the sidebar's own row delete. Both give the identical guarantees — confirm,
   the row gone at once, and a real undo window before anything is committed. Five apps
   hand-rolled their per-row delete instead, so the same item deleted two ways had two
   different guarantees, and one of them (Clipboard) deleted on the first click with no
   confirm at all (#724).
   - **Apps using `createHistorySidebar`** (`src/components/historySidebar.ts`): pass
     `selectable: true` plus `bulkConfirm(n)` / `bulkUndo(n)` (e.g. denoise, televoica
     via `createMediaTextApp` which exposes `itemNoun`, vidrec). You get the
     Select/Done toggle, per-row checkboxes, select-all, **Delete (N)**, AND mouse
     drag-to-select for free.
   - **Custom lists** (e.g. Tasks, PDF Library, Notes): use
     `createBulkSelect` (`src/components/bulkSelect.ts`). In the list render:
     `const visible = bulk.filterVisible(entries); header.append(bulk.controls(visible));`
     and, when `bulk.isSelecting()`, render a checkbox per row bound to
     `bulk.isChecked(id)` / `bulk.setChecked(id, on)` (then call your re-render). Pass
     `{ noun, remove, onChange }`. `remove` must commit ONE delete and keep any caches
     correct (see notes's `removePageCommit`), and `onChange` must repaint from the
     STORE, not from a stale in-memory list — a commit clears the pending id, so a
     repaint of cached rows brings the deleted row straight back. If the host renders
     an in-memory snapshot instead (an expensive re-query, like Tabs), keep the cheap
     snapshot repaint in `onChange` and pass `refresh` too — it re-reads truth on
     exactly the commit transitions, where the snapshot lies (#940).

   **If your app has a "keep this" mark — a favorite, a pin — declare it**, with
   `isProtected: (entry) => …` plus `protectedNoun`. Any delete that includes one — the
   batch bar or a single row, since both go through the same path — then names it in the
   confirm ("2 of them are favorites") and keeps Confirm disabled until the user ticks an
   explicit acknowledgement. A mark the app honours everywhere else must not count for
   nothing on the one path that destroys data: Clipboard's star survived auto-cleanup and
   "Clear" but not **Select all** (#650).

3. **System tip.** Add one short (~55–65 char, single-line) entry to
   `src/data/tips.ts` covering the app's headline feature; it rotates in the dock tip
   line under the dock.

   Both the shared sidebar and `createBulkSelect` also provide **mouse drag-select**
   (press a row, drag over others). For `createBulkSelect`, call
   `bulk.bindRow(rowEl, id)` on each row (see Tasks / PDF Library). Skip binding
   on a row that already owns a native drag gesture (e.g. Notes' move-to-collection
   drag) — bind only its select-mode variant there.

4. **Window sizing — every app window mounts at ONE size, and is maximizable.** There
   is **no per-app window size**. The apps controller (`appsController` → `openApp`)
   opens every app at the single standard `size: 'app'` (`.dialog-app` — `720 × 620`,
   capped to the viewport) and always `maximizable: true`. A consistent window on open
   matters more than each app's ideal footprint, and any app can still Maximize for
   full width, so a descriptor does **not** declare a `dialog` size/maximizable — that
   field is gone. (Utility dialogs — Settings, Release notes, the App Store detail —
   are `appDialog: false` and still pass their own `size`; only the shared "utility"
   size `lg` is used there, per #499. Those are not app windows.) Every window, app or
   utility, **re-fits the viewport on every browser resize, open and restore** (one
   `refit()` in `createDialog`): a sized window keeps its requested size squeezed into
   the viewport and grows back, an unmoved one re-centres, a moved one is clamped on-screen.

   **The app root fills the window body in EVERY state — mounted included, not only
   maximized.** `appsController` tags an app's single body root with `.app-root`, and
   `styles/shell.css` flex-fills it (`flex: 1; min-height: 0`) in the default mounted
   720×620 window, maximized, manually sized and full-screen alike — one folded,
   `.dialog-app`-scoped rule so the four states cannot drift. Size your root with
   `height: 100%` and let long content scroll inside it; **never** size it to a `vh`
   guess (the window is not the viewport) and **never** assume the window is tall enough
   to show everything — an empty state must center in the _visible_ window. The stretch
   was once gated on maximized/sized only, so at the mounted size a `vh`-height or
   content-tall root overflowed below the fold and pushed the empty-state CTA off-screen
   (#1089, one state after #651). Utility dialogs (`dialog-static`) are deliberately
   excluded: they keep the plain content-growing scroll-region body.

5. **Agent tools — DORMANT. Declare them, but never advertise them.**

   > **The agent does not run.** No shipped model can enter the loop, so every
   > tool every app declares is inert. This is deliberate: measured on our own
   > prompt and parser, the default model (SmolLM2-360M) got **1/6** tool calls
   > right ([`docs/extension/agent-tool-bench.md`](docs/extension/agent-tool-bench.md)),
   > and its failures were the dangerous kind — asked "what tasks do I
   > have today?" it answered _"You have no tasks today"_ without ever calling the
   > tool. A model that confidently reports doing what it never did is worse than
   > one that cannot act.
   >
   > **So: never write user-facing copy (README, marketing, booklets, app `desc`)
   > saying KimtAI can drive the apps.** It cannot. Keep the `tools` arrays —
   > they cost nothing at runtime and mean switching the feature on later is a
   > runtime change, not a rewrite of every app — but treat them as inert until an
   > on-device model is proven able to drive them.
   >
   > **Do not restate how many tools there are.** The count lives in the descriptors
   > and nowhere else; `scripts/agent-tool-count.mjs` derives it, the docs build
   > substitutes it into the handbooks as `{{agentToolCount}}`, and
   > `scripts/check-agent-tool-count.mjs` fails the build on a figure that disagrees.
   > This paragraph itself used to name one, and it was wrong, as were the three
   > other copies of it (#1099).

   **This is enforced.** `scripts/check-agent-claims.mjs` runs in CI over the booklets,
   the marketing site and the README, and fails the build on a present-tense capability
   claim ("the assistant can …", "on your behalf", "can drive"). It exists because this
   convention was prose-only and eight booklets drifted straight past it (#170) — the
   public docs told readers the assistant could delete their clips on their behalf.
   Describe the tools as **declared and dormant** ("Tabs declares agent tools … they do
   not run today"); the honest phrasings (`cannot`, `not yet`, `dormant`, `would`) pass.

   Expose the app's capabilities as an MCP-shaped `tools` array on the descriptor.
   Each tool is
   `{ name, description, parameters (JSON-Schema), needs?, run(args, ctx) }` and
   `run` returns `{ ok, result: <string for the model>, summary: <short label>,
artifact? }`. `lib/agentTools.ts` auto-collects the tools of every installed
   app — so a new tool is just an entry in this array; no wiring. Conventions:
   - **Name by verb + noun**, consistent across apps: `list_<things>`,
     `get_<thing>` (by id), `create_<thing>`, `update_<thing>` / `rename_<thing>`,
     `delete_<thing>`, `search_<things>`, plus domain verbs (`complete_task`,
     `move_note`, `set_pdf_read`). A `get_<thing>` takes the id from the matching
     `list_`/`search_`.
   - **Cover the whole surface.** Any user-facing data action the app supports
     should have a tool (aim for full CRUD + get + search), so the assistant can
     drive the app end-to-end. `run` should go through the app's `*.local.js`
     routes (`getApi`/`jsonApi`) just like the UI, so tools and UI stay in sync.
   - **`run` never throws to the user**: return `{ ok: false, result, summary }`
     for "not found"/validation so the agent can recover. Keep `result` compact
     (it's re-fed to a small on-device model each turn); list ids so follow-up
     tools can reference them.
   - Media/compute tools that consume an attachment declare `needs:
{ attachment: 'image' | 'audio' }` and read it via `ctx.attachment(kind)`
     (see snaptext/televoica/denoise). Actions needing a live user gesture
     (recording, drawing on a canvas) are intentionally _not_ exposed.
   - **The runtime would only ever run tools of _installed_ apps**
     (`availableTools()` filters by `isInstalled`). None of this executes today — it is the shape the feature
     will take if it is ever switched on.

6. **Storage — everything in the one shared DB, prefixed by app id.** ALL an app's
   persistent data goes through the shared `dataStore` (`lib/dataStore.ts`) — the
   single `kimtos` IndexedDB with three stores: `records` (partitioned by a
   `collection` string), `blobs` (object-URL storage), and `kv` (a key/value
   cache). **Never** open your own IndexedDB or write app data to `localStorage`.
   Name every partition with your **app id as the prefix** so AnubisDB attributes
   it to your app automatically — no `apps/anubisdb/registry.ts` edit:
   - records collection → `<id>-<thing>` (e.g. `thoth-chunks`)
   - blob namespace / kv key → `<id>:<thing>` (e.g. `thoth:hashes`, `kimtai:downloaded`)
   - media/history apps → `history:<id>` (already handled)

   AnubisDB (`apps/anubisdb/`) is the console over this DB: it derives the app
   labels from every `meta.ts` and resolves ownership from the id prefix
   (`registry.ts` → `ownerOf`), so a new app's data shows up, named and grouped,
   with zero changes there. Anything that ignores the convention lands under
   "Unmapped data" — that's the signal you named a store wrong.

   **Settings** are the one thing that does NOT live in the shared DB, and that is
   deliberate — not a migration waiting to happen. Per-app settings use the
   declarative `settings` schema via `getAppConfig`/`setAppConfig`
   (`lib/appConfig.ts`) and persist in `store.apps[<id>]` — the sync `store`
   (chrome.storage / localStorage). **They have to.** The **service worker and
   content scripts read this state**, and a content script cannot open our
   IndexedDB: its `indexedDB` is the visited page's origin, not ours. chrome.storage
   is the only store all three contexts can reach.

   So settings are **mirrored** into `dataStore.kv` (`settings:general`,
   `settings:<appId>`, and `settings:<appId>-<name>` for content-script config) —
   which is what makes them visible in AnubisDB and portable in a backup.

   **The mirror is a projection, never the source.** Anything that WRITES settings —
   AnubisDB's clear, an import, an undo — must go through `lib/settingsControl.ts`,
   which writes chrome.storage first. Deleting the kv key alone clears nothing: the
   apps read chrome.storage, and `mirrorPrefs()` rewrites the key on the next save,
   so the settings come back. That exact bug shipped: AnubisDB's "clear" and
   "import" both reported success and did nothing (#225).

7. **App icon.** Add a 24×24 line-mark **glyph** to `APP_GLYPHS` in
   `shared-modules/icons/src/glyphs.ts` (and the `AppId` union), keyed by the app
   **id** — `fill="none"`, `stroke-width` ≈ 1.9, round caps/joins, drawn with
   `currentColor`. It's the single source of truth: the extension dock/App Store
   (`paintAppTile`) and the marketing site (`AppGrid.vue` → `appGlyphSvg`) both
   render the identical glyph on a squircle tile built from the app's `accent`. No
   image files — inline SVG only (offline-first). A letter monogram is the
   fallback until a glyph exists. Rebuild `@kimtos/icons` after editing.

8. **Docs booklet.** Add `docs/extension/apps/<id>/` — a `booklet.toml` (title,
   subtitle, `accent`, `order`, matching the app's `meta.ts`) plus numbered
   chapters under `content/` (`01-overview.md`, `02-getting-started.md`,
   `03-architecture.md`; add `04-reference.md` if the app earns one). One `# H1`
   per file, never skip heading levels — see `docs/extension/apps/README.md`.
   This is **not optional**: the public docs site assembles one
   page per **booklet**, so an app without one is silently absent from the docs
   entirely. `www-docs` **fails the build** if a shipped app has no booklet (or a
   booklet has no app), so a missing booklet is a red CI check, not a surprise on
   the live site.

9. **Home card — declaring it is what creates its off switch.** If your app renders a
   card on the home screen, declare `widget()` **plus a `widgetLabel`** (and optional
   `widgetHint`) on the descriptor. The Settings ▸ Preferences toggle is **generated
   from that declaration** — iterate, never list. Do **not** add a toggle by hand, do
   not add a boolean to `Settings`, and do not add the app to any gate map: none of
   those exist any more.

   State lives in `store.homeWidgets` — `{ [appId]: false }` for the cards the user
   turned off, keyed by app id like `tipsSeen`. Absent means shown.

   This is convention, not preference: it used to be four hand-maintained lists that
   had to agree, and two apps (KimtAI, NotaBoard) shipped home cards the user could not
   turn off at all, while a dock tip promised any card could be unpinned (#83). Omit
   `widgetLabel` and the toggle still appears, labelled `Pin <name>` — a card can never
   ship without a way to hide it.

10. **Session — minimize remembers, close forgets, and a teardown is not optional.**

    Minimize keeps your app mounted and running; close tears it down and discards its
    state, so the next open is the initial page — and both survive a page reload
    (`lib/appSession.ts`, over `chrome.storage.session`). Window position, size and
    maximized state are restored for **every** app with no work on your part.

    To reopen where the user actually was, read `ctx.session` (your last saved state, or
    `null`) and call `ctx.saveSession(state)` whenever it changes. **Push, never pull**:
    there is deliberately no `save()` at unload, because a tab can be killed without ever
    running an unload handler, which would lose exactly the sessions the feature exists to
    keep. Keep the state small and JSON-serialisable.

    If your app mounts `createHistorySidebar`, do **not** hand-roll this: use
    `createEntrySession(ctx)` (`components/historySidebar.ts`) and pass its
    `initialActiveId`, calling `remember()` from `onOpen`/`onNew` and `start()` once the
    first pane is up. Five apps need the identical three moves, and a hand-copied block is
    how the pop-out settings rotted until only one app had them (#197).

    **`render()` must return a teardown if it acquires anything** — a media element, a
    microphone, a MediaRecorder, an interval. `appsController` calls it on close, and it is
    the only thing between a closed window and audio that keeps playing.
    `scripts/check-app-teardown.mjs` fails the build if you forget; the return type allows
    `void`, so nothing else would.

    Do not reach for `dataStore` for any of this. Session state is ephemeral shell state,
    not user data: putting it there would file scroll offsets and window coordinates in
    AnubisDB and in every exported backup, where they would then have to be aged out.

11. **Background work — it goes through KimtManager, always.**

    Anything that outlives the user's attention — a model download, a transcription, an
    export, a long import — is registered with the orchestrator
    (`extension/src/lib/kimtManager.ts`) and RUN by it:

    ```ts
    const job = kimtManager.start({
      appId,
      title: `Transcribing ${name}`,
      kind: 'compute',
      run: async (ctx) => {
        /* report ctx.progress, honour ctx.signal */
      },
    });
    await job.run();
    ```

    Work started on the side is **invisible**: it cannot be seen, cannot be stopped, and
    cannot be told apart from the app having hung. That is the bug KimtManager exists to
    make impossible (#1172). Registering also buys the row in KimtManager and the
    switcher, live progress, a working Stop, and queueing so two downloads do not fight
    over one connection.

    Declare `cancellable: false` for work that cannot be safely interrupted, so the row
    offers no Stop instead of a button that does nothing. Never invent a progress number —
    `ctx.progress(null)` is the honest answer for work you cannot measure.

    **A MODEL DOWNLOAD is this, and it has a helper.** Use `lib/modelJob.ts`'s `loadAsJob` for a
    model loaded on first USE (pressing Ask, typing, first-run setup); `lib/installManager.ts`
    already registers the App Store path. Never hand-roll a `Map` of in-flight downloads with its
    own AbortControllers — that is the orchestrator re-implemented in one dialog, and it is how a
    gigabyte transfer stayed invisible to Stop all and to the takeover notice (#1275).
    `scripts/check-orchestrated-jobs.mjs` fails the build on one, and it reads every `.ts` in the
    app, not just `index.ts`.

    `cancellable` is DECLARED, never assumed — on `ModelEntry` as well as on `JobSpec`. The
    assumption it replaced was "everything can stop", so six installs showed an enabled Stop that
    deleted the row and kept downloading up to 300 MB (#1302). A Stop that lies is worse than no
    Stop. The `on-device-models` skill says which engines honour a signal, and why
    `savesOnStop: false` is the honest declaration for a download until #1301 lands.

    It does **not** replace `lib/jobStore.ts`, which writes the work down BEFORE it starts
    so it survives the page dying (#314). A long job that owns user input uses both. See
    the `new-app` skill, Step 3c, and `apps/denoise/index.ts`.

Shared, reusable styles — including the selection ones (`.app-tip*`, `.mt-select-*`,
`.bulk-controls`, `.is-dragsel`) and the shared empty state (`.empty-state*`) — live in
**`src/styles/components.css`**, which is one of the three sheets `src/styles/main.css`
imports (`base.css`, `shell.css`, `components.css`). Per-app styles are colocated at
`apps/<id>/<id>.css`. There is no `apps.css`: add a shared style to `components.css`, or
a new stylesheet will simply never be imported and your CSS will do nothing. Persisted
one-time flags live in `store.tipsSeen` (`src/models/store.ts`).

**Never re-render a subtree that contains a focused input in response to that input's own
keystrokes.** A search/filter box's `input` (or `keyup`/`change`) handler must repaint only the
**results region** — a sibling — never the container that holds the box. Rebuilding an ancestor
of the focused field (`replaceChildren` / `innerHTML =` / `replaceWith`) destroys and replaces
the live input node, so the user is kicked out mid-type and has to click back in; a trailing
`requestAnimationFrame(() => input.focus())` is a band-aid that still loses the caret and
selection. If a full re-render is genuinely unavoidable, snapshot and restore
`document.activeElement` and its selection range. The sibling-only pattern is in `apps/tabs`
(persistent bar, scrolling list) and `apps/kimtfs` (toolbar vs `paintRows`); the regression this
guards is #217. This is a convention, not a preference — it has silently broken a focused field
twice, and a review-checklist item is the minimum bar until something enforces it.

## Model hosting and licensing

- [x] **Model hosting + licences — DONE. Keep it that way.**

  **Kimtos makes no network request except the model downloads you start, from Hugging Face.** This
  is an owner decision, not a default: no user data and no request ever goes to any other host, so
  never add a fetch, a remote image, a CDN, a feed or an analytics call. The manifest's
  `host_permissions` and its CSP `connect-src` name Hugging Face and nothing else, and
  `extension/src/build/manifestHosts.test.ts` fails if either widens.

  Kimtos runs **no file host**. Every on-device model is downloaded once, in the browser, from
  **Hugging Face** (`huggingface.co`, with large files redirected to `*.hf.co`), which already serves
  it with CORS: Whisper, Kokoro, the KimtAI chat models, FLAN-T5, MiniLM and Denoise's DeepFilterNet
  weight (`kimtos-labs/denoiser-dfn3`). OCR (Tesseract: worker, core and the English data) ships
  inside the extension under `/ocr` and loads nothing; English is its only language. Transformers.js resolves a
  model id to `https://huggingface.co/<id>/resolve/main/<file>`, so the engines name the repo and
  leave `env.remoteHost` alone. `docs/extension/models.md` says which model comes from which repo;
  `extension/src/lib/modelHosts.ts` holds the URL helpers; every host is declared in
  `scripts/network-hosts.mjs`, disclosed on the privacy page, and checked by
  `scripts/check-network-hosts.mjs`. Add/change a model: point the id at the repo, add it to
  `docs/extension/models.md`, `scripts/model-notices.mjs` and `THIRD-PARTY-NOTICES.md`.

  **Every model we ship must be PERMISSIVELY licensed**, and must be attributed in
  `THIRD-PARTY-NOTICES.md` (MIT and Apache both require the notice to travel with
  what we distribute — we shipped six models with none until this was fixed). What
  remains — DeepFilterNet (MIT/Apache), SmolLM2, Whisper, MiniLM, FLAN-T5 (all
  Apache-2.0) — is clean.

  **Gemma 3 was removed** rather than kept: Google's Gemma Terms are a custom
  licence with use restrictions we would have had to bind every user to. Do not re-add it, or anything else non-permissive, to
  `engines/kimtai.ts` — a licence that restricts what a _user_ may do with the
  weights is not ours to accept on their behalf.

- [ ] **Grammit — three on-device layers; the AI model is an optional add-on.**
      (1) **Rules** `extension/src/lib/grammarRules/` (`ruleIssues()` in `index.ts`; the
      individual rules in `rules.ts`, data tables in `dictionaries.ts`, shared helpers in
      `helpers.ts`): typos & irregular
      plurals, contractions, pronoun "I", capitalization, a/an, repeated words, spacing,
      subject–verb agreement (now a real **conjugator** — `BASE_VERBS`/`thirdPerson()`,
      both directions), double negatives, comparatives, modal+of/to, then/than, and
      **contextual homophones** (`homophoneRules`: their/there, your/you're, its/it's,
      to/too — flipped only when the following word rules out the possessive/infinitive).
      **`MISSPELLINGS` rewrites on sight, so nothing in it may also be a real word.**
      Eleven were, and ordinary sentences came back wrong — "he wolfs down his dinner" →
      "he wolves down", "the waiter foots the bill" → "feet", NAD the coenzyme → AND
      (#1031). A typo that is also a word now goes in `CONTEXTUAL_MISSPELLINGS`
      (`contextualWordRules`), gated the same way as the homophones: an **allowlist** on
      one neighbouring word (`two knifes` but not `he knifes the box open`), so an
      unrecognised context leaves the token alone. Where no cheap neighbour test separates
      the two readings, the entry is dropped — a silent miss beats a confident wrong
      correction. Both halves are asserted in `spellcheck.dictionary.test.ts`: no key of
      the flat table may be in `words.txt`, and every key of the gated one must be.
      **`PHRASES` holds the same bar one level up: no key may have ANY valid English
      reading**, because `phraseRules` also rewrites on sight. It broke the subjunctive
      ("If I were you" → "If I was you"), every question and modal ("Does he have a
      car?" → "Does he has"), and "married with children" (#1051). A phrase with a
      valid reading goes in `CONTEXTUAL_PHRASES`, gated on one neighbouring word — an
      allowlist, or a block-list ONLY for a closed idiom class ("many a", "of course") —
      or is dropped. There is no dictionary oracle for phrases, so the guard is the
      fixture `grammarRules/data/phrase-readings.txt` + `phrases.test.ts`: every flat
      key must be declared `never:` valid there, every gated key must appear in a
      fixture sentence that stays clean, and every fixture sentence must come back
      untouched — a bad entry fails CI instead of shipping.
      (2) **Spell check** `extension/src/lib/spellcheck.ts` (`spellIssues()`, lazy-loaded):
      a 60k-word frequency-ranked dictionary catches _any_ misspelling; suggestions are
      Norvig edit-distance-1/2 ranked by frequency. Guards: skips proper nouns
      (capitalized mid-sentence), ACRONYMS, words <4 chars, an `ALLOW` set of tech terms,
      and only flags when a near dictionary word exists (so names/jargon are left alone).
      (3) Optional **AI deep grammar** model (off by default, downloads on first use).
      All tuned for **no false positives** ("have to" isn't a modal, bare "no" stays,
      "then"→"than" only after a comparative, past/invariant verbs like "he set" untouched).
      Deliberately not rule-fixed (leave to the model): missing articles, verb tense,
      no/know-type homophones.
      **Dictionary provenance — regenerate with `node scripts/gen-words.mjs`, never by
      hand.** `extension/public/words.txt` = the top 60k words of Norvig's `count_1w.txt`
      frequency order (Google Web Trillion-Word Corpus counts) that **SCOWL** also
      contains. Membership comes from SCOWL and nothing else; Norvig supplies only the
      RANKING, which is what the speller needs it for (line order IS the rank). SCOWL is
      the curated source behind hunspell's en_US and Aspell — permissively licensed
      (Copyright 2000-2016 Kevin Atkinson) and attributed in `THIRD-PARTY-NOTICES.md`.
      Both downloads are pinned by sha256 in the script. It used to be intersected with
      dwyl/english-words `words_alpha.txt` instead, which is a web scrape rather than a
      dictionary, so 29 common misspellings shipped as dictionary words — `langauge`,
      `accomodate`, `enviroment`, `untill`, `wich` — and the speller could neither flag
      them nor avoid suggesting them (#961). The invariant is asserted on every PR by
      `extension/src/lib/spellcheck.dictionary.test.ts` against the fixture
      `extension/src/lib/data/known-misspellings.txt`; a regenerated list that
      reintroduces a misspelling, or that drops ordinary English, is a red check. The list
      can grow (currently 60k) and the curated typo/phrase dicts in
      `grammarRules/dictionaries.ts` too. Grammit therefore installs with **no download**: it is
      skipped by `onboarding.ts`, and its `appModels.ts` entry downloads nothing unless the user
      turns the optional model on (`download` returns early when `deep !== 'on'`, and `remove`
      frees the cache on uninstall). The optional **AI "deep grammar"** layer (settings
      `deep: on`) loads `Xenova/flan-t5-base` from Hugging Face, per the model-hosting rule
      above, via `lib/engines/grammar.ts` and merges non-overlapping suggestions; it's
      **off by default**. Caveats if we lean on it more:
      FLAN-T5 is a _generic_ instruction model (can "answer"/rephrase instead of
      correcting) — mitigated by `trustworthy()` in `lib/textDiff.ts`. The proper upgrade
      is a dedicated GEC fine-tune (e.g. `pszemraj/flan-t5-*-grammar-synthesis`,
      `vennify/t5-base-grammar-correction`, a CoEdIT model) converted to ONNX and **hosted
      on a HF repo we control**, then point `DEFAULT_MODEL` at it. **Verify each model's
      _and its training data's_ license** (CoEdIT's data is CC-BY-NC). To-do: the
      misspelling/contraction dictionaries in `grammarRules/dictionaries.ts` can keep growing.
      **Replacing the rule layer with Harper** (Automattic's Rust/WASM checker) was evaluated
      and **rejected** in #1068 — measured, not assumed: it reproduces a dozen of the exact false
      positives #1053/#1067 fixed, misses most of the classes it was proposed to add, and its
      WebAssembly is remotely-hosted code under MV3 so it could not be loaded from a remote host. Read that
      issue before re-proposing it.

- [ ] **Chrome Web Store publishing (optional).** The release workflow has a guarded
      slot for a publish step; it needs four CWS secrets and the one-time $5 developer
      fee. Wire it up if/when we want a real store listing.

- **Bundled wallpapers**: two owned defaults in `extension/src/assets/images/wallpapers/`
  — `default-light.webp` and `default-dark.webp`. When the user hasn't pinned their
  own wallpaper, the background follows the active theme's default (see
  `backgroundController` → `onThemeChange`). Over-wallpaper text (clock, subtitle,
  credit, dock tip) therefore flips with the theme via `--text`/`--text-secondary`,
  with a `--text-halo` glow and a theme-aware `--bg-overlay` for legibility.
