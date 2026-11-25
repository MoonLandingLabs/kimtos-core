// dataStore.listWorkspaces — powers the AnubisDB workspace switcher (#473). It must report
// every workspace that holds data, keyed by the record `workspace` field and the `<ws>\0`
// prefix on blob/kv keys, and must NOT invent a workspace out of a device-global kv key
// (model tracking, the settings mirror). fake-indexeddb is shared across the suite, so these
// use unique workspace ids and assert presence rather than an exact device-wide set.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';

describe('dataStore.listWorkspaces (#473)', () => {
  let env: DomEnv;
  afterEach(() => env.cleanup());

  test('reports each workspace that has data, active first, and never a device-global key', async () => {
    env = installDom();
    const { dataStore } = await import('./dataStore.js');

    dataStore.setWorkspace('lw-A');
    await dataStore.put('notes-pages', { id: 'n1', text: 'a' });
    await dataStore.putBlob('pdf:1', new Blob(['aaa']));
    await dataStore.kv.set('thoth:hashes', { x: 1 }); // per-user kv
    await dataStore.kv.set('kimtai:downloaded', ['m1']); // DEVICE-GLOBAL — not a workspace

    dataStore.setWorkspace('lw-B');
    await dataStore.put('tasks-items', { id: 't1' });

    dataStore.setWorkspace('lw-A');
    const list = await dataStore.listWorkspaces();
    const ids = list.map((w) => w.id);

    assert.ok(ids.includes('lw-A') && ids.includes('lw-B'), 'both workspaces are reported');
    assert.equal(list[0].id, 'lw-A', 'the active workspace is first');
    assert.ok(
      list.every((w) => !w.id.includes(':')),
      'a device-global kv key (kimtai:downloaded) is never read as a workspace',
    );
    const a = list.find((w) => w.id === 'lw-A');
    assert.ok(a && a.count >= 3, "A counts its record + blob + kv (not the global 'kimtai' key)");
  });

  test('the active workspace appears even when it holds nothing', async () => {
    env = installDom();
    const { dataStore } = await import('./dataStore.js');
    dataStore.setWorkspace('lw-empty');
    const list = await dataStore.listWorkspaces();
    assert.equal(list[0].id, 'lw-empty', 'the active workspace sorts first regardless of size');
    assert.equal(list.find((w) => w.id === 'lw-empty')?.count, 0);
  });
});
