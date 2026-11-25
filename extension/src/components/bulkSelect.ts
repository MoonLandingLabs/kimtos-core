// Reusable multi-select + batch delete for custom lists (apps that don't use
// createHistorySidebar). The host owns rendering; this owns the selection state,
// the Select/Done + select-all + Delete(N) controls, and the confirm+undo delete.
//
//   noun        singular item noun for messages ("task" -> "Delete 3 tasks?")
//   remove      async (entry) => commit one delete to the store
//   onChange    () => host re-renders its list (reads isSelecting()/isChecked())
//   refresh     optional: () => host re-reads the store, then re-renders (commit only)
//   isProtected optional: this entry needs an explicit acknowledgement first
//
// Both the batch delete AND the single-row delete live here (`deleteSelected` /
// `deleteOne`), because they are the same action at different arity and must behave
// identically. They used not to: every host hand-rolled its per-row Delete straight
// against the store, so the batch path offered an Undo and the row's own trash icon
// did not — the same item, deleted two ways, with two different guarantees (#724).
// A host's per-row delete calls `deleteOne`; it never talks to the store itself.
//
// See CLAUDE.md "App conventions" for the standard.

import { el, ownerDoc } from '../lib/dom.js';
import { confirmDialog } from './confirm.js';
import { showUndoToast } from './undoToast.js';

export interface BulkEntry {
  id: string;
  [key: string]: unknown;
}
export interface DeleteOneOptions {
  /** Overrides the default `Delete this <noun>?` confirm question. */
  confirmMessage?: string;
  /** Overrides the default `1 <noun> deleted` toast message. */
  undoMessage?: string;
}
export interface BulkSelectOptions {
  noun?: string;
  remove: (entry: BulkEntry) => Promise<void> | void;
  onChange: () => void;
  /** Repaint from TRUTH — re-read the store, then re-render. Called instead of `onChange`
   *  on the commit transitions (a commit, successful or failed), never on a selection
   *  toggle or an undo. At the moment a delete commits, the deleted ids leave the pending
   *  set, so a host whose `onChange` repaints an in-memory snapshot resurrects the rows it
   *  just deleted (#940 — Tabs' closed tabs came back and stayed). Defaults to `onChange`,
   *  which is correct for every host whose `onChange` already reads from the store. */
  refresh?: () => void | Promise<void>;
  undoMs?: number;
  /** The app's root element. A pop-out-capable app must pass it, so the confirm and
   *  the undo toast open in the floating window rather than on the new-tab page behind
   *  it — an unseen undo toast silently commits the delete (#85). The drag-select does
   *  not need it: it derives the document from the row you pressed. */
  owner?: Element | null;
  /** Does this entry carry the app's "keep this" mark (a favorited clip, a pinned note)?
   *  A delete that includes one is not made on a plain confirm: the dialog names how many are
   *  protected and gates its Confirm behind an explicit acknowledgement checkbox. Without this,
   *  a mark the app honours everywhere else — Clipboard's star already survives auto-cleanup
   *  and "Clear" — counted for nothing the moment the user hit Select all (#650). */
  isProtected?: (entry: BulkEntry) => boolean;
  /** Singular noun for a protected entry, used in that confirm ("2 of them are favorites").
   *  Defaults to `favorite`; pass the app's own word when it calls the mark something else. */
  protectedNoun?: string;
}

export function createBulkSelect({
  noun = 'item',
  remove,
  onChange,
  refresh = onChange,
  undoMs = 5000,
  owner,
  isProtected,
  protectedNoun = 'favorite',
}: BulkSelectOptions) {
  let selecting = false;
  const selected = new Set<string>();
  const pending = new Set<string>(); // ids hidden during their undo window
  let delBtn: HTMLButtonElement | null = null; // the live "Delete (N)" button
  const plural = (n: number): string => `${noun}${n === 1 ? '' : 's'}`;
  const protectedPlural = (n: number): string => `${protectedNoun}${n === 1 ? '' : 's'}`;
  const idOf = (rowEl: HTMLElement | null | undefined): string | undefined => rowEl?.dataset?.bulkId;
  // Repaint from truth, and keep a repaint failure OUT of the delete's error path: the
  // host's `refresh` may be an async re-query that can reject, and throwing it out of a
  // commit would tell the user the delete did not happen when it did.
  const repaintFromTruth = async (): Promise<void> => {
    try {
      await refresh();
    } catch (err) {
      console.error('bulk delete repaint failed', err);
    }
  };

  /**
   * The guard on top of the confirm: what the app marked to keep must be NAMED before it is
   * destroyed. "Delete 12 clips?" is the same sentence whether or not it takes the starred ones
   * with it, which is exactly why the star stopped meaning anything on this one path (#650).
   * Returns nothing when the app declares no mark, or when this batch contains none — so every
   * existing host's confirm is byte-for-byte what it was.
   */
  function protectionFor(targets: BulkEntry[]): { suffix: string; checkbox?: { label: string } } {
    const g = isProtected ? targets.filter(isProtected).length : 0;
    if (!g) return { suffix: '' };
    const n = targets.length;
    let suffix: string;
    if (n === 1) suffix = ` It is a ${protectedNoun}.`;
    else if (g === n) suffix = ` All of them are ${protectedPlural(g)}.`;
    else if (g === 1) suffix = ` 1 of them is a ${protectedNoun}.`;
    else suffix = ` ${g} of them are ${protectedPlural(g)}.`;
    return {
      suffix,
      checkbox: { label: g === 1 ? `Delete the ${protectedNoun} too` : `Delete all ${g} ${protectedPlural(g)} too` },
    };
  }

  // Mouse drag-select: press a row and drag over others to select a range,
  // scoped to the row's own list container. Auto-enters selection mode. A plain
  // click (no movement past threshold) is left for the row's own handler.
  function armDrag(e: PointerEvent, anchorEl: HTMLElement): void {
    if (e.pointerType !== 'mouse' || e.button !== 0) return; // primary mouse only
    // The row you pressed IS in the app's document — so a popped-out app needs no
    // extra wiring here: track the drag in whichever document the row lives in.
    const doc = ownerDoc(anchorEl);
    // Drag range spans the nearest [data-bulk-list] ancestor, or the direct parent
    // when none is marked (so rows nested below a list still drag across siblings).
    const container = (anchorEl.closest('[data-bulk-list]') || anchorEl.parentElement) as HTMLElement | null;
    if (!container) return;
    const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[data-bulk-id]')];
    const anchorIndex = rows().indexOf(anchorEl);
    if (anchorIndex < 0) return;
    const base = new Set(selected); // a drag adds to any prior selection
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let result = base;

    const paint = (lo: number, hi: number): Set<string> => {
      const list = rows();
      const set = new Set(base);
      for (let i = lo; i <= hi; i++) {
        const id = idOf(list[i]);
        if (id != null) set.add(id);
      }
      // Class-only preview: don't touch row checkboxes — in normal mode those are
      // semantic (done / read), not selection. The commit re-render reflects truth.
      list.forEach((row) => row.classList.toggle('is-selected', set.has(idOf(row) ?? '')));
      if (delBtn) {
        delBtn.textContent = `Delete (${set.size})`;
        delBtn.disabled = !set.size;
      }
      return set;
    };

    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
        dragging = true;
        container.style.userSelect = 'none';
      }
      const overEl = doc.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-bulk-id]') as HTMLElement | null;
      const end = overEl && container.contains(overEl) ? rows().indexOf(overEl) : anchorIndex;
      result = paint(Math.min(anchorIndex, end), Math.max(anchorIndex, end));
      ev.preventDefault();
    };
    const up = (): void => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      container.style.userSelect = '';
      if (!dragging) return; // a plain click — let the row's own handler run
      // Swallow the click synthesized right after this drag (so it doesn't toggle a
      // row), then remove the guard so it can't eat a later, unrelated click.
      const swallow = (ev: Event): void => ev.stopPropagation();
      doc.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => doc.removeEventListener('click', swallow, { capture: true }), 0);
      selected.clear();
      result.forEach((id) => selected.add(id));
      selecting = true;
      onChange();
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  const api = {
    isSelecting: () => selecting,
    isChecked: (id: string) => selected.has(id),
    setChecked(id: string, on: boolean) {
      if (on) selected.add(id);
      else selected.delete(id);
    },
    // Tag a row for drag-select. Call on every row (both normal and select mode)
    // so a drag can begin anywhere; `id` must match the entry's id.
    bindRow(rowEl: HTMLElement, id: string | number): HTMLElement {
      rowEl.dataset.bulkId = String(id);
      rowEl.addEventListener('pointerdown', (e) => armDrag(e, rowEl));
      return rowEl;
    },
    // True while an id is in its post-delete undo window (host can skip the row).
    isPending: (id: string) => pending.has(id),
    // Hide rows that are mid-undo so a batch delete looks immediate.
    filterVisible: (entries: BulkEntry[]) => entries.filter((e) => !pending.has(e.id)),

    // The Select/Done toggle plus, while selecting, the select-all + Delete(N) bar.
    controls(visible: BulkEntry[]): HTMLElement {
      const wrap = el('div', 'bulk-controls');
      const toggle = el('button', 'mt-select-toggle', selecting ? 'Done' : 'Select');
      toggle.type = 'button';
      toggle.disabled = !visible.length && !selecting;
      toggle.addEventListener('click', () => {
        selecting = !selecting;
        if (!selecting) selected.clear();
        onChange();
      });
      wrap.append(toggle);

      delBtn = null;
      if (selecting) {
        const bar = el('div', 'mt-select-bar');
        const allCb = Object.assign(el('input'), { type: 'checkbox' });
        allCb.checked = visible.length > 0 && visible.every((e) => selected.has(e.id));
        allCb.addEventListener('change', () => {
          if (allCb.checked) visible.forEach((e) => selected.add(e.id));
          else selected.clear();
          onChange();
        });
        const lbl = el('label', 'mt-select-all');
        lbl.append(allCb, el('span', undefined, 'Select all'));
        const del = el('button', 'button-primary is-danger mt-select-del', `Delete (${selected.size})`);
        del.type = 'button';
        del.disabled = !selected.size;
        del.addEventListener('click', () => api.deleteSelected(visible));
        bar.append(lbl, del);
        wrap.append(bar);
        delBtn = del;
      }
      return wrap;
    },

    // Delete ONE entry with exactly the guarantees the batch path gives: a confirm, the
    // row gone at once, and a real Undo window before anything is committed. Hosts call
    // this from a row's trash button instead of hitting the store themselves. Resolves
    // true once the delete is in flight (the undo toast is up), false if the user
    // cancelled. The row disappears via `filterVisible`/`isPending`, which every host
    // already applies for the batch path.
    deleteOne(entry: BulkEntry, { confirmMessage, undoMessage }: DeleteOneOptions = {}) {
      return runDelete({
        targets: [entry],
        confirmMessage: confirmMessage ?? `Delete this ${noun}?`,
        undoMessage: undoMessage ?? `1 ${noun} deleted`,
        commitErrorMessage: `That ${noun} couldn't be deleted. It is still here.`,
        // A single-row delete must not silently drop a selection the user built up.
        exitSelection: false,
      });
    },

    deleteSelected(visible: BulkEntry[]) {
      const targets = visible.filter((e) => selected.has(e.id));
      const n = targets.length;
      return runDelete({
        targets,
        confirmMessage: `Delete ${n} ${plural(n)}?`,
        undoMessage: `${n} ${plural(n)} deleted`,
        commitErrorMessage: `Some ${plural(n)} couldn't be deleted. They are still here.`,
        exitSelection: true,
      });
    },
  };

  // The one delete: confirm, hide, undo window, then commit. Both arities go through it
  // so a single-row delete cannot drift from the batch one again (#724).
  async function runDelete({
    targets,
    confirmMessage,
    undoMessage,
    commitErrorMessage,
    exitSelection,
  }: {
    targets: BulkEntry[];
    confirmMessage: string;
    undoMessage: string;
    commitErrorMessage: string;
    exitSelection: boolean;
  }): Promise<boolean> {
    if (!targets.length) return false;
    const { suffix, checkbox } = protectionFor(targets);
    if (!(await confirmDialog(`${confirmMessage}${suffix}`, { owner, checkbox }))) return false;
    const ids = targets.map((e) => e.id);
    ids.forEach((id) => {
      pending.add(id);
      selected.delete(id);
    });
    if (exitSelection) {
      selecting = false;
      selected.clear();
    }
    onChange();

    showUndoToast(undoMessage, {
      owner,
      duration: undoMs,
      onUndo: () => {
        ids.forEach((id) => pending.delete(id));
        onChange();
      },
      // ONE failure must not abandon the rest of the batch. Every target is attempted; what
      // fails is collected and reported, and the rows that were NOT deleted come back —
      // they still exist. This used to throw out of the loop and vanish (#288).
      onCommit: async () => {
        const failed: BulkEntry[] = [];
        for (const entry of targets) {
          if (!pending.has(entry.id)) continue;
          pending.delete(entry.id);
          try {
            await remove(entry);
          } catch (err) {
            console.error('bulk delete failed for', entry.id, err);
            failed.push(entry);
          }
        }
        // Repaint from TRUTH, not the host's snapshot: the ids just left the pending
        // set, so a stale in-memory list would resurrect the deleted rows (#940). What
        // survived a failure is still in the store, so it comes back on this same read.
        await repaintFromTruth();
        if (failed.length) {
          throw new Error(`${failed.length} of ${targets.length} could not be deleted`);
        }
      },
      commitErrorMessage,
      onCommitError: () => void repaintFromTruth(),
    });
    return true;
  }

  return api;
}
