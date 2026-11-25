// A pre-fetch that cannot start now must not be lost.
//
// Changing a download-affecting setting fetches the new asset immediately, so that USING the app
// never downloads mid-task. One job per app means a change made while the app is already busy
// cannot start — and that request used to be discarded, leaving the app configured for a model it
// had never fetched. The download then happened at use time: the wait #1306 is about, arriving
// right after the user had been told a download was under way (#1310).
//
// Driven through the REAL orchestrator, with a job that does not settle standing in for a download
// in flight. The re-fetch these tests observe is a real one: it is asserted as "a download job
// appeared for this app", not by watching an injected double.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

let env: DomEnv;
let fake: FakeChrome;
let km: typeof import('./kimtManager.js');
let im: typeof import('./installManager.js');
let installed: typeof import('../models/installed.js');

/** Hold an app busy with a job the test decides when to finish. */
function blocker(appId: string): () => void {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  km.start({ appId, title: `Downloading ${appId}`, kind: 'download', run: async () => held });
  return release;
}

/** The ids of every download job registered for `appId` from now on — a set, because a job is
 *  notified about many times as it progresses. */
function watchDownloads(appId: string): { ids: Set<string>; stop: () => void } {
  const ids = new Set<string>();
  const stop = km.subscribe(() => {
    for (const job of km.list()) if (job.appId === appId && job.kind === 'download') ids.add(job.id);
  });
  return { ids, stop };
}

// The re-fetch these tests provoke is the REAL one, so it really does try to load a model. It
// gets no further than asking for a Web Worker, which this environment does not have — but that
// is luck, not a property, and the day it changes these tests would quietly start pulling model
// weights off our CDN on every CI run. So the network is watched, and touching it fails the test.
let outbound: string[];
let realFetch: unknown;

beforeEach(async () => {
  env = installDom();
  fake = installChrome();
  outbound = [];
  const g = globalThis as unknown as Record<string, unknown>;
  realFetch = g.fetch;
  g.fetch = (...args: unknown[]): Promise<never> => {
    outbound.push(String(args[0]));
    return Promise.reject(new Error('a unit test must not reach the network'));
  };
  km = await import('./kimtManager.js');
  im = await import('./installManager.js');
  installed = await import('../models/installed.js');
  km.__reset();
});

afterEach(() => {
  km.__reset();
  (globalThis as unknown as Record<string, unknown>).fetch = realFetch;
  fake.cleanup();
  env.cleanup();
  assert.deepEqual(outbound, [], 'these tests observe that a fetch was SCHEDULED, never perform one');
});

describe('a re-fetch refused because the app is busy', () => {
  const APP = 'televoica'; // installed below; it has a model entry (Whisper)

  test('is remembered, and runs once the app is free', async () => {
    await installed.setInstalled(APP, true);
    const release = blocker(APP);
    await settle(0);
    const seen = watchDownloads(APP);

    assert.equal(im.ensureModel(APP), false, 'it cannot start while the app is busy');
    assert.equal(im.isBusy(APP), true, 'and the app is still busy with the FIRST download');

    release();
    await settle(10);

    assert.equal(seen.ids.size, 1, 'the request was not thrown away: a fresh download job appeared');
    seen.stop();
  });

  test('several changes while busy collapse into ONE re-fetch', async () => {
    await installed.setInstalled(APP, true);
    const release = blocker(APP);
    await settle(0);
    const seen = watchDownloads(APP);

    im.ensureModel(APP);
    im.ensureModel(APP);
    im.ensureModel(APP);

    release();
    await settle(10);

    // Whatever runs reads the config as it is THEN, so the only right answer is one fetch of the
    // final choice — not one per change, and never a stale choice from two changes ago.
    assert.equal(seen.ids.size, 1, `expected exactly one re-fetch, saw ${seen.ids.size}`);
    seen.stop();
  });

  test('waits behind the work the user actually asked for', async () => {
    // The sequence that produced #1310 in the first place: a download running, the setting
    // changed, and then the user pressing the app's own button. A pre-fetch nobody is waiting for
    // must not delay the transcription somebody is.
    await installed.setInstalled(APP, true);
    const releaseDownload = blocker(APP);
    await settle(0);

    im.ensureModel(APP); // refused, remembered

    let releaseRun!: () => void;
    const held = new Promise<void>((r) => {
      releaseRun = r;
    });
    const userRun = km.start({ appId: APP, title: 'Working on recording', kind: 'compute', run: async () => held });
    await settle(0);
    assert.equal(userRun.status(), 'queued', 'it is behind the download, which is what #1306 now says out loud');

    releaseDownload();
    await settle(10);
    assert.equal(userRun.status(), 'running', "the user's run takes the freed slot");
    assert.equal(
      km.list().some((j) => j.kind === 'download'),
      false,
      'and the deferred pre-fetch has not jumped in front of it',
    );

    releaseRun();
    await settle(20);
    assert.ok(
      km.list().some((j) => j.kind === 'download'),
      'it runs once the app is genuinely free',
    );
  });

  test('the memory is spent once, not left armed for the next job', async () => {
    // A flag that survived its own re-fetch would fire again on the next unrelated piece of work
    // for that app — a download the user did nothing to ask for, every time they used the app.
    await installed.setInstalled(APP, true);
    const release = blocker(APP);
    await settle(0);
    const seen = watchDownloads(APP);

    im.ensureModel(APP);
    release();
    await settle(10);
    const afterFirst = seen.ids.size;

    // Something else entirely, for the same app.
    const second = blocker(APP);
    await settle(0);
    second();
    await settle(10);

    assert.equal(seen.ids.size, afterFirst + 1, 'only the blocker itself — no second re-fetch');
    seen.stop();
  });

  test('an app with no model to fetch is not remembered at all', async () => {
    // Nothing to download, so nothing to re-check — and a flag left set here would fire on the
    // next unrelated job for that app.
    const NO_MODEL = 'anubisdb'; // required, so installed by definition, and it has no model
    const release = blocker(NO_MODEL);
    await settle(0);
    const seen = watchDownloads(NO_MODEL);

    assert.equal(im.ensureModel(NO_MODEL), false);

    release();
    await settle(10);
    assert.equal(seen.ids.size, 0, 'no download was scheduled for an app that has nothing to fetch');
    seen.stop();
  });

  test('an uninstalled app is not remembered either', async () => {
    await installed.setInstalled(APP, false);
    const release = blocker(APP);
    await settle(0);
    const seen = watchDownloads(APP);

    assert.equal(im.ensureModel(APP), false);

    release();
    await settle(10);
    assert.equal(seen.ids.size, 0, 'an app the user removed must not have its model fetched behind them');
    seen.stop();
  });
});
