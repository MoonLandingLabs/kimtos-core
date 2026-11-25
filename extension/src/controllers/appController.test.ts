// The home screen follows the INSTALL state. There is no plan, entitlement or account: only what
// the user installed (and which cards they hid) decides which cards are shown.
//
// This drives the real controller. A test that passed whether or not its subscription exists would
// be worse than no test at all.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

// The elements the page gives the controller. Building them is cheaper than importing index.html.
const IDS = [
  'app-dock',
  'settings-btn',
  'bg-bar',
  'bg-credit',
  'bg-layer',
  'clock',
  'dock-tip',
  'home-focus',
  'home-readit',
  'home-weather',
  'home-widgets',
  'rate-btn',
  'release-btn',
  'search',
  'store-btn',
  'subtitle',
];

let env: DomEnv;
let fake: FakeChrome;
let doc: Document;
let store: typeof import('../models/store.js').store;

// startApp() is the whole page: it starts a clock, rotates the dock tip, and polls the session.
// Those intervals would keep Node alive after the test finished — the runner waits for an empty
// event loop — so they are collected and cleared in afterEach. The controller has no teardown of
// its own (it never needed one: the page it runs on is closed by the browser).
const intervals: ReturnType<typeof setInterval>[] = [];
const realSetInterval = globalThis.setInterval;
function trackIntervals(): void {
  (globalThis as { setInterval: unknown }).setInterval = ((fn: () => void, ms?: number) => {
    const id = realSetInterval(fn, ms);
    intervals.push(id);
    return id;
  }) as typeof setInterval;
}
function clearTrackedIntervals(): void {
  for (const id of intervals.splice(0)) clearInterval(id);
  (globalThis as { setInterval: unknown }).setInterval = realSetInterval;
}

// REAL app ids, deliberately, so the install model sees apps we actually ship. `denoise` is opt-in
// (ships uninstalled), `calculator` is installed by default.
const OPT_IN_APP = 'denoise';
const DEFAULT_APP = 'calculator';
// Real id again, for the same reason: ⌘K asks isInstalled('tabs') and opens that id.
const TABS_APP = 'tabs';

/** How many times the Tabs stub rendered — the difference between "opened" and "re-rendered". */
let tabsRenders = 0;

/**
 * A stand-in for Tabs: one root (so markAppRoot is happy) holding a real search field, which
 * is all ⌘K's window step looks for (lib/windowSearch.ts).
 */
const searchApp = (id: string, name: string) => ({
  ...widgetApp(id, name),
  widget: undefined,
  render: (body: HTMLElement) => {
    tabsRenders++;
    const root = doc.createElement('div');
    const search = doc.createElement('input');
    search.type = 'search';
    search.dataset.search = id;
    root.append(search);
    body.replaceChildren(root);
  },
});

/** Press the shortcut and hand back the event, so a test can read `defaultPrevented`. */
function pressCtrlK({
  key = 'k',
  ctrl = true,
  shift = false,
  alt = false,
}: { key?: string; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    code: 'KeyK',
    key,
    ctrlKey: ctrl,
    shiftKey: shift,
    altKey: alt,
    bubbles: true,
    cancelable: true,
  });
  doc.dispatchEvent(e);
  return e;
}

/** A fake app that renders a card we can look for. No CSS, so it imports in Node. */
const widgetApp = (id: string, name: string) => ({
  id,
  name,
  accent: '#888888',
  order: 1,
  description: name,
  tools: [],
  render: () => () => {},
  widget: () => {
    const card = doc.createElement('div');
    card.dataset.card = id;
    card.textContent = `${name} card`;
    return card;
  },
});

const cards = (): string[] =>
  [...doc.querySelectorAll('#home-widgets [data-card]')].map((e) => (e as HTMLElement).dataset.card ?? '');

describe('the home screen follows the install state', () => {
  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    trackIntervals();
    for (const id of IDS) {
      const node = doc.createElement('div');
      node.id = id;
      doc.body.append(node);
    }
    fake = installChrome();

    tabsRenders = 0;
    const stub = await import('../apps/index.js');
    (stub as unknown as { __setApps: (l: unknown[]) => void }).__setApps([
      widgetApp(OPT_IN_APP, 'Denoise'),
      widgetApp(DEFAULT_APP, 'Calculator'),
      searchApp(TABS_APP, 'Tabs'),
    ]);

    ({ store } = await import('../models/store.js'));
    await store.set({
      onboarded: true, // do not render the welcome overlay
      installedApps: [OPT_IN_APP, DEFAULT_APP, TABS_APP],
      // Cleared explicitly: the store is a module singleton, so an installed set written by one
      // test survives into the next, and migrateInstalledApps() skips a workspace it already
      // knows — so the legacy list above would be silently discarded and this suite would run
      // against the PREVIOUS test's installed apps.
      installedAppsByUser: {},
      homeWidgets: {},
    } as never);

    const { startApp } = await import('./appController.js');
    await startApp();
    await settle(20);
  });

  afterEach(() => {
    clearTrackedIntervals();
    fake.cleanup();
    env.cleanup();
  });

  test('nothing is ever locked: every installed app has its card', async () => {
    assert.ok(cards().includes(OPT_IN_APP), 'an installed opt-in app has its card');
    assert.ok(cards().includes(DEFAULT_APP));
  });

  test('an uninstalled app loses its card', async () => {
    // The real path: an uninstall finishing fires onInstalledChange, which repaints the home.
    const { uninstall } = await import('../lib/installManager.js');
    assert.ok(cards().includes(OPT_IN_APP), 'precondition: it had a card');
    uninstall(OPT_IN_APP);
    await settle(60);
    assert.equal(cards().includes(OPT_IN_APP), false, 'not installed is not installed');
    assert.ok(cards().includes(DEFAULT_APP), 'the others keep theirs');
  });

  test('the data workspace is the store workspace, so the settings mirror lands right (#472)', async () => {
    const { dataStore } = await import('../lib/dataStore.js');
    assert.equal(store.workspaceId(), 'local', 'a fresh install has no account, so it is local');
    assert.equal(dataStore.getWorkspace(), store.workspaceId());
  });

  test('⌘K is claimed by the PHYSICAL key, not the layout-mapped character (#1162)', async () => {
    // The bug: the handler matched `e.key === 'k'`. `e.key` is what the LAYOUT produces, so on
    // an Arabic/Cyrillic/Greek layout the K position reports something else entirely, the
    // handler returned before preventDefault(), and Chrome's omnibox took the keystroke —
    // "browser search instead of app search". Only `e.code` is layout-independent.
    const e = pressCtrlK({ key: 'ن' });
    assert.equal(e.defaultPrevented, true, 'the browser must never get this keystroke');
    assert.equal(tabsRenders, 1, 'and it must still open the Tabs finder');
  });

  test('⌘K in a window that HAS a search box focuses it instead of jumping to Tabs (#1162)', async () => {
    pressCtrlK(); // opens Tabs; its window is now the one on top
    assert.equal(tabsRenders, 1);
    await settle(20); // dialog.ts marks a window `is-open` a frame after open()

    const e = pressCtrlK();
    assert.equal(e.defaultPrevented, true);
    assert.equal(doc.activeElement, doc.querySelector(`[data-search="${TABS_APP}"]`), 'search where you are');
    assert.equal(tabsRenders, 1, 'the window it is already in must not be torn down and re-rendered');
  });

  test('⌘K falls back to the home search bar rather than the browser when Tabs is gone (#1162)', async () => {
    // The second way the bug reproduced: the handler returned early — again with no
    // preventDefault() — for an uninstalled Tabs, deliberately handing the key to Chrome.
    await store.set({ installedAppsByUser: { [store.workspaceId()]: [DEFAULT_APP] } } as never);
    await settle(10);

    const e = pressCtrlK();
    assert.equal(e.defaultPrevented, true, 'the key is ours in EVERY branch');
    assert.equal(tabsRenders, 0, 'an uninstalled app must not open');
    assert.equal(doc.activeElement, doc.querySelector('#search input'), 'the only search box left');
  });

  test('⌘K does not over-claim: a bare K, or one with a modifier we do not use, is the page’s', async () => {
    // Shift is deliberately NOT in this list any more. `views/appSwitcher.ts` now binds
    // ⌘/Ctrl+Shift+K to open the switcher, so that combo is legitimately ours — asserting it stays
    // the page's would be asserting against a feature this branch adds on purpose. What the test
    // still pins is the thing it was written for (#1162): the ⌘K handler itself must not widen, so
    // a bare K and an Alt combo stay the page's.
    for (const init of [{ ctrl: false }, { alt: true }]) {
      const e = pressCtrlK(init);
      assert.equal(e.defaultPrevented, false, `${JSON.stringify(init)} is not our shortcut`);
    }
    assert.equal(tabsRenders, 0);
  });
});
