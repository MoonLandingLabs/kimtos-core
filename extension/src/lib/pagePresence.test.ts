// The page half of single-instance (#1172). Its whole job is to notice it LOST — the page that
// lost is the one holding the live players and the microphone, and it only learns that by watching
// the presence record change. A missed displacement is the original bug wearing a new hat: apps
// still running in a page the user has walked away from.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PRESENCE_KEY } from './presenceShared.js';

type Handler = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

function installChrome() {
  const handlers: Handler[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const had = 'chrome' in g;
  const before = g.chrome;
  g.chrome = {
    storage: {
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
    handlers,
    /** Fire a storage change exactly as chrome does. */
    fire: (newValue: unknown, area = 'session') => {
      for (const h of [...handlers]) h({ [PRESENCE_KEY]: { newValue } }, area);
    },
    cleanup: () => {
      if (had) g.chrome = before;
      else delete g.chrome;
    },
  };
}

let env: ReturnType<typeof installChrome>;

describe('noticing that another page took the apps', () => {
  afterEach(() => env.cleanup());

  test('a record naming another page is a displacement', async () => {
    env = installChrome();
    const { watchForDisplacement } = await import('./pagePresence.js');
    const seen: unknown[] = [];

    watchForDisplacement((holder) => seen.push(holder));
    env.fire({ pageId: 'someone-else', tabId: 7 });

    assert.deepEqual(seen, [{ pageId: 'someone-else', tabId: 7 }], 'and it carries the tab, for Switch to it');
  });

  test('our OWN record is not a displacement', async () => {
    env = installChrome();
    const { watchForDisplacement, pageId } = await import('./pagePresence.js');
    const seen: unknown[] = [];

    watchForDisplacement(() => seen.push(1));
    env.fire({ pageId, tabId: 1 }); // this page claiming, or re-claiming

    assert.deepEqual(seen, [], 'a page must not tear its own apps down when it wins');
  });

  // The holder's tab closed, so the worker cleared the record. Nobody took the apps — and a page
  // that treated this as a displacement would stop apps it is still rightfully running.
  test('a cleared record is not a displacement', async () => {
    env = installChrome();
    const { watchForDisplacement } = await import('./pagePresence.js');
    const seen: unknown[] = [];

    watchForDisplacement(() => seen.push(1));
    env.fire(undefined);

    assert.deepEqual(seen, []);
  });

  test('changes in other storage areas are ignored', async () => {
    env = installChrome();
    const { watchForDisplacement } = await import('./pagePresence.js');
    const seen: unknown[] = [];

    watchForDisplacement(() => seen.push(1));
    env.fire({ pageId: 'someone-else' }, 'local');

    assert.deepEqual(seen, []);
  });

  test('unsubscribing stops the watch', async () => {
    env = installChrome();
    const { watchForDisplacement } = await import('./pagePresence.js');
    const seen: unknown[] = [];

    const stop = watchForDisplacement(() => seen.push(1));
    stop();
    env.fire({ pageId: 'someone-else' });

    assert.deepEqual(seen, []);
    assert.equal(env.handlers.length, 0, 'and the listener is really gone, not just inert');
  });
});

// Under `vite dev` there is no extension API to arbitrate with. Standing down has to mean "behave
// exactly as before", not "refuse to run" — a dev build that showed the second-page notice to its
// only page would be unusable.
test('with no extension APIs, the page just runs the apps', async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = 'chrome' in g;
  const before = g.chrome;
  delete g.chrome;

  const { claimPrimary, watchForDisplacement } = await import('./pagePresence.js');
  assert.deepEqual(await claimPrimary(), { primary: true });
  assert.equal(typeof watchForDisplacement(() => {}), 'function', 'and unsubscribing is still safe to call');

  if (had) g.chrome = before;
});
