// Uninstall confirmation. Unlike the plain confirmDialog it can offer an "erase
// my data" checkbox, and it sits in a z-index band above the App Store (a static
// utility dialog), so it's actually visible on top of it.
//
// Resolves to null if cancelled, or { eraseData } if the user confirms.

import { el, overlayHost } from '../lib/dom.js';

export interface UninstallDialogOptions {
  appName?: string;
  modelSize?: string;
  dataLabel?: string;
}
export interface UninstallResult {
  eraseData: boolean;
}

export function uninstallDialog({
  appName,
  modelSize,
  dataLabel,
}: UninstallDialogOptions = {}): Promise<UninstallResult | null> {
  return new Promise((resolve) => {
    const overlay = el('div', 'confirm-overlay uninstall-overlay');
    const card = el('div', 'confirm-card');

    card.append(el('h3', 'confirm-title', `Uninstall ${appName}?`));

    const lines = [`${appName} will be removed from your dock.`];
    if (modelSize) lines.push(`Its on-device model (${modelSize}) will be deleted to free up space.`);
    card.append(el('p', 'confirm-message', lines.join(' ')));

    // Apps that own data let the user keep it (the default) or erase it.
    let erase: HTMLInputElement | null = null;
    if (dataLabel) {
      card.append(
        el(
          'p',
          'confirm-note',
          `Your ${dataLabel} will stay on this device, ready for the next time you install ${appName}.`,
        ),
      );
      const label = el('label', 'confirm-check');
      erase = el('input');
      erase.type = 'checkbox';
      label.append(erase, el('span', undefined, `Also erase my ${dataLabel} — this can't be undone`));
      card.append(label);
    }

    const actions = el('div', 'confirm-actions');
    const cancel = el('button', 'button-secondary', 'Cancel');
    const ok = el('button', 'button-primary is-danger', 'Uninstall');
    actions.append(cancel, ok);
    card.append(actions);

    overlay.append(card);
    overlayHost().append(overlay);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(null);
    };
    const close = (val: UninstallResult | null): void => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(val);
    };
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', () => close(null));
    ok.addEventListener('click', () => close({ eraseData: !!erase?.checked }));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    requestAnimationFrame(() => ok.focus());
  });
}
