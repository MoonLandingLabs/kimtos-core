# Getting Started

Open Clipboard from the dock. Once the app is installed, capture
starts automatically: copy some text on any site and it appears in the list. If
you have not copied anything yet, the list reads "Nothing copied yet."

## The clipboard window

The window is a single list of your clips, most-recently-used first, with a
toolbar on top and a stats/housekeeping footer at the bottom.

- **Search** — type in the search box to filter clips by substring.
- **Sort** — the **Recent / A–Z** button toggles between most-recent-first and
  alphabetical order.
- **Monitoring** — the **● Monitoring / ○ Paused** button turns capture on or off
  everywhere (this setting is shared with the background worker and the content
  script).
- **Settings** — the sliders button opens a drawer (see below).
- **Add an item** — type into the "Add an item…" box and press Enter (or the **+**
  button) to save a clip manually.

## Working with a clip

Each row shows the clip's preview (or a thumbnail for image clips), its
last-used time, and the source page it came from, plus its tags.

- **Copy it back** — click the preview text (or thumbnail), or the copy icon. A
  brief "Copied" note confirms. Copying updates the clip's last-used time and use
  count. (Copying needs a focused window; if it fails, click the window first.)
- **Favorite** — click the star. Favorites are protected from auto-cleanup, from
  "Clear", and from being deleted without an explicit acknowledgement.
- **Edit** — the pencil icon opens an inline editor; **Save** rewrites the text
  (and its preview, type, and size).
- **Tag** — the tag icon prompts for a tag name; a new tag gets the next color
  from the palette automatically. Remove a tag by clicking its `#tag ×` chip.
- **Delete** — the trash icon removes the clip, after a confirm. A toast lets
  you **undo** for a few seconds. Deleting a favorite additionally asks you to
  acknowledge it explicitly.

## Filter chips

Below the toolbar, chips filter the list: **All**, **★ Favorites**, and one chip
per tag (`#tagname`). Click a chip to filter; click it again to clear.

## Batch actions

Enter multi-select from the list header to tick several clips at once, then
delete them in one step (one confirm, one **Undo**). Favorites keep their star
while selecting, and if the batch contains any, the confirm says how many and
stays disabled until you tick "Delete all N favorites too" — so **Select all**
can never quietly take your favorites with it. With two or more selected, a
**Merge (N)** button appears that combines them into a single new clip.

## Capture settings

The settings drawer (the sliders button) controls how capture behaves. These
settings are stored in `chrome.storage.local` so they apply across the page, the
background worker, and every tab's content script:

- **Keep at most** — the maximum number of clips to retain (10–5000, default
  500). When you exceed it, the oldest non-favorite clips are evicted.
- **Never capture from** — a comma-separated list of hosts to exclude; a copy on
  a matching site is ignored.
- **Show a note on the page when I copy** — toggles the small "Saved to Kimtos
  Clipboard" toast that appears on the page after a captured copy.
- **Also capture copied images** — off by default; when on, copying an image
  file saves it as an image clip (subject to the 5 MB cap).

Password fields are always skipped regardless of these settings.

## Pasting on any page

You do not need to switch to the kimtos tab to reuse a clip. On any https page:

- **Open the picker** — press `Alt+Shift+V`, choose **Paste from Kimtos
  Clipboard…** from the right-click menu, or click the small kimtos button that
  appears at the corner of a focused text field. A search overlay opens; type to
  filter, use **↑ ↓** to move, **Enter** to paste, **Esc** to close. The clip is
  inserted into the field you were in — or copied to the system clipboard if no
  field is focused.
- **Quick paste** — `Alt+Shift+1`, `Alt+Shift+2`, or `Alt+Shift+3` pastes the
  1st, 2nd, or 3rd most-recent clip straight into the focused field.
- **Save a selection explicitly** — right-click a selection and choose **Save
  selection to Clipboard History**. This is deliberate, so it bypasses the
  monitor toggle and exclusions.
- **Open the side panel** — right-click and choose **Open Kimtos Clipboard
  panel** to keep the history open beside the tab.

The `Alt+Shift+V` shortcut is editable at `chrome://extensions/shortcuts`.

## Import, export, and clearing

The footer shows a live count, total size, and favorite count, plus:

- **Export JSON** — downloads your whole history (image clips inlined as data
  URLs) as `kimtos-clipboard.json`.
- **Import JSON** — loads clips from a previous export or a compatible
  `{ items: [{ text }] }` file. Imports merge by content — duplicates are not
  re-added.
- **Clear…** — after a confirm, removes every clip **except your favorites**.
