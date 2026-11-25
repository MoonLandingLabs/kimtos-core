// Deleting must not quietly take the items the user marked to keep (#650).
//
// Clipboard's star already survives auto-cleanup and "Clear", so a favorite was protected
// everywhere EXCEPT the one path that destroys it: tick it (or press Select all) and the
// confirm said only "Delete 12 clips?" before taking the starred ones with it. `isProtected`
// makes the dialog name them and gates its Confirm behind an acknowledgement checkbox.
//
// The delete MECHANICS — the confirm/hide/undo/commit sequence both arities share — are
// covered in bulkSelect.test.ts (#724). This file covers only the guard on top of them.
//
// A real DOM is required: the whole guard IS the dialog's copy and its disabled Confirm.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';
import { createBulkSelect, type BulkEntry } from './bulkSelect.js';

let env: DomEnv;

const clip = (id: string, favorite = false): BulkEntry => ({ id, favorite });

const card = () => env.document.querySelector('.confirm-card') as HTMLElement | null;
const message = () => card()?.querySelector('.confirm-message')?.textContent ?? '';
const gate = () => card()?.querySelector('.confirm-check input') as HTMLInputElement | null;
const confirmBtn = () => card()?.querySelector('.button-primary') as HTMLButtonElement;
const cancelBtn = () => card()?.querySelector('.button-secondary') as HTMLButtonElement;

/** Let queued microtasks and zero-delay timers run. */
const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Tick the acknowledgement checkbox, which is what arms the guarded Confirm. */
function acknowledge(): void {
  const box = gate();
  assert.ok(box, 'the acknowledgement checkbox is rendered');
  box.checked = true;
  box.dispatchEvent(new Event('change'));
}

/** A bulk-select that treats `favorite` entries as protected, unless `protect` is off. */
function harness(entries: BulkEntry[], { protect = true }: { protect?: boolean } = {}) {
  const removed: string[] = [];
  const bulk = createBulkSelect({
    noun: 'clip',
    protectedNoun: 'favorite',
    isProtected: protect ? (e) => Boolean(e.favorite) : undefined,
    remove: (e) => {
      removed.push(e.id);
    },
    onChange: () => {},
    undoMs: 5,
  });
  return { bulk, removed, entries };
}

/** Select every entry and press Delete (N). Deliberately NOT async: the returned promise only
 *  settles once the confirm is answered, so awaiting this helper would deadlock the test. */
function pressDelete(h: ReturnType<typeof harness>): Promise<boolean> {
  h.entries.forEach((e) => h.bulk.setChecked(e.id, true));
  return h.bulk.deleteSelected(h.entries);
}

describe('createBulkSelect protects marked entries (#650)', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('a batch with nothing protected confirms exactly as before', async () => {
    const h = harness([clip('a'), clip('b')]);
    const done = pressDelete(h);
    await settle();

    assert.equal(message(), 'Delete 2 clips?');
    assert.equal(gate(), null, 'no acknowledgement checkbox when nothing is protected');
    assert.equal(confirmBtn().disabled, false, 'Confirm is available immediately');

    cancelBtn().click();
    assert.equal(await done, false);
  });

  test('an app that declares no protection is unaffected', async () => {
    const h = harness([clip('a', true), clip('b', true)], { protect: false });
    const done = pressDelete(h);
    await settle();

    assert.equal(message(), 'Delete 2 clips?');
    assert.equal(gate(), null);

    cancelBtn().click();
    assert.equal(await done, false);
  });

  test('a batch containing favorites names them and gates Confirm behind the acknowledgement', async () => {
    const h = harness([clip('a'), clip('b', true), clip('c', true)]);
    const done = pressDelete(h);
    await settle();

    assert.equal(message(), 'Delete 3 clips? 2 of them are favorites.');
    assert.equal(confirmBtn().disabled, true, 'Confirm starts disabled');
    assert.match(card()?.textContent ?? '', /Delete all 2 favorites too/);

    acknowledge();
    assert.equal(confirmBtn().disabled, false, 'ticking the box arms Confirm');

    cancelBtn().click();
    assert.equal(await done, false);
  });

  test('one favorite among several is described in the singular', async () => {
    const h = harness([clip('a'), clip('b', true)]);
    const done = pressDelete(h);
    await settle();

    assert.equal(message(), 'Delete 2 clips? 1 of them is a favorite.');
    assert.match(card()?.textContent ?? '', /Delete the favorite too/);

    cancelBtn().click();
    assert.equal(await done, false);
  });

  test('a batch that is entirely favorites says so', async () => {
    const h = harness([clip('a', true), clip('b', true)]);
    const done = pressDelete(h);
    await settle();

    assert.equal(message(), 'Delete 2 clips? All of them are favorites.');

    cancelBtn().click();
    assert.equal(await done, false);
  });

  test('cancelling the guarded confirm deletes nothing and leaves every row visible', async () => {
    const h = harness([clip('a'), clip('b', true)]);
    const done = pressDelete(h);
    await settle();
    cancelBtn().click();
    assert.equal(await done, false);
    await settle(20);

    assert.deepEqual(h.removed, []);
    assert.equal(h.bulk.filterVisible(h.entries).length, 2, 'both rows are still on screen');
  });

  test('acknowledging deletes the favorites along with the rest', async () => {
    const h = harness([clip('a'), clip('b', true)]);
    const done = pressDelete(h);
    await settle();
    acknowledge();
    confirmBtn().click();
    assert.equal(await done, true);

    await settle(30); // let the undo window lapse
    assert.deepEqual(h.removed.sort(), ['a', 'b']);
  });

  test('the single-row delete is guarded too, and an ordinary row is not', async () => {
    const h = harness([clip('a', true), clip('b')]);

    const guarded = h.bulk.deleteOne(h.entries[0]);
    await settle();
    assert.equal(message(), 'Delete this clip? It is a favorite.');
    assert.equal(confirmBtn().disabled, true, 'a single favorite is gated too');
    cancelBtn().click();
    assert.equal(await guarded, false);

    const plain = h.bulk.deleteOne(h.entries[1]);
    await settle();
    assert.equal(message(), 'Delete this clip?', 'an ordinary row keeps the plain question');
    assert.equal(gate(), null);
    cancelBtn().click();
    assert.equal(await plain, false);
  });
});
