// Reusable floating popover anchored beneath a trigger button. One instance
// manages a single open popover at a time inside `host` (which must be
// position:relative). It owns positioning (clamped within the host), the
// open/close lifecycle, the trigger's `is-open` class, and dismissal on
// outside-click or Esc. Styling is left to the caller via `className`.
//
// The content builder receives the empty panel element, fills it, and may return
// a `refresh()` function (called once immediately, and again on `pop.refresh()`).

import { el } from '../lib/dom.js';

export interface PopoverOptions {
  host: HTMLElement;
  className?: string;
  openClass?: string;
  gap?: number;
}
type BuildFn = (panel: HTMLElement) => (() => void) | void;

export function createPopover({ host, className = 'popover', openClass = 'is-open', gap = 8 }: PopoverOptions) {
  let panel: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;
  let teardown: (() => void) | null = null;
  let refreshFn: (() => void) | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  function position(): void {
    if (!panel || !anchor) return;
    const hb = host.getBoundingClientRect();
    const ab = anchor.getBoundingClientRect();
    panel.style.top = `${ab.bottom - hb.top + gap}px`;
    // Width is known only after layout — clamp the left edge within the host.
    requestAnimationFrame(() => {
      if (!panel) return;
      const left = Math.max(4, Math.min(ab.left - hb.left, host.clientWidth - panel.offsetWidth - 4));
      panel.style.left = `${left}px`;
    });
  }

  function close(): void {
    if (!panel) return;
    teardown?.(); // cancels the arm timer (if pending) and removes any listeners
    anchor?.classList.remove(openClass);
    panel.remove();
    panel = anchor = teardown = refreshFn = null;
  }

  function open(trigger: HTMLElement, build: BuildFn): void {
    close();
    panel = el('div', className);
    anchor = trigger;
    refreshFn = build(panel) || null;
    host.append(panel);
    position();
    anchor.classList.add(openClass);
    refreshFn?.();

    // Dismiss on outside-click / Esc. The listeners are armed on the next tick so
    // the opening click (still propagating) doesn't immediately close the popover;
    // both handlers no-op once closed, and `teardown` cancels the pending timer so
    // closing before it fires can't leak a listener.
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (panel && !panel.contains(target) && !anchor?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (panel && e.key === 'Escape') close();
    };
    armTimer = setTimeout(() => {
      armTimer = null;
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('keydown', onKey);
    }, 0);
    teardown = () => {
      if (armTimer) {
        clearTimeout(armTimer);
        armTimer = null;
      }
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }

  return {
    open,
    toggle: (trigger: HTMLElement, build: BuildFn) => (anchor === trigger ? close() : open(trigger, build)),
    close,
    isOpen: () => !!panel,
    isOpenFor: (trigger: HTMLElement) => anchor === trigger,
    currentAnchor: () => anchor,
    refresh: () => refreshFn?.(),
  };
}
