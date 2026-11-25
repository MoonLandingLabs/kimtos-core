import { el, overlayHost, ownerDoc } from '../lib/dom.js';

export interface PickerItem {
  id: string;
  label: string;
  /** Optional leading icon (SVG markup). */
  icon?: string;
}
export interface PickerDialogOptions {
  title?: string;
  items: PickerItem[];
  cancelLabel?: string;
  /** The element this dialog belongs to — so it opens in a popped-out app's window (#85). */
  owner?: Element | null;
}

// "Choose one from a list" modal — resolves to the chosen id, or null if cancelled.
// Built on the shared .prompt-* dialog styling (same as confirm/promptDialog).
export function pickerDialog({
  title = '',
  items,
  cancelLabel = 'Cancel',
  owner,
}: PickerDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const doc = ownerDoc(owner);
    const overlay = el('div', 'prompt-overlay');
    const card = el('div', 'prompt-card picker-dialog');
    if (title) card.append(el('p', 'prompt-label', title));

    const list = el('div', 'picker-list');
    for (const it of items) {
      const btn = el('button', 'picker-item');
      if (it.icon) {
        const ic = el('span', 'picker-icon');
        ic.innerHTML = it.icon;
        btn.append(ic);
      }
      btn.append(el('span', 'picker-name', it.label));
      btn.addEventListener('click', () => close(it.id));
      list.append(btn);
    }
    const actions = el('div', 'prompt-actions');
    const cancel = el('button', 'button-secondary', cancelLabel);
    actions.append(cancel);
    card.append(list, actions);
    overlay.append(card);
    overlayHost(owner).append(overlay);

    const close = (val: string | null): void => {
      doc.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(val);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(null);
    };
    doc.addEventListener('keydown', onKey);
    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}
