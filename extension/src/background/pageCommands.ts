// The ONE place a page action is carried out — whichever surface asked for it.
//
// A page action has three front doors: the keyboard shortcut (`chrome.commands`), the
// right-click menu, and (since #1110) the toolbar popup. They must all reach the SAME code, or
// the popup's "Fill this form" and the Alt+Shift+F that fills the same form quietly become two
// different features with two different gates. So the popup does not run anything itself: it
// names the manifest `commands` key and the tab, and this function does exactly what the
// keyboard listener does.
//
// Deps are injected rather than imported so the decisions here (which gate, which order) are
// testable without a browser, matching background/fakeform.ts.

import { actionForCommand } from '../lib/fakeformShared.js';
import { CLIPBOARD_PICKER_COMMAND } from '../lib/pageActions.js';
import { runFakeForm, type FakeFormDeps } from './fakeform.js';

export interface PageCommandDeps {
  /** How a FakeForm action reaches the page (gate, inject, message). */
  fakeform: FakeFormDeps;
  /** Is Clipboard installed AND usable by this user? Asked fresh on every invocation. */
  clipboardActive: () => Promise<boolean>;
  /** Ask the tab's content script to open the in-page history picker. */
  openPicker: (tabId: number) => void;
}

/**
 * Run the page action named by a manifest `commands` key in a tab.
 *
 * Returns whether the page was asked to do anything, so a caller (the popup, a test) can tell
 * "app not installed" / "unknown command" apart from "done".
 */
export async function runPageCommand(
  command: string,
  tabId: number | undefined,
  deps: PageCommandDeps,
): Promise<boolean> {
  const fakeform = actionForCommand(command);
  if (fakeform) return runFakeForm(tabId, fakeform, deps.fakeform);

  if (command !== CLIPBOARD_PICKER_COMMAND) return false;
  if (tabId == null) return false;
  // Check before messaging the tab, so the pages of a user without Clipboard are never spoken
  // to at all.
  if (!(await deps.clipboardActive())) return false;
  deps.openPicker(tabId);
  return true;
}
