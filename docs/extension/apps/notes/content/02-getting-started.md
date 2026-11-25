# Getting Started

Open Notes from the dock. On first run, if you have no collections yet,
it offers **New collection** to get started. After that, your most recently
worked-on collection opens automatically, with its first page in the editor.

## Collections and pages

The left sidebar is a tree: collections at the top level, their pages nested
underneath.

- **New collection** — the **＋** button in the sidebar header.
- **New page** — expand a collection and click **New page** at the bottom of its
  page list, or pick **New page** from the right-click menu of any collection or
  page.
- **Expand / collapse** — click a collection to show or hide its pages.
- **Open a page** — click it to load it into the editor.
- **Rename, move, delete** — right-click a collection or page for its menu.
- **Move a page** — drag it onto another collection, or use **Move to
  collection…** in its right-click menu.
- **Resize the sidebar** — drag the divider; the **☰** button toggles it.

Every edit **autosaves** a moment after you stop typing. Deleting a page or a
whole collection can be **undone for 30 seconds** via the toast that appears.

## The Markdown editor

Write in GitHub-flavored Markdown: headings, lists, tables, links, and fenced
code blocks (syntax-highlighted for many languages). Pages are capped at {{noteMaxChars}}
characters; the counter in the toolbar shows how close you are.

Switch panes with the toolbar tabs:

- **Edit** — the source textarea only (the default).
- **Split** — source and live preview side by side; drag the divider to resize
  the two panes.
- **Preview** — the rendered result only.

When the window is too narrow for two panes, Split falls back to Edit
automatically until there is room again. A narrow window also has no room for the
three tabs, so they give way to a single toggle next to the search button that
flips between writing and preview.

## Lists and checklists

Lists continue themselves. Press `Enter` at the end of a list item and the next
line starts with the same marker, indented to match:

| You are on   | `Enter` gives you                     |
| ------------ | ------------------------------------- |
| `- [ ] item` | `- [ ] ` — a new box, always unticked |
| `- item`     | `- `                                  |
| `* item`     | `* ` (the marker you used is kept)    |
| `1. item`    | `2. ` (the number goes up)            |

A continued checkbox is deliberately **unticked**, even when you continued a
ticked one — the new task is not one you have done.

To **end a list**, press `Enter` on an item you have not typed anything into. The
marker is removed and you are left on a blank line. `Shift` + `Enter` skips all of
this and gives you a plain newline wherever you are.

Undo treats a continuation as one step, so `⌘/Ctrl` + `Z` takes back the whole
marker rather than a character at a time.

## Ticking things off

Checkboxes in the **preview** are real checkboxes — click one and it ticks. What
you are actually clicking is the note itself: the click rewrites `[ ]` as `[x]` in
your Markdown, so the change is saved with the page and comes out in every export,
the book view and the print. In Split view you can watch the source change as you
click.

This is specific to Notes. The assistant's replies and file previews render the
same Markdown, but there is no document behind them to write to, so their
checkboxes stay decorative.

## Find & replace

Press `⌘/Ctrl+F` (or the search icon) to open the find bar. Every match is
highlighted in the source.

- **Enter** / **Shift+Enter** — jump to the next / previous match.
- **Aa** — toggle match case.
- **Replace** — change the current match; **All** — replace every match in one
  undoable step.
- **Esc** — close the bar.

Replacements join the editor's native undo history, so `⌘/Ctrl+Z` undoes them
just like typing.

## Internal links

Link from one page to another using an ordinary Markdown link whose target is a
page reference instead of a URL:

- **Same collection:** `[text](this:page_name)`
- **Another collection:** `[text](collection_name:page_name)`

Names are normalized — spaces and dashes become `_` and case is ignored — so a
page titled "Page Title" is referenced as `page_title`. In the editor's preview,
clicking an internal link opens the target page; in Book view it navigates within
the reading view.

## Export as Book

From a collection's right-click menu, choose **Export as Book** to read the whole
collection as one continuous, rendered document (pages in oldest-first order).
Internal links navigate within the book, and the **←** button steps back through
where you have been; the **⬇** icon exports the book to PDF.

## Export and download

From the right-click menus (or the Book view):

- **Download a page** as a `.md` Markdown file.
- **Download a collection** as a `.zip` containing one `.md` file per page,
  inside a folder named after the collection.
- **Export as PDF** — for a single page or a whole collection. This opens your
  browser's print dialog; choose **Save as PDF**. Each page in a collection
  export starts on its own sheet. Everything stays on your device.

## The floating window

If your browser supports it, a **pop out** button appears in the title bar (you
can turn this off in settings). It moves the app into a small, always-on-top
floating window — the same browser feature Google Meet uses — so your notes stay
visible while you work in other tabs. Keep the original tab open; the floating
window lives only as long as that tab does.

## Deleting several at once

Click **Select** in the sidebar to enter multi-select mode. Tick pages, or pick
whole collections (which selects all of their pages too), then **Delete (N)**
removes them in one step. You can also drag across collection rows to select a
range. A single confirm covers the batch, and one **Undo** restores everything.
