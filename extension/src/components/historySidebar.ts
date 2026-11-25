// A reusable "history" sidebar: a titled list of past items with a New button,
// active-row highlight, and a right-click menu (Delete built in, with confirm +
// undo). The host owns the data and how the main pane renders (onOpen / onNew).
//
//   load()         -> Promise<entries[]>     (newest first; each needs an `id`)
//   remove(entry)  -> Promise                (commit the delete to the store)
//   itemOf(entry)  -> { snippet, date? }     (date defaults to formatWhen(entry.at))
//   menu(entry)    -> [contextMenuItem]      (extra items; Delete is appended)
//   onOpen(entry) / onNew()                  (render the main pane)
//
// Optional multi-select (pass `selectable: true`): a "Select" toggle reveals a
// checkbox per row plus a select-all + "Delete (N)" bar, for deleting several at
// once (one confirm, one undo that restores them all).
//
// Returns { el, open(entry), showNew(), refresh(), destroy() }. Call `destroy()` from the host's
// teardown — see the `torn` flag below for why nothing else makes the redraws stop.

import { el } from '../lib/dom.js';
import { formatWhen } from '../lib/format.js';
import { confirmDialog } from './confirm.js';
import { openContextMenu, type ContextMenuItem } from './contextMenu.js';
import { showUndoToast } from './undoToast.js';
import { TRASH, PIN } from './icons.js';

export interface HistorySidebarEntry {
  id: string;
  at?: number;
  [key: string]: unknown;
}
export interface HistoryItemInfo {
  snippet?: string;
  date?: string;
  pinned?: boolean;
}
export interface HistorySidebarConfig {
  title?: string;
  emptyText?: string;
  load: () => Promise<HistorySidebarEntry[]>;
  remove: (entry: HistorySidebarEntry) => Promise<void> | void;
  itemOf: (entry: HistorySidebarEntry) => HistoryItemInfo;
  menu?: (entry: HistorySidebarEntry) => ContextMenuItem[];
  onOpen?: (entry: HistorySidebarEntry) => void;
  onNew?: () => void;
  confirmMessage?: string;
  undoMessage?: string;
  undoMs?: number;
  selectable?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  bulkConfirm?: (n: number) => string;
  bulkUndo?: (n: number) => string;
  /**
   * Re-open this entry once the list has loaded — how a minimize-and-reload comes back to the item
   * the user was actually on (#1172).
   *
   * The host saves it from the `onOpen`/`onNew` it already receives, so remembering the user's
   * place costs one option here and one line there, for every app that uses this sidebar.
   *
   * An id that no longer exists (the entry was deleted from another page, or the app was updated)
   * is IGNORED rather than restored: `onOpen` would otherwise fire with undefined and hand the app
   * a result screen for a recording that is not there.
   */
  initialActiveId?: string | null;
}

/**
 * Bind "which entry am I on" to the app session (#1172).
 *
 * Every app that mounts this sidebar needs the same three moves — the open saves, the new clears,
 * the mount restores. Declared once here rather than hand-copied into each, because a copied block
 * is precisely how the conventions in this codebase rot: the floating-window settings were a copied
 * block, and two apps shipped a pop-out the user could not turn off (#197).
 *
 * No count is written down here, deliberately — the callers are the list, and a number in a comment
 * is a number that goes stale (#1099). **Retouch is the one host that does not use this**: its
 * editor has an unsaved-changes guard and its own `restoring` flag, so silently reloading the last
 * image on mount is a product decision rather than a mechanical one, and it was left out on
 * purpose rather than overlooked.
 *
 * `start()` is the part that is easy to get wrong on your own. The mount puts a pane on screen
 * before the (async) list has resolved, and that is not the user navigating — saving it would write
 * a null straight over the entry id being restored.
 */
export function createEntrySession(ctx: { session?: unknown; saveSession?: (state: unknown) => void }) {
  let tracking = false;
  return {
    /** Pass to `createHistorySidebar({ initialActiveId })`. */
    initialActiveId: (ctx.session as { entryId?: string | null } | null)?.entryId ?? null,
    /** Call once the first pane is on screen. */
    start: (): void => {
      tracking = true;
    },
    /** Call from `onOpen` with the entry id, and from `onNew` with null. */
    remember: (entryId: string | null): void => {
      if (tracking) ctx.saveSession?.({ entryId });
    },
  };
}

export function createHistorySidebar({
  title = 'History',
  emptyText = 'Nothing here yet.',
  load,
  remove,
  itemOf,
  menu = () => [],
  onOpen,
  onNew,
  confirmMessage = 'Delete this item?',
  undoMessage = 'Deleted',
  undoMs = 5000,
  selectable = false,
  // Optional: a persistent search box above the list that filters by `itemOf().snippet`.
  searchable = false,
  searchPlaceholder = 'Search…',
  bulkConfirm = (n) => `Delete ${n} selected item${n === 1 ? '' : 's'}?`,
  bulkUndo = (n) => `${n} item${n === 1 ? '' : 's'} deleted`,
  initialActiveId = null,
}: HistorySidebarConfig) {
  const root = el('aside', 'mt-sidebar');
  // Everything this component opens (confirm, undo toast, context menu) and every
  // document-level listener it installs is scoped to `root` — never the bare
  // `document`. A pop-out-capable app mounts this sidebar inside a FLOATING window,
  // and the opener's document is the wrong one: the dialog would appear behind the
  // popped-out app, and the drag-select hit-test would find nothing (#85). `root` is
  // adopted into the host document when it is appended, so it is always the right one.
  const ownerDocOf = (): Document => root.ownerDocument;
  // Raised by destroy(). Async work outlives the pane that asked for it — the history load itself,
  // a delete's undo window committing on a plain setTimeout, an entry opened by a job that settled
  // late — and each of those continuations ends in draw(). Nothing else can tell it the window has
  // gone: `root` is still a live element, just detached, so a draw carries on rebuilding rows for a
  // list nobody is looking at, re-attaching their listeners and holding every entry object
  // reachable, and the closed window's data cannot be collected. In a headless DOM the same draw
  // throws instead (`document is not defined`), which is the only reason it was ever visible (#1329).
  let torn = false;
  const pendingDelete = new Set<string>(); // ids hidden during their undo window
  let activeId: string | null = null;
  let selecting = false; // multi-select mode active
  const selected = new Set<string>(); // ids checked in multi-select mode
  let lastVisible: HistorySidebarEntry[] = []; // entries shown by the last draw
  let query = ''; // current search filter (lowercased)

  // The search box lives OUTSIDE the redrawn list so typing is never interrupted.
  const content = el('div', 'mt-sidebar-content');
  let searchInput: HTMLInputElement | null = null;
  if (searchable) {
    searchInput = el('input', 'input mt-history-search');
    searchInput.type = 'search';
    searchInput.placeholder = searchPlaceholder;
    searchInput.setAttribute('aria-label', 'Search');
    searchInput.addEventListener('input', () => {
      query = searchInput!.value.trim().toLowerCase();
      draw();
    });
  }
  root.replaceChildren(...(searchInput ? [searchInput] : []), content);

  // A row's title, prefixed with a pin marker when `itemOf` reports `pinned`.
  const snippetNode = (info: HistoryItemInfo): HTMLSpanElement => {
    const span = el('span', 'mt-history-snippet');
    if (info.pinned) {
      const pin = el('span', 'mt-history-pin');
      pin.innerHTML = PIN;
      span.append(pin);
    }
    span.append(document.createTextNode(info.snippet ?? ''));
    return span;
  };

  const whenOf = (info: HistoryItemInfo, entry: HistorySidebarEntry): string =>
    info.date ?? (entry.at != null ? formatWhen(entry.at) : '');

  // Both call back into the host, which repaints its MAIN pane — the same defect one step out. A
  // job that resolves after the window closed must not hand the app a result screen to draw.
  const open = (entry?: HistorySidebarEntry): void => {
    if (torn) return;
    activeId = entry?.id ?? null;
    onOpen?.(entry as HistorySidebarEntry);
    draw();
  };
  const showNew = (): void => {
    if (torn) return;
    activeId = null;
    onNew?.();
    draw();
  };

  const deleteEntry = async (entry: HistorySidebarEntry): Promise<void> => {
    if (!(await confirmDialog(confirmMessage, { owner: root }))) return;
    pendingDelete.add(entry.id);
    if (activeId === entry.id) showNew();
    else draw();

    showUndoToast(undoMessage, {
      owner: root,
      duration: undoMs,
      onUndo: () => {
        pendingDelete.delete(entry.id);
        draw();
      },
      onCommit: async () => {
        if (!pendingDelete.has(entry.id)) return;
        pendingDelete.delete(entry.id);
        await remove(entry);
      },
      // A delete that throws leaves the item there — say so, and draw it back (#288).
      commitErrorMessage: "That couldn't be deleted. It is still here.",
      onCommitError: () => {
        pendingDelete.delete(entry.id);
        draw();
      },
    });
  };

  const exitSelect = (): void => {
    selecting = false;
    selected.clear();
  };

  // Delete every checked item at once: one confirm, one undo that restores all.
  const deleteSelected = async (): Promise<void> => {
    const targets = lastVisible.filter((e) => selected.has(e.id));
    if (!targets.length) return;
    if (!(await confirmDialog(bulkConfirm(targets.length), { owner: root }))) return;
    const ids = targets.map((e) => e.id);
    ids.forEach((id) => pendingDelete.add(id));
    exitSelect();
    if (activeId != null && ids.includes(activeId)) showNew();
    else draw();

    showUndoToast(bulkUndo(targets.length), {
      owner: root,
      duration: undoMs,
      onUndo: () => {
        ids.forEach((id) => pendingDelete.delete(id));
        draw();
      },
      // One failure must not abandon the rest of the batch — attempt every item, then report.
      onCommit: async () => {
        const failed: string[] = [];
        for (const entry of targets) {
          if (!pendingDelete.has(entry.id)) continue;
          pendingDelete.delete(entry.id);
          try {
            await remove(entry);
          } catch (err) {
            console.error('history bulk delete failed for', entry.id, err);
            failed.push(String(entry.id));
          }
        }
        draw(); // what survived comes back
        if (failed.length) throw new Error(`${failed.length} of ${targets.length} could not be deleted`);
      },
      commitErrorMessage: "Some of those couldn't be deleted. They are still here.",
      onCommitError: () => draw(),
    });
  };

  // --- mouse drag-select: press on a row and drag over others to select a range
  // (auto-enters selection mode). Mouse only — touch keeps the Select button so
  // it doesn't fight the drawer's scroll. Highlights update in place during the
  // drag (no re-render); one draw() commits on release. ---
  const rowIndexAt = (x: number, y: number): number | null => {
    const item = ownerDocOf().elementFromPoint(x, y)?.closest('.mt-history-item') as HTMLElement | null;
    if (!item || !root.contains(item)) return null;
    const i = Number(item.dataset.index);
    return Number.isNaN(i) ? null : i;
  };

  const armDrag = (e: PointerEvent, anchorIndex: number): void => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return; // primary mouse only
    const startX = e.clientX;
    const startY = e.clientY;
    const base = new Set(selected); // preserve any prior selection; the drag adds to it
    let dragging = false;
    let result = base;

    const paint = (lo: number, hi: number): Set<string> => {
      const set = new Set(base);
      for (let i = lo; i <= hi; i++) {
        const id = lastVisible[i]?.id;
        if (id != null) set.add(id);
      }
      root.querySelectorAll('.mt-history-item').forEach((node) => {
        const item = node as HTMLElement;
        const id = lastVisible[Number(item.dataset.index)]?.id;
        const on = id != null && set.has(id);
        item.classList.toggle('is-dragsel', on);
        const cb = item.querySelector('input[type=checkbox]') as HTMLInputElement | null;
        if (cb) cb.checked = on;
      });
      const del = root.querySelector('.mt-select-del') as HTMLButtonElement | null;
      if (del) {
        del.textContent = `Delete (${set.size})`;
        del.disabled = !set.size;
      }
      return set;
    };

    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
        dragging = true;
        root.style.userSelect = 'none';
      }
      const end = rowIndexAt(ev.clientX, ev.clientY) ?? anchorIndex;
      result = paint(Math.min(anchorIndex, end), Math.max(anchorIndex, end));
      ev.preventDefault();
    };
    const doc = ownerDocOf();
    const up = (): void => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      root.style.userSelect = '';
      if (!dragging) return; // a plain click — let the row's own handler run (open/toggle)
      // Swallow the click synthesized right after this drag so it can't open a row,
      // then remove the guard so it can't eat a later, unrelated click.
      const swallow = (ev: Event): void => ev.stopPropagation();
      doc.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => doc.removeEventListener('click', swallow, { capture: true }), 0);
      selected.clear();
      result.forEach((id) => selected.add(id));
      selecting = true;
      draw();
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  };

  async function draw(): Promise<void> {
    if (torn) return; // cheap: no draw STARTS once the window is gone
    const head = el('div', 'mt-sidebar-head');
    head.append(el('span', 'mt-sidebar-title', title));
    const headActions = el('div', 'mt-head-actions');
    if (selectable) {
      const selBtn = el('button', 'mt-select-toggle', selecting ? 'Done' : 'Select');
      selBtn.type = 'button';
      selBtn.addEventListener('click', () => {
        if (selecting) exitSelect();
        else selecting = true;
        draw();
      });
      headActions.append(selBtn);
    }
    const newBtn = el('button', 'icon-button mt-new', '+');
    newBtn.type = 'button';
    newBtn.title = 'New';
    newBtn.setAttribute('aria-label', 'New');
    newBtn.addEventListener('click', showNew);
    headActions.append(newBtn);
    head.append(headActions);

    const list = el('div', 'mt-history-list');
    let entries: HistorySidebarEntry[] = [];
    try {
      entries = await load();
    } catch {
      /* ignore */
    }
    // The one that matters. `load()` is the host reading its store, so this is where a draw that
    // began while the window was open resumes after it has closed — everything below builds DOM.
    if (torn) return;
    const notDeleted = entries.filter((e) => !pendingDelete.has(e.id));
    const visible = query
      ? notDeleted.filter((e) => (itemOf(e).snippet || '').toLowerCase().includes(query))
      : notDeleted;
    lastVisible = visible;
    // Drop selections for rows that no longer exist.
    for (const id of [...selected]) if (!visible.some((e) => e.id === id)) selected.delete(id);

    const children: HTMLElement[] = [head];

    if (selectable && selecting && visible.length) {
      const bar = el('div', 'mt-select-bar');
      const allCb = Object.assign(el('input'), { type: 'checkbox' });
      allCb.checked = visible.every((e) => selected.has(e.id));
      allCb.addEventListener('change', () => {
        if (allCb.checked) visible.forEach((e) => selected.add(e.id));
        else selected.clear();
        draw();
      });
      const allLabel = el('label', 'mt-select-all');
      allLabel.append(allCb, el('span', undefined, 'Select all'));
      const del = el('button', 'button-primary is-danger mt-select-del', `Delete (${selected.size})`);
      del.type = 'button';
      del.disabled = !selected.size;
      del.addEventListener('click', deleteSelected);
      bar.append(allLabel, del);
      children.push(bar);
    }

    if (!visible.length) list.append(el('p', 'mt-history-empty', emptyText));
    visible.forEach((entry, idx) => {
      const item = el('div', 'mt-history-item' + (entry.id === activeId ? ' is-active' : ''));
      const info = itemOf(entry);
      if (info.pinned) item.classList.add('is-pinned');
      if (selectable) {
        item.dataset.index = String(idx);
        item.addEventListener('pointerdown', (e) => armDrag(e, idx)); // mouse drag-select
      }
      if (selectable && selecting) {
        // Whole row is a label that toggles the checkbox; no open/contextmenu.
        const label = el('label', 'mt-history-select');
        const cb = Object.assign(el('input'), { type: 'checkbox' });
        cb.checked = selected.has(entry.id);
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(entry.id);
          else selected.delete(entry.id);
          draw();
        });
        const text = el('span', 'mt-history-open');
        text.append(snippetNode(info), el('span', 'mt-history-date', whenOf(info, entry)));
        label.append(cb, text);
        item.append(label);
      } else {
        const btn = el('button', 'mt-history-open');
        btn.append(snippetNode(info), el('span', 'mt-history-date', whenOf(info, entry)));
        btn.addEventListener('click', () => open(entry));
        item.append(btn);
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openContextMenu(
            e.clientX,
            e.clientY,
            [
              ...menu(entry),
              { separator: true },
              { label: 'Delete', icon: TRASH, danger: true, onClick: () => deleteEntry(entry) },
            ],
            { owner: root },
          );
        });
      }
      list.append(item);
    });
    children.push(list);
    content.replaceChildren(...children);
  }

  // The first draw is also the session restore: `load()` is async, so the entry to re-open cannot
  // be known until it resolves. `open` is only called for an id that is genuinely still there.
  const firstDraw = draw().then(() => {
    // Closed before the list landed. `ready` promises what was ACTUALLY restored, so answering with
    // an entry nothing opened would be a small lie told to a host that is no longer there.
    if (torn || !initialActiveId) return null;
    const entry = lastVisible.find((e) => e.id === initialActiveId);
    if (entry) open(entry);
    // Resolves with what was ACTUALLY restored, so a host can tell "came back to your item" from
    // "that item is gone" and fall back rather than leaving an empty pane.
    return entry ?? null;
  });

  /**
   * The window that owns this sidebar has gone; stop drawing it.
   *
   * Idempotent, and deliberately NOT a cancel: a delete the user already confirmed still commits
   * when its undo window lapses, because closing a window is not undoing it. Only the repaint that
   * would follow is skipped.
   */
  const destroy = (): void => {
    torn = true;
  };

  return { el: root, open, showNew, refresh: draw, ready: firstDraw, destroy };
}
