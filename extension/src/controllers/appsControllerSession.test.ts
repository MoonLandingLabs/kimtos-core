// Minimize and close were already different in memory; what they were not was different after a
// reload, because nothing was written down (#1172). These tests drive the real controller through
// the two verbs and then through a fresh controller — the closest a unit test gets to "reload the
// tab" — and assert the difference survives.
//
// The assertion that matters for close is not "the window is gone". It is that the app's SESSION
// is gone: a close that left the state behind would silently resume it on the next open, which is
// the opposite of what closing an app means.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

// REAL ids, so the install model sees the apps we actually ship.
const A = 'calculator';
const B = 'tasks';

let env: DomEnv;
let fake: FakeChrome;
let doc: Document;
let store: typeof import('../models/store.js').store;
let createAppsController: typeof import('./appsController.js').createAppsController;
let session: typeof import('../lib/appSession.js');

let renders: Record<string, number>;
let seen: Record<string, unknown>;

/** An app that reads its session on render and writes one when asked. */
const spyApp = (id: string, name: string) => ({
  id,
  name,
  accent: '#888888',
  order: 1,
  description: name,
  tools: [],
  render: (body: HTMLElement, ctx: { session: unknown; saveSession: (s: unknown) => void }) => {
    renders[id] = (renders[id] ?? 0) + 1;
    seen[id] = ctx.session;
    const marker = doc.createElement('div');
    marker.dataset.app = id;
    body.append(marker);
    (marker as unknown as { save: (s: unknown) => void }).save = ctx.saveSession;
    return () => {};
  },
});

/** Long enough for the window's 160ms fade AND the 200ms persist debounce behind it. Anything
 *  shorter reads the session before it has been written and asserts against the previous state. */
const flush = (): Promise<void> => settle(500);

const saveFrom = (id: string, state: unknown): void => {
  const marker = doc.querySelector(`[data-app="${id}"]`) as unknown as { save: (s: unknown) => void };
  marker.save(state);
};

/** Every announcement the controller made that the running set changed. */
let changes: number;

async function newController() {
  const dockEl = doc.createElement('div');
  doc.body.append(dockEl);
  const ctrl = createAppsController({
    dockEl: dockEl as unknown as HTMLElement,
    onWindowsChange: () => changes++,
  });
  await settle(10);
  return ctrl;
}

describe('the session survives a reload, and close is what ends it', () => {
  let ctrl: Awaited<ReturnType<typeof newController>>;

  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    fake = installChrome();
    renders = {};
    seen = {};
    changes = 0;

    const stub = await import('../apps/index.js');
    (stub as unknown as { __setApps: (l: unknown[]) => void }).__setApps([spyApp(A, 'Calculator'), spyApp(B, 'Tasks')]);

    ({ store } = await import('../models/store.js'));
    await store.set({ onboarded: true, installedApps: [A, B] } as never);

    session = await import('../lib/appSession.js');
    ({ createAppsController } = await import('./appsController.js'));
    ctrl = await newController();
  });

  afterEach(() => {
    fake.cleanup();
    env.cleanup();
  });

  // The switcher's count is driven by this. It used to fire only on the way OUT (close/minimize),
  // so opening an app left the switcher button hidden while apps were running — the exact state it
  // exists to make visible.
  test('OPENING an app announces that the running set changed', async () => {
    changes = 0;

    ctrl.openById(A);
    await settle(10);

    assert.ok(changes > 0, 'an app opening must reach the shell, not only an app closing');
  });

  test('minimizing and closing announce it too', async () => {
    ctrl.openById(A);
    await settle(10);

    changes = 0;
    doc.querySelector<HTMLElement>('.window-min')?.click();
    await flush();
    assert.ok(changes > 0, 'minimize');

    changes = 0;
    ctrl.openById(A);
    await settle(10);
    doc.querySelector<HTMLElement>('.window-close')?.click();
    await flush();
    assert.ok(changes > 0, 'close');
  });

  // The debounce is a 200ms window in which the page can go away with the change still sitting in a
  // timer that will never fire. Open an app and reload at once, and the very app you opened is the
  // one dropped — from the feature whose whole purpose is surviving a reload.
  test('flushWindows writes immediately, without waiting out the debounce', async () => {
    ctrl.openById(A);
    await settle(10); // well inside the 200ms debounce
    assert.deepEqual(await session.getWindows(), [], 'precondition: the debounced write has not landed');

    ctrl.flushWindows();
    await settle(10);

    assert.deepEqual(
      (await session.getWindows()).map((w) => w.appId),
      [A],
      'leaving the page must not lose the change that was still pending',
    );
  });

  test('an open app is written into the session', async () => {
    ctrl.openById(A);
    await flush(); // the write is debounced

    const windows = await session.getWindows();
    assert.deepEqual(
      windows.map((w) => w.appId),
      [A],
    );
    assert.equal(windows[0].minimized, false);
  });

  test('minimizing keeps the app in the session, marked minimized', async () => {
    ctrl.openById(A);
    await settle(10);
    saveFrom(A, { where: 'page-2' });

    doc.querySelector<HTMLElement>('.window-min')?.click();
    await flush();

    const [w] = await session.getWindows();
    assert.equal(w.minimized, true, 'a minimized app is still running, so it stays in the session');
    assert.deepEqual(await session.getAppSession(A), { where: 'page-2' });
  });

  test('closing drops it from the session AND forgets its state', async () => {
    ctrl.openById(A);
    await settle(10);
    saveFrom(A, { where: 'page-2' });
    await settle(50);
    assert.deepEqual(await session.getAppSession(A), { where: 'page-2' }, 'precondition: state was saved');

    doc.querySelector<HTMLElement>('.window-close')?.click();
    await flush();

    assert.deepEqual(await session.getWindows(), [], 'a closed app is not restored');
    assert.equal(await session.getAppSession(A), null, 'and its state must not survive to the next open');
  });

  // The point of the whole feature: a new controller over the same session is what a reload IS.
  test('a fresh page restores a minimized app, mounted but not shown, with its state', async () => {
    ctrl.openById(A);
    await settle(10);
    saveFrom(A, { where: 'page-2' });
    doc.querySelector<HTMLElement>('.window-min')?.click();
    await flush();

    renders = {};
    seen = {};
    const next = await newController();
    await next.restoreSession();
    await settle(10);

    assert.equal(renders[A], 1, 'the app is mounted again');
    assert.deepEqual(seen[A], { where: 'page-2' }, 'and handed back exactly where the user was');
    assert.equal(next.runningApps().length, 1);
    assert.equal(next.runningApps()[0].minimized, true, 'it comes back minimized, not flashed open');
  });

  test('a fresh page after a close restores nothing, and the app opens clean', async () => {
    ctrl.openById(A);
    await settle(10);
    saveFrom(A, { where: 'page-2' });
    doc.querySelector<HTMLElement>('.window-close')?.click();
    await flush();

    renders = {};
    seen = {};
    const next = await newController();
    await next.restoreSession();
    await settle(10);

    assert.equal(renders[A] ?? 0, 0, 'nothing is restored');

    next.openById(A);
    await settle(10);
    assert.equal(seen[A], null, 'and opening it again starts on its initial page');
  });

  test('an app uninstalled between the two loads is skipped, not restored', async () => {
    ctrl.openById(A);
    ctrl.openById(B);
    await flush();

    await store.set({ installedApps: [B] } as never);
    renders = {};
    const next = await newController();
    await next.restoreSession();
    await flush();

    assert.equal(renders[A] ?? 0, 0, 'the uninstalled app has nothing to render');
    assert.equal(renders[B], 1);
    assert.deepEqual(
      (await session.getWindows()).map((w) => w.appId),
      [B],
      'and the stale entry is written out of the session rather than skipped forever',
    );
  });

  // Another page took over. Every app here must be STOPPED — that is what actually silences a clip
  // playing in a tab the user walked away from.
  test('releaseAll tears down every window, shown or minimized', async () => {
    const teardowns: string[] = [];
    // Mounts a root like a real app, so `markAppRoot` has its one element and the run stays quiet.
    const tracked = (id: string, name: string) => ({
      ...spyApp(id, name),
      render: (body: HTMLElement) => {
        body.append(doc.createElement('div'));
        return () => teardowns.push(id);
      },
    });
    const stub = await import('../apps/index.js');
    (stub as unknown as { __setApps: (l: unknown[]) => void }).__setApps([
      tracked(A, 'Calculator'),
      tracked(B, 'Tasks'),
    ]);
    const owner = await newController();
    owner.openById(A);
    owner.openById(B);
    await settle(10);
    doc.querySelectorAll<HTMLElement>('.window-min')[1]?.click(); // minimize one of them
    await flush();

    owner.releaseAll();
    await flush();

    assert.deepEqual(teardowns.sort(), [A, B], 'both the shown and the minimized app are stopped');
    assert.equal(owner.runningApps().length, 0);
  });
});
