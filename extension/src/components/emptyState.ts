// A real empty state: a glyph, a headline, a line of help, and — where there is one —
// the button that gets you out of it.
//
// Every app had grown its own bare line of grey text (`.clip-empty`, `.anubis-empty`,
// `.dk-empty`, `.kimtfs-empty`), which is the least useful thing to show someone who has
// nothing yet: it says what is missing and not what to do about it. This is the one
// version, styled once in styles/apps.css.
//
// The action is optional on purpose. "No results for your search" has nothing to offer
// but different words; "this folder is empty" has a Create button.

import { el } from '../lib/dom.js';

export interface EmptyStateOptions {
  /** Inline SVG markup, e.g. `fileGlyphSvg('folder')`. Drawn in the app's accent. */
  icon?: string;
  title: string;
  /** One short line: what this is, or what to do next. */
  message?: string;
  actionLabel?: string;
  onAction?: (e: MouseEvent) => void;
}

export function createEmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateOptions): HTMLElement {
  const wrap = el('div', 'empty-state');

  if (icon) {
    const art = el('div', 'empty-state-icon');
    art.innerHTML = icon;
    art.setAttribute('aria-hidden', 'true'); // decorative: the title already says it
    wrap.append(art);
  }

  wrap.append(el('p', 'empty-state-title', title));
  if (message) wrap.append(el('p', 'empty-state-msg', message));

  if (actionLabel && onAction) {
    const btn = el('button', 'button-primary empty-state-action', actionLabel);
    btn.type = 'button';
    btn.addEventListener('click', (e) => onAction(e as MouseEvent));
    wrap.append(btn);
  }
  return wrap;
}
