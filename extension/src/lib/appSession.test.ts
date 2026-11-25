// Minimize and close are different verbs, and the whole feature rests on them staying different
// once the state is written down (#1172). These tests pin that difference, and the defensiveness
// that keeps a stale stored shape from restoring a broken window.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WINDOWS_KEY,
  appSessionKey,
  clearAppSession,
  getAppSession,
  getWindows,
  setAppSession,
  setWindows,
  type SessionArea,
  type WindowState,
} from './appSession.js';

function fakeArea(seed: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(seed));
  const area: SessionArea = {
    get: async <T>(k: string) => map.get(k) as T | undefined,
    set: async (k, v) => void map.set(k, v),
    del: async (k) => void map.delete(k),
  };
  return { area, map };
}

const win = (appId: string, over: Partial<WindowState> = {}): WindowState => ({
  appId,
  minimized: false,
  maximized: false,
  ...over,
});

describe('the window list', () => {
  test('round-trips', async () => {
    const { area } = fakeArea();
    await setWindows([win('notes', { minimized: true, left: 40, top: 60 })], area);

    const [got] = await getWindows(area);
    assert.equal(got.appId, 'notes');
    assert.equal(got.minimized, true);
    assert.deepEqual([got.left, got.top], [40, 60]);
  });

  test('is empty when nothing was ever saved', async () => {
    const { area } = fakeArea();
    assert.deepEqual(await getWindows(area), []);
  });

  test('geometry stays absent until the user moves the window, so a restore re-centres it', async () => {
    const { area } = fakeArea();
    await setWindows([win('tasks')], area);

    const [got] = await getWindows(area);
    assert.equal(got.left, undefined);
    assert.equal(got.width, undefined);
  });

  // A build that changed this shape leaves the old one in a live session. Restoring a window with
  // no app id would open nothing and throw on the way; dropping it is the only safe reading.
  test('drops entries that are not windows rather than restoring them', async () => {
    const { area } = fakeArea({ [WINDOWS_KEY]: [win('notes'), { minimized: true }, null, 'tasks', { appId: '' }] });

    const got = await getWindows(area);
    assert.deepEqual(
      got.map((w) => w.appId),
      ['notes'],
    );
  });

  test('survives a stored value that is not a list at all', async () => {
    const { area } = fakeArea({ [WINDOWS_KEY]: { appId: 'notes' } });
    assert.deepEqual(await getWindows(area), []);
  });

  test('coerces a missing minimized/maximized flag to false', async () => {
    const { area } = fakeArea({ [WINDOWS_KEY]: [{ appId: 'notes' }] });

    const [got] = await getWindows(area);
    assert.equal(got.minimized, false);
    assert.equal(got.maximized, false);
  });
});

describe("an app's own state", () => {
  test('round-trips, and is null before anything is saved', async () => {
    const { area } = fakeArea();
    assert.equal(await getAppSession('notes', area), null);

    await setAppSession('notes', { pageId: 'p1', scroll: 120 }, area);
    assert.deepEqual(await getAppSession('notes', area), { pageId: 'p1', scroll: 120 });
  });

  // Convention 6's naming: an app's session sits beside its `<appId>:job` record, so AnubisDB
  // attributes it to the app from the id prefix with no registry edit.
  test('is keyed by app id', () => {
    assert.equal(appSessionKey('notes'), 'notes:session');
  });

  test('is per app — one app saving does not disturb another', async () => {
    const { area } = fakeArea();
    await setAppSession('notes', { a: 1 }, area);
    await setAppSession('tasks', { b: 2 }, area);

    await clearAppSession('notes', area);
    assert.equal(await getAppSession('notes', area), null);
    assert.deepEqual(await getAppSession('tasks', area), { b: 2 });
  });
});

// THE distinction the feature exists for. Close must forget; minimize must not.
describe('close forgets, minimize remembers', () => {
  test('clearing an app session leaves the next open with nothing to restore', async () => {
    const { area } = fakeArea();
    await setAppSession('denoise', { entryId: 'clip-1' }, area);

    await clearAppSession('denoise', area);

    assert.equal(await getAppSession('denoise', area), null);
  });

  test('a minimized window keeps its state', async () => {
    const { area } = fakeArea();
    await setAppSession('denoise', { entryId: 'clip-1' }, area);
    await setWindows([win('denoise', { minimized: true })], area);

    assert.deepEqual(await getAppSession('denoise', area), { entryId: 'clip-1' });
    assert.equal((await getWindows(area))[0].minimized, true);
  });
});
