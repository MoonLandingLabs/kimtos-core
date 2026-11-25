// Reusable context menu, opened at a given screen position (e.g. a right-click)
// or anchored beneath a button (pass the button's bottom-corner coords).
// items: [{ label, icon?, danger?, accent?, onClick }] or { separator: true }.
// opts.header renders a non-interactive block at the top (e.g. a profile card);
// opts.className adds a modifier class for menu-specific styling.
// Closes on outside-click, Escape, scroll/resize, or selecting an item.

import { el, overlayHost, ownerDoc, ownerView } from '../lib/dom.js';

export interface ContextMenuItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  accent?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

export interface ContextMenuOptions {
  header?: HTMLElement;
  className?: string;
  /** The element the menu belongs to. In a popped-out app it decides BOTH which
   *  document the menu opens in and which viewport it is clamped to — the opener's
   *  is much larger, so clamping against it puts the menu off-screen (#85). */
  owner?: Element | null;
}

let close: (() => void) | null = null; // closes the currently-open menu, if any

function closeContextMenu(): void {
  if (close) close();
}

export function openContextMenu(x: number, y: number, items: ContextMenuItem[], opts: ContextMenuOptions = {}): void {
  closeContextMenu();

  const doc = ownerDoc(opts.owner);
  const view = ownerView(opts.owner);
  const menu = el('div', `context-menu${opts.className ? ` ${opts.className}` : ''}`);
  if (opts.header) menu.append(opts.header);
  for (const item of items) {
    if (item.separator) {
      menu.append(el('div', 'context-sep'));
      continue;
    }
    const btn = el('button', `context-item${item.danger ? ' is-danger' : ''}${item.accent ? ' is-accent' : ''}`);
    if (item.icon) {
      const ic = el('span', 'context-icon');
      ic.innerHTML = item.icon;
      btn.append(ic);
    }
    btn.append(el('span', 'context-label', item.label ?? ''));
    btn.addEventListener('click', () => {
      dismiss();
      item.onClick?.();
    });
    menu.append(btn);
  }

  // Place off-screen first to measure, then clamp into the viewport — the OWNER's
  // viewport, which in a floating window is a few hundred pixels, not the page's.
  menu.style.visibility = 'hidden';
  overlayHost(opts.owner).append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, view.innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, view.innerHeight - r.height - 8))}px`;
  menu.style.visibility = '';

  const onDown = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node | null)) dismiss();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss();
  };
  // Only a scroll that can actually move the menu (or the content it is anchored
  // to) should close it: the document/page, or a scroll container that holds the
  // menu. A scroll of an unrelated inner element — notably the dock's one-time
  // scroll-hint animation, which fires ~550ms after mount — must NOT dismiss it
  // (#418). `document.contains(menu)` is true, so a genuine page scroll still closes it.
  const onScroll = (e: Event): void => {
    const t = e.target;
    if (!(t instanceof Node) || t.contains(menu)) dismiss();
  };
  function dismiss(): void {
    menu.remove();
    doc.removeEventListener('mousedown', onDown, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('scroll', onScroll, true);
    view.removeEventListener('blur', dismiss);
    view.removeEventListener('resize', dismiss);
    if (close === dismiss) close = null;
  }
  close = dismiss;

  // Defer the dismiss listeners so the opening click doesn't instantly close it.
  setTimeout(() => {
    doc.addEventListener('mousedown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('scroll', onScroll, true); // capture: scroll doesn't bubble
    view.addEventListener('blur', dismiss);
    view.addEventListener('resize', dismiss);
  }, 0);
}
