// Whether the toolbar click opens the popup or goes straight to Kimtos (#1186).
//
// The popup is right when the page HAS actions and wrong when it does not — on a restricted
// page, or for any user with none of the apps that register page actions installed, it is a menu
// whose only item is "Open Kimtos". `shouldShowPopup` is the whole decision, and it is pure, so
// the table it implements is the test.
//
// The case worth guarding hardest is `grant-host`: ZERO actions, but the popup still carries the
// only button that grants the permission unblocking them (`popup.ts` -> `requestAllSites`).
// "no actions" is therefore the wrong condition, and a future simplification to
// `model.actions.length === 0` would strand a user with no route to what they installed
// for. That is what the fourth test below exists to catch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowPopup, syncPopupFor, syncAllTabs, type ToolbarDeps } from './toolbarClick.js';
import { pageActionsFor, type PageAction, type PageActionContext, type PopupModel } from '../lib/pageActions.js';
import type { InstalledState } from '../lib/installedApps.js';

const model = (over: Partial<PopupModel> = {}): PopupModel => ({ actions: [], notice: null, ...over });
const row: PageAction = { id: 'x', appId: 'fakeform', label: 'X', access: 'inject' };

describe('shouldShowPopup: the four states, directly', () => {
  test('actions to show -> the popup', () => {
    assert.equal(shouldShowPopup(model({ actions: [row] })), true);
  });

  test('no actions, but a grant would unblock them -> the popup, because it holds the grant button', () => {
    assert.equal(shouldShowPopup(model({ notice: 'grant-host' })), true);
  });

  test('a restricted page -> no popup, the click opens Kimtos', () => {
    assert.equal(shouldShowPopup(model({ notice: 'restricted' })), false);
  });

  test('nothing to show and nothing to offer -> no popup', () => {
    assert.equal(shouldShowPopup(model()), false);
  });

  test('a grant notice wins even alongside actions — it is never the reason to hide', () => {
    assert.equal(shouldShowPopup(model({ actions: [row], notice: 'grant-host' })), true);
  });
});

// Driven through the real rule, but with a registry of this test's own — the shipped one is all
describe('shouldShowPopup: through pageActionsFor, on the states users are actually in', () => {
  const APP = 'fakeform';
  const injects: PageAction[] = [{ id: 'fill', appId: APP, label: 'Fill', access: 'inject' }];
  const needsHost: PageAction[] = [{ id: 'pick', appId: APP, label: 'Pick', access: 'content-script' }];
  const ctx = (over: Partial<PageActionContext> = {}): PageActionContext => ({
    installed: { installedApps: [APP] },
    pageKind: 'web',
    secure: true,
    hasAllSites: true,
    ...over,
  });

  test('an ordinary page with an installed action keeps the menu', () => {
    assert.equal(shouldShowPopup(pageActionsFor(ctx(), injects)), true);
  });

  test('a chrome:// page skips it', () => {
    assert.equal(shouldShowPopup(pageActionsFor(ctx({ pageKind: 'restricted' }), injects)), false);
  });

  test('a user without the app skips it — nothing is installed to act with', () => {
    const bare = ctx({ installed: { installedApps: [] } });
    assert.equal(shouldShowPopup(pageActionsFor(bare, injects)), false);
  });

  test('installed but held back by the missing host grant keeps the menu', () => {
    const held = pageActionsFor(ctx({ hasAllSites: false }), needsHost);
    assert.deepEqual(held.actions, [], 'the fixture must actually be blocked, or this proves nothing');
    assert.equal(held.notice, 'grant-host');
    assert.equal(shouldShowPopup(held), true);
  });
});

// The orchestration, not just the predicate. `syncPopupFor` claims a safety property — it only
// ever CLEARS the popup on a confident answer, and leaves it in place otherwise — and that claim
// is the whole argument for the feature being safe, so it is the part worth pinning.
//
// The first review round found it was false: the background cannot see `tab.url` (`tabs` is an
// optional permission this extension does not hold, and `host_permissions` covers five domains),
// `pageKindOf` maps a missing URL to 'restricted', and the popup was therefore cleared on every
// ordinary page for exactly the users the menu exists for. The "unreadable URL" cases
// below are that bug, pinned.
describe('syncPopupFor: what actually reaches chrome.action.setPopup', () => {
  const BOTH: InstalledState = { installedApps: ['fakeform', 'clipboard'] };
  const NONE: InstalledState = { installedApps: [] };

  const spy = (over: Partial<ToolbarDeps> = {}) => {
    const calls: { tabId: number; popup: string }[] = [];
    const deps: ToolbarDeps = {
      readInstalledState: async () => BOTH,
      hasAllSites: async () => true,
      setPopup: async (d) => void calls.push(d),
      queryTabs: async () => [],
      ...over,
    };
    return { calls, deps };
  };

  test('a user with the apps on an UNREADABLE url keeps the popup — we cannot see the page, so we do not clear it', async () => {
    const { calls, deps } = spy();
    await syncPopupFor(1, undefined, deps);
    assert.deepEqual(calls, [{ tabId: 1, popup: 'popup.html' }]);
  });

  test('a user with nothing installed is cleared even on an unreadable url — no page can give them a row', async () => {
    const { calls, deps } = spy({ readInstalledState: async () => NONE });
    await syncPopupFor(2, undefined, deps);
    assert.deepEqual(calls, [{ tabId: 2, popup: '' }]);
  });

  test('a real chrome:// url is cleared', async () => {
    const { calls, deps } = spy();
    await syncPopupFor(3, 'chrome://extensions', deps);
    assert.deepEqual(calls, [{ tabId: 3, popup: '' }]);
  });

  test('a user with the apps on a real web page keeps the popup', async () => {
    const { calls, deps } = spy();
    await syncPopupFor(4, 'https://example.com', deps);
    assert.deepEqual(calls, [{ tabId: 4, popup: 'popup.html' }]);
  });

  test('an unreadable installed set keeps the popup rather than guessing', async () => {
    const { calls, deps } = spy({ readInstalledState: async () => null });
    await syncPopupFor(5, 'chrome://extensions', deps);
    assert.deepEqual(
      calls,
      [{ tabId: 5, popup: 'popup.html' }],
      'even a restricted page, when we cannot read the installed set',
    );
  });

  test('a thrown installed-set read keeps the popup', async () => {
    const { calls, deps } = spy({
      readInstalledState: async () => {
        throw new Error('storage unavailable');
      },
    });
    await syncPopupFor(6, 'chrome://extensions', deps);
    assert.deepEqual(calls, [{ tabId: 6, popup: 'popup.html' }]);
  });

  test('a stale computation cannot overwrite a newer one for the same tab', async () => {
    const { calls, deps } = spy();
    // Initialised to a no-op rather than null: it is only ever assigned inside the executor
    // below, which TypeScript cannot see, so a nullable would narrow to `never` at the call.
    let release: () => void = () => {};
    const slow: ToolbarDeps = {
      ...deps,
      readInstalledState: () =>
        new Promise((resolve) => {
          release = () => resolve(NONE);
        }),
    };
    const stale = syncPopupFor(7, undefined, slow); // would clear (nothing installed), and resolves LAST
    const fresh = syncPopupFor(7, undefined, deps); // has the apps: keeps the popup
    await fresh;
    release();
    await stale;
    assert.deepEqual(calls, [{ tabId: 7, popup: 'popup.html' }], 'only the newest call for a tab may write');
  });

  test('a setPopup that throws — a tab closed mid-flight — does not reject', async () => {
    const { deps } = spy({
      setPopup: async () => {
        throw new Error('No tab with id 8');
      },
    });
    await syncPopupFor(8, 'https://example.com', deps);
  });
});

describe('syncAllTabs', () => {
  test('decides for every tab that has an id, and survives one without', async () => {
    const calls: { tabId: number; popup: string }[] = [];
    const deps: ToolbarDeps = {
      readInstalledState: async () => ({ installedApps: [] }),
      hasAllSites: async () => true,
      setPopup: async (d) => void calls.push(d),
      queryTabs: async () => [{ id: 11, url: 'https://a.test' }, { url: 'https://b.test' }, { id: 13 }],
    };
    await syncAllTabs(deps);
    assert.deepEqual(
      calls.map((c) => c.tabId).sort((a, b) => a - b),
      [11, 13],
    );
  });

  test('a failed tabs query leaves every tab on the manifest popup rather than throwing', async () => {
    const calls: unknown[] = [];
    await syncAllTabs({
      readInstalledState: async () => null,
      hasAllSites: async () => true,
      setPopup: async (d) => void calls.push(d),
      queryTabs: async () => {
        throw new Error('no tabs API');
      },
    });
    assert.deepEqual(calls, []);
  });
});
