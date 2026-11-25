// Two callers that want the same model must share one load.
//
// The orchestrator deliberately does NOT dedupe — `register` allocates a fresh record every time,
// and `appBusy` only stops two jobs RUNNING at once, so the second is queued and then runs. In
// Thoth that is reachable in two clicks: Rebuild index and Ask both call `ensureEmbedder`, both
// see it unset, and both load. The second value wins the assignment and the first load's Worker is
// never referenced again, so it is never disposed.
//
// The first version of `loadAsJob` claimed in its own comment to prevent this and did not. This is
// the test that would have caught that.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type DomEnv } from '../test/domEnv.js';

let env: DomEnv;
let loadAsJob: typeof import('./modelJob.js').loadAsJob;
let noteFor: typeof import('./modelJob.js').noteFor;
let km: typeof import('./kimtManager.js');

beforeEach(async () => {
  env = installDom();
  ({ loadAsJob, noteFor } = await import('./modelJob.js'));
  km = await import('./kimtManager.js');
  km.__reset();
});
afterEach(() => {
  km.__reset();
  env.cleanup();
});

describe('loadAsJob shares a load already in flight', () => {
  test('two overlapping callers run the loader ONCE and get the same value', async () => {
    let runs = 0;
    const load = async (): Promise<{ id: number }> => {
      runs += 1;
      await settle(20);
      return { id: runs };
    };

    const [a, b] = await Promise.all([
      loadAsJob({ appId: 'thoth', title: 'Downloading the search model' }, load),
      loadAsJob({ appId: 'thoth', title: 'Downloading the search model' }, load),
    ]);

    assert.equal(runs, 1, 'a second caller must not start a second transfer of the same bytes');
    assert.equal(a, b, 'and both get the same model, so neither is left holding an undisposed one');
  });

  test('one app can load two DIFFERENT models at once', async () => {
    // Thoth wants an embedder and a chat model. Keying on the app alone would hand the second
    // caller the first model.
    const mk = (name: string) => async () => {
      await settle(5);
      return name;
    };
    const [emb, chat] = await Promise.all([
      loadAsJob({ appId: 'thoth', title: 'Downloading the search model' }, mk('embedder')),
      loadAsJob({ appId: 'thoth', title: 'Downloading the AI model' }, mk('chat')),
    ]);
    assert.equal(emb, 'embedder');
    assert.equal(chat, 'chat');
  });

  test('a failed load is retryable — the entry is dropped, not cached', async () => {
    let runs = 0;
    const load = async (): Promise<string> => {
      runs += 1;
      if (runs === 1) throw new Error('network went away');
      return 'ok';
    };
    await assert.rejects(() => loadAsJob({ appId: 'grammit', title: 'Downloading' }, load));
    assert.equal(await loadAsJob({ appId: 'grammit', title: 'Downloading' }, load), 'ok');
    assert.equal(runs, 2, 'the second attempt really re-ran');
  });

  test('a successful load is not cached either — this is dedup, not a cache', async () => {
    let runs = 0;
    const load = async (): Promise<number> => ++runs;
    await loadAsJob({ appId: 'thoth', title: 'x' }, load);
    await loadAsJob({ appId: 'thoth', title: 'x' }, load);
    assert.equal(runs, 2, 'the callers own the caching; this only collapses overlap');
  });

  test('the work is registered, so it is visible while it runs', async () => {
    let seen = 0;
    const done = loadAsJob({ appId: 'thoth', title: 'Downloading the search model' }, async () => {
      seen = km.active().filter((j) => j.appId === 'thoth' && j.kind === 'download').length;
      return 1;
    });
    await done;
    assert.equal(seen, 1, 'a row exists while the model is loading');
  });
});

describe('what the row says', () => {
  test('real bytes when the server gave a size', () => {
    assert.equal(noteFor({ loaded: 12_000_000, total: 48_600_000 }), '12 MB of 48.6 MB');
  });
  test("the engine's own phase when it did not", () => {
    assert.equal(noteFor({ label: 'Loading model' }), 'Loading model');
  });
  test('and never an invented number', () => {
    assert.equal(noteFor(undefined), 'Downloading');
    assert.equal(noteFor({ ratio: 0.5 }), 'Downloading');
  });
});
