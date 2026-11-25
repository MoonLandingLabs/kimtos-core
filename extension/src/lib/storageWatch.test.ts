// The live install gate. The half that matters is switching OFF: a content script that only ever
// learns it is allowed to run would keep an uninstalled feature on a long-lived page (#223).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { watchAppInstalled, watchGate } from './storageWatch.js';

type Handler = (changes: Record<string, unknown>, area: string) => void;

// A fake chrome.storage: the `kimtos` blob, plus the onChanged fan-out a real content script
// listens to.
function fakeChrome(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const handlers: Handler[] = [];
  const chrome = {
    storage: {
      local: {
        get: (key: string): Promise<Record<string, unknown>> => Promise.resolve({ [key]: data[key] }),
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
    chrome,
    handlers,
    /** Write a key and fire onChanged, the way chrome.storage really does. */
    set(key: string, value: unknown, area = 'local'): void {
      data[key] = value;
      for (const h of [...handlers]) h({ [key]: { newValue: value } }, area);
    },
  };
}

const store = (installedApps: string[]): Record<string, unknown> => ({ kimtos: { installedApps } });

// Let the primed read (a promise) settle.
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('watchAppInstalled', () => {
  beforeEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  test('reports the initial answer once', async () => {
    const fake = fakeChrome(store(['grammit']));
    (globalThis as { chrome?: unknown }).chrome = fake.chrome;
    const seen: boolean[] = [];
    watchAppInstalled('grammit', (on) => seen.push(on));
    await settle();
    assert.deepEqual(seen, [true]);
  });

  test('switches OFF when the app is uninstalled, and back ON when it returns', async () => {
    const fake = fakeChrome(store(['grammit']));
    (globalThis as { chrome?: unknown }).chrome = fake.chrome;
    const seen: boolean[] = [];
    watchAppInstalled('grammit', (on) => seen.push(on));
    await settle();

    fake.set('kimtos', { installedApps: [] });
    await settle();
    fake.set('kimtos', { installedApps: ['grammit'] });
    await settle();
    assert.deepEqual(seen, [true, false, true]);
  });

  test('an unrelated write does not repeat the answer', async () => {
    const fake = fakeChrome(store(['grammit']));
    (globalThis as { chrome?: unknown }).chrome = fake.chrome;
    const seen: boolean[] = [];
    watchAppInstalled('grammit', (on) => seen.push(on));
    await settle();

    fake.set('kimtos', { installedApps: ['grammit'], theme: 'dark' });
    await settle();
    assert.deepEqual(seen, [true], 'told once, not on every settings write');
  });

  test('the returned function unsubscribes', async () => {
    const fake = fakeChrome(store(['grammit']));
    (globalThis as { chrome?: unknown }).chrome = fake.chrome;
    const off = watchGate(
      async () => true,
      () => {},
      ['kimtos'],
    );
    assert.equal(fake.handlers.length, 1);
    off();
    assert.equal(fake.handlers.length, 0);
  });

  test('no chrome.storage is not an error', () => {
    const off = watchGate(
      async () => true,
      () => {},
      ['kimtos'],
    );
    off();
  });
});
