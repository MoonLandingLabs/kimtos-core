// The install rule, and the pin that nothing is ever locked: the only thing that decides whether an
// app is usable is whether the user installed it. There is no plan, tier or account term.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_NS,
  appInstalled,
  defaultApps,
  isAppInstalled,
  isAppRequired,
  readInstalledState,
  workspaceIdOf,
} from './installedApps.js';
import { APP_IDS, OPT_IN_APP_IDS, REQUIRED_APP_IDS } from '../data/appInstall.js';

type ChromeStub = { storage: { local: { get: (k: string) => Promise<Record<string, unknown>> } } };
const withBlob = (blob: unknown): void => {
  (globalThis as { chrome?: ChromeStub }).chrome = {
    storage: { local: { get: async (k: string) => ({ [k]: blob }) } },
  };
};

describe('the install rule', () => {
  test('nothing is ever locked: every shipped app is usable once it is installed', () => {
    for (const id of APP_IDS) {
      assert.equal(isAppInstalled(id, { installedApps: [id] }), true, `${id} runs when installed`);
    }
  });

  test('a never-configured profile gets the defaults: everything except the opt-in apps', () => {
    const defaults = defaultApps();
    for (const id of APP_IDS) {
      const expected = !OPT_IN_APP_IDS.includes(id) || REQUIRED_APP_IDS.includes(id);
      assert.equal(defaults.includes(id), expected, id);
      assert.equal(isAppInstalled(id, { installedApps: null }), expected, id);
    }
  });

  test('an empty set is a real state, kept distinct from "never chosen"', () => {
    const optional = APP_IDS.find((id) => !REQUIRED_APP_IDS.includes(id))!;
    assert.equal(isAppInstalled(optional, { installedApps: [] }), false);
  });

  test('a required app is installed whatever the stored set says', () => {
    for (const id of REQUIRED_APP_IDS) {
      assert.equal(isAppRequired(id), true);
      assert.equal(isAppInstalled(id, { installedApps: [] }), true);
    }
  });
});

describe('reading the installed set from chrome.storage', () => {
  beforeEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  test('no chrome.storage (vite dev): no state, and appInstalled allows', async () => {
    assert.equal(await readInstalledState(), null);
    assert.equal(await appInstalled('grammit'), true);
  });

  test('the per-user set wins over the legacy device-wide one', async () => {
    withBlob({ workspaceId: 'u1', installedApps: ['old'], installedAppsByUser: { u1: ['grammit'] } });
    assert.deepEqual(await readInstalledState(), { installedApps: ['grammit'] });
    assert.equal(await appInstalled('grammit'), true);
    assert.equal(await appInstalled('clipboard'), false);
  });

  test('a fresh profile reads the local workspace; a stored workspaceId selects another', async () => {
    withBlob({ installedAppsByUser: { local: ['clipboard'] } });
    assert.deepEqual(await readInstalledState(), { installedApps: ['clipboard'] });
    assert.equal(workspaceIdOf({ workspaceId: 'u9' }), 'u9');
    assert.equal(workspaceIdOf(undefined), 'local');
    assert.equal(workspaceIdOf({ account: { id: 'u9' } }), 'local', 'a retired account field is ignored');
    assert.equal(STORE_NS, 'kimtos');
  });
});
