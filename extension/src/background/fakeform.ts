// What a FakeForm action does, once the worker has one — extracted from the service worker so
// the one thing that matters here can actually be tested.
//
// THE RULE: nothing is injected, and nothing is asked of a page, unless the app is installed.
// FakeForm's entry points all live OUTSIDE the new
// tab — a badge on every site, three keyboard commands, four right-click items — and every one
// of them reaches the page through this function. That is why the gate is a dependency rather
// than an import: the worker owns the subscription (it re-syncs on every storage change), and
// this stays a pure decision that a test can drive.
//
// The order is deliberate and not interchangeable: check, then inject, then message. Injecting
// first would put the filler into the page of a user who has not installed it.

import { FAKEFORM_APPLY, FAKEFORM_FILLER_FILE, type FakeFormAction } from '../lib/fakeformShared.js';

export interface FakeFormDeps {
  /** Is FakeForm installed? Asked fresh on every action. */
  isActive: () => Promise<boolean>;
  /** Put the filler bundle into the tab. Resolves once it has run. */
  inject: (tabId: number, file: string) => Promise<unknown>;
  /** Send the injected filler its instruction. */
  send: (tabId: number, message: unknown) => Promise<unknown>;
  /** Report a failure. Never swallow one — a dead shortcut that says nothing is how a broken
   *  feature stays broken (#257). */
  onError: (message: string, error: unknown) => void;
}

/**
 * Run one FakeForm action in a tab.
 *
 * Returns whether the page was asked to do anything, so a caller (and a test) can tell "not
 * installed" apart from "done".
 */
export async function runFakeForm(
  tabId: number | undefined,
  action: FakeFormAction,
  deps: FakeFormDeps,
): Promise<boolean> {
  if (tabId == null) return false;
  if (!(await deps.isActive())) return false;
  try {
    // Injecting the same file twice is fine and expected: the filler is written to be
    // re-entrant, and re-injecting is cheaper than tracking which tabs already have it (a tab
    // navigates, and the worker is not awake to notice).
    await deps.inject(tabId, FAKEFORM_FILLER_FILE);
    await deps.send(tabId, { type: FAKEFORM_APPLY, action });
    return true;
  } catch (error) {
    // A page we hold no host permission for, a restricted URL (chrome://, the Web Store), or a
    // tab that closed mid-flight. All three are "nothing happened", and the user pressed a key.
    deps.onError(`FakeForm could not run "${action}" in this tab`, error);
    return false;
  }
}
