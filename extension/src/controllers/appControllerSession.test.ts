// A page that does NOT own the session must never write to it (#1172).
//
// This is the one failure mode in the whole feature that destroys user state rather than merely
// failing to restore it, and it is not hypothetical: the flush-on-leave fix introduced it. The
// listeners go live before the claim comes back, and the claim is a round-trip to a service worker
// that may be asleep. A tab opened in the background and hidden during that gap would flush its own
// empty window map straight over the real page's session — the feature erasing exactly what it
// exists to keep.
//
// So: drive the real controller as a SECONDARY page, hide it, and assert the session survives.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome, type SwMessage } from '../test/domEnv.js';
import { PRESENCE_CLAIM, PRESENCE_FOCUS } from '../lib/presenceShared.js';

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

const APP = 'calculator';

let env: DomEnv;
let fake: FakeChrome;
let doc: Document;
let store: typeof import('../models/store.js').store;
let session: typeof import('../lib/appSession.js');

// startApp() starts a clock and polls the session; those intervals would keep Node alive past the
// test, so they are tracked and cleared. (Same reason as appController.test.ts.)
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
  intervals.forEach(clearInterval);
  intervals.length = 0;
  (globalThis as { setInterval: unknown }).setInterval = realSetInterval;
}

const stubApp = (id: string, name: string) => ({
  id,
  name,
  accent: '#888888',
  order: 1,
  description: name,
  tools: [],
  render: (body: HTMLElement) => {
    body.append(doc.createElement('div'));
    return () => {};
  },
});

/** Boot the real page, with the worker answering a presence claim however the test wants. */
type Responder = (msg: SwMessage) => unknown;

async function boot(
  claimReply: { primary: boolean; holderTabId?: number } | Promise<unknown> | Responder,
): Promise<void> {
  env = installDom();
  doc = env.document;
  trackIntervals();
  for (const id of IDS) {
    const node = doc.createElement('div');
    node.id = id;
    doc.body.append(node);
  }
  const respond: Responder =
    typeof claimReply === 'function'
      ? (claimReply as Responder)
      : (msg: SwMessage) => (msg?.type === PRESENCE_CLAIM ? claimReply : { stored: true });
  fake = installChrome({}, respond);

  const stub = await import('../apps/index.js');
  (stub as unknown as { __setApps: (l: unknown[]) => void }).__setApps([stubApp(APP, 'Calculator')]);

  ({ store } = await import('../models/store.js'));
  await store.set({ onboarded: true, installedApps: [APP], homeWidgets: {} } as never);
  session = await import('../lib/appSession.js');
}

/** What the browser fires as a tab goes to the background. */
function hidePage(): void {
  Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
  doc.dispatchEvent(new Event('visibilitychange'));
}

describe('only the page that owns the session may write to it', () => {
  afterEach(() => {
    clearTrackedIntervals();
    fake.cleanup();
    env.cleanup();
  });

  // THE regression, and it lives in a narrow window. Once a page has been REFUSED, `releasing` (set
  // by releaseAll) already stops it writing. The unprotected moment is earlier: the leave-listeners
  // go live before the claim comes back, so between "asked" and "learned it lost" the page has an
  // empty window map, `releasing` still false, and nothing but the `owns` gate standing between it
  // and overwriting the real page's session.
  //
  // So the claim is held in flight while the page is hidden. Awaiting startApp first would make
  // this test pass with the gate deleted — it did, which is the only reason the gate got a test at
  // all rather than a comment claiming it was covered.
  test('a page hidden while still asking for the apps does not erase the real session', async () => {
    let answerClaim!: (r: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      answerClaim = resolve;
    });
    await boot(pending as never);
    const { startApp } = await import('./appController.js');

    // The session the OTHER page owns, already on disk.
    await session.setWindows([{ appId: APP, minimized: true, maximized: false }]);

    const booting = startApp(); // do NOT await: the claim is deliberately left unanswered
    await settle(30); // long enough for governSession to register its leave-listeners

    hidePage(); // the tab goes to the background while its role is still unknown
    await settle(20);

    answerClaim({ primary: false, holderTabId: 7 }); // only now does it learn it lost
    await booting;
    await settle(30);

    assert.deepEqual(
      (await session.getWindows()).map((w) => w.appId),
      [APP],
      "a page that does not yet own the apps must not erase the owner's windows",
    );
  });

  test('a page already refused does not write either', async () => {
    await boot({ primary: false, holderTabId: 7 });
    const { startApp } = await import('./appController.js');
    await session.setWindows([{ appId: APP, minimized: true, maximized: false }]);

    await startApp();
    await settle(30);
    hidePage();
    await settle(30);

    assert.deepEqual(
      (await session.getWindows()).map((w) => w.appId),
      [APP],
    );
  });

  test('and it shows the choice instead of running the apps', async () => {
    await boot({ primary: false, holderTabId: 7 });
    const { startApp } = await import('./appController.js');
    await startApp();
    await settle(30);

    assert.ok(doc.querySelector('.secondary-overlay'), 'the second page offers to switch or take over');
  });

  // A stale takeover must not replay onto a page that has since become primary.
  //
  // "Switch to it" against a dead tab resolves whenever the worker gets round to it — which can be
  // AFTER the user has already taken over by the other button. Replaying it re-runs restoreSession
  // on a live desktop: windows re-placed under the user, and anything they touched in between
  // clobbered by the stale copy read back from storage. An in-flight guard alone does not catch
  // this, because by then nothing is in flight.
  test('a late Switch-to-it on a dead tab does not re-run the takeover it lost to', async () => {
    let answerFocus!: (r: unknown) => void;
    const focusPending = new Promise<unknown>((resolve) => {
      answerFocus = resolve;
    });
    await boot((msg: SwMessage) => {
      if (msg?.type === PRESENCE_FOCUS) return focusPending; // held: the holder's tab is gone
      if (msg?.type === PRESENCE_CLAIM) return msg.force ? { primary: true } : { primary: false, holderTabId: 7 };
      return { stored: true };
    });
    const { startApp } = await import('./appController.js');
    await startApp();
    await settle(30);

    const buttons = [...doc.querySelectorAll<HTMLElement>('.secondary-actions button')];
    buttons[0].click(); // Switch to it — its answer is held
    await settle(10);
    buttons[1].click(); // Use here instead — wins, this page becomes primary
    await settle(40);
    assert.equal(doc.querySelector('.secondary-overlay'), null, 'precondition: the takeover succeeded');

    const restoresAfterTakeover = fake.messages.filter(
      (m) => (m as SwMessage)?.type === PRESENCE_CLAIM && (m as SwMessage)?.force,
    ).length;

    answerFocus({ ok: false }); // the dead tab finally answers, long after the takeover
    await settle(40);

    assert.equal(
      fake.messages.filter((m) => (m as SwMessage)?.type === PRESENCE_CLAIM && (m as SwMessage)?.force).length,
      restoresAfterTakeover,
      'the late answer must not start a second takeover on a page that already owns the apps',
    );
    assert.equal(doc.querySelector('.secondary-overlay'), null, 'and must not blank the page');
  });

  // The other direction: the owner must still flush, or the fix would have cured the bug by
  // disabling the feature.
  test('the page that DOES own the apps still writes on the way out', async () => {
    await boot({ primary: true });
    const { startApp } = await import('./appController.js');
    await startApp();
    await settle(30);

    assert.equal(doc.querySelector('.secondary-overlay'), null, 'precondition: this page owns the apps');

    // Open an app and hide the page well inside the 200ms persist debounce.
    doc.querySelector<HTMLElement>('.dock-app')?.click();
    await settle(10);
    hidePage();
    await settle(30);

    assert.deepEqual(
      (await session.getWindows()).map((w) => w.appId),
      [APP],
      'the owner leaving must not lose the change that was still pending',
    );
  });
});
