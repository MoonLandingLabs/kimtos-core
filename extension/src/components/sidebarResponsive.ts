// Make a sidebar+main `layout` responsive, the same way Notes does it: below a
// width threshold the sidebar collapses into a closed overlay (so small / mobile
// windows show the content full-width) and a hamburger lets the user open it.
// Measures the layout element itself, so it also works inside a resized or
// floating window — not just the viewport.

import { el } from '../lib/dom.js';
import { BURGER } from './icons.js';

// Below this LAYOUT width the sidebar collapses into a closed overlay. It must sit
// BELOW the standard app-window content width, or the sidebar auto-collapses at the
// default size: since #533 every app window mounts at 720px (`.dialog-app`), whose
// content area is ~680px, so a 760 threshold hid the sidebar behind a hamburger in
// every sidebar app (KimtAI, Notes, NotaBoard, KimtFS, the media apps) at their normal
// size (#564). 640 keeps the sidebar docked at the standard window and collapses it
// only when the window is genuinely narrow (dragged small, or a phone-width viewport).
const DOCK_WIDTH = 640;

export interface SidebarResponsiveOptions {
  layout: HTMLElement;
  sidebar: HTMLElement;
  label?: string;
}

export function makeSidebarResponsive({ layout, sidebar, label = 'History' }: SidebarResponsiveOptions): {
  destroy: () => void;
} {
  let narrow = false;
  let savedWidth = ''; // the docked (drag-set) width, restored when we re-dock

  const burger = el('button', 'mt-burger');
  burger.type = 'button';
  burger.title = label;
  burger.setAttribute('aria-label', `Toggle ${label.toLowerCase()}`);
  burger.innerHTML = BURGER;
  burger.addEventListener('click', (e) => {
    e.stopPropagation();
    layout.classList.toggle('collapsed');
  });
  layout.append(burger);

  const apply = (w: number): void => {
    if (w <= 0) return;
    const next = w < DOCK_WIDTH;
    if (next === narrow) return; // only act when crossing the breakpoint
    narrow = next;
    layout.classList.toggle('is-narrow', narrow);
    layout.classList.toggle('collapsed', narrow); // closed by default on mobile
    if (narrow) {
      savedWidth = sidebar.style.width; // remember the docked width
      sidebar.style.width = ''; // let the overlay CSS size it
    } else {
      sidebar.style.width = savedWidth; // restore the docked width
    }
  };

  const ro = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
  ro.observe(layout);

  // While the overlay is open: close it on a click outside the drawer, or after
  // the user picks an item inside it (mobile-drawer behavior).
  const onClick = (e: MouseEvent): void => {
    if (!narrow || layout.classList.contains('collapsed')) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.mt-burger')) return;
    if (target?.closest('.mt-sidebar')) {
      if (target.closest('.mt-history-open')) layout.classList.add('collapsed'); // picked an item
      return;
    }
    layout.classList.add('collapsed'); // clicked the content
  };
  layout.addEventListener('click', onClick);

  return {
    destroy: () => {
      ro.disconnect();
      layout.removeEventListener('click', onClick);
    },
  };
}
