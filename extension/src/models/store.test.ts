// The settings mirror, and the keys it must not eat.
//
// `settings:` has two writers. This module owns `settings:<appId>`; csConfigMirror owns
// `settings:grammit-anywhere` and `settings:clipboard-capture`. The prune assumed it was the only
// writer and deleted the other's keys on every save — so a Clipboard user's capture EXCLUSION
// LIST (their bank, their password manager) vanished from the backup, and Import silently
// restored "capture on, nothing excluded" (#248).
//
// These tests drive the REAL mirrorPrefs against a fake kv, not just the pure helper: a helper
// test alone would still pass if mirrorPrefs stopped calling it and deleted everything anyway.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorPrefs, settingsKeysToPrune, SETTINGS_PREFIX, GENERAL_KEY, type Settings } from './store.js';
import { csConfigKeys } from '../lib/csConfigMirror.js';

const CS_KEYS = csConfigKeys().map(([, dbKey]) => dbKey);
const OWNED = () => CS_KEYS;

/** A kv store with the same surface as dataStore.kv. */
function fakeKv(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    store: data,
    get: <T = unknown>(key: string): Promise<T | undefined> => Promise.resolve(data.get(key) as T | undefined),
    set: (key: string, value: unknown): Promise<unknown> => {
      data.set(key, value);
      return Promise.resolve();
    },
    del: (key: string): Promise<unknown> => {
      data.delete(key);
      return Promise.resolve();
    },
    keys: (): Promise<string[]> => Promise.resolve([...data.keys()]),
  };
}

/** Only the fields mirrorPrefs reads; the rest of Settings is irrelevant here. */
const settings = (apps: Record<string, Record<string, unknown>>): Settings =>
  ({ apps, theme: 'dark' }) as unknown as Settings;

describe('mirrorPrefs: the keys csConfigMirror owns survive', () => {
  test('a clipboard exclusion list is NOT deleted by an unrelated settings save', async () => {
    // THE bug. The user excluded their password manager from capture; csConfigMirror wrote it
    // here. Then they opened a new tab, which writes `lastBgId` -> store.set -> mirrorPrefs.
    const capture = { monitorEnabled: true, excludedSites: ['1password.com', 'mybank.example'] };
    const kv = fakeKv({
      'settings:clipboard-capture': capture,
      'settings:grammit-anywhere': { enabled: false },
    });

    await mirrorPrefs(settings({ notes: { sort: 'recent' } }), kv);

    assert.deepEqual(
      await kv.get('settings:clipboard-capture'),
      capture,
      'the exclusion list must survive — losing it silently re-enables capture on the excluded sites',
    );
    assert.deepEqual(await kv.get('settings:grammit-anywhere'), { enabled: false });
  });

  test('they survive even when NO app has any config at all', async () => {
    const kv = fakeKv({ 'settings:clipboard-capture': { monitorEnabled: false } });
    await mirrorPrefs(settings({}), kv);
    assert.deepEqual(await kv.get('settings:clipboard-capture'), { monitorEnabled: false });
  });

  test('every key the registry declares is protected, not just the two we happen to know', async () => {
    // If a third content-script key is added to CS_CONFIG, it must be protected the day it lands
    // — with no second list to update here. That is the point of asking csConfigKeys().
    const kv = fakeKv(Object.fromEntries(CS_KEYS.map((k) => [k, { v: 1 }])));
    await mirrorPrefs(settings({}), kv);
    for (const k of CS_KEYS) assert.deepEqual(await kv.get(k), { v: 1 }, `${k} must survive`);
  });
});

describe('mirrorPrefs: the prune still has a real job', () => {
  test("an uninstalled app's config IS pruned", async () => {
    // Do not over-protect. If the fix simply stopped pruning, this test fails — and stale
    // settings for a removed app would linger in AnubisDB and in every backup forever.
    const kv = fakeKv({ 'settings:notes': { sort: 'recent' }, 'settings:tabs': { pinned: true } });
    await mirrorPrefs(settings({ notes: { sort: 'recent' } }), kv);
    assert.equal(await kv.get('settings:tabs'), undefined, 'tabs was removed from the live store');
    assert.deepEqual(await kv.get('settings:notes'), { sort: 'recent' });
  });

  test('a stale key for an app that never existed is pruned', async () => {
    const kv = fakeKv({ 'settings:ghostapp': { x: 1 } });
    await mirrorPrefs(settings({}), kv);
    assert.equal(await kv.get('settings:ghostapp'), undefined);
  });

  test('a content-script key REMOVED from the registry is no longer owned, so it is pruned', async () => {
    // Ownership is a live question, not a permanent exemption. A key that CS_CONFIG no longer
    // declares is an orphan, and orphans get cleaned up.
    const kv = fakeKv({ 'settings:retired-thing': { old: true } });
    await mirrorPrefs(settings({}), kv);
    assert.equal(await kv.get('settings:retired-thing'), undefined);
  });

  test('settings:general is never pruned', async () => {
    const kv = fakeKv({ [GENERAL_KEY]: { theme: 'light' } });
    await mirrorPrefs(settings({}), kv);
    assert.notEqual(await kv.get(GENERAL_KEY), undefined);
  });

  test('keys outside the settings: namespace are never touched', async () => {
    // Apps store their own data as `<id>:<thing>` (convention 6). The mirror must not reach into it.
    const kv = fakeKv({ 'thoth:hashes': [1, 2], 'kimtai:downloaded': ['x'], 'kimtfs:abc': 'blob' });
    await mirrorPrefs(settings({}), kv);
    assert.deepEqual(await kv.get('thoth:hashes'), [1, 2]);
    assert.deepEqual(await kv.get('kimtai:downloaded'), ['x']);
    assert.equal(await kv.get('kimtfs:abc'), 'blob');
  });
});

describe('mirrorPrefs: it still does its job', () => {
  test("each app's config is written under settings:<appId>, and general under settings:general", async () => {
    const kv = fakeKv();
    await mirrorPrefs(settings({ notes: { sort: 'recent' }, tabs: { pinned: true } }), kv);
    assert.deepEqual(await kv.get(SETTINGS_PREFIX + 'notes'), { sort: 'recent' });
    assert.deepEqual(await kv.get(SETTINGS_PREFIX + 'tabs'), { pinned: true });
    assert.notEqual(await kv.get(GENERAL_KEY), undefined);
  });

  test('the per-user installed-app map never reaches the mirror (#406)', async () => {
    // installedAppsByUser is a DEVICE-WIDE map keyed by every user id on the profile. A backup
    // is one user's data, so mirroring it would leak co-users' account ids + installs and clobber
    // them on restore. It must be stripped like the secrets are.
    const kv = fakeKv();
    const s = {
      apps: {},
      theme: 'dark',
      installedApps: ['a'],
      installedAppsByUser: { u1: ['a', 'b'], u2: ['c'] },
    };
    await mirrorPrefs(s as unknown as Settings, kv);
    const general = (await kv.get(GENERAL_KEY)) as Record<string, unknown>;
    assert.equal(general.installedAppsByUser, undefined, 'the per-user installed map must not be mirrored');
    assert.equal(general.installedApps, undefined, 'the legacy installed list must not be mirrored');
  });

  test('it never throws — a failing mirror must not break the save', async () => {
    // It is called with `void mirrorPrefs(...)` from a live save path. A rejection here would be
    // an unhandled rejection on every settings write.
    const broken = {
      get: () => Promise.reject(new Error('db is gone')),
      set: () => Promise.reject(new Error('db is gone')),
      del: () => Promise.reject(new Error('db is gone')),
      keys: () => Promise.reject(new Error('db is gone')),
    } as unknown as typeof import('../lib/dataStore.js').dataStore.kv;
    await assert.doesNotReject(() => mirrorPrefs(settings({ notes: {} }), broken));
  });
});

describe('settingsKeysToPrune (the decision, on its own)', () => {
  test('keeps owned keys, keeps general, keeps live apps, drops the rest', () => {
    const existing = [
      GENERAL_KEY,
      'settings:notes',
      'settings:tabs',
      'settings:clipboard-capture',
      'settings:grammit-anywhere',
      'thoth:hashes',
    ];
    assert.deepEqual(settingsKeysToPrune(existing, ['notes'], OWNED()), ['settings:tabs']);
  });

  test('an empty store prunes nothing', () => {
    assert.deepEqual(settingsKeysToPrune([], ['notes'], OWNED()), []);
  });
});
