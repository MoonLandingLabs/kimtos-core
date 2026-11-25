// The channel that lets a takeover notice name what it is about to destroy (#1270).
//
// The tab being asked to take over could describe nothing, because the holder's KimtManager is an
// in-memory registry in a context it cannot reach — so it warned about "anything still playing" and
// a user mid-way through a noise-reduction pass reasonably concluded nothing was at stake.
//
// Two properties are worth locking down, and they pull in opposite directions:
//   - the list must actually cross the gap, or the notice is no better than before;
//   - it must NOT be trusted once its page is gone. A tab that dies without running its teardown
//     leaves its record behind, and `chrome.tabs.onRemoved` clears only the PRESENCE record. A
//     warning that is sometimes false about a tab doing nothing is one users learn to click past,
//     which costs more than the vague sentence it replaced.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PRESENCE_KEY, PRESENCE_WORK_KEY, type HolderJob, type PresenceWork } from './presenceShared.js';

type Handler = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

/** A `chrome.storage.session` over a plain object, whose writes fire onChanged as the real one does. */
function installChrome(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const handlers: Handler[] = [];
  const fire = (changes: Record<string, { newValue?: unknown }>): void => {
    for (const h of [...handlers]) h(changes, 'session');
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const had = 'chrome' in g;
  const before = g.chrome;
  g.chrome = {
    storage: {
      session: {
        get: (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) out[k] = data[k];
          return Promise.resolve(out);
        },
        set: (items: Record<string, unknown>) => {
          Object.assign(data, items);
          fire(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }])));
          return Promise.resolve();
        },
        remove: (key: string) => {
          delete data[key];
          fire({ [key]: { newValue: undefined } });
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (fn: Handler) => handlers.push(fn),
        removeListener: (fn: Handler) => {
          const i = handlers.indexOf(fn);
          if (i >= 0) handlers.splice(i, 1);
        },
      },
    },
  };
  return {
    data,
    handlerCount: () => handlers.length,
    cleanup: () => {
      if (had) g.chrome = before;
      else delete g.chrome;
    },
  };
}

const job = (over: Partial<HolderJob> = {}): HolderJob => ({
  appId: 'vidrec',
  name: 'Video Recorder',
  label: 'Cleaning audio',
  ratio: 0.64,
  savesOnStop: true,
  cancellable: true,
  ...over,
});

let env: ReturnType<typeof installChrome>;

describe('publishing what the holder is working on', () => {
  afterEach(() => env.cleanup());

  test('a published list is readable when the presence record names the same page', async () => {
    env = installChrome();
    const { publishWork, readHolderWork, pageId } = await import('./pagePresence.js');
    await (globalThis.chrome.storage.session.set as (i: Record<string, unknown>) => Promise<void>)({
      [PRESENCE_KEY]: { pageId, tabId: 7 },
    });

    publishWork([job()]);
    await Promise.resolve();

    const read = await readHolderWork();
    assert.equal(read.length, 1);
    assert.equal(read[0].label, 'Cleaning audio');
    assert.equal(read[0].ratio, 0.64);
  });

  test('a list left by a page the presence record no longer names is ignored', async () => {
    // The tab was discarded or crashed: its work record survives, its presence record does not.
    env = installChrome({
      [PRESENCE_KEY]: { pageId: 'the-live-page', tabId: 7 },
      [PRESENCE_WORK_KEY]: { pageId: 'a-page-that-died', jobs: [job()] } satisfies PresenceWork,
    });
    const { readHolderWork } = await import('./pagePresence.js');

    assert.deepEqual(await readHolderWork(), [], 'a leftover from a dead page names nothing');
  });

  test('with no presence record at all there is nothing to attribute work to', async () => {
    env = installChrome({ [PRESENCE_WORK_KEY]: { pageId: 'someone', jobs: [job()] } satisfies PresenceWork });
    const { readHolderWork } = await import('./pagePresence.js');

    assert.deepEqual(await readHolderWork(), []);
  });

  test('publishing an empty list REMOVES the record rather than storing an empty one', async () => {
    // Work that has finished must leave nothing behind: a notice naming a job that no longer exists
    // is the same failure as one naming none that does.
    env = installChrome();
    const { publishWork } = await import('./pagePresence.js');

    publishWork([job()]);
    await Promise.resolve();
    assert.ok(PRESENCE_WORK_KEY in env.data);

    publishWork([]);
    await Promise.resolve();
    assert.ok(!(PRESENCE_WORK_KEY in env.data), 'the key is gone, not set to []');
  });
});

describe('following the holder while the notice is on screen', () => {
  afterEach(() => env.cleanup());

  test('a change to the work list reaches the watcher', async () => {
    env = installChrome();
    const { publishWork, watchHolderWork, pageId } = await import('./pagePresence.js');
    await (globalThis.chrome.storage.session.set as (i: Record<string, unknown>) => Promise<void>)({
      [PRESENCE_KEY]: { pageId, tabId: 7 },
    });

    const seen: (readonly HolderJob[])[] = [];
    const off = watchHolderWork((jobs) => seen.push(jobs));

    publishWork([job({ label: 'Adding cleaned audio' })]);
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(seen.length, 1);
    assert.equal(seen[0][0].label, 'Adding cleaned audio');
    off();
    assert.equal(env.handlerCount(), 0, 'unsubscribing really detaches the listener');
  });

  test('the PRESENCE record moving is watched too — it is what makes a list anybody’s', async () => {
    // The holder's tab closing clears presence and nothing else, so a watcher that only followed the
    // work key would keep showing a list that had just become meaningless.
    env = installChrome({
      [PRESENCE_KEY]: { pageId: 'holder', tabId: 7 },
      [PRESENCE_WORK_KEY]: { pageId: 'holder', jobs: [job()] } satisfies PresenceWork,
    });
    const { watchHolderWork } = await import('./pagePresence.js');

    const seen: (readonly HolderJob[])[] = [];
    watchHolderWork((jobs) => seen.push(jobs));

    await (globalThis.chrome.storage.session.remove as (k: string) => Promise<void>)(PRESENCE_KEY);
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(seen.at(-1), [], 'with no holder, there is no work to name');
  });
});
