# Overview

**Notes** is a Notion-style Markdown notebook. You organize your writing
into **collections** (think of a collection as a notebook, e.g. one per book or
topic), and each collection holds one or more Markdown **pages**. A sidebar tree
lets you expand a collection to reveal its pages, and an editor with an optional
live preview sits alongside. It is part of the kimtos new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no
network: every collection and page lives in your browser's IndexedDB and never
leaves the machine.

## Highlights

- **Collections & pages** — a sidebar tree of collections, each expanding to its
  pages. Create, rename, move, and delete from right-click menus.
- **Markdown editor** — write GitHub-flavored Markdown with headings, lists,
  tables, links, and fenced code blocks with syntax highlighting.
- **Edit / Split / Preview** — write in source, see a live preview, or split the
  pane and do both. Edits **autosave**.
- **Find & replace** — `⌘/Ctrl+F` opens a find bar; every match is highlighted,
  with match-case, previous/next, replace, and replace-all.
- **Internal links** — link from one page to another with a plain Markdown link,
  within a collection (`this:page`) or across collections (`collection:page`).
- **Export as Book** — read a whole collection as one continuous document, with
  internal links navigating in the reading view.
- **Export & download** — download a page as `.md`, a collection as a `.zip`, or
  export either to **PDF** through your browser's own print dialog.
- **Floating window** — pop the app out into a small, always-on-top window so
  your notes stay visible while you browse other tabs.
- **Home card** — an optional card on the KimtOS home screen listing your
  collections; click one to open it, or start a new collection. Turn it off in
  Settings ▸ Preferences.
- **Batch delete with undo** — multi-select collections and pages, delete in one
  step, and undo for 30 seconds.

## Privacy model

Notes writes only to local browser storage:

- **Collections** (name, last-updated time) are records in IndexedDB.
- **Pages** (title, Markdown content, last-updated time) are records in
  IndexedDB, each linked to its collection.
- Nothing is uploaded, and there are no analytics or third-party calls.

Markdown is rendered **client-side** purely for an instant preview and for
export — all of your data and logic stays local. Because each page is plain
Markdown text, your work is portable: it travels with the browser profile and is
included in the suite's local backup.
