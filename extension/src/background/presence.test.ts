// Single-instance arbitration (#1172). One new-tab page runs the apps; a second is told to switch
// or take over. Everything here is about the decision, because getting it wrong is expensive in
// both directions: grant too readily and two pages run the same app with two sets of engines and
// two audio sources (the bug); refuse too readily and the user is locked out of their own desktop
// by a record left behind by a tab that no longer exists.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PRESENCE_KEY, type Presence } from '../lib/presenceShared.js';

let claim: typeof import('./presence.js').claim;
let release: typeof import('./presence.js').release;

/** Chrome, reduced to what arbitration touches: a session area and a set of live tab ids. */
function installChrome(liveTabs: number[] = []) {
  const data: Record<string, unknown> = {};
  const tabs = new Set(liveTabs);
  const g = globalThis as unknown as Record<string, unknown>;
  const had = 'chrome' in g;
  const before = g.chrome;
  g.chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: data[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(data, items),
        remove: async (key: string) => {
          delete data[key];
        },
      },
    },
    tabs: {
      get: async (id: number) => {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}`);
        return { id, windowId: 1 };
      },
    },
  };
  return {
    data,
    tabs,
    held: (): Presence | undefined => data[PRESENCE_KEY] as Presence | undefined,
    cleanup: () => {
      if (had) g.chrome = before;
      else delete g.chrome;
    },
  };
}

let env: ReturnType<typeof installChrome>;

describe('claiming the apps', () => {
  afterEach(() => env.cleanup());
  beforeEach(async () => {
    ({ claim, release } = await import('./presence.js'));
  });

  test('the first page gets them', async () => {
    env = installChrome([1]);

    const got = await claim('page-a', 1, false);

    assert.deepEqual(got, { primary: true });
    assert.deepEqual(env.held(), { pageId: 'page-a', tabId: 1 });
  });

  test('a second page is refused, and told which tab to switch to', async () => {
    env = installChrome([1, 2]);
    await claim('page-a', 1, false);

    const got = await claim('page-b', 2, false);

    assert.deepEqual(got, { primary: false, holderTabId: 1 });
    assert.equal(env.held()?.pageId, 'page-a', 'and the holder is untouched');
  });

  // A RELOAD is a new page in the same tab. It must be able to take primacy back from the record
  // its own previous life left behind, or reloading would lock the user out of their own desktop.
  test('a reload of the holding tab reclaims, because the page id is new', async () => {
    env = installChrome([1]);
    await claim('page-a', 1, false);

    const got = await claim('page-a-reloaded', 1, false);

    assert.deepEqual(got, { primary: true }, 'the incumbent tab is the caller, so nothing is contested');
    assert.equal(env.held()?.pageId, 'page-a-reloaded');
  });

  test('the same page claiming twice is still primary', async () => {
    env = installChrome([1]);
    await claim('page-a', 1, false);

    assert.deepEqual(await claim('page-a', 1, false), { primary: true });
  });

  // The holder's tab was closed without a clean release (a crash, or a close the worker missed).
  // Nothing may keep a live page out on behalf of a tab that is gone.
  test('a record left by a closed tab does not lock anyone out', async () => {
    env = installChrome([1, 2]);
    await claim('page-a', 1, false);
    env.tabs.delete(1); // that tab is gone

    const got = await claim('page-b', 2, false);

    assert.deepEqual(got, { primary: true });
    assert.equal(env.held()?.pageId, 'page-b');
  });

  test('a record with no tab id at all is not treated as a live holder', async () => {
    env = installChrome([2]);
    env.data[PRESENCE_KEY] = { pageId: 'ghost' };

    assert.deepEqual(await claim('page-b', 2, false), { primary: true });
  });

  test("'Use here instead' takes them over a live holder", async () => {
    env = installChrome([1, 2]);
    await claim('page-a', 1, false);

    const got = await claim('page-b', 2, true);

    assert.deepEqual(got, { primary: true });
    assert.equal(env.held()?.pageId, 'page-b', 'the record now names the page that took over');
  });
});

describe('releasing the apps', () => {
  afterEach(() => env.cleanup());
  beforeEach(async () => {
    ({ claim, release } = await import('./presence.js'));
  });

  test('the holder leaving clears the record, so the next page claims immediately', async () => {
    env = installChrome([1]);
    await claim('page-a', 1, false);

    await release('page-a');

    assert.equal(env.held(), undefined);
  });

  // The losing page unloads AFTER the winner has claimed. If release were unconditional it would
  // wipe the winner's record on its way out, and the desktop would belong to nobody.
  test('a page that already lost must not clear the winner on its way out', async () => {
    env = installChrome([1, 2]);
    await claim('page-a', 1, false);
    await claim('page-b', 2, true); // page-b took over

    await release('page-a'); // page-a now unloads

    assert.equal(env.held()?.pageId, 'page-b', 'the winner still holds them');
  });

  test('releasing when nothing is held is a no-op', async () => {
    env = installChrome([1]);
    await release('page-a');
    assert.equal(env.held(), undefined);
  });
});
