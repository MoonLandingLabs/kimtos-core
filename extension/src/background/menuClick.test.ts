// "Open Kimtos Clipboard panel" did nothing, and said nothing (#257).
//
// `chrome.sidePanel.open()` may only be called in direct response to a user gesture. The handler
// awaited an install-state re-check first — and an await, any await, spends the gesture — so Chrome
// rejected the open. An empty `.catch(() => {})` then dropped the rejection, so a dead feature
// looked like a working one.
//
// The property the browser enforces is TIMING: the call must happen before control ever returns
// to the event loop. That is what these tests assert — not "open was called", but "open was
// called SYNCHRONOUSLY". A test that only checked the former would still pass with the bug.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleMenuClick, type MenuDeps } from './menuClick.js';

/** A deps object that records the order things happened in. */
function spy(overrides: Partial<MenuDeps> & { active?: boolean } = {}) {
  const calls: string[] = [];
  const errors: { message: string; error: unknown }[] = [];
  const { active = true, ...rest } = overrides;
  const deps: MenuDeps = {
    openPanel: (windowId) => {
      calls.push(`openPanel:${windowId}`);
      return Promise.resolve();
    },
    isActive: async () => {
      calls.push('isActive'); // recorded even when the answer is "no" — the CHECK still happened
      return active;
    },
    openPicker: (tabId) => calls.push(`openPicker:${tabId}`),
    saveSelection: async (clip) => {
      calls.push(`saveSelection:${clip.text}`);
    },
    onError: (message, error) => errors.push({ message, error }),
    ...rest,
  };
  return { calls, errors, deps };
}

const TAB = { id: 7, windowId: 42, url: 'https://x.test', title: 'X' };

describe('the side panel opens on the USER GESTURE — no await first (#257)', () => {
  test('openPanel is called SYNCHRONOUSLY, before any microtask runs', () => {
    const { calls, deps } = spy();
    handleMenuClick({ menuItemId: 'clip-open-panel' }, TAB, deps);
    // Not awaited. If anything had been awaited inside, `calls` would still be empty here — and
    // that is precisely the state in which Chrome refuses to open the panel.
    assert.deepEqual(calls, ['openPanel:42'], 'the panel must open in the same tick as the click');
  });

  test('the install check does NOT precede it — that is what broke it', () => {
    // The old handler ran `await isActive()` first. This asserts the ordering can never come back:
    // isActive must not be called at all on this path.
    const { calls, deps } = spy();
    handleMenuClick({ menuItemId: 'clip-open-panel' }, TAB, deps);
    assert.ok(!calls.includes('isActive'), 'awaiting the install check would spend the gesture');
  });

  test('the panel gates itself, so skipping the check here grants nothing', async () => {
    // sidepanel.ts shows a not-installed notice, and it must: Chrome can open the panel from its
    // own toolbar picker with no help from us. Opening it without Clipboard installed shows the
    // notice, not the app.
    const { calls, deps } = spy({ active: false });
    await handleMenuClick({ menuItemId: 'clip-open-panel' }, TAB, deps);
    assert.deepEqual(calls, ['openPanel:42']);
  });

  test('a rejected open is REPORTED, not swallowed', async () => {
    // The empty catch is what turned a broken feature into an invisible one.
    const boom = new Error('may only be called in response to a user gesture');
    const { errors, deps } = spy({ openPanel: () => Promise.reject(boom) });
    await handleMenuClick({ menuItemId: 'clip-open-panel' }, TAB, deps);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /side panel failed to open/);
    assert.equal(errors[0]!.error, boom);
  });

  test('a click with no windowId is reported, not silently ignored', async () => {
    const { calls, errors, deps } = spy();
    await handleMenuClick({ menuItemId: 'clip-open-panel' }, { id: 7 }, deps);
    assert.deepEqual(calls, [], 'nothing to open');
    assert.match(errors[0]!.message, /no windowId/);
  });
});

describe('the other items keep their install re-check', () => {
  // They write to the store and message tabs, and a menu can outlive the install state that created
  // it (the service worker suspends). Those paths do not gate themselves (#68).
  test('the picker opens only when Clipboard is installed', async () => {
    const { calls, deps } = spy();
    await handleMenuClick({ menuItemId: 'clip-open-picker' }, TAB, deps);
    assert.deepEqual(calls, ['isActive', 'openPicker:7'], 'checked first, then opened');
  });

  test('a user without Clipboard gets nothing from the picker', async () => {
    const { calls, deps } = spy({ active: false });
    await handleMenuClick({ menuItemId: 'clip-open-picker' }, TAB, deps);
    assert.deepEqual(calls, ['isActive']);
  });

  test('saving a selection checks the install state, then saves with its source', async () => {
    const { calls, deps } = spy();
    await handleMenuClick(
      { menuItemId: 'clip-save-selection', selectionText: 'hello', pageUrl: 'https://p.test' },
      TAB,
      deps,
    );
    assert.deepEqual(calls, ['isActive', 'saveSelection:hello']);
  });

  test('a user without Clipboard cannot save a selection', async () => {
    const { calls, deps } = spy({ active: false });
    await handleMenuClick({ menuItemId: 'clip-save-selection', selectionText: 'hello' }, TAB, deps);
    assert.deepEqual(calls, ['isActive'], 'the store write must not happen');
  });

  test('an empty selection saves nothing', async () => {
    const { calls, deps } = spy();
    await handleMenuClick({ menuItemId: 'clip-save-selection', selectionText: '' }, TAB, deps);
    assert.deepEqual(calls, ['isActive']);
  });

  test('an unknown menu id does nothing', async () => {
    const { calls, deps } = spy();
    await handleMenuClick({ menuItemId: 'something-else' }, TAB, deps);
    assert.deepEqual(calls, ['isActive']);
  });
});
