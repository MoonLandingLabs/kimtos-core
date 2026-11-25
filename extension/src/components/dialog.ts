// App window. Non-modal so several can be open at once; draggable by its header
// (clamped to the viewport); OS-style header controls: minimize (keeps state),
// maximize/restore, close. Clicking a window raises it above the others.
//
// Pass `appDialog: false` for utility surfaces like Settings / Release notes:
// they keep the minimize/maximize/close controls but are not draggable or
// resizable (centered, fixed size).

import { Z_INDEX } from '@kimtos/config/ui';
import { setAccent } from '../lib/accent.js';
import { clamp } from '../lib/num.js';
import { overlayHost } from '../lib/dom.js';

// App windows share one rising z-index; utility dialogs (Settings, Release
// notes — appDialog:false) live in a separate, much higher band so they always
// open above any app window. Bases come from the shared Z_INDEX tokens.
let zTop = Z_INDEX.appWindow;
let zTopStatic = Z_INDEX.utilityDialog;

const ICON = {
  min: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 12h12"></path></svg>',
  max: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4.5" y="4.5" width="15" height="15" rx="2"></rect></svg>',
  restore:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="7" width="12" height="12" rx="2"></rect><path d="M5 15V6a1 1 0 0 1 1-1h9"></path></svg>',
  close:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
  popout:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4.5" width="18" height="15" rx="2"></rect><rect x="11.5" y="11" width="7.5" height="6.5" rx="1" fill="currentColor" stroke="none"></rect></svg>',
  // Four arrows out / four arrows in — the usual full-screen pair. Moved here from
  // NotaBoard, which drew them for its own control before this became shared (#1251).
  expand:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3h-6M21 3v6M21 3l-7 7"></path><path d="M3 21h6M3 21v-6M3 21l7-7"></path></svg>',
  compress:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 10l7-7M21 3h-6M21 3v6"></path><path d="M10 14l-7 7M3 21h6M3 21v-6"></path></svg>',
  settings:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 8h9M17.5 8H19M5 16h2.5M11 16h8"></path><circle cx="15.5" cy="8" r="2.2"></circle><circle cx="9" cy="16" r="2.2"></circle></svg>',
  report:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9V6a3 3 0 0 1 6 0v3"></path><rect x="7" y="9" width="10" height="10" rx="5"></rect><path d="M3 13h3M18 13h3M4.5 8.5 7 9.5M19.5 8.5 17 9.5M4.5 17.5 7 16.5M19.5 17.5 17 16.5M12 12v6"></path></svg>',
};

function control(cls: string, label: string, svg: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `dialog-control ${cls}`;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg;
  b.addEventListener('click', onClick);
  return b;
}

export interface DialogOptions {
  title?: string;
  size?: string;
  accent?: string;
  onClose?: () => void;
  onMinimize?: () => void;
  onPopOut?: () => void;
  onReport?: () => void;
  onSettings?: () => void;
  /** The user finished moving, resizing or maximizing — the session records the new shape (#1172).
   *  Fired on gesture END, not on every pointermove, so it is a handful of calls per drag. */
  onGeometryChange?: () => void;
  /** Close was clicked — fired SYNCHRONOUSLY, ahead of the 160ms fade that precedes `onClose`.
   *  A caller that records which windows are open needs to know now, not after the animation: a
   *  reload during the fade would otherwise write the window back as still open. */
  onCloseStart?: () => void;
  appDialog?: boolean;
  maximizable?: boolean;
}

/** Where a window is, for the session to remember.
 *
 *  Position and size are ABSENT until the user actually moves or resizes the window. That is the
 *  difference between "restore it here" and "put it wherever a new window goes": a restored window
 *  the user never positioned re-centres itself exactly like a fresh one, which is what should
 *  happen when the viewport is a different size than it was. */
export interface DialogGeometry {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  maximized: boolean;
}

/** `parseFloat` of a CSS length, or undefined when the style was never set. */
function cssNumber(value: string): number | undefined {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

export function createDialog({
  title = '',
  size = 'md',
  accent,
  onClose,
  onMinimize,
  onPopOut,
  onReport,
  onSettings,
  onGeometryChange,
  onCloseStart,
  appDialog = true,
  maximizable = true, // utility dialogs opt out (the app launcher); app windows never do
}: DialogOptions = {}) {
  const el = document.createElement('div');
  el.className = `dialog dialog-${size}${appDialog ? '' : ' dialog-static'}`;
  if (accent) setAccent(el, accent);
  el.hidden = true;

  const header = document.createElement('header');
  header.className = 'dialog-header';
  const heading = document.createElement('h2');
  heading.className = 'dialog-title';
  heading.textContent = title;

  const controls = document.createElement('div');
  controls.className = 'dialog-controls';
  // Optional "report an issue" control (app windows opt in via onReport) — opens a
  // pre-filled GitHub issue for this app.
  const reportBtn = onReport ? control('window-report', 'Report an issue', ICON.report, () => onReport()) : null;
  // Optional settings control. The apps controller passes it for EVERY app that
  // declares a settings schema, so an app's settings are one click from the app
  // itself and not only buried in Settings > Apps.
  const settingsBtn = onSettings ? control('window-settings', 'Settings', ICON.settings, () => onSettings()) : null;
  // Optional "pop out to a floating window" control (set up only when the app
  // opts in via onPopOut). Hidden until enabled for the current open.
  const popBtn = onPopOut ? control('window-popout', 'Open in a floating window', ICON.popout, () => onPopOut()) : null;
  if (popBtn) popBtn.hidden = true;
  const minBtn = control('window-min', 'Minimize', ICON.min, () => minimize());
  const maxBtn = control('window-max', 'Maximize', ICON.max, () => toggleMax());
  // Full screen is NOT maximize. Maximize fills the Kimtos tab, with the browser's tab strip and
  // address bar and our own desktop still on screen; this takes the whole display and hides them,
  // which is the point of a focus mode. Both controls stay (#1251).
  const fsBtn = control('window-fullscreen', 'Full screen', ICON.expand, () => toggleFullscreen());
  if (!maximizable) {
    // `maximizable: false` means "this surface must not be blown up to fill the display", and full
    // screen is the bigger version of exactly what it refuses. The two dialogs that opt out are the
    // Spotlight launcher, whose results are capped at 52vh so a maximized one is mostly empty
    // (#498), and the per-app settings form. Letting full screen through would reproduce the
    // outcome their opt-out exists to prevent, by a control with no equivalent guard.
    fsBtn.disabled = true;
    fsBtn.title = 'Full screen isn’t available for this window';
    fsBtn.setAttribute('aria-disabled', 'true');
  } else if (!document.fullscreenEnabled) {
    // Blocked by a permissions policy, or a browser without the API. Keep the icon so the chrome
    // is the same everywhere, and say why it does nothing — the same treatment `maximizable: false`
    // gets above, rather than a button that silently swallows the click.
    fsBtn.disabled = true;
    fsBtn.title = 'Full screen isn’t available in this browser';
    fsBtn.setAttribute('aria-disabled', 'true');
  }
  if (!maximizable) {
    // Apps that opt out of full-width keep the icon (consistent window chrome) but
    // it's disabled.
    maxBtn.disabled = true;
    maxBtn.title = 'Full-width isn’t available for this app';
    maxBtn.setAttribute('aria-disabled', 'true');
  }
  const closeBtn = control('window-close', 'Close', ICON.close, () => close());
  if (settingsBtn) controls.append(settingsBtn);
  if (reportBtn) controls.append(reportBtn);
  if (popBtn) controls.append(popBtn);
  controls.append(minBtn, maxBtn, fsBtn, closeBtn);
  header.append(heading, controls);

  const body = document.createElement('div');
  body.className = 'dialog-body';

  el.append(header, body);

  // Resize handles on all four edges and corners (app windows only).
  const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const handles: HTMLDivElement[] = appDialog
    ? DIRS.map((dir) => {
        const h = document.createElement('div');
        h.className = `dialog-resize dialog-resize-${dir}`;
        h.dataset.dir = dir;
        h.setAttribute('aria-hidden', 'true');
        el.append(h);
        return h;
      })
    : [];

  // Into the FULL-SCREEN element when one is open, not the page body (#1251). A window opened
  // from a full-screen app — an app's own settings, the App Store, a report form — would otherwise
  // mount outside the top layer and render under it, unreachable. When nothing is full screen this
  // is `document.body`, exactly as before.
  overlayHost().append(el);

  const MIN_W = 350;
  const MIN_H = 400;
  let placed = false;
  let maxed = false;
  let sized = false;
  let moved = false;
  let prev: { left: string; top: string } | null = null;

  const raise = (): void => {
    el.style.zIndex = String(appDialog ? ++zTop : ++zTopStatic);
  };

  function center(): void {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(8, (window.innerWidth - w) / 2)}px`;
    el.style.top = `${Math.max(8, (window.innerHeight - h) / 2)}px`;
  }

  function open(): void {
    el.hidden = false;
    if (!placed) {
      center();
      placed = true;
    }
    raise();
    requestAnimationFrame(() => el.classList.add('is-open'));
  }

  function hide(after?: () => void): void {
    el.classList.remove('is-open');
    setTimeout(() => {
      el.hidden = true;
      after?.();
    }, 160);
  }

  function close(): void {
    onCloseStart?.(); // synchronous: the fade below is long enough for a reload to land mid-close
    // Give the display back before we go. Closing a window that owns the screen would otherwise
    // leave the user staring at a full-screen nothing, with the desktop they came from behind it.
    if (isFullscreen()) void document.exitFullscreen?.();
    // A fresh open should re-center; minimizing keeps the window where it is.
    placed = false;
    moved = false;
    // Fade out at the CURRENT size (incl. maximized) and only drop the maximized
    // state once hidden — restoring first would animate the window back to its
    // small size before it closes (a jarring two-step). While hidden the element
    // is display:none, so removing `is-max` doesn't animate.
    hide(() => {
      setMax(false);
      onClose?.();
    });
  }

  function minimize(): void {
    // Same reason as `close()`, and NOT because the browser handles it — it does not. Hiding the
    // element that owns the screen leaves `document.fullscreenElement` pointing straight at it and
    // fires no `fullscreenchange` at all (measured in Chrome, not assumed). So a minimize would
    // hand the user a blank full-screen display with no window left to press, and reopening would
    // bring the app back inside a full screen nobody asked for.
    if (isFullscreen()) void document.exitFullscreen?.();
    hide(onMinimize);
  }

  /** Apply the maximized state. Split out of `toggleMax` so close and a session restore can reach
   *  it WITHOUT reporting a geometry change — a restore that announced itself would write straight
   *  back over the session it is in the middle of reading. */
  function setMax(on: boolean): void {
    if (on === maxed) return;
    maxed = on;
    if (maxed) {
      prev = { left: el.style.left, top: el.style.top };
      el.classList.add('is-max');
    } else {
      el.classList.remove('is-max');
      if (prev) {
        el.style.left = prev.left;
        el.style.top = prev.top;
      }
    }
    maxBtn.innerHTML = maxed ? ICON.restore : ICON.max;
    maxBtn.title = maxed ? 'Restore' : 'Maximize';
  }

  function toggleMax(): void {
    setMax(!maxed);
    onGeometryChange?.();
  }

  /** Does the display currently belong to THIS window? Asked of the browser every time rather than
   *  tracked, because full screen is the browser's state, not ours — see `syncFullscreen`. */
  const isFullscreen = (): boolean => document.fullscreenElement === el;

  /**
   * Repaint the control from what the browser actually says.
   *
   * Never from what we just asked for. The user can leave full screen with Esc or an OS gesture,
   * the request can be refused outright, and only ONE element in a document can hold full screen —
   * so a second window taking it drops this one, with no call of ours involved. Every one of those
   * arrives as `fullscreenchange`, and each open dialog re-asks. A button that tracked its own
   * clicks would be wrong after any of them, which is what NotaBoard's version learned first.
   */
  function syncFullscreen(): void {
    const on = isFullscreen();
    fsBtn.innerHTML = on ? ICON.compress : ICON.expand;
    fsBtn.title = on ? 'Exit full screen (Esc)' : 'Full screen';
  }
  document.addEventListener('fullscreenchange', syncFullscreen);

  function toggleFullscreen(): void {
    if (isFullscreen()) void document.exitFullscreen?.();
    // A rejection needs no handling beyond not throwing: the browser stayed out of full screen, and
    // `syncFullscreen` only ever reports what it finds, so the button is already correct.
    else void el.requestFullscreen?.().catch(() => {});
  }

  el.addEventListener('pointerdown', raise);

  // Drag by the header (not when maximized or clicking a control). Utility
  // dialogs (appDialog: false) stay centered — no drag.
  if (appDialog)
    header.addEventListener('pointerdown', (e) => {
      if (maxed || (e.target as Element | null)?.closest('.dialog-controls')) return;
      const rect = el.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      header.setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent): void => {
        moved = true;
        el.style.left = `${clamp(ev.clientX - offX, 0, window.innerWidth - el.offsetWidth)}px`;
        el.style.top = `${clamp(ev.clientY - offY, 0, window.innerHeight - el.offsetHeight)}px`;
      };
      const up = (): void => {
        header.releasePointerCapture(e.pointerId);
        header.removeEventListener('pointermove', move);
        header.removeEventListener('pointerup', up);
        if (moved) onGeometryChange?.();
      };
      header.addEventListener('pointermove', move);
      header.addEventListener('pointerup', up);
    });

  // Resize from any edge/corner. The direction string says which sides move.
  function startResize(e: PointerEvent): void {
    if (maxed) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    const dir = handle.dataset.dir || '';
    const r = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const right0 = r.left + r.width;
    const bottom0 = r.top + r.height;
    if (!sized) {
      sized = true;
      el.classList.add('is-sized');
    }
    handle.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent): void => {
      let left = r.left;
      let top = r.top;
      let w = r.width;
      let h = r.height;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dir.includes('e')) w = clamp(r.width + dx, MIN_W, window.innerWidth - r.left - 8);
      if (dir.includes('s')) h = clamp(r.height + dy, MIN_H, window.innerHeight - r.top - 8);
      if (dir.includes('w')) {
        left = clamp(r.left + dx, 8, right0 - MIN_W);
        w = right0 - left;
      }
      if (dir.includes('n')) {
        top = clamp(r.top + dy, 8, bottom0 - MIN_H);
        h = bottom0 - top;
      }
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    const up = (): void => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      onGeometryChange?.();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }
  handles.forEach((h) => h.addEventListener('pointerdown', startResize));

  function clampIntoView(): void {
    el.style.left = `${clamp(parseFloat(el.style.left) || 0, 0, window.innerWidth - el.offsetWidth)}px`;
    el.style.top = `${clamp(parseFloat(el.style.top) || 0, 0, window.innerHeight - el.offsetHeight)}px`;
  }

  // Keep a moved/resized window within the viewport when the browser resizes.
  window.addEventListener('resize', () => {
    if (el.hidden || maxed) return;
    if (sized) {
      el.style.width = `${Math.min(el.offsetWidth, window.innerWidth - 16)}px`;
      el.style.height = `${Math.min(el.offsetHeight, window.innerHeight - 16)}px`;
    }
    clampIntoView();
  });

  // When the window's own content changes its size (e.g. opening the PDF reader
  // makes the dialog taller), re-center it if the user hasn't positioned it
  // themselves — otherwise just keep it on-screen.
  const selfRO = new ResizeObserver(() => {
    if (el.hidden || maxed) return;
    if (placed && !moved && !sized) center();
    else clampIntoView();
  });
  selfRO.observe(el);

  return {
    el,
    body,
    open,
    close,
    minimize,
    setTitle: (t: string) => {
      heading.textContent = t;
    },
    isVisible: () => !el.hidden,
    /** Where this window is, for the session (#1172). While maximized the element's own left/top
     *  are the maximized ones, so `prev` — where the window lands when restored — is what gets
     *  remembered; otherwise a restored window would come back stuck to the top-left. */
    getGeometry: (): DialogGeometry => {
      const pos = maxed && prev ? prev : { left: el.style.left, top: el.style.top };
      return {
        left: moved ? cssNumber(pos.left) : undefined,
        top: moved ? cssNumber(pos.top) : undefined,
        width: sized ? cssNumber(el.style.width) : undefined,
        height: sized ? cssNumber(el.style.height) : undefined,
        maximized: maxed,
      };
    },
    /** Put the window back where the session says it was. Call BEFORE `open()`: setting `placed`
     *  is what stops `open()` re-centring over the restored position. */
    applyGeometry: (g: DialogGeometry): void => {
      // CLAMP TO THE CURRENT VIEWPORT. The geometry was saved against whatever screen the user had
      // then, and a reload fires no `resize`, so neither the resize handler nor the ResizeObserver
      // ever corrects it. Restoring a window that was at x=1700 on an external monitor onto a
      // laptop screen would put it — title bar and all — completely off-screen, with nothing left
      // to grab and no way back short of clearing the session.
      if (typeof g.width === 'number' && typeof g.height === 'number') {
        el.style.width = `${clamp(g.width, MIN_W, Math.max(MIN_W, window.innerWidth - 16))}px`;
        el.style.height = `${clamp(g.height, MIN_H, Math.max(MIN_H, window.innerHeight - 16))}px`;
        sized = true;
        el.classList.add('is-sized');
      }
      if (typeof g.left === 'number' && typeof g.top === 'number') {
        // Measured after any size above, so the clamp uses the width the window will actually have.
        const w = el.offsetWidth || MIN_W;
        const h = el.offsetHeight || MIN_H;
        el.style.left = `${clamp(g.left, 0, Math.max(0, window.innerWidth - w))}px`;
        el.style.top = `${clamp(g.top, 0, Math.max(0, window.innerHeight - h))}px`;
        placed = true;
        moved = true;
      }
      // Last: `setMax` snapshots the current left/top as the restore position, so the position
      // above has to already be applied.
      setMax(g.maximized);
    },
    // Show/hide the floating-window control for the current open (the per-app
    // setting can change between opens).
    setPopOutEnabled: (on: boolean) => {
      if (popBtn) popBtn.hidden = !on;
    },
    // Same, for the settings control.
    setSettingsEnabled: (on: boolean) => {
      if (settingsBtn) settingsBtn.hidden = !on;
    },
    /** Hide the full-screen control for the current open. Popping an app out MOVES its content into
     *  the floating window and leaves a placeholder in this one, so full-screening it would fill the
     *  display with an empty box. Mirrors `setPopOutEnabled`, at the same two moments. */
    setFullscreenEnabled: (on: boolean) => {
      fsBtn.hidden = !on;
      // A window losing the control while it holds the screen has to give it back — otherwise the
      // display stays ours with nothing left to press.
      if (!on && isFullscreen()) void document.exitFullscreen?.();
    },
    /** Drop the document-level listener this window added. Nothing calls it today — dialogs live as
     *  long as the page — but a listener with no way off is how a component starts leaking. */
    destroy: () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
    },
  };
}
