# Overview

**Tabs** is an on-device tab manager for your browser. It gives you a
`⌘K`-style fuzzy finder over every open tab, groups those tabs by window, lets
you hibernate idle ones to reclaim memory, and stashes a set of tabs as a named
**session** you can reopen later. It is part of the kimtos new-tab app suite.

Everything is **fully on-device**. Tabs talks to the browser's own tab APIs
directly and stores your saved sessions in the browser's local IndexedDB. There
is no backend, no account, and no network call — your tabs and their URLs never
leave the machine.

## Highlights

- **Fuzzy tab finder** — type to search every open tab by title and URL. A
  subsequence scorer ranks contiguous and word-start matches first, so `gh iss`
  surfaces your GitHub issues tab. Use `↑`/`↓` to move the highlight and `Enter`
  to jump to it; `Esc` clears the query.
- **Windows overview** — when you are not searching, tabs are listed grouped by
  window (the focused window first), with tab-group chips inline.
- **Hibernate idle tabs** — discard a tab to free the memory it holds; it
  reloads automatically the next time you focus it.
- **Tab groups** — select several tabs and group them, or from a tab's menu
  create a new group or add it to an existing one. Rename a group and recolor it
  from the nine colors Chrome allows, or ungroup all its tabs.
- **Move, pin, reorder** — drag a tab to reorder it or move it to another
  window, pin/unpin it, or send it to a brand-new window.
- **Recently closed** — reopen tabs (or whole windows) you just closed, read
  from the browser's own recently-closed list.
- **Saved sessions** — "Save window" stashes the current window's tabs as a
  named session; reopen it later (all tabs in a new window) or delete it.
- **Batch actions with undo** — multi-select tabs to close them, or sessions to
  delete them, in one step.
- **Agent tools (declared, not active)** — Tabs declares tools to list, switch,
  close and hibernate tabs and manage sessions, through the same code paths as the
  UI, for a future on-device assistant. No shipped model can run them yet.

## Privacy model

Tabs reads and controls your tabs only on this device:

- **Reading your tabs** (titles, URLs, favicons) requires the browser's `tabs`
  permission, which the app requests at runtime — only when you open it and
  click **Grant access to my tabs**, never from a background update.
- **Saved sessions** (a name, a timestamp, and each tab's title/URL/favicon) are
  records in the browser's local IndexedDB, in the `tab-sessions` collection.
- Nothing is uploaded, and there are no analytics or third-party calls.

Because it drives the real browser tab APIs, Tabs only works in the installed
extension — not in the `vite dev` preview, where those APIs are unavailable.
