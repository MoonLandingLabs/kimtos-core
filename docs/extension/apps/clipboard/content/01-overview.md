# Overview

**Clipboard** keeps an on-device history of what you copy. As you copy text (or,
optionally, images) on any site, each item is saved into your own clipboard
history — so you can search it, favorite the entries worth keeping, tag them, and
paste them back into any field without switching tabs. It is part of the kimtos
new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no
network: every clip lives in your browser's local storage and never leaves the
machine. Password fields are never captured — that is a hard rule, not a setting.

Clipboard is free, like every app, and needs no account. It is added from the App
Store, and its capture pipeline runs only while the app is installed; otherwise
nothing is captured.

> This app is under active development. This booklet describes what the code
> currently supports.

## Highlights

- **Automatic capture** — a content script watches `copy`/`cut` on every https
  page and forwards the copied text to the extension, where it is saved. Reading
  the copied text inside the copy event needs no clipboard-read permission.
- **Types** — clips are auto-classified as **text**, **link** (a bare `http(s)`
  URL), **color** (a `#hex`/`rgb()`/`hsl()` value), or **image** (opt-in).
- **Source chip** — text clips remember the page title/URL (and favicon) they
  were copied from.
- **Search, sort, favorite, tag** — filter by substring, sort by recency or A–Z,
  star entries to protect them, and add colored tags for quick filtering.
- **Merge** — combine two or more clips into one new clip.
- **In-page picker** — a search overlay you open on any page (`Alt+Shift+V`, the
  right-click menu, or the on-field button) to paste a past clip straight into
  the field you were in, without leaving the page.
- **Quick paste** — `Alt+Shift+1/2/3` pastes the 1st/2nd/3rd most-recent clip
  directly into the focused field.
- **Side panel** — open the history in Chrome's side panel, beside the tab.
- **Floating window** — pop the app out into a small, always-on-top window (the
  same browser Picture-in-Picture feature Notes uses), so your clip history stays
  visible while you work in other tabs.
- **Manage & housekeeping** — edit clip text, delete, batch-delete, export/import
  the history as JSON, and clear everything except your favorites.
- **Agent tools (declared, not active)** — Clipboard declares tools to list,
  search, read, create, copy, favorite, tag, merge, and delete clips, for a future
  on-device assistant. No shipped model can run them, so nothing acts on your clips
  today.

## Privacy model

Clipboard writes only to local browser storage:

- **Clips** (type, text, one-line preview, byte size, favorite flag, tags,
  timestamps, use count, and the source page) are records in the shared
  IndexedDB, in the `clipboard-items` collection.
- **Image clips** keep their bytes in the local blob store, keyed `clipboard:<id>`.
- **Tags** (name + color) live in the local key/value store under
  `clipboard:tags`.
- **Capture settings** live in `chrome.storage.local` so the page, the background
  worker, and the content script share one source of truth.

Nothing is uploaded, and there are no analytics or third-party calls. A hard rule
skips password fields; long pastes (over 100,000 characters) and large images
(over 5 MB) are skipped so local storage stays reasonable. Duplicate copies are
de-duplicated rather than stored twice, and the history is trimmed to a maximum
count (default 500) — but favorites are never evicted.
