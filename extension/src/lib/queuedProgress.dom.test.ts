// What the run screen says while it is NOT running yet.
//
// KimtManager runs one job per app, so pressing the app's button while that app is downloading
// its model queues the run behind the download. The screen went up regardless — an indeterminate
// bar labelled "Preparing…" under a heading claiming the work was under way — and stayed that way
// for the length of a 280 MB transfer. That is indistinguishable from a hang, and the natural
// response to a hang is to close the window, which is the one thing that makes it worse (#1306).
//
// The label is pinned here rather than left to a screenshot because it is the entire fix: what
// the user is told during the wait.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';

describe('the run screen while the run is queued', () => {
  let env: DomEnv;
  let queuedLabel: (blocker: { kind: string } | null) => string;

  before(async () => {
    // Installed first: the module reaches the orchestrator, which reads the document as it loads.
    env = installDom();
    ({ queuedLabel } = await import('./queuedProgress.js'));
  });
  after(() => env.cleanup());

  test('a model download is named, because that is what the user is actually waiting for', () => {
    assert.match(queuedLabel({ kind: 'download' }), /model download/i);
  });

  test('an uninstall is named as itself, not as a download', () => {
    const label = queuedLabel({ kind: 'uninstall' });
    assert.match(label, /uninstall/i);
    assert.doesNotMatch(label, /download/i, 'saying "download" here would be a guess, and a wrong one');
  });

  test('any other job is still reported as a wait, not as work', () => {
    assert.match(queuedLabel({ kind: 'compute' }), /^Waiting/);
  });

  test('a queue with nothing identifiable in front still says it has not started', () => {
    // `blockerFor` returns null when the job is held by a full lane rather than by this app's own
    // work. There is nothing honest to name, but "waiting" is still true and "Preparing…" is not.
    assert.match(queuedLabel(null), /^Waiting/);
  });

  test('every case reads as waiting — none of them claims the work is happening', () => {
    for (const kind of ['download', 'uninstall', 'compute', 'export']) {
      const label = queuedLabel({ kind });
      assert.match(label, /^Waiting/, `${kind}: a queued run must not describe itself as working`);
      assert.doesNotMatch(label, /^Preparing/, `${kind}: "Preparing…" is the string this fix exists to remove`);
    }
  });
});

describe('followQueue drives the bar until the run starts', () => {
  let env: DomEnv;

  before(() => {
    env = installDom();
  });
  after(() => env.cleanup());

  const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

  test('it reports the wait, borrows the blocker progress, and hands over when the run starts', async () => {
    const { followQueue } = await import('./queuedProgress.js');
    const km = await import('./kimtManager.js');
    km.__reset();

    const shown: { label?: string; ratio?: number | null }[] = [];
    const bar = { update: (p: { label?: string; ratio?: number | null }) => shown.push(p) };

    let releaseDownload = (): void => {};
    const download = new Promise<void>((r) => {
      releaseDownload = r;
    });
    km.start({
      appId: 'televoica',
      title: 'Downloading Voice to Text',
      kind: 'download',
      run: async (ctx) => {
        ctx.progress(0.4);
        return download;
      },
    });
    let releaseRun = (): void => {};
    const run = new Promise<void>((r) => {
      releaseRun = r;
    });
    const task = km.start({ appId: 'televoica', title: 'Working', kind: 'compute', run: async () => run });
    await settle(0);

    const off = followQueue(task, bar);
    assert.equal(task.status(), 'queued', 'the run really is behind the download');
    assert.equal(shown.at(-1)?.label, 'Waiting for the model download to finish', 'it says so at once');
    assert.equal(shown.at(-1)?.ratio, 0.4, 'and moves with the download rather than sweeping');

    // Once the run starts, the engine owns the label: nothing further may be written here, or a
    // stale "waiting" would paint over a real "Decoding audio".
    releaseDownload();
    await settle(5);
    assert.equal(task.status(), 'running');
    const afterStart = shown.length;
    km.start({ appId: 'denoise', title: 'Something else', kind: 'compute', run: async () => settle(0) });
    await settle(5);
    assert.equal(shown.length, afterStart, 'a running task is never written over');

    off();
    releaseRun();
    await settle(5);
    km.__reset();
  });

  test('unsubscribing really stops it', async () => {
    const { followQueue } = await import('./queuedProgress.js');
    const km = await import('./kimtManager.js');
    km.__reset();

    const shown: unknown[] = [];
    let release = (): void => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    km.start({ appId: 'televoica', title: 'Downloading', kind: 'download', run: async () => blocked });
    const task = km.start({ appId: 'televoica', title: 'Working', kind: 'compute', run: async () => blocked });
    await settle(0);

    const off = followQueue(task, { update: (p) => shown.push(p) });
    const before = shown.length;
    off();
    // A change that WOULD have repainted, if the listener were still attached.
    km.start({ appId: 'denoise', title: 'Other', kind: 'compute', run: async () => blocked });
    await settle(5);
    assert.equal(shown.length, before, 'a screen that has moved on leaves no listener behind');

    release();
    await settle(5);
    km.__reset();
  });
});
