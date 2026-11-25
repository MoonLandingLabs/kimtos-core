// The single-row delete on the shared multi-select (#724).
//
// The bug this guards: every host hand-rolled its per-row Delete straight against the
// store, so the SAME item deleted from the batch bar got a confirm and an Undo window,
// while the row's own trash icon deleted it instantly with nothing to undo. `deleteOne`
// is now the one path, and these tests hold it to the batch path's guarantees: ask
// first, hide at once, commit only when the undo window lapses, and put the row back
// if the commit fails (the item still exists — #288).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';
import { createBulkSelect, type BulkEntry } from './bulkSelect.js';

let env: DomEnv;

const UNDO_MS = 20;
const entry = (id: string): BulkEntry => ({ id });

const confirmBtn = () => env.document.querySelector('.confirm-card .button-primary') as HTMLButtonElement;
const cancelBtn = () => env.document.querySelector('.confirm-card .button-secondary') as HTMLButtonElement;
const toast = () => env.document.querySelector('.undo-toast');
const undoBtn = () => env.document.querySelector('.undo-toast-btn') as HTMLButtonElement;

/** Let queued microtasks and timers run; the undo window is `UNDO_MS`. */
const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A bulk-select wired to a spy `remove`, plus a repaint counter. */
function harness(removeImpl: (e: BulkEntry) => Promise<void> | void = () => {}) {
  const removed: string[] = [];
  const state = { repaints: 0 };
  const bulk = createBulkSelect({
    noun: 'task',
    undoMs: UNDO_MS,
    remove: async (e) => {
      removed.push(e.id);
      await removeImpl(e);
    },
    onChange: () => {
      state.repaints++;
    },
  });
  return { bulk, removed, state };
}

describe('createBulkSelect.deleteOne (#724)', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('it asks first, and cancelling deletes nothing', async () => {
    const { bulk, removed, state } = harness();
    const done = bulk.deleteOne(entry('a'));
    await settle();

    assert.ok(cancelBtn(), 'a confirm dialog must open before anything is deleted');
    cancelBtn().click();

    assert.equal(await done, false, 'deleteOne reports the user cancelled');
    assert.deepEqual(removed, [], 'nothing was removed');
    assert.equal(bulk.isPending('a'), false, 'the row was never hidden');
    assert.equal(state.repaints, 0, 'a cancel does not repaint');
    assert.equal(toast(), null, 'no undo toast for a delete that never happened');
  });

  test('confirming hides the row at once and shows an undo toast', async () => {
    const { bulk, removed } = harness();
    const done = bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();

    assert.equal(await done, true);
    assert.equal(bulk.isPending('a'), true, 'the row is hidden for the undo window');
    assert.deepEqual(
      bulk.filterVisible([entry('a'), entry('b')]).map((e) => e.id),
      ['b'],
    );
    assert.ok(toast(), 'the undo toast is up');
    assert.deepEqual(removed, [], 'nothing is committed while the undo window is open');

    undoBtn().click(); // do not leave a timer running into the next test
    await settle();
  });

  test('Undo restores the row and never touches the store', async () => {
    const { bulk, removed, state } = harness();
    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();
    await settle();

    const before = state.repaints;
    undoBtn().click();
    await settle();

    assert.deepEqual(removed, [], 'undo must not delete');
    assert.equal(bulk.isPending('a'), false, 'the row is back');
    assert.ok(state.repaints > before, 'the host repainted so the row reappears');

    await settle(UNDO_MS * 3);
    assert.deepEqual(removed, [], 'the lapsed timer must not fire after an undo');
  });

  test('letting the window lapse commits exactly one delete', async () => {
    const { bulk, removed } = harness();
    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();

    await settle(UNDO_MS * 4);
    assert.deepEqual(removed, ['a'], 'the delete committed once, and only once');
    assert.equal(bulk.isPending('a'), false, 'no longer pending — it is really gone');
    assert.equal(toast(), null, 'the toast is dismissed');
  });

  test('a delete that fails brings the row back and says so', async () => {
    const { bulk, state } = harness(() => {
      throw new Error('boom');
    });
    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();

    await settle(UNDO_MS * 4);
    assert.equal(bulk.isPending('a'), false, 'the item still exists, so its row must not stay hidden');
    assert.ok(state.repaints >= 2, 'the host repaints from truth after a failed commit');
    assert.ok(env.document.querySelector('.snackbar'), 'the user is told the delete did not happen');
  });

  test('deleting one row does not throw away a selection the user built up', async () => {
    const { bulk } = harness();
    bulk.setChecked('b', true);
    bulk.setChecked('c', true);

    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();
    await settle();

    assert.equal(bulk.isChecked('b'), true);
    assert.equal(bulk.isChecked('c'), true);

    undoBtn().click();
    await settle();
  });

  test('the batch delete still exits selection mode and commits every target', async () => {
    const { bulk, removed } = harness();
    const visible = [entry('a'), entry('b'), entry('c')];
    bulk.setChecked('a', true);
    bulk.setChecked('c', true);

    const done = bulk.deleteSelected(visible);
    await settle();
    confirmBtn().click();
    assert.equal(await done, true);
    assert.equal(bulk.isSelecting(), false, 'the batch path leaves selection mode');

    await settle(UNDO_MS * 4);
    assert.deepEqual(removed.sort(), ['a', 'c']);
  });

  test('a batch delete with nothing selected asks nothing and does nothing', async () => {
    const { bulk, removed } = harness();
    assert.equal(await bulk.deleteSelected([entry('a')]), false);
    assert.equal(cancelBtn(), null, 'no confirm for an empty selection');
    assert.deepEqual(removed, []);
  });
});

// The commit transition repaints from TRUTH (#940). A host that renders an in-memory
// snapshot (Tabs' `windows`) is stale the moment the commit clears the pending ids, so
// repainting the snapshot resurrects the rows that were just deleted. `refresh` is the
// re-read-then-repaint path; it must carry the commit transitions and ONLY those —
// selection toggles and undo stay on the cheap `onChange`, so a host can keep those
// synchronous (the focused-search-box rule, #217).
describe('createBulkSelect refresh-from-truth on commit (#940)', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  /** Like `harness`, but with a distinct `refresh` spy so the two paths are tellable apart. */
  function truthHarness(removeImpl: (e: BulkEntry) => Promise<void> | void = () => {}) {
    const removed: string[] = [];
    const state = { repaints: 0, refreshes: 0 };
    const bulk = createBulkSelect({
      noun: 'tab',
      undoMs: UNDO_MS,
      remove: async (e) => {
        removed.push(e.id);
        await removeImpl(e);
      },
      onChange: () => {
        state.repaints++;
      },
      refresh: () => {
        state.refreshes++;
      },
    });
    return { bulk, removed, state };
  }

  test('a committed delete repaints via refresh, never via the stale onChange', async () => {
    const { bulk, removed, state } = truthHarness();
    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();
    await settle();

    assert.equal(state.refreshes, 0, 'no re-read while the undo window is open');
    const paintsBeforeCommit = state.repaints;

    await settle(UNDO_MS * 4);
    assert.deepEqual(removed, ['a']);
    assert.equal(state.refreshes, 1, 'the commit re-reads the store exactly once');
    assert.equal(state.repaints, paintsBeforeCommit, 'the commit never repaints the stale snapshot');
  });

  test('a FAILED commit also repaints via refresh, so survivors come back from truth', async () => {
    const { bulk, state } = truthHarness(() => {
      throw new Error('boom');
    });
    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();

    await settle(UNDO_MS * 4);
    assert.ok(state.refreshes >= 1, 'the failed commit still re-reads the store');
    assert.ok(env.document.querySelector('.snackbar'), 'the user is told the delete did not happen');
  });

  test('undo and selection changes stay on onChange — nothing was deleted, the snapshot is truth', async () => {
    const { bulk, removed, state } = truthHarness();
    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();
    await settle();
    undoBtn().click();
    await settle(UNDO_MS * 3);

    assert.deepEqual(removed, [], 'undo committed nothing');
    assert.equal(state.refreshes, 0, 'an undo never forces a store re-read');
    assert.ok(state.repaints >= 2, 'hide and undo both repainted via onChange');
  });

  test('a repaint failure is not a delete failure — no snackbar lying about the delete', async () => {
    const removed: string[] = [];
    const bulk = createBulkSelect({
      noun: 'tab',
      undoMs: UNDO_MS,
      remove: (e) => {
        removed.push(e.id);
      },
      onChange: () => {},
      refresh: () => {
        throw new Error('re-query blew up');
      },
    });
    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();

    await settle(UNDO_MS * 4);
    assert.deepEqual(removed, ['a'], 'the delete itself committed');
    assert.equal(env.document.querySelector('.snackbar'), null, 'a repaint failure must not report a failed delete');
  });

  test('refresh defaults to onChange, so existing hosts are untouched', async () => {
    const { bulk, removed, state } = harness();
    void bulk.deleteOne(entry('a'));
    await settle();
    confirmBtn().click();
    const before = state.repaints;

    await settle(UNDO_MS * 4);
    assert.deepEqual(removed, ['a']);
    assert.ok(state.repaints > before, 'without a refresh of its own, the commit falls back to onChange');
  });
});
