// Reusable confirmation dialog. Resolves true (confirmed) or false (cancelled).
// Escape / backdrop-click cancels. On open, focus lands on a SAFE control — Cancel for a
// destructive dialog (the default), the confirm action only for a non-destructive one — so
// the browser's own Enter/Space activation hits whichever button is safe and never a
// pre-armed destructive action (#860). This matches the rule www and admin settled on
// (#770, #830): Enter never confirms a `danger` dialog. A checkbox-gated confirm also lands
// on Cancel, since its confirm button starts disabled and focusing a disabled button would
// silently drop focus to <body>.
//
// `owner`: the element this dialog belongs to. Pass it from a pop-out-capable app so
// the dialog opens in the floating window rather than on the new-tab page behind it,
// and so Esc works there (#85).

import { el, overlayHost, ownerDoc } from '../lib/dom.js';

export interface ConfirmDialogOptions {
  confirmLabel?: string;
  danger?: boolean;
  owner?: Element | null;
  /** An acknowledgement checkbox rendered above the actions; when present, Confirm stays
   *  disabled until it is ticked (an "I understand …, do it anyway" gate). */
  checkbox?: { label: string };
}

/**
 * `message` may be a plain string OR a Node — pass an element to show richer content (a
 * few lines, a warning box) inside the SAME small confirm card, rather than hand-rolling
 * a full window dialog for a confirmation (#563).
 */
export function confirmDialog(
  message: string | Node,
  { confirmLabel = 'Delete', danger = true, owner, checkbox }: ConfirmDialogOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const doc = ownerDoc(owner);
    const overlay = el('div', 'confirm-overlay');
    const card = el('div', 'confirm-card');
    const actions = el('div', 'confirm-actions');
    const cancel = el('button', 'button-secondary', 'Cancel');
    const ok = el('button', `button-primary${danger ? ' is-danger' : ''}`, confirmLabel);
    actions.append(cancel, ok);

    card.append(typeof message === 'string' ? el('p', 'confirm-message', message) : message);
    // Optional gate: Confirm stays disabled until the box is ticked.
    if (checkbox) {
      const wrap = el('label', 'confirm-check');
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      ok.disabled = true;
      box.addEventListener('change', () => {
        ok.disabled = !box.checked;
      });
      wrap.append(box, el('span', '', checkbox.label));
      card.append(wrap);
    }
    card.append(actions);
    overlay.append(card);
    overlayHost(owner).append(overlay);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false);
    };
    const close = (val: boolean): void => {
      doc.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(val);
    };
    doc.addEventListener('keydown', onKey);
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    // Focus a safe control, never the pre-armed destructive button (#860): Cancel on a
    // destructive or checkbox-gated dialog, the confirm action otherwise.
    requestAnimationFrame(() => (danger || ok.disabled ? cancel : ok).focus());
  });
}
