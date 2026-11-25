// Close the tab during a Denoise run and the work was gone — not just the result, but the INPUT.
// The recording only ever existed in that page (#314). For a local-first tool that is the worst
// thing that can happen: the user's own file, destroyed by closing a tab.
//
// So a job writes itself down before it runs. These tests pin the properties that make the resume
// prompt honest — above all the ORDER, because a record that points at an input which was never
// saved is a button that cannot do what it says.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { beginJob, endJob, pendingJob, pendingInput, type JobDb } from './jobStore.js';

/** A fake store that records the ORDER of writes — the property that matters most here. */
function fakeDb() {
  const kv = new Map<string, unknown>();
  const blobs = new Map<string, Blob>();
  const order: string[] = [];
  const db: JobDb = {
    kv: {
      get: async <T>(k: string) => kv.get(k) as T | undefined,
      set: async (k, v) => {
        order.push(`kv:${k}`);
        kv.set(k, v);
      },
      del: async (k) => {
        order.push(`kv-del:${k}`);
        kv.delete(k);
      },
    },
    putBlob: async (k, b) => {
      order.push(`blob:${k}`);
      blobs.set(k, b);
    },
    getBlob: async (k) => blobs.get(k),
    delBlob: async (k) => {
      order.push(`blob-del:${k}`);
      blobs.delete(k);
    },
  };
  return { db, kv, blobs, order };
}

const RECORDING = new Blob(['pretend-audio'], { type: 'audio/webm' });
const JOB = { kind: 'denoise', name: 'recording.webm' };

describe('a job exists on disk BEFORE it runs (#314)', () => {
  let f: ReturnType<typeof fakeDb>;
  beforeEach(() => (f = fakeDb()));

  test('THE INPUT IS SAVED FIRST, then the record that points at it', async () => {
    // If the record landed first and the tab died in between, the app would greet the user with a
    // resume prompt for an input that does not exist — a lie told to someone who just lost a
    // recording. Order is the whole guarantee.
    await beginJob('denoise', JOB, RECORDING, f.db);
    assert.deepEqual(f.order, ['blob:denoise:job-input', 'kv:denoise:job']);
  });

  test('the record says what was being done, and to what', async () => {
    await beginJob('denoise', JOB, RECORDING, f.db);
    const rec = await pendingJob('denoise', f.db);
    assert.equal(rec?.kind, 'denoise');
    assert.equal(rec?.name, 'recording.webm');
    assert.ok(rec!.startedAt > 0);
  });

  test('the input survives, which is the entire point', async () => {
    await beginJob('denoise', JOB, RECORDING, f.db);
    const input = await pendingInput('denoise', f.db);
    assert.ok(input, 'the recording must still exist after the page is gone');
    assert.equal(input!.size, RECORDING.size);
  });

  test('the keys are prefixed with the app id, so AnubisDB attributes them (convention 6)', async () => {
    await beginJob('denoise', JOB, RECORDING, f.db);
    assert.ok(f.kv.has('denoise:job'));
    assert.ok(f.blobs.has('denoise:job-input'));
  });
});

describe('a finished job leaves nothing behind', () => {
  let f: ReturnType<typeof fakeDb>;
  beforeEach(() => (f = fakeDb()));

  test('ending clears the record AND the input — no orphaned recording on disk', async () => {
    await beginJob('denoise', JOB, RECORDING, f.db);
    await endJob('denoise', f.db);
    assert.equal(await pendingJob('denoise', f.db), null);
    assert.equal(f.kv.size, 0);
    assert.equal(f.blobs.size, 0, 'the input must not linger — it can be a large recording');
  });

  test('a FAILED job also clears — a failure must not resurrect as a resume prompt', async () => {
    // endJob is called on both paths. If it were not, a job that told the user it failed would
    // offer to resume itself the next time they opened the app.
    await beginJob('denoise', JOB, RECORDING, f.db);
    await endJob('denoise', f.db); // the catch branch calls this too
    assert.equal(await pendingJob('denoise', f.db), null);
  });

  test('nothing pending when nothing ever ran', async () => {
    assert.equal(await pendingJob('denoise', f.db), null);
  });
});

describe('the resume prompt never lies', () => {
  let f: ReturnType<typeof fakeDb>;
  beforeEach(() => (f = fakeDb()));

  test('a record whose input is MISSING reports nothing pending, and cleans itself up', async () => {
    // Half-written state: the record exists, the blob does not (a quota failure, a wiped store).
    // Offering to resume would dangle a button that cannot work. Say there is nothing.
    await beginJob('denoise', JOB, RECORDING, f.db);
    f.blobs.delete('denoise:job-input');

    assert.equal(await pendingJob('denoise', f.db), null);
    assert.equal(f.kv.size, 0, 'the useless record is swept, not left to prompt again tomorrow');
  });

  test('jobs are per-app: one app’s pending work is not another’s', async () => {
    await beginJob('denoise', JOB, RECORDING, f.db);
    assert.equal(await pendingJob('transcribe', f.db), null);
    assert.ok(await pendingJob('denoise', f.db));
  });
});
