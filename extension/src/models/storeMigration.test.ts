// The forward migration for the retired accounts and paid-plan machinery: old profiles carry
// fields that mean nothing now (`account`, `authTokens`, `homeGrantAlert`). They are dropped
// silently on load, the data stays under the key it already had, and nothing else in the blob is
// touched.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, type DomEnv, type FakeChrome } from '../test/domEnv.js';

type Disk = {
  account?: unknown;
  authTokens?: unknown;
  workspaceId?: string;
  installedAppsByUser: Record<string, string[]>;
  workspaces: Record<string, Record<string, unknown>>;
};
const readDisk = async (): Promise<Disk> =>
  (
    await (
      globalThis as unknown as {
        chrome: { storage: { local: { get: (k: string) => Promise<Record<string, unknown>> } } };
      }
    ).chrome.storage.local.get('kimtos')
  ).kimtos as Disk;

describe('loading an old persisted blob', () => {
  let env: DomEnv;
  let fake: FakeChrome;
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    fake.cleanup();
    env.cleanup();
  });

  test('a profile that once signed in: account and tokens are dropped, the data keeps its key', async () => {
    fake = installChrome({
      kimtos: {
        account: { id: 'u1', email: 'a@b.c', name: 'A', plan: 'pro', role: 'user', grants: [] },
        authTokens: { accessToken: 'a', refreshToken: 'r', at: 1 },
        installedAppsByUser: { u1: ['grammit'] },
        workspaces: { u1: { theme: 'dark', homeGrantAlert: false, homeTips: false } },
      },
    });
    const { store } = await import('./store.js');
    await store.init();

    assert.equal(store.workspaceId(), 'u1', 'the id the data lives under is kept');
    assert.equal(store.get('theme'), 'dark', 'the user settings survive');
    assert.equal(store.get('homeTips'), false);
    assert.equal('homeGrantAlert' in store.get(), false, 'the retired toggle is gone');
    assert.equal('account' in store.get(), false);
    assert.equal('authTokens' in store.get(), false);
    assert.deepEqual(store.get('installedAppsByUser'), { u1: ['grammit'] });

    const disk = await readDisk();
    assert.equal('account' in disk, false, 'the account is gone from disk');
    assert.equal('authTokens' in disk, false, 'and so are the tokens');
    assert.equal(disk.workspaceId, 'u1');
    assert.equal('homeGrantAlert' in disk.workspaces.u1, false);
    assert.equal(disk.workspaces.u1.theme, 'dark');
    assert.deepEqual(disk.installedAppsByUser, { u1: ['grammit'] });
  });

  test('a signed-out or fresh profile stays on the local workspace', async () => {
    fake = installChrome({
      kimtos: {
        account: null,
        authTokens: null,
        installedAppsByUser: { local: ['notes'] },
        workspaces: { local: { theme: 'light' } },
      },
    });
    const { store } = await import('./store.js');
    await store.init();
    assert.equal(store.workspaceId(), 'local');
    assert.equal(store.get('theme'), 'light');
    assert.deepEqual(store.get('installedAppsByUser'), { local: ['notes'] });
    assert.equal((await readDisk()).workspaceId, 'local');
  });

  test('a flat pre-workspace blob with an account moves into that account workspace', async () => {
    fake = installChrome({
      kimtos: {
        account: { id: 'u7', email: 'a@b.c', name: 'A' },
        authTokens: { accessToken: 'a', refreshToken: 'r' },
        theme: 'dark',
      },
    });
    const { store } = await import('./store.js');
    await store.init();
    assert.equal(store.workspaceId(), 'u7');
    assert.equal(store.get('theme'), 'dark');
    const disk = await readDisk();
    assert.equal('account' in disk, false);
    assert.equal('theme' in disk, false, 'settings live under their workspace, not at the top level');
    assert.equal(disk.workspaces.u7.theme, 'dark');
  });

  test('migrating twice changes nothing', async () => {
    fake = installChrome({
      kimtos: { account: { id: 'u1', email: 'a@b.c', name: 'A' }, workspaces: { u1: { theme: 'dark' } } },
    });
    const { store } = await import('./store.js');
    await store.init();
    const once = JSON.stringify(await readDisk());
    await store.init();
    assert.equal(JSON.stringify(await readDisk()), once);
  });
});

describe('workspaceIdFrom', () => {
  test('prefers a stored workspaceId, then the retired account id, then local', async () => {
    fake_noop();
    const { workspaceIdFrom } = await import('./store.js');
    assert.equal(workspaceIdFrom({ workspaceId: 'w', account: { id: 'u1' } }), 'w');
    assert.equal(workspaceIdFrom({ account: { id: 'u1' } }), 'u1');
    assert.equal(workspaceIdFrom({ account: null }), 'local');
    assert.equal(workspaceIdFrom({ account: { plan: 'pro' } }), 'local');
    assert.equal(workspaceIdFrom({}), 'local');
  });
});

// `models/store.ts` decides between chrome.storage and localStorage when it is first imported; this
// suite only calls a pure function, so any environment will do.
function fake_noop(): void {}
