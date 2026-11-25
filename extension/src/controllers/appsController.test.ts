// An open app window follows the INSTALL state, and nothing else.
//
// There is no plan, tier, entitlement or account. So the
// two things pinned here are that no app is ever replaced by a wall, and that
// an uninstall still closes the window and stops the app (its cleanup runs, not just a hide).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

// REAL ids, so the install model sees the apps we actually ship.
const OPT_IN_APP = 'denoise';
const DEFAULT_APP = 'calculator';

let env: DomEnv;
let fake: FakeChrome;
let doc: Document;
let store: typeof import('../models/store.js').store;
let createAppsController: typeof import('./appsController.js').createAppsController;

/** How many times each app was rendered, and torn down. */
let renders: Record<string, number>;
let cleanups: Record<string, number>;

const spyApp = (id: string, name: string) => ({
  id,
  name,
  accent: '#888888',
  order: 1,
  description: name,
  tools: [],
  render: (body: HTMLElement) => {
    renders[id] = (renders[id] ?? 0) + 1;
    const marker = doc.createElement('div');
    marker.dataset.app = id;
    body.append(marker);
    return () => {
      cleanups[id] = (cleanups[id] ?? 0) + 1;
    };
  },
});

/** Is the app itself in the window? */
const appIsLive = (id: string): boolean => !!doc.querySelector(`[data-app="${id}"]`);

describe('an open window follows the install state', () => {
  let ctrl: ReturnType<typeof createAppsController>;

  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    fake = installChrome();
    renders = {};
    cleanups = {};

    const stub = await import('../apps/index.js');
    (stub as unknown as { __setApps: (l: unknown[]) => void }).__setApps([
      spyApp(OPT_IN_APP, 'Denoise'),
      spyApp(DEFAULT_APP, 'Calculator'),
    ]);

    ({ store } = await import('../models/store.js'));
    await store.set({ onboarded: true, installedApps: [OPT_IN_APP, DEFAULT_APP] } as never);

    ({ createAppsController } = await import('./appsController.js'));
    const dockEl = doc.createElement('div');
    doc.body.append(dockEl);
    ctrl = createAppsController({ dockEl: dockEl as unknown as HTMLElement });
    await settle(10);
  });

  afterEach(() => {
    fake.cleanup();
    env.cleanup();
  });

  test('nothing is ever locked: every app renders', async () => {
    for (const id of [OPT_IN_APP, DEFAULT_APP]) {
      ctrl.openById(id);
      await settle(10);
      assert.ok(appIsLive(id), `${id} renders`);
    }
  });

  test('refresh() is idempotent — it does not churn a healthy window', async () => {
    // refresh() also runs on every install/uninstall. Tearing an app down and rebuilding it each
    // time would lose the user's in-app state for no reason.
    ctrl.openById(OPT_IN_APP);
    await settle(10);
    ctrl.refresh();
    ctrl.refresh();
    ctrl.refresh();
    assert.equal(renders[OPT_IN_APP], 1, 'still rendered exactly once');
    assert.equal(cleanups[OPT_IN_APP] ?? 0, 0, 'and never torn down');
  });

  test('an uninstall closes the window and stops the app', async () => {
    // Closing hides the window; it does not empty it. So the honest assertion is that the app was
    // TORN DOWN by the close.
    ctrl.openById(OPT_IN_APP);
    await settle(10);
    assert.equal(cleanups[OPT_IN_APP] ?? 0, 0);

    await store.set({ installedApps: [DEFAULT_APP] } as never);
    ctrl.refresh();
    await settle(300); // the close animation

    assert.equal(cleanups[OPT_IN_APP], 1, 'uninstalling must close the window, and stop the app');
  });
});

// A maximized window has to be FILLED by the app in it. The shared stylesheet used to do
// that off a hand-written list of app layout class names, and KimtFS was never on it — so
// maximizing it left the explorer at its own height with dead space under it (#651). The
// root is now derived from the DOM, which is only safe while an app mounts exactly one.
describe('the app root is tagged for the maximize/full-screen rule (#651)', () => {
  let env: DomEnv;
  let markAppRoot: typeof import('./appsController.js').markAppRoot;

  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    fake = installChrome();
    ({ markAppRoot } = await import('./appsController.js'));
  });
  afterEach(() => {
    fake.cleanup();
    env.cleanup();
  });

  const bodyWith = (n: number): HTMLElement => {
    const body = doc.createElement('div');
    for (let i = 0; i < n; i++) body.append(doc.createElement('div'));
    return body as unknown as HTMLElement;
  };

  test('the one element an app renders is tagged, whatever it is called', () => {
    const body = bodyWith(1);
    markAppRoot(body);
    assert.equal(body.children[0].className, 'app-root', 'no per-app entry, anywhere');
  });

  test('nothing is tagged when an app leaves several siblings behind', () => {
    // Tagging them all would give each `flex: 1` and split the height between them, which is
    // worse than the window they have today.
    const body = bodyWith(3);
    markAppRoot(body);
    assert.equal(
      Array.from(body.children).filter((c) => c.classList.contains('app-root')).length,
      0,
      'an ambiguous body is left exactly as it was',
    );
  });

  test('the real controller tags the app it just rendered', async () => {
    const dockEl = doc.createElement('div');
    doc.body.append(dockEl);
    const stub = await import('../apps/index.js');
    (stub as unknown as { __setApps: (l: unknown[]) => void }).__setApps([spyApp(DEFAULT_APP, 'Calculator')]);
    ({ store } = await import('../models/store.js'));
    await store.set({ onboarded: true, installedApps: [DEFAULT_APP] } as never);
    const ctrl = createAppsController({ dockEl: dockEl as unknown as HTMLElement });
    await settle(10);

    ctrl.openById(DEFAULT_APP);
    await settle(10);
    const root = doc.querySelector(`[data-app="${DEFAULT_APP}"]`);
    assert.ok(root?.classList.contains('app-root'), 'the element the app rendered carries the tag');
  });

  test('an app that mounts TWO roots is reported, not silently left unstretched', async () => {
    // Replacing a hand-maintained list with a derived one is only an improvement while the
    // derivation cannot fail quietly. An app that starts mounting two roots gets no tag —
    // that part is deliberate — but it must not simply stop filling a maximized window with
    // nothing anywhere to say why. That would be the same silent drift in a new costume.
    const twoRoots = {
      ...spyApp(DEFAULT_APP, 'Calculator'),
      render: (body: HTMLElement) => {
        body.append(doc.createElement('div'), doc.createElement('div'));
      },
    };
    const stub = await import('../apps/index.js');
    (stub as unknown as { __setApps: (l: unknown[]) => void }).__setApps([twoRoots]);
    ({ store } = await import('../models/store.js'));
    await store.set({ onboarded: true, installedApps: [DEFAULT_APP] } as never);

    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
    try {
      const dockEl = doc.createElement('div');
      doc.body.append(dockEl);
      const ctrl = createAppsController({ dockEl: dockEl as unknown as HTMLElement });
      await settle(10);
      ctrl.openById(DEFAULT_APP);
      await settle(10);
    } finally {
      console.warn = realWarn;
    }

    assert.ok(
      warnings.some((w) => w.includes(DEFAULT_APP) && w.includes('ONE root')),
      'the app is named, and told what the rule is',
    );
  });
});
