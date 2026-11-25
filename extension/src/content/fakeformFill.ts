// FakeForm's filler — the heavy half, injected ON DEMAND.
//
// This carries the detector, the generators and the name dataset. It is NOT registered against
// every site: the service worker injects it with `chrome.scripting.executeScript` the moment
// somebody actually asks for a fill, so a page nobody fills never loads a byte of it (#222).
//
// Injection is repeatable — the same tab gets this script again on the next action — so the
// module is written to be re-entrant: the listener is registered once, guarded by a marker on
// the isolated world's global, and the undo snapshot survives between injections because the
// world does.
//
// PASSWORD FIELDS ARE FILLED HERE, ON PURPOSE. Grammit Anywhere deliberately never touches a
// password field; FakeForm must, because logging back in is half of testing a signup form. Same
// element type, opposite rule, same codebase — so it is written down rather than left to be
// "fixed" later. The generated password is reported back so the tester can read it off the
// toast and use it.

import { showToast } from './toast.js';
import { fillFields, type FillResult, type FillScope } from '../lib/fakeform/fill.js';
import { appInstalled } from '../lib/installedApps.js';
import { FAKEFORM_APP_ID, FAKEFORM_APPLY, isFakeFormAction, type FakeFormAction } from '../lib/fakeformShared.js';

interface FillerState {
  /** The last fill in THIS page, so Undo has something to put back. */
  last: FillResult | null;
  /** Whether the message listener is already attached, so a re-injection does not add a second. */
  listening: boolean;
}

/**
 * The state lives on the isolated world's global, NOT in a module variable.
 *
 * Re-injecting the file re-runs the module, so a module-level `lastFill` would be reset to null
 * by the very next fill — and Undo, the thing that makes a one-keypress form filler safe to use
 * at all, would never have anything to restore. The world outlives the injection; the module
 * does not.
 */
const world = globalThis as typeof globalThis & { __kimtosFakeForm?: FillerState };
const state: FillerState = (world.__kimtosFakeForm ??= { last: null, listening: false });

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

async function run(action: FakeFormAction): Promise<string> {
  // Re-check at fill time, not only when the worker decided to inject. A tab can sit open across
  // an uninstall, and this script stays resident once injected.
  if (!(await appInstalled(FAKEFORM_APP_ID))) return '';

  if (action === 'undo') {
    const restored = state.last?.restore() ?? 0;
    state.last = null;
    return restored ? `Restored ${plural(restored, 'field')}` : 'Nothing to undo';
  }

  const result = fillFields(action as FillScope);
  if (!result.filled) return 'No fields to fill here';
  state.last = result;
  return `Filled ${plural(result.filled, 'field')}${result.password ? ` · password ${result.password}` : ''}`;
}

// Registered once per page, however many times the worker injects this file.
if (!state.listening) {
  state.listening = true;
  chrome.runtime.onMessage.addListener((msg: { type?: string; action?: unknown }, _sender, sendResponse) => {
    if (msg?.type !== FAKEFORM_APPLY || !isFakeFormAction(msg.action)) return undefined;
    run(msg.action)
      .then((message) => {
        if (message) showToast(message);
        sendResponse({ ok: true, message });
      })
      .catch((err: unknown) => {
        // A page can throw from its own event handlers while we write to it. Say so rather than
        // leaving the user with a shortcut that silently does nothing.
        console.warn('[kimtos] FakeForm could not fill this page:', err);
        showToast('FakeForm could not fill this page');
        sendResponse({ ok: false, message: String(err) });
      });
    return true; // async response
  });
}
