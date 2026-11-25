# Getting Started

Open Tabs from the dock. The first time you open it, the app asks for
permission to read your tabs — it needs the browser's `tabs` access to search,
switch, hibernate, and save them. Click **Grant access to my tabs** to continue.
The request runs from your click (a user gesture, as the browser requires) and
everything stays on your device; if you decline, nothing changes and you can
grant it later.

Once granted, the app loads your open tabs, your recently closed items, and any
saved sessions.

## Finding and switching tabs

The search box sits at the top. Start typing to fuzzy-search every open tab by
its title and URL — you do not need a contiguous match, so `gh iss` finds a
"GitHub · Issues" tab.

- **`↑` / `↓`** — move the highlight up and down the results.
- **`Enter`** — jump to the highlighted tab (focusing its window).
- **`Esc`** — clear the query and return to the windows overview.
- **Click a tab** — switch to it directly.

Search is debounced, so the ranked list rebuilds a moment after you stop typing
rather than on every keystroke.

## The windows overview

With the search box empty, tabs are grouped by window, with the focused window
("This window") first and a per-window tab count. Tabs that belong to a tab
group appear under a colored group chip. Each row shows the favicon (read from the
browser's own icon cache, so no request goes to the site; or a
per-domain monogram tile when no favicon is usable), the title, and a tidied
URL, plus badges marking pinned (`Pinned`), audible (`♪`), and hibernated
(`Asleep`) tabs.

## Row actions

Hover a tab row for its quick actions:

- **Hibernate** (moon icon) — discard the tab to free memory; it reloads when
  next focused. Hidden for tabs that are already asleep.
- **Close** (✕) — close the tab.
- **More** (⋯) — a menu with **Pin / Unpin**, **Move to** (a new window, or any
  other open window), **Group** (new group, an existing group, or remove from
  group), and **Close tab**.

## Grouping tabs

You can build tab groups two ways:

- From a tab's **More → Group** menu: start a **New group**, add the tab to an
  existing group, or **Remove from group**.
- In multi-select mode: tick several tabs, then **Group N** collects them into a
  new group at once.

Click a group's chip to open its editor: **rename** the group, pick one of the
nine **colors**, or **Ungroup all tabs**.

## Moving, pinning, and reordering

- **Drag** a tab row to reorder it, drop it on another tab to place it there, or
  drop it on a window header to move it into that window.
- **Pin / Unpin** from the More menu.
- **Move to → New window** (or another open window) from the More menu, or drag
  it across.

If the browser clamps a move (for example, pinned-tab constraints), the list
simply re-scans and reflects the real state.

## Recently closed

Below the overview, **Recently closed** lists tabs and windows you just closed,
read from the browser's own history. Click an item (or its reopen icon) to
restore it — a closed window brings back all of its tabs.

## Saving and reopening sessions

Click **Save window** in the top bar to stash the current window's saveable tabs
(its `http`/`https` pages) as a named session. Saved sessions appear under
**Saved sessions**, each showing its tab count and when you saved it.

- **Reopen** — click the session (or its open icon) to reopen all its tabs in a
  new window.
- **Delete** — remove a session with its trash icon, after a confirm. A toast
  lets you **undo** for a few seconds.

Sessions persist in local browser storage, so they survive restarts and travel
with your browser profile.

## Deleting several at once

Use **Select** to enter multi-select mode:

- In the overview, tick tabs and close them in one step (or **Group** them).
- Under Saved sessions, tick sessions and delete them together.

You can also drag across rows to select a range.

## Agent tools (not active yet)

Tabs declares agent tools — list, switch, close and hibernate tabs, and manage
sessions — through the same on-device code paths as the UI. **They do not run
today.** No shipped on-device model is reliable enough to call tools, so the
assistant cannot drive Tabs for you. The declarations are kept so the feature is a
runtime switch rather than a rewrite if that changes.
