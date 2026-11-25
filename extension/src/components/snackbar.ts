// A lightweight, self-dismissing status message (bottom-centre). Unlike the undo
// toast it's informational (e.g. "download continues in the background"), with an
// OPTIONAL single action button (e.g. "Reopen"). Only one is shown at a time;
// click the bar to dismiss early. Returns a function that removes it.

import { el, overlayHost, ownerDoc } from '../lib/dom.js';

export interface SnackbarOptions {
  duration?: number;
  actionLabel?: string;
  /** May be async. It IS awaited, and a rejection is never silent — see below. */
  onAction?: () => void | Promise<void>;
  /** What the user is told if `onAction` throws. Say what did NOT happen — the default is
   *  deliberately not reassuring, because the action did not run. */
  actionErrorMessage?: string;
  /** Called when `onAction` throws, so the caller can recover — re-offer the action, repaint
   *  from truth, keep the backup. Without this the user is still TOLD; they just cannot retry. */
  onActionError?: (err: unknown) => void;
  /** The element this bar belongs to — so it shows in a popped-out app's window (#85). */
  owner?: Element | null;
}

export function showSnackbar(
  message: string,
  { duration = 4000, actionLabel, onAction, actionErrorMessage, onActionError, owner }: SnackbarOptions = {},
): () => void {
  // One at a time, across both documents — see the note in undoToast.ts.
  const doc = ownerDoc(owner);
  doc.querySelector('.snackbar')?.remove();
  if (doc !== document) document.querySelector('.snackbar')?.remove();

  const bar = el('div', 'snackbar');
  bar.setAttribute('role', 'status');
  bar.append(el('span', 'snackbar-msg', message));

  let done = false;
  const remove = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    bar.classList.remove('is-shown');
    setTimeout(() => bar.remove(), 200); // let the fade-out finish
  };

  if (actionLabel && onAction) {
    const btn = el('button', 'snackbar-btn', actionLabel);
    btn.type = 'button';
    // THE ACTION IS AWAITED, AND A FAILURE IS NEVER SILENT.
    //
    // Every action passed here is async, and this used to be `onAction()` — fire-and-forget.
    // The promise was dropped, so a rejection went nowhere: the bar closed and the user was
    // told nothing. On the Undo of a destructive action that is the worst possible outcome —
    // the restore threw, the backup only ever existed in memory, and the user walked away
    // believing their data was back (#288).
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let the bar's dismiss handler also fire
      remove();
      void (async () => {
        try {
          await onAction();
        } catch (err) {
          console.error('snackbar action failed', err);
          // Tell them what did NOT happen. `onActionError` lets the caller do better still —
          // put the row back, or offer the Undo again with the backup it still holds.
          showSnackbar(actionErrorMessage ?? "That didn't work. Nothing was changed.", { owner });
          onActionError?.(err);
        }
      })();
    });
    bar.append(btn);
  }

  overlayHost(owner).append(bar);
  requestAnimationFrame(() => bar.classList.add('is-shown'));
  const timer = setTimeout(remove, duration);
  bar.addEventListener('click', remove); // click anywhere else to dismiss
  return remove;
}
