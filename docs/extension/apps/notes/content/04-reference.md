# Reference

A quick reference for shortcuts, settings, internal links, and storage.

## Keyboard shortcuts

| Keys                                | Action                           |
| ----------------------------------- | -------------------------------- |
| `⌘/Ctrl` + `F`                      | Open find & replace              |
| `⌘/Ctrl` + `Z`                      | Undo (including Replace)         |
| `⌘` + `Shift` + `Z` / `Ctrl` + `Y`  | Redo                             |
| `Enter` (in the editor, on a list)  | Continue the list                |
| `Enter` (on an empty list item)     | End the list                     |
| `Shift` + `Enter` (in the editor)   | A plain newline, never a marker  |
| `Enter` (in the find bar)           | Next match                       |
| `Shift` + `Enter` (in the find bar) | Previous match                   |
| `Esc`                               | Close the find bar (or a dialog) |

The **Aa** button in the find bar toggles match-case; **Replace** changes the
current match and **All** replaces every match in one undoable step.

## List continuation

| Current line | `Enter` inserts                        |
| ------------ | -------------------------------------- |
| `- [ ] item` | `- [ ] ` (a continued box is unticked) |
| `- item`     | `- `                                   |
| `* item`     | `* `                                   |
| `+ item`     | `+ `                                   |
| `1. item`    | `2. `                                  |
| `3) item`    | `4) `                                  |

Leading indentation is carried across, so a nested list stays nested. An item with
nothing in it ends the list instead. Anything that is not a list item leaves
`Enter` alone.

## Task checkboxes

| Where                         | Behaviour                                                    |
| ----------------------------- | ------------------------------------------------------------ |
| Notes preview (Split/Preview) | Clickable; ticking rewrites `[ ]` / `[x]` in the page source |
| Book view, print, exports     | Rendered as-is, not clickable                                |
| Other apps' Markdown previews | Not clickable — no source document behind them               |

## Settings

Open the app's settings to configure the floating window. These are per-app.

| Setting              | Key       | Options                  | Default  |
| -------------------- | --------- | ------------------------ | -------- |
| Floating window      | `popout`  | On, Off                  | On       |
| Floating window size | `pipSize` | Compact, Standard, Large | Standard |

**Floating window** shows the "pop out" button in the title bar (it needs a
browser that supports the feature; keep the original tab open). **Floating window
size** sets how big the window first opens — you can still drag its edges to
resize afterwards:

| Size     | Opens at  |
| -------- | --------- |
| Compact  | 380 × 520 |
| Standard | 560 × 720 |
| Large    | 880 × 940 |

## Internal-link syntax

Write an internal link as a normal Markdown link whose target is a page
reference. Names are normalized: spaces and dashes become `_` and case is
ignored (so "Page Title" → `page_title`).

| Syntax                              | Links to                          |
| ----------------------------------- | --------------------------------- |
| `[text](this:page_name)`            | A page in the **same** collection |
| `[text](collection_name:page_name)` | A page in **another** collection  |

Anything that looks like a real URL (e.g. `https://…`, `//…`, `#…`, `/…`) is
left as an external link and opens in a new tab; schemeless links get `https://`
added automatically.

## Right-click actions

| Item       | Actions                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| Collection | New page, Export as Book, Rename, Download (`.zip`), Export as PDF, Delete     |
| Page       | New page, Rename, Download (`.md`), Export as PDF, Move to collection…, Delete |

## Data & storage

| Item                                          | Where it lives                                |
| --------------------------------------------- | --------------------------------------------- |
| Collections (name, last-updated)              | IndexedDB records                             |
| Pages (title, Markdown content, last-updated) | IndexedDB records, linked to a collection     |
| Backup                                        | Included in the suite's local Export / Import |

Pages are capped at **{{noteMaxChars}} characters** each. Deleting a collection also
deletes its pages. Deletes and moves can be undone for 30 seconds. Nothing is
ever uploaded.
