// "Which search box is the user actually looking at?" — the question ⌘K has to answer
// before it can focus one (#1162).
//
// Derived from the DOM, NOT from a list an app registers in. `dialog.ts` already stamps a
// rising z-index on every window as it opens or is raised (and puts utility dialogs in a
// higher band), so the stacking order is already written down where it belongs; and the
// field an app means as "its search" is already marked by the semantic HTML — `type="search"`,
// which ten surfaces use today. A registry would be a second copy of both facts, and the kind
// that goes stale the first time someone adds an app without noticing it exists. Same reason
// `markAppRoot()` derives the app root from the DOM instead of naming every app's layout class.
//
// So: give a search box the correct type and ⌘K finds it. There is nothing else to wire.

// `.dialog.is-open` is the whole "on screen" test, and it needs BOTH halves. `dialog.ts`
// fades a window out over 140ms: `hide()` drops `is-open` at once but only sets `hidden`
// once the transition has run, so for that beat a closed or minimized window is still
// `hidden === false` while `shell.css` has it at `opacity: 0`. Matching on `hidden` alone
// would let ⌘K pressed just after a close focus a box the user can no longer see — and
// then stop, because a found box is the end of the search. `is-open` is what the stylesheet
// itself keys the window's visibility on, so it is the honest signal.
const OPEN_WINDOW = '.dialog.is-open';
const SEARCH_FIELD = 'input[type="search"]';

/** Whether a field can actually take focus right now. */
function usable(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly) return false;
  if (input.closest('[hidden]')) return false;
  // Catches the CSS-hidden cases the `hidden` attribute does not (a collapsed toolbar,
  // `display: none` on a pane). Optional-called so this module stays usable in a document
  // that does not implement it — the test DOM is not Chrome, and "the engine cannot tell
  // me" must fall back to "visible", not to "nothing is ever focusable".
  return input.checkVisibility?.() ?? true;
}

/**
 * The visible window stacked highest, or null when none is open.
 *
 * Ties (two windows never raised, so both at the same base z) go to the one later in the
 * DOM, which is the one painted on top.
 */
export function topWindow(doc: Document = document): HTMLElement | null {
  let top: HTMLElement | null = null;
  let topZ = -Infinity;
  for (const el of doc.querySelectorAll<HTMLElement>(OPEN_WINDOW)) {
    // Both halves, because `is-open` and `hidden` CAN both be true at once: `hide()`'s
    // timeout is never cancelled, so reopening a window within 140ms of closing it lets
    // that pending timeout hide the freshly-opened window (a dialog.ts bug of its own,
    // filed as #1169). Neither flag is sufficient alone.
    if (el.hidden) continue;
    const z = parseInt(el.style.zIndex, 10);
    const zi = Number.isNaN(z) ? 0 : z;
    if (zi >= topZ) {
      top = el;
      topZ = zi;
    }
  }
  return top;
}

/**
 * Focus (and select) the search field of the topmost window, so typing replaces whatever
 * was already in it. Returns whether there was one — the caller decides what ⌘K should
 * mean when the window you are in has nothing to search.
 */
export function focusTopWindowSearch(doc: Document = document): boolean {
  const win = topWindow(doc);
  if (!win) return false;
  for (const input of win.querySelectorAll<HTMLInputElement>(SEARCH_FIELD)) {
    if (!usable(input)) continue;
    input.focus();
    input.select();
    return true;
  }
  return false;
}
