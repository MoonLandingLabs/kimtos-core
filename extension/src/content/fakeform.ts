// FakeForm's in-page badge — and NOTHING else.
//
// This is the always-on half of a deliberate split (#222). It draws one small control in a
// shadow root, waits for a click, and asks the service worker to do the work. It knows nothing
// about forms: no detector, no generator, no name dataset. That is the point — a badge the user
// can see on any site has to be paid for on every page load, so it has to stay small, while the
// heavy half (`content/fakeformFill.ts`) is injected only once somebody actually asks to fill
// something.
//
// The gate is a SUBSCRIPTION, not a snapshot. the control must not
// exist for a user who has not installed FakeForm — not greyed out, not rendered.
// `watchAppInstalled` switches it on the moment they install, and off the moment they uninstall,
// with no reload
// (#223). Note that this is a PRODUCT gate, not a security boundary: the extension is on the
// user's disk and anyone willing to edit this bundle can bypass it. It exists so the app behaves
// correctly for honest users, which is all a client-side check can ever do.

import { createFieldChip, type FieldChip } from '../lib/fieldChip.js';
import { CONTENT_THEME_CSS, themeShadowHost } from '../lib/contentTheme.js';
import { floatPlacement } from '../lib/floatPlacement.js';
import { watchAppInstalled } from '../lib/storageWatch.js';
import { FAKEFORM_ACTIONS, FAKEFORM_APP_ID, FAKEFORM_RUN, type FakeFormAction } from '../lib/fakeformShared.js';

// Fields worth offering the badge on. Buttons and hidden inputs are not fields the user types
// into, and a chip glued to a checkbox is noise — `createFieldChip` skips tiny boxes anyway.
const FOCUS_SEL =
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]), textarea, select';

/** The app glyph (a form with a bolt), inlined so the bundle stays self-contained. */
const GLYPH =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round" stroke-linejoin="round" style="display:block">' +
  '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.2"/><path d="M7.3 8.3h9.4M7.3 11.8h5"/>' +
  '<path d="M15.7 12.4l-2.7 4.3h2.3l-.5 3 3.1-4.6h-2.3z"/></svg>';

const MENU_CSS = `
  :host { all: initial; }
${CONTENT_THEME_CSS}
  .menu { min-width: 178px; padding: 5px; border-radius: 12px; background: var(--kt-panel);
    border: 1px solid var(--kt-hairline); box-shadow: var(--kt-shadow);
    font: 500 12.5px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--kt-text); }
  .item { display: block; width: 100%; box-sizing: border-box; text-align: left; padding: 7px 10px;
    border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .item:hover { background: var(--kt-surface-hover); }
  .sep { height: 1px; margin: 4px 6px; background: var(--kt-hairline); }
`;

let chip: FieldChip | null = null;
let menuHost: HTMLElement | null = null;
let menuRoot: ShadowRoot | null = null;
let menuUntheme: (() => void) | null = null;
let menuOpen = false;

function ask(action: FakeFormAction): void {
  closeMenu();
  try {
    chrome.runtime.sendMessage({ type: FAKEFORM_RUN, action }, () => {
      // The worker may be asleep or the tab unreachable. Read lastError so Chrome does not log
      // an unchecked-error warning into the page's console on every click.
      void chrome.runtime.lastError;
    });
  } catch {
    // The extension context was invalidated (an update/reload while this page stayed open).
  }
}

function ensureMenu(): ShadowRoot {
  if (menuRoot) return menuRoot;
  menuHost = document.createElement('div');
  menuHost.style.cssText = 'position:fixed;z-index:2147483646;display:none;';
  menuRoot = menuHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = MENU_CSS;
  const menu = document.createElement('div');
  menu.className = 'menu';
  for (const spec of FAKEFORM_ACTIONS) {
    if (spec.action === 'undo') menu.append(Object.assign(document.createElement('div'), { className: 'sep' }));
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'item';
    item.textContent = spec.label;
    item.addEventListener('click', () => ask(spec.action));
    menu.append(item);
  }
  // Keep the page's focus where it is: the actions are defined relative to the focused field,
  // and a menu that steals focus would make "Fill this input" mean nothing.
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menuRoot.append(style, menu);
  menuUntheme = themeShadowHost(menuHost);
  document.body.appendChild(menuHost);
  return menuRoot;
}

function openMenu(): void {
  const root = ensureMenu();
  const menu = root.querySelector('.menu') as HTMLElement | null;
  if (!menuHost || !menu || !chip) return;
  menuOpen = true;
  menuHost.style.display = 'block';
  const anchor = chip.host.getBoundingClientRect();
  const { left, top } = floatPlacement(
    { left: anchor.left, top: anchor.top, bottom: anchor.bottom },
    { width: menu.offsetWidth || 178, height: menu.offsetHeight || 140 },
    { width: window.innerWidth, height: window.innerHeight },
  );
  menuHost.style.left = `${left}px`;
  menuHost.style.top = `${top}px`;
}

function closeMenu(): void {
  menuOpen = false;
  if (menuHost) menuHost.style.display = 'none';
}

const onFocusIn = (e: Event): void => {
  const field = (e.target as Element | null)?.closest?.(FOCUS_SEL);
  if (field instanceof HTMLElement) chip?.show(field);
};

const onFocusOut = (): void => {
  // Let the click that moved focus land first; a menu click keeps focus, so this only fires
  // when the user genuinely left the field.
  setTimeout(() => {
    if (menuOpen) return;
    if (document.activeElement?.closest?.(FOCUS_SEL)) return;
    chip?.hide();
  }, 0);
};

const onDocPointerDown = (e: Event): void => {
  if (!menuOpen) return;
  const path = (e as PointerEvent).composedPath?.() ?? [];
  if (menuHost && path.includes(menuHost)) return;
  if (chip && path.includes(chip.host)) return;
  closeMenu();
};

const onKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') closeMenu();
};

const reposition = (): void => {
  const field = document.activeElement;
  if (field instanceof HTMLElement && field.closest?.(FOCUS_SEL)) chip?.show(field);
  if (menuOpen) openMenu();
};

function activate(): void {
  chip ??= createFieldChip({
    name: 'fakeform',
    order: 2, // left of Grammit (1) and Clipboard (0)
    icon: GLYPH,
    title: 'FakeForm — fill this form with fake data',
    onClick: () => (menuOpen ? closeMenu() : openMenu()),
  });
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  // A field may already be focused — someone who installs it mid-form is looking at one, and no
  // focusin event is coming.
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.closest?.(FOCUS_SEL)) chip.show(focused);
}

/** Uninstalling has to take the control OFF this page, not merely stop updating it. */
function deactivate(): void {
  document.removeEventListener('focusin', onFocusIn, true);
  document.removeEventListener('focusout', onFocusOut, true);
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('scroll', reposition, true);
  window.removeEventListener('resize', reposition);
  closeMenu();
  menuUntheme?.();
  menuUntheme = null;
  menuHost?.remove();
  menuHost = null;
  menuRoot = null;
  chip?.destroy();
  chip = null;
}

watchAppInstalled(FAKEFORM_APP_ID, (on) => (on ? activate() : deactivate()));
