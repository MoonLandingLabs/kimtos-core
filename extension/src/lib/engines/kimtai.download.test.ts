// downloadModel's cancellation contract (#655). The Model Library's Cancel button is only
// honest if aborting actually tears the worker down, never records the model as installed,
// and cannot be undone by a `ready` message that was already in flight. None of that is
// visible from the UI, so it is asserted here.
//
// The worker is faked: the real one pulls hundreds of MB through Transformers.js. What the
// fake proves is the protocol around it — spawn, terminate, settle exactly once.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../../test/domEnv.js';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function installWorker(): () => void {
  FakeWorker.instances = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const before = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  return () => {
    if (before) Object.defineProperty(globalThis, 'Worker', before);
    else delete g.Worker;
  };
}

/** Let the promise chain inside downloadModel run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('downloadModel cancellation (#655)', () => {
  let env: DomEnv;
  let removeWorker: () => void;
  afterEach(() => {
    removeWorker?.();
    env?.cleanup();
  });

  test('aborting mid-download terminates the worker, rejects as cancelled, and installs nothing', async () => {
    env = installDom();
    removeWorker = installWorker();
    const { downloadModel, isDownloadCancelled, isDownloaded } = await import('./kimtai.js');

    const id = 'kimtos-test/cancel-mid-flight';
    const controller = new AbortController();
    const seen: unknown[] = [];
    const promise = downloadModel(id, (p) => seen.push(p), controller.signal);
    await tick();

    const worker = FakeWorker.instances.at(-1)!;
    assert.equal(FakeWorker.instances.length, 1, 'one worker is spawned');
    worker.emit({ type: 'progress', data: { phase: 'download', loaded: 10, total: 100, ratio: 0.1 } });
    assert.equal(seen.length, 1, 'progress reaches the caller');

    controller.abort();
    await assert.rejects(promise, (err: unknown) => isDownloadCancelled(err));
    assert.equal(worker.terminated, true, 'the fetching worker is torn down');
    assert.equal(await isDownloaded(id), false, 'a cancelled model is never marked installed');
  });

  test('a ready message that lands after the abort cannot resurrect the download', async () => {
    env = installDom();
    removeWorker = installWorker();
    const { downloadModel, isDownloadCancelled, isDownloaded } = await import('./kimtai.js');

    const id = 'kimtos-test/cancel-then-ready';
    const controller = new AbortController();
    const promise = downloadModel(id, undefined, controller.signal);
    await tick();
    const worker = FakeWorker.instances.at(-1)!;

    controller.abort();
    worker.emit({ type: 'ready' }); // the real worker can already have posted this
    await assert.rejects(promise, (err: unknown) => isDownloadCancelled(err));
    await tick();
    assert.equal(await isDownloaded(id), false, 'the late ready must not install the model');
  });

  test('an already-aborted signal rejects without spawning a worker at all', async () => {
    env = installDom();
    removeWorker = installWorker();
    const { downloadModel, isDownloadCancelled } = await import('./kimtai.js');

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(downloadModel('kimtos-test/pre-aborted', undefined, controller.signal), (err: unknown) =>
      isDownloadCancelled(err),
    );
    assert.equal(FakeWorker.instances.length, 0, 'no worker is started');
  });

  test('a download with no signal still completes and records the model', async () => {
    env = installDom();
    removeWorker = installWorker();
    const { downloadModel, isDownloaded } = await import('./kimtai.js');

    const id = 'kimtos-test/plain-download';
    const promise = downloadModel(id);
    await tick();
    const worker = FakeWorker.instances.at(-1)!;
    assert.equal((worker.posted[0] as { type?: string }).type, 'load');
    assert.equal((worker.posted[0] as { prefetch?: boolean }).prefetch, true, 'files are cached, not kept resident');

    worker.emit({ type: 'ready' });
    await promise;
    assert.equal(worker.terminated, true);
    assert.equal(await isDownloaded(id), true);
  });

  test('a failed write on the success path still settles, so the bar cannot spin forever', async () => {
    env = installDom();
    removeWorker = installWorker();
    const { dataStore } = await import('../dataStore.js');
    const { downloadModel } = await import('./kimtai.js');

    const originalSet = dataStore.kv.set;
    dataStore.kv.set = () => Promise.reject(new Error('QuotaExceededError'));
    try {
      const promise = downloadModel('kimtos-test/write-fails');
      await tick();
      FakeWorker.instances.at(-1)!.emit({ type: 'ready' });
      await assert.rejects(promise, /QuotaExceededError/);
    } finally {
      dataStore.kv.set = originalSet;
    }
  });
});
