// A model download cannot be started from inside the run that needs it.
//
// The orchestrator allows one job per app — two would race the same model cache. So a download
// registered by a RUNNING compute job is queued behind the very job that is awaiting it, and
// neither ever finishes: Voice to Text would hang on its first cold run, showing a progress screen
// for work that had not started and never would.
//
// That is why `createMediaTextApp` has a `prepare` hook: it runs before the job exists. This pins
// the deadlock itself, in the orchestrator's own terms, so the shape cannot come back by being
// written somewhere else.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

let env: DomEnv;
let fake: FakeChrome;
let km: typeof import('./kimtManager.js');

beforeEach(async () => {
  env = installDom();
  fake = installChrome();
  km = await import('./kimtManager.js');
  km.__reset();
});
afterEach(() => {
  km.__reset();
  fake.cleanup();
  env.cleanup();
});

describe('a job of the same app cannot be started from inside a running job', () => {
  test('the inner one never starts, and the outer one never finishes', async () => {
    let inner = 'not started';
    const outer = km.start({
      appId: 'televoica',
      title: 'Working on recording',
      kind: 'compute',
      run: async () => {
        const download = km.start({
          appId: 'televoica',
          title: 'Downloading the speech model',
          kind: 'download',
          run: async () => {
            inner = 'ran';
          },
        });
        await download.run();
        inner = 'finished';
      },
    });
    void outer.run();
    await settle(20);

    assert.equal(inner, 'not started', 'the download is queued behind the job waiting for it');
    assert.equal(outer.status(), 'running', 'and that job can never finish — this is the deadlock');
  });

  test('started BEFORE the run, both complete — which is what `prepare` is for', async () => {
    const order: string[] = [];
    const download = km.start({
      appId: 'televoica',
      title: 'Downloading the speech model',
      kind: 'download',
      run: async () => {
        order.push('download');
      },
    });
    await download.run();
    const run = km.start({
      appId: 'televoica',
      title: 'Working on recording',
      kind: 'compute',
      run: async () => {
        order.push('run');
      },
    });
    await run.run();
    await settle(5);

    assert.deepEqual(order, ['download', 'run']);
    assert.equal(run.status(), 'done');
  });
});
