// Notes' DELETE routes (#947). The bulk-delete commit used to swallow every rejection
// from these routes — partly to absorb a double-delete (a page selected alongside its
// own collection, which cascades). That absorb belongs HERE, as idempotency: deleting an
// id that is already gone resolves ok, so the commit needs no swallow and a REAL store
// failure rejects all the way to the undo toast (#288's contract). These tests pin both
// halves so a future "not found" throw cannot silently turn double-deletes into failures.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../../test/domEnv.js';

let env: DomEnv;

describe('notes DELETE routes are idempotent, and only a real failure rejects (#947)', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  async function routes() {
    await import('./notes.local.js'); // registers the handlers (idempotent module init)
    const { dispatch } = await import('../../lib/localRouter.js');
    const { dataStore } = await import('../../lib/dataStore.js');
    return { dispatch, dataStore };
  }

  test('deleting a page that is already gone resolves ok', async () => {
    const { dispatch, dataStore } = await routes();
    dataStore.setWorkspace('notes-del-a');
    const res = (await dispatch('DELETE', 'pages/no-such-page')) as { ok?: boolean };
    assert.equal(res.ok, true, 'an already-absent id is a success, not an error');
  });

  test('deleting a collection that is already gone resolves ok', async () => {
    const { dispatch, dataStore } = await routes();
    dataStore.setWorkspace('notes-del-b');
    const res = (await dispatch('DELETE', 'collections/no-such-col')) as { ok?: boolean };
    assert.equal(res.ok, true);
  });

  test('a collection delete cascades, so its pages deleted again in the same batch still succeed', async () => {
    const { dispatch, dataStore } = await routes();
    dataStore.setWorkspace('notes-del-c');
    const col = (await dispatch('POST', 'collections', { body: { name: 'Book' } })) as { id: string };
    const page = (await dispatch('POST', `collections/${col.id}/pages`, { body: { title: 'P1' } })) as { id: string };

    await dispatch('DELETE', `collections/${col.id}`);
    assert.equal((await dataStore.list('pages')).length, 0, 'the cascade removed the page');

    // The double-delete the old swallow existed for: the page's own commit after the cascade.
    const res = (await dispatch('DELETE', `pages/${page.id}`)) as { ok?: boolean };
    assert.equal(res.ok, true, 'the second delete of a cascaded page is a success');
  });

  test('a REAL store failure rejects through the route — nothing may swallow it', async () => {
    const { dispatch, dataStore } = await routes();
    dataStore.setWorkspace('notes-del-d');
    const col = (await dispatch('POST', 'collections', { body: { name: 'Book' } })) as { id: string };
    const page = (await dispatch('POST', `collections/${col.id}/pages`, { body: { title: 'P1' } })) as { id: string };

    const realRemove = dataStore.remove;
    dataStore.remove = async () => {
      throw new Error('quota blown');
    };
    try {
      await assert.rejects(dispatch('DELETE', `pages/${page.id}`), /quota blown/);
      await assert.rejects(dispatch('DELETE', `collections/${col.id}`), /quota blown/);
    } finally {
      dataStore.remove = realRemove;
    }
    assert.equal((await dataStore.list('pages')).length, 1, 'the page is still in the store — and must stay on screen');
  });
});
