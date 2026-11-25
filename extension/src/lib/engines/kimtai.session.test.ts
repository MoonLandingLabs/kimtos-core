// createChat's run routing (#967). A chat session used to hold ONE mutable callback
// slot and a worker protocol with no run id, so a stopped generation's late `done`
// was delivered to whatever send() registered next — the engine-level root of the
// cross-conversation corruption in #951. Every generation is now a run: its id is
// stamped on `generate`, echoed by the worker, and anything not carrying the
// current run's id is dropped at this boundary.
//
// The worker is faked (the real one pulls a model through Transformers.js); what
// these tests hold is the routing contract around it.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../../test/domEnv.js';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: { type?: string; run?: number; [k: string]: unknown }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: { type?: string }): void {
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

/** Callbacks whose every delivery is recorded, so a mis-routed one is visible. */
function recorder() {
  const seen = { tokens: [] as string[], done: [] as (string | undefined)[], errors: [] as string[] };
  return {
    seen,
    cbs: {
      onToken: (t: string) => void seen.tokens.push(t),
      onDone: (text: string | undefined) => void seen.done.push(text),
      onError: (e: Error) => void seen.errors.push(e.message),
    },
  };
}

const lastGenerate = (w: FakeWorker) => w.posted.filter((m) => m.type === 'generate').at(-1)!;

describe('createChat run routing (#967)', () => {
  let env: DomEnv;
  let removeWorker: () => void;
  afterEach(() => {
    removeWorker?.();
    env?.cleanup();
  });

  async function makeSession() {
    env = installDom();
    removeWorker = installWorker();
    const { createChat } = await import('./kimtai.js');
    const session = createChat({ model: 'kimtos-test/run-routing' });
    const worker = FakeWorker.instances.at(-1)!;
    return { session, worker };
  }

  test('a run streams and completes through its own callbacks', async () => {
    const { session, worker } = await makeSession();
    const a = recorder();
    session.send([{ role: 'user', content: 'Hi' }], a.cbs);

    const gen = lastGenerate(worker);
    assert.equal(typeof gen.run, 'number', 'the generate request is stamped with a run id');
    worker.emit({ type: 'token', run: gen.run, text: 'He' });
    worker.emit({ type: 'token', run: gen.run, text: 'llo' });
    worker.emit({ type: 'done', run: gen.run, text: 'Hello' });

    assert.deepEqual(a.seen.tokens, ['He', 'llo']);
    assert.deepEqual(a.seen.done, ['Hello']);
    assert.deepEqual(a.seen.errors, []);
  });

  test("stop A, start B, deliver A's late done: B never sees it, and A settled at stop", async () => {
    const { session, worker } = await makeSession();
    const a = recorder();
    session.send([{ role: 'user', content: 'First question' }], a.cbs);
    const runA = lastGenerate(worker).run;
    worker.emit({ type: 'token', run: runA, text: 'Par' });

    // stop() settles A immediately with the text streamed so far…
    session.stop();
    assert.deepEqual(a.seen.done, ['Par'], 'the stopped run settles at stop time, with its partial text');
    const stopMsg = worker.posted.at(-1)!;
    assert.deepEqual({ type: stopMsg.type, run: stopMsg.run }, { type: 'stop', run: runA });

    // …so the worker's own late messages for A go nowhere, least of all to B.
    const b = recorder();
    session.send([{ role: 'user', content: 'Second question' }], b.cbs);
    const runB = lastGenerate(worker).run;
    assert.notEqual(runB, runA, 'every generation gets a fresh run id');

    worker.emit({ type: 'token', run: runA, text: 'is.' });
    worker.emit({ type: 'done', run: runA, text: 'Paris.' });
    worker.emit({ type: 'error', run: runA, message: 'late failure' });
    assert.deepEqual(b.seen.tokens, [], "the stopped run's stragglers never reach the next run");
    assert.deepEqual(b.seen.done, [], "the stopped run's done never reaches the next run (#951)");
    assert.deepEqual(b.seen.errors, []);
    assert.deepEqual(a.seen.done, ['Par'], 'the stopped run is not settled twice');

    // B itself still works.
    worker.emit({ type: 'done', run: runB, text: 'London.' });
    assert.deepEqual(b.seen.done, ['London.']);
  });

  test('send() over an unfinished run supersedes it: stopped in the worker, callbacks dropped', async () => {
    const { session, worker } = await makeSession();
    const a = recorder();
    session.send([{ role: 'user', content: 'First' }], a.cbs);
    const runA = lastGenerate(worker).run;

    const b = recorder();
    session.send([{ role: 'user', content: 'Second' }], b.cbs);
    const stopMsg = worker.posted.find((m) => m.type === 'stop')!;
    assert.equal(stopMsg.run, runA, 'the worker is told to stop the superseded run');

    worker.emit({ type: 'done', run: runA, text: 'stale' });
    assert.deepEqual(a.seen.done, [], "a superseded run's callbacks are dropped, not settled");
    assert.deepEqual(b.seen.done, [], "…and its done cannot cross into the new run's callbacks");

    worker.emit({ type: 'done', run: lastGenerate(worker).run, text: 'fresh' });
    assert.deepEqual(b.seen.done, ['fresh']);
  });

  test('stop() with nothing in flight is a no-op', async () => {
    const { session, worker } = await makeSession();
    const posted = worker.posted.length;
    session.stop();
    assert.equal(worker.posted.length, posted, 'no stop message is sent for an idle session');

    // And after a run has completed, stop() must not re-settle it.
    const a = recorder();
    session.send([{ role: 'user', content: 'Hi' }], a.cbs);
    worker.emit({ type: 'done', run: lastGenerate(worker).run, text: 'Done.' });
    session.stop();
    assert.deepEqual(a.seen.done, ['Done.'], 'a completed run is settled exactly once');
  });

  test('a fatal load error fails the ready promise AND the run waiting on it', async () => {
    const { session, worker } = await makeSession();
    const a = recorder();
    session.send([{ role: 'user', content: 'Hi' }], a.cbs);
    worker.emit({ type: 'error', fatal: true, message: 'model failed to load' });
    await assert.rejects(session.ready, /model failed to load/);
    assert.deepEqual(a.seen.errors, ['model failed to load']);
  });

  test('a worker crash settles the in-flight run instead of leaving it hanging', async () => {
    const { session, worker } = await makeSession();
    worker.emit({ type: 'ready', device: 'wasm' });
    const a = recorder();
    session.send([{ role: 'user', content: 'Hi' }], a.cbs);
    worker.onerror?.({ message: 'worker crashed' });
    assert.deepEqual(a.seen.errors, ['worker crashed']);
    assert.deepEqual(a.seen.done, []);
  });
});
