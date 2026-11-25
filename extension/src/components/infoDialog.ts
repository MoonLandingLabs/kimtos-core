import { el, overlayHost, ownerDoc } from '../lib/dom.js';

export interface InfoDialogOptions {
  title?: string;
  /** Trusted, app-authored HTML (headings / lists / code / bold are styled). */
  html?: string;
  confirmLabel?: string;
  /** Extra controls shown to the LEFT of the confirm button — e.g. a copy-to-clipboard
   *  for a settings path Chrome will not let a page navigate to (#1327). */
  actions?: HTMLElement[];
  /** The element this dialog belongs to — so it opens in a popped-out app's window (#85). */
  owner?: Element | null;
}

// A dismissible content sheet with one confirm button — e.g. an app help panel.
// Built on the shared .prompt-* dialog styling.
export function infoDialog({
  title = '',
  html = '',
  confirmLabel = 'Got it',
  actions: extraActions = [],
  owner,
}: InfoDialogOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const doc = ownerDoc(owner);
    const overlay = el('div', 'prompt-overlay');
    const card = el('div', 'prompt-card info-dialog');
    if (title) card.append(el('p', 'prompt-label', title));
    const bodyEl = el('div', 'info-dialog-body');
    bodyEl.innerHTML = html;
    card.append(bodyEl);
    const actions = el('div', 'prompt-actions');
    const ok = el('button', 'button-primary', confirmLabel);
    actions.append(...extraActions, ok);
    card.append(actions);
    overlay.append(card);
    overlayHost(owner).append(overlay);

    const done = (): void => {
      doc.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done();
    };
    doc.addEventListener('keydown', onKey);
    ok.addEventListener('click', done);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done();
    });
    requestAnimationFrame(() => ok.focus());
  });
}
