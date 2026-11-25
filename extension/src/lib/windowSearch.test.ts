// ⌘K has to pick the search box the user is looking at, and it picks it out of the DOM —
// no registry, no per-app wiring (#1162). That makes these the tests for the CONTRACT: a
// window is `.dialog`, on screen means not `hidden`, on top means the highest z-index, and
// a search box is `input[type="search"]`. If any of those stops holding, ⌘K silently starts
// focusing the wrong box (or nothing) with no other signal — so they are asserted here.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';

let env: DomEnv;
let doc: Document;
let topWindow: typeof import('./windowSearch.js').topWindow;
let focusTopWindowSearch: typeof import('./windowSearch.js').focusTopWindowSearch;

/**
 * A window as `dialog.ts` builds it: `.dialog`, a numeric z-index, `is-open` while it is on
 * screen, `hidden` once a close or minimize has finished fading out.
 */
function win(z: number, { open = true, hidden = false }: { open?: boolean; hidden?: boolean } = {}): HTMLElement {
  const el = doc.createElement('div');
  el.className = open ? 'dialog is-open' : 'dialog';
  el.style.zIndex = String(z);
  el.hidden = hidden;
  doc.body.append(el);
  return el;
}

function searchField(parent: HTMLElement, name: string): HTMLInputElement {
  const input = doc.createElement('input');
  input.type = 'search';
  input.name = name;
  parent.append(input);
  return input;
}

describe('windowSearch — which box ⌘K focuses', () => {
  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    ({ topWindow, focusTopWindowSearch } = await import('./windowSearch.js'));
  });

  afterEach(() => env.cleanup());

  test('no windows open at all', () => {
    assert.equal(topWindow(doc), null);
    assert.equal(focusTopWindowSearch(doc), false, 'nothing to focus, and it must SAY so');
  });

  test('the highest z-index wins, whatever the DOM order', () => {
    const low = win(10);
    const high = win(30);
    win(20);
    searchField(low, 'low');
    const wanted = searchField(high, 'high');

    assert.equal(topWindow(doc), high);
    assert.equal(focusTopWindowSearch(doc), true);
    assert.equal(doc.activeElement, wanted, 'the window on top owns the keystroke');
  });

  test('a minimized or closed window is not on top — it is not on screen', () => {
    // dialog.ts sets `hidden` for BOTH, so the highest z-index can easily be a window the
    // user cannot see. Focusing into it would put the caret somewhere invisible.
    const onScreen = win(10);
    const minimized = win(99, { open: false, hidden: true });
    searchField(minimized, 'minimized');
    const wanted = searchField(onScreen, 'open');

    assert.equal(topWindow(doc), onScreen);
    assert.equal(focusTopWindowSearch(doc), true);
    assert.equal(doc.activeElement, wanted);
  });

  test('a window still FADING OUT is not on screen either', () => {
    // dialog.ts drops `is-open` at once but only sets `hidden` once the 140ms transition has
    // run. For that beat the closing window is `hidden === false` and still the highest z,
    // while the stylesheet has it at opacity 0 — so `hidden` alone would send ⌘K pressed
    // right after a close into a box the user can no longer see, and stop there.
    const onScreen = win(10);
    const closing = win(99, { open: false, hidden: false });
    searchField(closing, 'closing');
    const wanted = searchField(onScreen, 'open');

    assert.equal(topWindow(doc), onScreen);
    assert.equal(focusTopWindowSearch(doc), true);
    assert.equal(doc.activeElement, wanted);
  });

  test('ties go to the window later in the DOM — the one painted on top', () => {
    win(10);
    const later = win(10);
    const wanted = searchField(later, 'later');
    assert.equal(topWindow(doc), later);
    assert.equal(focusTopWindowSearch(doc), true);
    assert.equal(doc.activeElement, wanted);
  });

  test('a window with no search box reports false — it does not reach past it to another window', () => {
    // Deliberate: ⌘K must not focus a box in a window BEHIND the one you are in. The caller
    // decides the fallback (open Tabs); this function only answers for the top window.
    const behind = win(10);
    searchField(behind, 'behind');
    win(20);

    assert.equal(focusTopWindowSearch(doc), false);
    assert.notEqual(doc.activeElement, behind.querySelector('input'));
  });

  test('a text input is not a search box', () => {
    const w = win(10);
    const text = doc.createElement('input');
    text.type = 'text';
    w.append(text);
    assert.equal(focusTopWindowSearch(doc), false, 'the semantic type IS the registration');
  });

  test('a hidden, disabled or read-only field is skipped for the next real one', () => {
    const w = win(10);
    const collapsed = doc.createElement('div');
    collapsed.hidden = true;
    w.append(collapsed);
    searchField(collapsed, 'in-a-hidden-pane');
    searchField(w, 'disabled').disabled = true;
    searchField(w, 'readonly').readOnly = true;
    const wanted = searchField(w, 'usable');

    assert.equal(focusTopWindowSearch(doc), true);
    assert.equal(doc.activeElement, wanted);
  });

  test('the field is SELECTED, so typing replaces what was there', () => {
    const w = win(10);
    const field = searchField(w, 'q');
    field.value = 'old query';

    assert.equal(focusTopWindowSearch(doc), true);
    assert.equal(field.selectionStart, 0);
    assert.equal(field.selectionEnd, 'old query'.length);
  });
});
