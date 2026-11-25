// The switcher exists so that nothing can be running where the user cannot see or stop it (#1172).
// So the tests are about COVERAGE of that claim: a minimized app appears, and — the case a plain
// window list would miss entirely — so does an app whose window is gone but whose work is not.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

let env: DomEnv;
let fake: FakeChrome;
let doc: Document;
let createAppSwitcher: typeof import('./appSwitcher.js').createAppSwitcher;
let beginJob: typeof import('../lib/jobStore.js').beginJob;
let km: typeof import('../lib/kimtManager.js');
let endJob: typeof import('../lib/jobStore.js').endJob;

const APPS = [
  { id: 'denoise', name: 'Denoise', accent: '#888888', minimized: false },
  { id: 'notes', name: 'Notes', accent: '#888888', minimized: false },
];

const names = (): string[] => [...doc.querySelectorAll('.switcher-name')].map((n) => n.textContent ?? '');
const states = (): string[] => [...doc.querySelectorAll('.switcher-state')].map((n) => n.textContent ?? '');

describe('what the switcher lists', () => {
  let running: { id: string; name: string; accent?: string; minimized: boolean }[];

  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    fake = installChrome();
    running = [];
    // The button the view binds itself to; index.html ships it, so the test has to as well.
    const btn = doc.createElement('button');
    btn.id = 'switcher-btn';
    doc.body.append(btn);

    ({ createAppSwitcher } = await import('./appSwitcher.js'));
    ({ beginJob, endJob } = await import('../lib/jobStore.js'));
    km = await import('../lib/kimtManager.js');
  });

  // The job store is real and outlives a DOM teardown, so a job left behind would turn up in the
  // next test's panel — which is how the first draft of these tests lied to itself.
  afterEach(async () => {
    for (const app of APPS) await endJob(app.id);
    fake.cleanup();
    env.cleanup();
  });

  const mount = () =>
    createAppSwitcher({
      running: () => running,
      known: () => APPS,
      onPick: () => {},
      onStop: () => {},
    });

  test('an open app and a minimized one are both listed, and say which they are', async () => {
    running = [
      { ...APPS[0], minimized: true },
      { ...APPS[1], minimized: false },
    ];
    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.deepEqual(names(), ['Denoise', 'Notes']);
    assert.deepEqual(states(), ['Minimized', 'Open']);
  });

  // THE case a window list would miss. The job outlived its page, so there is no window to list —
  // and it is exactly the thing the user has no other way to find.
  test('an app with no window but a running job is still listed', async () => {
    await beginJob('denoise', { kind: 'denoise', name: 'meeting.webm' }, new Blob(['x']));
    running = []; // no windows at all

    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.deepEqual(names(), ['Denoise']);
    assert.deepEqual(states(), ['Unfinished: meeting.webm']);
  });

  test('a working app is reported as working, not merely as open', async () => {
    await beginJob('denoise', { kind: 'denoise', name: 'meeting.webm' }, new Blob(['x']));
    running = [{ ...APPS[0], minimized: true }];

    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.deepEqual(states(), ['Unfinished: meeting.webm'], 'the work is the more urgent fact');
    assert.equal(doc.querySelectorAll('.switcher-state.is-working').length, 1);
  });

  test('an app is listed once, even with both a window and a job', async () => {
    await beginJob('denoise', { kind: 'denoise', name: 'meeting.webm' }, new Blob(['x']));
    running = [{ ...APPS[0], minimized: false }];

    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.equal(names().length, 1);
  });

  test('nothing running says so, rather than showing an empty panel', async () => {
    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.equal(names().length, 0);
    assert.match(doc.querySelector('.switcher-empty')?.textContent ?? '', /Nothing is running/);
  });
});

describe('using the switcher', () => {
  let running: { id: string; name: string; accent?: string; minimized: boolean }[];
  let picked: string[];
  let stopped: string[];

  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    fake = installChrome();
    running = [{ ...APPS[0], minimized: true }];
    picked = [];
    stopped = [];
    const btn = doc.createElement('button');
    btn.id = 'switcher-btn';
    doc.body.append(btn);
    ({ createAppSwitcher } = await import('./appSwitcher.js'));
    km = await import('../lib/kimtManager.js');
  });

  afterEach(() => {
    km.__reset();
    fake.cleanup();
    env.cleanup();
  });

  const mount = () =>
    createAppSwitcher({
      running: () => running,
      known: () => APPS,
      onPick: (id) => picked.push(id),
      onStop: (task) => void stopped.push(task.appId),
    });

  test('picking a tile brings the app up and closes the panel', async () => {
    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    doc.querySelector<HTMLElement>('.switcher-pick')?.click();

    assert.deepEqual(picked, ['denoise']);
    assert.equal(doc.querySelector<HTMLElement>('.switcher-overlay')?.hidden, true);
  });

  // The direct answer to a clip you can hear but cannot find.
  test('Stop stops the app', async () => {
    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    doc.querySelector<HTMLElement>('.switcher-stop')?.click();

    assert.deepEqual(stopped, ['denoise']);
  });

  // #1212, first half. `onStop` used to take an app id and was wired to "close the window", so a
  // task backed by a REGISTERED JOB had its window closed and its work left running while the
  // button said Stop. The task is handed over whole and UNCHANGED, because its `kind` is the whole
  // routing decision — a job that arrives looking like a window gets stopped the wrong way.
  test('Stop hands over the task unchanged, so a job is not mistaken for a window', async () => {
    const gate = new Promise<void>(() => {});
    km.start({ appId: 'denoise', title: 'Working', kind: 'compute', run: () => gate });
    await settle(0);

    let handed: import('../lib/kimtManager.js').RunningTask | null = null;
    const switcher = createAppSwitcher({
      running: () => [],
      known: () => APPS,
      onPick: () => {},
      onStop: (task) => {
        handed = task as import('../lib/kimtManager.js').RunningTask;
      },
    });
    switcher.open();
    await switcher.refresh();

    doc.querySelector<HTMLElement>('.switcher-stop')?.click();

    const got = handed as import('../lib/kimtManager.js').RunningTask | null;
    assert.ok(got, 'the view must pass the task, so the caller can route the stop');
    assert.equal(got!.appId, 'denoise');
    assert.notEqual(got!.kind, 'window', 'a registered job must not reach the caller looking like a window');
    assert.ok(got!.jobId, 'and it must carry the job id, which is what the orchestrator cancels by');
    switcher.destroy();
  });

  test('the button hides when nothing is running, and shows a count when something is', async () => {
    const count = doc.createElement('span');
    count.id = 'switcher-count';
    doc.body.append(count);

    const switcher = mount();
    await switcher.refresh();
    assert.equal(doc.getElementById('switcher-btn')?.hidden, false);
    assert.equal(count.textContent, '1');

    running = [];
    await switcher.refresh();
    assert.equal(doc.getElementById('switcher-btn')?.hidden, true, 'no reason to offer a panel with nothing in it');
  });

  test('Escape closes it', async () => {
    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    assert.equal(doc.querySelector<HTMLElement>('.switcher-overlay')?.hidden, true);
  });

  test('destroy unbinds the keystroke and removes the panel', async () => {
    const switcher = mount();
    switcher.destroy();

    doc.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', shiftKey: true, metaKey: true }));
    await settle(40);

    assert.equal(doc.querySelector('.switcher-overlay'), null);
  });
});

// #1212, second half, and the Stop all it makes safe to add (#1213).
describe('what the switcher offers to stop', () => {
  let running: { id: string; name: string; accent?: string; minimized: boolean }[];

  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    fake = installChrome();
    running = [];
    const btn = doc.createElement('button');
    btn.id = 'switcher-btn';
    doc.body.append(btn);
    ({ createAppSwitcher } = await import('./appSwitcher.js'));
    km = await import('../lib/kimtManager.js');
  });

  afterEach(() => {
    km.__reset();
    fake.cleanup();
    env.cleanup();
  });

  const mount = () =>
    createAppSwitcher({ running: () => running, known: () => APPS, onPick: () => {}, onStop: () => {} });

  // An uninstall declares `cancellable: false`. The switcher rendered a Stop for it anyway, which
  // called a cancel that returned immediately — a button that lies. The KimtManager window has
  // always guarded this; this is the switcher catching up.
  test('work that cannot be interrupted gets no Stop at all', async () => {
    const gate = new Promise<void>(() => {}); // never settles; the job stays running
    km.start({ appId: 'denoise', title: 'Uninstalling', kind: 'uninstall', cancellable: false, run: () => gate });
    await settle(0);

    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.equal(doc.querySelectorAll('.switcher-name').length, 1, 'it is listed');
    assert.equal(doc.querySelectorAll('.switcher-stop').length, 0, 'but offers no button that could not work');
    switcher.destroy();
  });

  // A FAILED tile is the other case with no live job behind it. It used to render a Stop that
  // called a cancel which returned immediately — the same lie, one state over (#1216).
  test('a failed tile offers Retry and Dismiss, and no Stop', async () => {
    km.start({
      appId: 'denoise',
      title: 'Downloading',
      kind: 'download',
      run: async () => {
        throw new Error('offline');
      },
    });
    await settle(5);

    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    const labels = [...doc.querySelectorAll('.task-act')].map((b) => b.textContent);
    assert.deepEqual(labels, ['Retry', 'Dismiss']);
    assert.equal(doc.querySelectorAll('.switcher-stop').length, 0, 'no button that could not work');
    switcher.destroy();
  });

  test('Dismiss clears the failure and the tile goes', async () => {
    km.start({
      appId: 'denoise',
      title: 'Downloading',
      kind: 'download',
      run: async () => {
        throw new Error('offline');
      },
    });
    await settle(5);

    const switcher = mount();
    switcher.open();
    await switcher.refresh();
    assert.equal(doc.querySelectorAll('.switcher-name').length, 1);

    [...doc.querySelectorAll<HTMLElement>('.task-act')].find((b) => b.textContent === 'Dismiss')?.click();
    // The click's own refresh awaits an IndexedDB read, so a fixed sleep is a bet on how loaded
    // the machine is — which is exactly how this test went red on CI and never locally. Await a
    // refresh instead; the generation guard makes the in-flight one harmless if it lands after.
    await switcher.refresh();

    assert.equal(doc.querySelectorAll('.switcher-name').length, 0, 'the failure was the only thing listed');
    switcher.destroy();
  });

  test('a RUNNING job still gets a Stop, not the failed controls', async () => {
    const gate = new Promise<void>(() => {});
    km.start({ appId: 'denoise', title: 'Downloading', kind: 'download', run: () => gate });
    await settle(0);

    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.equal(doc.querySelectorAll('.switcher-stop').length, 1);
    assert.equal(doc.querySelectorAll('.task-act').length, 0);
    switcher.destroy();
  });

  test('and no Stop all either, when that is everything there is', async () => {
    const gate = new Promise<void>(() => {});
    km.start({ appId: 'denoise', title: 'Uninstalling', kind: 'uninstall', cancellable: false, run: () => gate });
    await settle(0);

    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.equal(doc.querySelectorAll('.switcher-killall').length, 0, 'hidden, not present and inert');
    switcher.destroy();
  });

  test('Stop all appears as soon as one thing can be stopped', async () => {
    running = [{ ...APPS[1], minimized: false }];

    const switcher = mount();
    switcher.open();
    await switcher.refresh();

    assert.equal(doc.querySelectorAll('.switcher-killall').length, 1);
    switcher.destroy();
  });
});
