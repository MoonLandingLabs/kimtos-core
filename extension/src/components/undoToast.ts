// Reusable "undo" toast: a small floating bar with an Undo button. After
// `duration` ms it commits the action (`onCommit`); the Undo button cancels it
// (`onUndo`). The countdown PAUSES while the pointer is over the toast (or it has
// keyboard focus), so hovering to read it or aim for Undo never loses the chance.
// Only one toast is shown at a time. Returns a function that cancels early (undo).

import { el, overlayHost, ownerDoc } from '../lib/dom.js';
import { showSnackbar } from './snackbar.js';

export interface UndoToastOptions {
  /** May be async. Awaited; a rejection is never silent (#288). */
  onUndo?: () => void | Promise<void>;
  /** May be async, and this one is the REAL mutation — the delete actually happens here when
   *  the window lapses. A silent failure means the row is gone from the screen while the item
   *  is still in the database, and the user was told it was deleted (#288). */
  onCommit?: () => void | Promise<void>;
  /** What the user is told if the commit throws. Say what did NOT happen. */
  commitErrorMessage?: string;
  /** Called if the commit throws, so the caller can repaint from truth — the item still
   *  exists, so its row must come back. */
  onCommitError?: (err: unknown) => void;
  /** Called if the undo itself throws. */
  onUndoError?: (err: unknown) => void;
  duration?: number;
  /** The element this toast belongs to — so it shows in a popped-out app's window (#85).
   *  Without it the undo for a delete the user just made lands on the new-tab page,
   *  where they never see it and it silently times out into a commit. */
  owner?: Element | null;
}

export function showUndoToast(
  message: string,
  { onUndo, onCommit, commitErrorMessage, onCommitError, onUndoError, duration = 5000, owner }: UndoToastOptions = {},
): () => void {
  // One toast at a time — and "at a time" now spans two documents, since the app may
  // have been popped out (or brought back) while one was up. Clear both, or the old
  // one is orphaned on the other page.
  const doc = ownerDoc(owner);
  doc.querySelector('.undo-toast')?.remove();
  if (doc !== document) document.querySelector('.undo-toast')?.remove();

  const toast = el('div', 'undo-toast');
  const btn = el('button', 'undo-toast-btn', 'Undo');
  toast.append(el('span', 'undo-toast-msg', message), btn);
  overlayHost(owner).append(toast);

  let remaining = duration;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;

  // Both handlers are AWAITED and their failures surfaced. This used to be `onCommit?.()` —
  // fire-and-forget — so a delete that threw took the row off the screen and left the item in
  // the database, and told the user it was deleted (#288). A commit is the real mutation; it is
  // the last place a silent failure belongs.
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    toast.remove();
    void (async () => {
      try {
        if (commit) await onCommit?.();
        else await onUndo?.();
      } catch (err) {
        console.error(commit ? 'undo-toast commit failed' : 'undo-toast undo failed', err);
        showSnackbar(
          commit
            ? (commitErrorMessage ?? "That couldn't be deleted. Nothing was removed.")
            : "That couldn't be undone.",
          { owner },
        );
        // The caller repaints from truth: on a failed commit the item still exists, so its row
        // has to come back rather than staying invisible.
        (commit ? onCommitError : onUndoError)?.(err);
      }
    })();
  };
  // `timer` doubles as the running/paused flag so these stay idempotent when both
  // a pointer event AND a focus event fire (e.g. pointerenter + focusin): run()
  // won't stack a second timer, and pause() won't double-subtract the elapsed time.
  const run = (): void => {
    if (done || timer) return; // already counting down
    startedAt = performance.now();
    timer = setTimeout(() => finish(true), Math.max(0, remaining));
  };
  const pause = (): void => {
    if (done || !timer) return; // already paused
    clearTimeout(timer);
    timer = null;
    remaining -= performance.now() - startedAt;
  };

  // Pause while hovered or focused; resume on leave/blur.
  toast.addEventListener('pointerenter', pause);
  toast.addEventListener('pointerleave', run);
  toast.addEventListener('focusin', pause);
  toast.addEventListener('focusout', run);
  btn.addEventListener('click', () => finish(false));

  run();
  return () => finish(false);
}
