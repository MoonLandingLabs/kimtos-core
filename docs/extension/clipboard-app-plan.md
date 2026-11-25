# Clipboard History app — design record (delivered)

> **Status: shipped.** The Clipboard app is fully implemented as a
> fully-on-device app under `extension/src/apps/clipboard/` (plus the shared
> store in `lib/`, the capture content script + in-page picker in `content/`, the
> background service worker in `background/index.ts`, and the Chrome side-panel
> host `sidepanel.ts`). This document is kept as the design record: the plan is
> intact below, with **"as-built"** notes where the shipped code deviates from
> the original proposal. See §11 for the delivered feature list.

Build a kimtos app (`clipboard`) matching the local feature set of
[clipboardhistory.io](https://www.clipboardhistory.io/): browser-wide capture,
searchable history, favorites, color tags, merge, import/export, multiple access
surfaces, and storage analytics.

**Strategy:** a **free app that is fully on-device** — the clipboard
never leaves the user's machine. It ships uninstalled (`optIn`) and is added from the App Store.
**Cloud sync is intentionally NOT built** — it would contradict the "nothing
leaves your device" promise. We adapt the _functionality_, not their code
(they're React/Plasmo/Mantine; we're vanilla TS + the shared app runtime).

---

## 1. Architecture at a glance

```
   ┌──────────────── any https page ────────────────┐
   │  content script  dist/clipboard.js              │
   │   • listens for `copy` / `cut` (capture phase)  │
   │   • reads selection / clipboardData text        │
   │   • skips password fields + excluded sites      │
   └──────────────┬──────────────────────────────────┘
                  │ chrome.runtime.sendMessage({type:'clip:add', …})
                  ▼
   ┌──────────── background service worker  dist/background.js ────────────┐
   │  (NEW — kimtos has none today)                                         │
   │   • onMessage → dedupe (hash) → append to IndexedDB via idb/dataStore  │
   │   • trims to maxItems (oldest non-favorite first)                      │
   │   • hosts context-menu items, chrome.commands (the picker hotkey)     │
   │   • serves history to the in-page picker; content script does pastes   │
   └──────────────┬──────────────────────────────────┬────────────────────┘
                  │ same-origin IndexedDB "kimtos"    │ chrome.storage bump → wake UI
                  ▼                                   ▼
   ┌──────── new-tab app  apps/clipboard/ ───────┐   (side panel / floating popout
   │  render(): search • list • favorites • tags │    reuse the same render)
   │  merge • edit • bulk-delete • import/export  │
   │  copy-on-click (navigator.clipboard.write)  │
   │  agent tools • settings • storage analytics │
   └─────────────────────────────────────────────┘
```

**Why a background service worker is required:** a content script runs in the
_page's_ origin, so it cannot touch the extension's `kimtos` IndexedDB. It must
message the extension. With no persistent new-tab page guaranteed open, the only
always-available extension context is an MV3 background service worker. `idb.ts`
is DOM-free, so the SW can append records directly. This SW is a new shared
surface for the whole extension and should be security-reviewed.

---

## 2. Data model (dataStore conventions, id-prefixed → auto-mapped in AnubisDB)

| Store                                  | Key         | Shape              |
| -------------------------------------- | ----------- | ------------------ |
| `records` collection `clipboard-items` | item id     | `ClipItem` (below) |
| `blobs` namespace `clipboard:<id>`     | image clips | image blob         |
| `kv` `clipboard:tags`                  | —           | `Tag[]`            |

**As-built:** capture **settings do NOT live in `dataStore.kv`.** They're the
`CaptureState` object in `chrome.storage.local` under `clipboard:capture`
(`clipboardShared.ts`), because the content script and background SW — neither of
which can reach the `kimtos` IndexedDB — must read and live-reload them. The
shipped `CaptureState` is `{ monitorEnabled, excludedSites, maxItems, notify,
captureImages, pausedUntil? }` (no `dedupeWindowMs`/`sortMode`; sort is a UI-only
toggle, dedupe uses exact-text match, passwords are a hard rule not a setting).
Tags are stored by **name** (`Tag { name, color }`, no `id`) and items reference
tag names. The dedupe hash is a fast FNV-1a, not a SHA.

```ts
interface ClipItem {
  id: string;
  type: 'text' | 'link' | 'color' | 'image';
  text: string; // the payload (or blob key for images)
  preview: string; // truncated display string
  hash: string; // for dedupe (sha of normalized text)
  bytes: number; // size, for storage analytics
  favorite: boolean;
  tags: string[]; // tag ids
  createdAt: number;
  lastUsedAt: number; // bumped on re-copy / paste
  useCount: number;
  source?: { url: string; title: string; favicon?: string };
}
interface Tag {
  id: string;
  name: string;
  color: string;
}
interface Settings {
  monitorEnabled: boolean; // master capture toggle (default on)
  maxItems: number; // default 500 (unlimitedStorage lets us go high)
  captureImages: boolean; // Phase 2, default off
  dedupeWindowMs: number; // re-copy within window bumps, not adds
  excludedSites: string[]; // host patterns to never capture
  pausedUntil?: number; // temporary pause
  sortMode: 'recent' | 'alpha';
  // Passwords are ALWAYS skipped — not a setting.
}
```

**Dedupe:** hash normalized text; if a matching item exists, bump
`lastUsedAt`/`useCount` and re-sort instead of inserting a duplicate (standard
clipboard-manager behavior).

---

## 3. Capture pipeline (the core)

### 3a. Content script — `src/content/clipboardCapture.ts` → `dist/clipboard.js`

- Add-listen `copy` and `cut` on `document` in the capture phase.
- Text extraction, in order: `window.getSelection()?.toString()`, else
  `e.clipboardData?.getData('text/plain')`. Both are available **inside the copy
  handler without `clipboardRead`** and without a user-gesture prompt.
- **Hard skips:** active/target element is `<input type=password>`; the page host
  matches `settings.excludedSites`; `monitorEnabled` is false or `pausedUntil` is
  in the future (the SW tells the content script the current state, cached).
- Classify: URL → `link`; `#rrggbb`/`rgb()` → `color`; else `text`.
- Send `{ type:'clip:add', text, url: location.href, title: document.title }`.
- Phase 2 images: iterate `e.clipboardData.items` for `image/*`, read to blob, send.
- Kept **separate** from `writer.js` (Grammit) for isolation and so either can be
  disabled independently.

### 3b. Background service worker — `src/background/index.ts` → `dist/background.js`

- `chrome.runtime.onMessage`: `clip:add` → dedupe → `idb.put('records', …)` →
  enforce `maxItems` (delete oldest non-favorite) → bump `chrome.storage.local`
  `clipboard:changed = Date.now()` so an open app refreshes.
- `chrome.contextMenus`: "Save selection to Clipboard History", "Paste from
  KimtOS Clipboard…" (opens the in-page picker) and "Open KimtOS Clipboard panel".
- `chrome.commands.onCommand`: `open-clipboard-picker` (opens the in-page picker
  in the active tab). See §5.
- **As-built:** there is **no offscreen document.** Pastes are inserted by the
  content script (`document.execCommand('insertText')`), so the SW never needs to
  write the clipboard (see §5). The content script reads capture state straight
  from `chrome.storage.local` (`clipboard:capture`) and live-reloads it via
  `onCaptureChanged`, so there's no `clip:getState` round-trip.

### 3c. UI refresh across contexts

The SW can't invoke the page's `dataStore.onChange`. The open app subscribes to
`chrome.storage.onChanged` for `clipboard:changed` **and** re-scans on
`visibilitychange`/`focus` (dataStore already documents focus re-scan). Cheap and
reliable.

---

## 4. The app UI — `apps/clipboard/`

Files: `meta.ts`, `index.ts`, `clipboard.css`, `clipboard.local.ts`.

`meta.ts` — `optIn: true` (fully on-device), an
accent, and a `marketing` block (auto-publishes the App Store card via
`gen-apps.mjs`).

`index.ts` descriptor (follows every CLAUDE.md app convention):

- `tip`: one-time banner, e.g. _"Everything you copy on any site is saved here,
  on your device. Click an item to copy it again; star the keepers."_
- `dialog`: default (maximizable) — a history list benefits from width.
- `settings[]`: declarative schema for the Settings object (§2).
- `tools[]`: agent tools (§7).
- `render(body, ctx)`:
  - **Toolbar:** search input, sort toggle (recent/A–Z), filter chips
    (All · ★ Favorites · #tags), master monitor on/off, a storage meter.
  - **List:** clip rows (preview, source favicon, relative time, ★, tag dots,
    row actions: copy · edit · tag · delete). Click → `navigator.clipboard
.writeText` (works — the new-tab page is a real document) and bump `lastUsedAt`.
  - **Bulk delete:** `createBulkSelect({ noun:'clip', remove, onChange })` — the
    required multi-select → one confirm → one undo (CLAUDE.md §2).
  - **Merge:** select N → combine into one item with a separator.
  - **Edit:** inline-edit an item's text.
- `clipboard.local.ts`: the CRUD/query layer over `dataStore` (list/search/put/
  patch/remove, tag ops, dedupe, trim, import/export) — the UI _and_ agent tools
  both call through it, keeping them in sync (CLAUDE.md §5).

**Import/Export:** JSON `{ items, tags }`; import merges by hash. Accept the
Clipboard History IO JSON shape for painless migration.

**Storage analytics:** total items + bytes, per-type breakdown, and
"Clear all" / "Clear non-favorites" (with undo).

**System tip:** one line in `src/data/tips.ts` (CLAUDE.md §3).

---

## 5. Access surfaces

| Surface                         | Mechanism                                                                                               | Phase |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ----- |
| App window (new tab)            | `render()`                                                                                              | 1     |
| Copy-on-click                   | `navigator.clipboard.writeText` in the app                                                              | 1     |
| Context-menu **save**           | SW `contextMenus` on selection → `clip:add`                                                             | 1     |
| Context-menu **paste ▸ recent** | SW menu → active tab content script `insertText` into focused field                                     | 2     |
| Global hotkeys                  | manifest `commands` + SW `chrome.commands`                                                              | 2     |
| Floating window                 | descriptor **`popout: true`** (kimtos already supports it; reuses the app `render()`, no separate HTML) | 2     |
| Side panel                      | manifest `side_panel` + `sidepanel.html` reusing `render()`                                             | 2     |

**As-built:** all surfaces above shipped (the "Phase" column is historical). The
in-page **picker** (`content/clipboardPicker.ts`) is the primary paste UI — opened
by the `Alt+Shift+V` command, the right-click menu, or a small KimtOS button that
appears on focused text fields. The **`Alt+Shift+1/2/3` quick-paste** is NOT a
manifest `command`; the content script listens for those chords itself and asks
the SW (`clip:nth`) for the Nth clip's text.

**The MV3 paste problem (call-out).** An SW has no DOM, so it _cannot_ write the
clipboard. **As-built, we sidestep it entirely — no offscreen document.** Every
paste is inserted by the content script into the focused editable
(`document.execCommand('insertText')`): the picker and the `Alt+Shift+1/2/3`
quick-paste both resolve the clip text from the SW, then the in-page script types
it into the field. There is no OS-level paste and no `offscreen` permission.
(Copy-_to-clipboard_ from the app window still uses `navigator.clipboard
.writeText`, which works there because the new-tab page is a real document.)

**Known limitation vs native apps:** an extension only sees copies made **inside
a browser tab** (via the copy event). Copies made in other OS apps are invisible
unless/until pasted into a page. Native parity would need a desktop helper —
out of scope. Document this clearly in the app's tip/settings.

---

## 6. Manifest & build diff (concrete)

As-shipped `manifest.json` (note: **`sidePanel`, not `offscreen`**, and a single
picker command — the quick-paste chords live in the content script):

```jsonc
{
  "permissions": ["storage", "geolocation", "unlimitedStorage", "identity", "contextMenus", "sidePanel"], // + contextMenus, sidePanel
  "background": { "service_worker": "background.js" }, // NEW
  "content_scripts": [
    { "matches": ["https://*/*"], "js": ["writer.js"], "run_at": "document_idle" },
    { "matches": ["https://*/*"], "js": ["clipboard.js"], "run_at": "document_start" }, // NEW
  ],
  "commands": {
    // NEW
    "open-clipboard-picker": {
      "suggested_key": { "default": "Alt+Shift+V" },
      "description": "Open KimtOS Clipboard history to paste a past item",
    },
  },
  "side_panel": { "default_path": "sidepanel.html" }, // NEW
}
```

(No network access is needed — the app is entirely on-device. `Alt+Shift+1/2/3`
is handled inside `clipboardCapture.ts`/`clipboardPicker.ts`, not as commands.)

**As-built build** — a single `vite.content.config.ts` emits one self-contained
IIFE per invocation, selected by the `CS` env var (Rollup can't emit IIFE for a
multi-input build), driven from the extension's `build` script:

```ts
// vite.content.config.ts
const ENTRIES = {
  writer: 'src/content/writer.ts', // → dist/writer.js
  clipboard: 'src/content/clipboardCapture.ts', // → dist/clipboard.js
  background: 'src/background/index.ts', // → dist/background.js
};
// package.json build: vite build && CS=writer vite build --config vite.content.config.ts
//                     && CS=clipboard … && CS=background …
```

`sidepanel.html` is a regular Vite HTML entry (mounted by `src/sidepanel.ts`).
There is **no** `offscreen.ts`/`offscreen.html`/`popup.html` — they were designed
out (the picker + side panel cover the surfaces; see §5).

---

## 7. Agent tools (KimtAI) — CLAUDE.md §5

All route through `clipboard.local.ts`; each returns `{ ok, result, summary }`.

**As-built — the nine shipped tools:** `list_clips` · `search_clips(query)` ·
`get_clip(id)` · `create_clip(text)` · `copy_clip(id)` (writes to clipboard —
runs in the new-tab document, fine) · `set_clip_favorite(id, favorite)` ·
`tag_clip(id, tag)` · `merge_clips(ids)` · `delete_clip(id)`. `untag_clip` and
`clear_clips` exist as local routes (used by the UI) but are **not** exposed as
agent tools. Keep `result` compact and list ids for follow-ups.

---

## 8. Gating — installed only; cloud sync — no

The app ships uninstalled (`optIn`). Because the always-injected content script would
otherwise capture anyone's clipboard, capture + the picker are gated on **installed**
(`clipboardActive()` reads the installed set from the store; the SW enforces it, the content
script caches it). Uninstall -> capture stops.

Other clipboard managers offer **cross-device cloud sync**. **We deliberately do not build
that** — the clipboard runs entirely on-device and never leaves the machine; syncing it to a
server would contradict that core promise. (If cross-device were ever revisited, the only
acceptable shape would be end-to-end encrypted with a user-held key — but it is not planned.)

---

## 9. Privacy & security (non-negotiables)

- **Never** capture `<input type=password>`. Hard rule, not a toggle.
- Master monitor toggle + temporary pause + per-site exclusion list.
- Local-only, always — the clipboard never leaves the device (no cloud sync).
- Data is id-prefixed → shows up, named, in **AnubisDB** for browse/clear/export.
- Security-review the new background SW (it receives messages from every page —
  validate `sender`, cap payload size, sanitize before storage/paste).

---

## 10. File-by-file change list

**As-built — New**

- `extension/src/apps/clipboard/{meta.ts,index.ts,clipboard.css,clipboard.local.ts}`
- `extension/src/lib/clipboardShared.ts` (DOM-free types/constants/capture-state,
  safe for the content script) and `extension/src/lib/clipboardStore.ts`
  (dataStore persistence, used by the SW + local routes)
- `extension/src/content/clipboardCapture.ts` and
  `extension/src/content/clipboardPicker.ts` (the in-page paste picker)
- `extension/src/background/index.ts` (the service worker)
- `extension/src/sidepanel.ts` + `extension/sidepanel.html` +
  `extension/src/styles/sidepanel.css` (the Chrome side-panel host)
- _(No `offscreen.ts`/`offscreen.html`/`popup.html` — designed out.)_

**As-built — Edit**

- `extension/manifest.json` — background, 2nd content script, permissions
  (`contextMenus`, `sidePanel`), the `open-clipboard-picker` command, `side_panel`
- `extension/vite.content.config.ts` — added the `clipboard` + `background` IIFE
  entries (built via `CS=…`)
- `extension/vite.config.ts` — added `sidepanel` as a Vite HTML input
- `extension/src/data/tips.ts` — one dock tip line
- (auto) `www/data/apps.ts` regenerates from `meta.ts` on build

---

## 11. Status — all local features shipped

**Shipped (free app, fully on-device):** background SW + capture content script +
data model + app UI (list/search/sort/favorite/color-tag/edit/merge/bulk-delete/
copy) + import/export + storage analytics + tip + settings + agent tools.
Surfaces:

- **App window** + **floating window** (`popout`) + **Chrome side panel**.
- **Paste anywhere** without leaving the tab — an in-page picker via the
  `Alt+Shift+V` hotkey, the right-click menu, or a KimtOS button on focused
  fields (pastes into the field); plus **`Alt+Shift+1/2/3`** to paste the Nth
  item directly.
- Context-menu _save_ and _open picker_ / _open panel_.
- **Image clips** — opt-in capture of copied images (blob storage + thumbnails +
  click-to-recopy).
- Gated: capture/picker only run when the app is installed.

**Not built (deliberate):**

- Capturing site "Copy button" writes (programmatic `clipboard.writeText`), which
  fire no `copy` event — would need a focus-time `clipboardRead` fallback.
- **Cloud sync / cross-device** (see §8) — the clipboard stays on-device.

---

## 12. Risks / notes

- **SW lifetime:** MV3 SWs suspend; capture is fine (each `onMessage` wakes it).
- **Paste** is done by the content script inserting into the focused field (no
  offscreen document needed).
- **Browser-only capture** — cannot see OS-level copies made outside tabs.
- **List perf** at large `maxItems` — windowed rendering; sane default cap (500).
- **New attack surface** — the background SW listens to all pages; validate input.

```

```
