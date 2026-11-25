// The two primitives the voice worker leans on. Both were hand-rolled wrongly there and
// the failure was silent and expensive: overlapping requests each started their own
// ~90 MB model load, and nothing kept two inference runs off one WASM session (#1163).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sharedByKey, createSerialQueue } from './asyncOnce.js';

const deferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('sharedByKey', () => {
  test('overlapping calls for one key share a single load', async () => {
    let started = 0;
    const gate = deferred<string>();
    const load = sharedByKey(async () => {
      started += 1;
      return gate.promise;
    });

    const a = load('model|q8');
    const b = load('model|q8'); // while the first is still in flight
    gate.resolve('tts');

    assert.equal(await a, 'tts');
    assert.equal(await b, 'tts');
    assert.equal(started, 1, 'the expensive load ran once, not once per caller');
  });

  test('a settled load is still shared by later callers', async () => {
    let started = 0;
    const load = sharedByKey(async () => {
      started += 1;
      return 'tts';
    });
    await load('k');
    await load('k');
    assert.equal(started, 1);
  });

  test('different keys load separately', async () => {
    let started = 0;
    const load = sharedByKey(async () => {
      started += 1;
      return 'x';
    });
    await Promise.all([load('a'), load('b')]);
    assert.equal(started, 2);
  });

  test('a failure is not cached — the next call retries', async () => {
    let attempt = 0;
    const load = sharedByKey(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network');
      return 'second time lucky';
    });

    await assert.rejects(load('k'), /network/);
    assert.equal(await load('k'), 'second time lucky', 'a rejection must not be inherited for ever');
  });
});

describe('createSerialQueue', () => {
  test('runs tasks one at a time, in order', async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    let running = 0;
    let overlapped = false;

    const task = (name: string, ms: number) => async (): Promise<void> => {
      running += 1;
      if (running > 1) overlapped = true;
      await new Promise((r) => setTimeout(r, ms));
      order.push(name);
      running -= 1;
    };

    await Promise.all([queue(task('a', 20)), queue(task('b', 1)), queue(task('c', 1))]);

    assert.equal(overlapped, false, 'never two at once — one WASM session, one job');
    assert.deepEqual(order, ['a', 'b', 'c'], 'and in the order they were queued');
  });

  test('a failing task settles its own caller and does not stop the queue', async () => {
    const queue = createSerialQueue();
    await assert.rejects(
      queue(async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(await queue(async () => 'still working'), 'still working');
  });
});
