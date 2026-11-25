# Architecture

kimtos is a **local-first** Chrome MV3 new-tab extension: everything you create —
notes, todos, PDFs, chats — lives in your browser and never leaves the device.
Kimtos v1 is **free and open source (MIT)** — the source is at
[github.com/MoonLandingLabs/kimtos-core](https://github.com/MoonLandingLabs/kimtos-core). There is **no account and no Kimtos backend**: nothing is signed in, nothing is uploaded, and
every app is free and runs in your browser. **Kimtos makes no network request except the model
downloads you start, from Hugging Face.** That is an owner decision and CI enforces it: the
manifest's `host_permissions` and its CSP `connect-src` may name Hugging Face and nothing else
(`extension/src/build/manifestHosts.test.ts`), and `scripts/network-hosts.mjs` lists every host
and is checked in CI. This doc describes how
the extension works.

## Apps

Every app is a folder under `src/apps/<id>/` with a default-export descriptor in
`index.ts`. Apps are **auto-discovered** (`apps/index.ts` globs
`./*/index.{js,ts}`) — there is no central registry to edit.

| File            | Role                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.ts`       | Identity — `id` (= folder name), `name`, `accent`, `order`, `optIn`, and an optional `marketing` block. The single source of truth: the descriptor, dock, App Store, onboarding, the marketing site, and AnubisDB all read it.                                                                                                                    |
| `index.ts`      | The descriptor (default export): `render(body, ctx)` plus the shared conventions — a first-time `tip`, an MCP-shaped `tools` array for the AI agent, per-app `settings`, home `widget`/`badge`. Every app window opens at the one standard size (maximizable); there is no per-app sizing field. See the app conventions in the root `CLAUDE.md`. |
| `<id>.local.ts` | Optional on-device data layer — `register()` REST routes, auto-discovered. Name partitions by app id (see _Data layer_).                                                                                                                                                                                                                          |
| `<id>.css`      | Optional colocated styles, imported by `index.ts`.                                                                                                                                                                                                                                                                                                |

**Adding a new app** — a few lines, not a rewrite:

1. `apps/<id>/meta.ts` — `id`, `name`, `accent`, `order`.
2. `apps/<id>/index.ts` — the descriptor + the `CLAUDE.md` app conventions (tip, tools, per-app settings, storage prefixing).
3. The app's **icon glyph** — see _App icons_ below.
4. `apps/<id>/<id>.local.ts` if it stores data.
5. A docs booklet under `docs/extension/apps/<id>/` (see `docs/extension/apps/README.md`).
6. Apps auto-install, except `optIn: true` apps, which ship uninstalled and are added from the App Store. Every app is free.

### The app root fills the window body in every state

Every app window is a `createDialog` (`components/dialog.ts`); an installed app opens
at the one standard `.dialog-app` size (`min(720px, 92vw) × min(620px, 88vh)`).
`appsController` tags the single element an app leaves in the body with `.app-root`
(`markAppRoot`), and `styles/shell.css` makes the **app-window** body a flex column and
flex-fills that `.app-root` (`flex: 1; min-height: 0`) in **every** state — the default
mounted 720×620, maximized, manually sized and full-screen alike. The four states are
folded into one selector set scoped to `.dialog-app` (`.dialog:not(.dialog-static)`), so
they cannot drift; **utility** dialogs (`.dialog-static`: Settings, App Store, launcher,
Report, app detail, release notes) are excluded and keep their plain content-growing
scroll-region body.

So an app sizes its root with `height: 100%` and lets long content scroll inside it —
never a `vh` guess (the window is not the viewport) and never an assumption that the
window is tall enough to show everything: an empty state centers in the _visible_ window.
The stretch was first added for maximized windows only (an app missing from a
hand-maintained class list sat at its own fixed height when maximized, #651), then gated
on the maximized/sized states, which left the **mounted** window unconstrained — a
`vh`-height or content-tall root overflowed below the fold and pushed the empty-state CTA
off-screen (#1089). It now holds in the mounted state too.

## App icons

Every app's icon is an inline **SVG line-mark on a squircle tile built from the
app's accent** — no image files, nothing fetched (it must work offline and read on
any wallpaper, light or dark). The whole set lives in one place, `@kimtos/icons`
(`shared-modules/icons/src/glyphs.ts`): `APP_GLYPHS` maps each app **id** to a
24×24 glyph drawn with `currentColor`, so it inverts cleanly — white-on-gradient in
the dock, accent-on-glass elsewhere.

Both surfaces render the **identical** glyph from this shared module:

- **Extension** — `paintAppTile()` (`components/appIcon.ts`) paints the accent
  gradient + glyph in the dock, App Store, and onboarding. A letter **monogram** is
  the fallback for any app with no glyph yet.
- **Marketing site** — `www/components/AppGrid.vue` uses `appTileGradient()` +
  `appGlyphSvg()` for the same tiles (replacing the old Twemoji PNGs).

**To add an icon**, add one entry to `APP_GLYPHS` (and the `AppId` union) keyed by
the app id — a 24×24 line mark: `fill="none"`, `stroke-width` ≈ 1.9, round
caps/joins — then rebuild `@kimtos/icons`. The dock and the site both pick it up.

### The second set: file-type glyphs

`@kimtos/icons` holds **two** glyph sets, and they are not interchangeable. `FILE_GLYPHS`
(`src/fileGlyphs.ts`, rendered by `fileGlyphSvg()`) is one mark per **file kind** — folder,
image, pdf, audio, video, json, markdown, code, text, archive, binary — for a file listing
(KimtFS's explorer). Same 24×24 line-mark conventions, but **background-less**: it inherits
the surrounding text colour instead of sitting on an accent squircle, because a Finder-style
row is not an app tile (#220).

A file's kind is **not** decided in the icons package: KimtFS's `detectKind(name, mime)`
(`apps/kimtfs/viewer.ts`) already classifies a file, and the set is keyed by that same
vocabulary — one classification, used by both the preview and the icon. `fileGlyphSvg` takes
a `FileKind`, so teaching the viewer a new kind without drawing its glyph **fails the
typecheck** rather than rendering a blank row.

## Data layer

All persistence goes through a small client-side stack:

| Module               | Role                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/idb.ts`         | Zero-dependency IndexedDB wrapper. One DB (`kimtos`) with stores `records`, `blobs`, `kv`.                                                                      |
| `lib/dataStore.ts`   | CRUD over `records` (partitioned by `collection`), blob storage exposed as object URLs, and a `kv` cache. Also `exportAll`/`importAll` for backup.              |
| `lib/localRouter.ts` | A tiny REST-style router. Handlers `register(method, pattern, fn)` and receive `{ params, query, body, form }`. The pseudo-method `FILE` returns an object URL. |
| `lib/api.ts`         | What apps call: `getApi`/`jsonApi`/`callApi`/`fileUrl`. Dispatches straight to the local router.                                                                |

App handlers live next to their app as `*.local.ts` and are auto-discovered by
`lib/localRoutes.ts` (`import.meta.glob('/src/**/*.local.{js,ts}')`). To add an app's
data layer, register routes in a `*.local.ts` file — no wiring needed.

```
apps/pdflib/index.ts   →  getApi('books')  →  localRouter.dispatch  →  apps/pdflib/pdflib.local.ts
```

**Name partitions by app id.** A `records` collection, `blobs` namespace, or `kv`
key should be prefixed with the owning app's id — `thoth-chunks`, `thoth:hashes`,
`kimtai:downloaded`, `history:<app>`. **AnubisDB** (`apps/anubisdb/`, the on-device
data explorer) derives app labels from every `meta.ts` and resolves ownership from
that prefix (`registry.ts` → `ownerOf`), so a new app's data appears named and
grouped with no registry edit. Un-prefixed data lands under "Unmapped data".

## On-device compute (televoica / snaptext)

The two compute apps run their models **in the browser** so audio and images
never leave the device:

- **snaptext** (Image to Text) — OCR via Tesseract.js (`lib/engines/ocr.ts`).
  Worker + core are self-hosted under `/ocr` (MV3 bans remote worker scripts);
  English data is bundled.
- **televoica** (Voice to Text) — speech-to-text via `@huggingface/transformers`
  Whisper (`lib/engines/transcribe.ts`), `device: 'wasm'`, `dtype: 'fp32'` (`q8` for Small). The
  pipeline is disposed after each run to free memory; model **files** stay cached.

Model files are fetched once and cached. The onboarding overlay
(`views/onboarding.ts`) pre-downloads them on first visit with a progress bar.

### Downloads run in the background (consistent everywhere)

Any model/asset download keeps running even if the surface that started it is
closed, and closing that surface mid-download raises a **snackbar**
(`components/snackbar.ts`) — _"Download continues in the background."_ with a
**Reopen** action button — so it never feels cancelled. Reopening (button or
manually) re-attaches to the live progress bar (the bar is always kept). This holds
for all three download surfaces:

- **App Store** and **Settings** (download-affecting setting changes) → the global
  `lib/installManager.ts` already runs installs/`ensureModel` detached; the dialogs
  fire the snackbar on close via `onClose` when `anyDownloading()`.
- **KimtAI Model Library** → a module-scoped `activeDownloads` registry in
  `apps/kimtai/index.ts` plays the same role for chat-model downloads.

New download UI should follow this: run the work off the closeable surface, keep a
progress bar that can be re-attached, and snackbar on close while it's in flight.

## Backup / portability

`dataStore.exportAll()` serialises every record and blob (blobs as data URLs)
into one JSON file; `importAll()` restores it. This is how a user moves their
data between machines — they own the file.

## Session and window lifecycle

Minimize and close are different verbs, and the difference survives a page reload.

| Verb         | The app                          | Its state | Next open        |
| ------------ | -------------------------------- | --------- | ---------------- |
| **Minimize** | stays mounted and running        | kept      | where you were   |
| **Close**    | torn down (its `render` cleanup) | discarded | its initial page |

**Where the session lives.** `lib/appSession.ts`, over `chrome.storage.session` — the one storage
area the browser clears when the browser session ends. That is the lifetime we want (survive a
reload, start clean on a restart), taken from the platform instead of maintained as epoch stamps
and an expiry sweep. It deliberately does **not** go in `dataStore`: convention 6 governs durable
user data, and window coordinates would then show up in AnubisDB and in every exported backup.

Two keys: `shell:windows` (the window list — `shell:` is not an app id, so AnubisDB files it under
the system bucket) and `<appId>:session` (each app's own state, beside its `<appId>:job` record).

**Window geometry is free.** Position, size, maximized and minimized are shell-level facts, so
every app is restored with no per-app work (`dialog.ts` → `getGeometry`/`applyGeometry`).

**Inner state is declared.** An app that wants to reopen where the user was reads `ctx.session` and
calls `ctx.saveSession(state)` — pushed as it changes, never pulled at unload, because a tab can be
killed without ever running an unload handler. See app convention 10 in `CLAUDE.md`.

### One page runs the apps

The extension **is** the new-tab page, so every tab is a separate JS context. Two pages could each
mount the same app with its own engines, workers and audio, and closing it in one could not touch
the other — which is how a clip could go on playing where the user could neither see nor stop it
(#1172).

So exactly one page is primary. `background/presence.ts` arbitrates (only the worker knows a
message's `sender.tab.id`, so no `tabs` permission is needed); `lib/pagePresence.ts` is the page
half. A second page gets `views/secondaryNotice.ts` — switch to the running one, or take over here.
Taking over makes the old page `releaseAll()`, which runs each app's own teardown.

Liveness is **event-driven, not a heartbeat**: `chrome.tabs.onRemoved` clears the record and a
claim probes with `chrome.tabs.get`. A background tab has its timers throttled to about once a
minute, so a heartbeat would hand primacy away from a page that is very much alive. A reload is a
new page id in the **same** tab, and reclaims — otherwise reloading would lock the user out.

### Seeing what is running

`lib/kimtManager.ts` is the **orchestrator**: every piece of background work is registered with it
and run by it. It owns the queue (two at a time per lane — downloads contend for bandwidth, compute
for cores, and the two do not contend with each other), one job per app, the abort signal, progress
and failures. `installManager` runs its downloads through it, and so do Denoise and the
media-to-text apps.

It also builds the row list both surfaces render: registered jobs, work orphaned by a page that
died (`lib/jobStore.ts` — the durable half, which an in-memory registry cannot replace), and open
or minimized windows (`lib/appControl.ts`). One row per app; where an app is doing several things
the more urgent wins, so the machine never reads as busier than it is.

**Anything long-running must register** — see app convention 11. Work started on the side is
invisible, unstoppable, and indistinguishable from a hang.

Two surfaces render that one answer, deliberately as two _views_ rather than two lists:

- **KimtManager** (`apps/kimtmanager`) — the task manager, and a required free app. Progress bars,
  failures, and a Stop routed by what the work actually is: a registered job is cancelled through
  the orchestrator, orphaned work is ended, a window is closed. Work declared uncancellable is
  offered no Stop at all, rather than a button that silently does nothing, and work that has FAILED
  is offered Retry and Dismiss instead — it is not running, so a Stop there did nothing either.
- **The switcher** (`views/appSwitcher.ts`) — the ⌘⇧K / Ctrl+Shift+K overlay and its top-bar
  button, for a glance without opening a window.

The apps controller publishes a small fixed interface — list windows, stop one, focus one — through
`lib/appControl.ts`, because an app's `render(body, ctx)` gets only `close` and `openApp`, and
widening that would hand every app a remote control over every other one.

**An app that acquires a device or a timer must return a teardown from `render()`.**
`scripts/check-app-teardown.mjs` fails the build otherwise; TypeScript already constrains what may
be returned, so the two guards compose.

## Floating windows (Picture-in-Picture)

Any app that opts in with `popout: true` on its descriptor gets a pop-out control
in its window title bar. Clicking it uses the
[Document Picture-in-Picture API](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
(`lib/pip.ts`) to open an always-on-top OS window — the same feature Google Meet
uses — and **moves** the app's DOM into it, leaving a "bring it back" placeholder
in the dialog. The PiP window is a same-origin child of the new-tab page, so the
moved nodes keep their event listeners and share our IndexedDB/JS — nothing is
copied or uploaded; we only mirror the stylesheets so it looks identical.

The orchestration lives in `appsController.ts` (`popOut`/`canPopOut`); the title-bar
control is wired through `createDialog({ onPopOut })` + `setPopOutEnabled()`.

**Declaring `popout: true` is what creates the settings.** Every pop-out app exposes an
on/off **Floating window** setting plus a **Floating window size** preset (Compact /
Standard / Large, clamped to the screen; the window stays drag-resizable on top of that)
under Settings ▸ Apps. Do **not** hand-write them on the app: they are declared once as
`POPOUT_SETTINGS` in `lib/pip.ts` — with the size options _derived_ from `PIP_SIZES`, so a
new preset needs no second edit — and merged into the app's own schema by `appSettings()`
(`lib/appConfig.ts`), which both the defaults and the Settings UI read. This is convention,
not preference: they used to be a hand-copied block, so only Notes had them while Clipboard
and Retouch shipped a pop-out the user could neither turn off nor resize (#197).

A one-time intro banner (`pipNoteSeen` in the store) tells users the feature exists. Caveat: a Document PiP window only lives as long as the new-tab page does —
keep that tab open and browse in _other_ tabs to keep the floating window around.

## Manifest notes

- `permissions`: `storage`, `unlimitedStorage`, `contextMenus`,
  `sidePanel`, `scripting` (registers the content scripts at runtime —
  see below), `activeTab` and `search`. `favicon` is an OPTIONAL permission, requested at
  runtime with the Tabs app's other optional permissions: it shows a page's icon from the
  browser's own icon cache through `chrome-extension://<id>/_favicon/`, so no request goes to
  the site (`lib/favicon.ts`). It carries an install-time warning, which is why it is not
  requested at install.
  **Every name here is checked in CI** by `scripts/check-manifest-permissions.mjs`
  against Chrome's documented list, because nothing else reads these keys and the
  browser is otherwise the first thing that validates one (#1335).
- **The microphone and the camera have NO manifest permission** — not in an
  extension. `audioCapture`/`videoCapture` are Chrome _Apps_ keys; declaring them
  warns on every load and grants nothing. The extension gets these devices the way
  a web page does, from a runtime `getUserMedia` prompt against its own origin,
  which Chrome then remembers for that origin. The prompt works on our UI because
  the New Tab override is an ordinary extension page in a real tab; it is the
  popup and the side panel that cannot show one. What no prompt can do is overrule
  the OS — Windows and macOS can block Chrome's mic or camera above the browser —
  so `lib/devicePermission.ts` names the exact setting instead.
- `host_permissions`: exactly two patterns, Hugging Face (`https://huggingface.co/*` and
  `https://*.hf.co/*`, where every model file is served from, directly or by redirect to
  `us.aws.cdn.hf.co` and its siblings). A named list bypasses CORS for those fetches WITHOUT
  the "read and change all your data on all websites" install warning that a broad
  `https://*/*` grant carries (#637). It is a hand-list; the source of truth for the fetch hosts is
  `scripts/network-hosts.mjs` — the data was split out of the checker in #678 so the
  manifest cross-check could read it — and `scripts/check-network-hosts.mjs` is what
  enforces it. The ONNX and OCR runtimes, and the English OCR data, are self-hosted in the
  package and load nothing from a CDN. The model choices and their sources are in
  [models.md](models.md).)
- `optional_host_permissions`: `https://*/*` — the genuine "any site" access,
  requested at runtime on a user gesture and never at install: when the user
  enables Grammit, Clipboard or FakeForm (their content scripts run on the pages the user
  browses). It lets the extension read those pages; it is not a way to reach an outside
  host, because the CSP `connect-src` below stops the extension's own pages from
  connecting anywhere but Hugging Face. Released when the last content-script app is
  uninstalled. A test pins this value.
- The Grammit (`writer.js`) and Clipboard (`clipboard.js`) content scripts are NOT
  declared in the manifest. The background worker registers them with
  `chrome.scripting.registerContentScripts` once the app is installed AND the
  all-sites permission is held, and unregisters them otherwise
  (`background/contentScripts.ts`, reconciled on install/update/startup and on
  permission or install-set changes). Registration keys on installed + permitted only. On UPDATE, existing
  users keep the (now-optional) grant, so the reconcile re-registers their scripts
  with no interruption.
- CSP allows `'wasm-unsafe-eval'` (for the WASM engines) and `worker-src 'self'`. Its
  `connect-src` is `'self' blob: data: https://huggingface.co https://*.hf.co`, and
  `img-src` is `'self' data: blob:`, so an extension page cannot load an image from, or
  connect to, any other host (a remote image in a note or in a model reply is simply
  blocked). `font-src`, `frame-src` and `base-uri` are locked the same way.
  `extension/src/build/manifestHosts.test.ts` fails if any of this widens.

## Tests

`npm test -w @kimtos/extension` runs `node --import tsx --test 'src/**/*.test.ts'`. Tests live
beside the code they cover. (`tsx` is a _resolver_, not a transpiler choice: Node's own
type-stripping does not rewrite `./x.js` imports to `./x.ts`.)

Most tests need no DOM. The ones that do — anything under `src/content/`, and any component
that builds elements — use the harness in `src/test/domEnv.ts`:

```ts
const env = installDom();
const fake = installChrome({ kimtos: { installedApps: ['grammit'] } });
await import('./writer.js'); // dynamic: a content script attaches its listeners at module scope
```

The **dynamic import is the point**. A content script reads `chrome` and attaches its listeners
the moment it is imported, so the DOM and the fake `chrome` have to exist first — an ordinary
top-level `import` runs too early. `installChrome` also fakes `chrome.storage.onChanged`, which
is how live storage-driven updates are exercised in a test.

**What the harness cannot do.** The **CSS Custom Highlight API** (`CSS.highlights`,
`new Highlight()`) exists in neither happy-dom nor jsdom. Grammit Anywhere paints its
contentEditable underlines with it, so `supportsHighlights()` reports false under test and that
branch never runs — it is browser-only, and a test claiming to cover it would be lying. The
textarea mirror-overlay branch, the shadow-root UI, the listeners and the teardown are all
covered.

## No account

Every app is free for everyone and the project is open source. There is no sign-in, no
profile and no server to talk to. Settings and app data live in one local workspace (the id is
`local`; a profile that once signed in to an older version keeps that old account id as its
workspace id so its data stays where it was written, see `models/store.ts`).

Apps marked `optIn: true` in `meta.ts` ship uninstalled so their on-device models and page
scripts only run when the user asks for them; they are added from the App Store.

Surfaces that render from app state subscribe (`watchAppActive`) so a toggle takes effect live.
Teardown must stay as real as setup.
