// The migration is the one piece of this app that can destroy something irrecoverable: it
// moves the user's entire file system from `homefs-*` to `kimtfs-*`, and those bytes exist
// in this browser's IndexedDB and nowhere else. There is no server copy, because there is
// no server.
//
// So it is tested for the property that matters — NOTHING OLD IS DELETED UNTIL ITS COPY
// EXISTS — and not merely for "it copies stuff".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { migrateFromHomefs, type MigrationStore } from './migrate.js';

type Row = Record<string, unknown>;

/** A fake dataStore that records the ORDER of operations, which is the whole point. */
function fakeStore(seed: { nodes?: Row[]; blobs?: Record<string, string> } = {}) {
  const collections = new Map<string, Row[]>([['homefs-nodes', [...(seed.nodes ?? [])]]]);
  const blobs = new Map<string, Blob>();
  for (const [k, v] of Object.entries(seed.blobs ?? {})) blobs.set(k, new Blob([v]));
  const log: string[] = [];

  const db: MigrationStore = {
    async list(c) {
      return [...(collections.get(c) ?? [])];
    },
    async put(c, record) {
      log.push(`put:${c}:${String(record.id)}`);
      const rows = collections.get(c) ?? [];
      rows.push(record as Row);
      collections.set(c, rows);
    },
    async clearCollection(c) {
      log.push(`clearCollection:${c}`);
      collections.set(c, []);
    },
    async getBlob(k) {
      return blobs.get(k) ?? null;
    },
    async putBlob(k, b) {
      log.push(`putBlob:${k}`);
      blobs.set(k, b);
    },
    async clearBlobsByPrefix(p) {
      log.push(`clearBlobsByPrefix:${p}`);
      for (const k of [...blobs.keys()]) if (k.startsWith(p)) blobs.delete(k);
    },
  };
  return { db, collections, blobs, log };
}

const folder = (id: string) => ({ id, parentId: '', type: 'folder', name: id });
const textFile = (id: string, parentId = '') => ({ id, parentId, type: 'file', kind: 'text', name: id, text: 'hi' });
const blobFile = (id: string, parentId = '') => ({ id, parentId, type: 'file', kind: 'blob', name: id });

describe('migrateFromHomefs — the tree survives', () => {
  test('every node is copied, ids intact, so parentId links still resolve', async () => {
    const { db, collections } = fakeStore({ nodes: [folder('docs'), textFile('a.txt', 'docs')] });
    await migrateFromHomefs(db);

    const moved = collections.get('kimtfs-nodes') ?? [];
    assert.equal(moved.length, 2);
    assert.deepEqual(
      moved.map((n) => n.id),
      ['docs', 'a.txt'],
    );
    // the child still points at its parent by the SAME id — a re-id would orphan the tree
    assert.equal(moved.find((n) => n.id === 'a.txt')?.parentId, 'docs');
  });

  test("an uploaded file's BYTES are carried across, re-keyed to the new prefix", async () => {
    const { db, blobs } = fakeStore({ nodes: [blobFile('pic')], blobs: { 'homefs:pic': 'PNGDATA' } });
    await migrateFromHomefs(db);

    assert.ok(blobs.has('kimtfs:pic'), 'the blob was not carried across');
    assert.equal(await blobs.get('kimtfs:pic')!.text(), 'PNGDATA', 'the bytes changed');
    assert.ok(!blobs.has('homefs:pic'), 'the old blob should be swept once the copy exists');
  });

  test('the old partitions are emptied afterwards, so AnubisDB shows one owner, not two', async () => {
    const { db, collections } = fakeStore({ nodes: [textFile('a.txt')] });
    await migrateFromHomefs(db);
    assert.deepEqual(collections.get('homefs-nodes'), []);
  });
});

describe('migrateFromHomefs — nothing is deleted before its copy exists', () => {
  test('ORDER: every put/putBlob happens BEFORE any clear', async () => {
    const { db, log } = fakeStore({
      nodes: [folder('docs'), blobFile('pic', 'docs'), textFile('a.txt', 'docs')],
      blobs: { 'homefs:pic': 'BYTES' },
    });
    await migrateFromHomefs(db);

    const firstDelete = log.findIndex((e) => e.startsWith('clear'));
    const lastWrite = log.reduce((acc, e, i) => (e.startsWith('put') ? i : acc), -1);
    assert.ok(firstDelete > lastWrite, `a delete ran before the last copy:\n${log.join('\n')}`);
  });

  test('if the copy throws mid-run, the ORIGINAL data is still fully intact', async () => {
    const { db, collections, blobs } = fakeStore({
      nodes: [textFile('a.txt'), blobFile('pic')],
      blobs: { 'homefs:pic': 'BYTES' },
    });
    // the blob copy explodes (quota exceeded, say) — the realistic failure
    db.putBlob = async () => {
      throw new Error('QuotaExceededError');
    };

    await migrateFromHomefs(db); // must NOT reject: an app that cannot open cannot rescue files

    assert.equal((collections.get('homefs-nodes') ?? []).length, 2, 'the old rows were destroyed');
    assert.ok(blobs.has('homefs:pic'), 'the old bytes were destroyed');
  });

  test('a failed migration is retried on the next boot, and then succeeds', async () => {
    const store = fakeStore({ nodes: [blobFile('pic')], blobs: { 'homefs:pic': 'BYTES' } });
    const realPutBlob = store.db.putBlob;
    store.db.putBlob = async () => {
      throw new Error('boom');
    };
    await migrateFromHomefs(store.db); // fails, changes nothing destructive

    store.db.putBlob = realPutBlob; // next boot, the disk is happy again
    await migrateFromHomefs(store.db);

    assert.ok(store.blobs.has('kimtfs:pic'));
    assert.deepEqual(store.collections.get('homefs-nodes'), []);
  });
});

describe('migrateFromHomefs — safe to run on every boot', () => {
  test('a fresh profile (no old data) is a no-op', async () => {
    const { db, log } = fakeStore({ nodes: [] });
    await migrateFromHomefs(db);
    assert.deepEqual(log, [], 'it touched the store when there was nothing to migrate');
  });

  test('a second run does nothing — idempotent, with no version flag to get wrong', async () => {
    const store = fakeStore({ nodes: [textFile('a.txt')] });
    await migrateFromHomefs(store.db);
    const after = store.log.length;

    await migrateFromHomefs(store.db);
    assert.equal(store.log.length, after, 'the second run was not a no-op');
    assert.equal((store.collections.get('kimtfs-nodes') ?? []).length, 1, 'it duplicated the data');
  });

  test('a missing blob does not abort the migration of everything else', async () => {
    // the node says it is a blob, but the bytes are gone (an old bug, a cleared cache)
    const { db, collections } = fakeStore({ nodes: [blobFile('ghost'), textFile('a.txt')], blobs: {} });
    await migrateFromHomefs(db);
    assert.equal((collections.get('kimtfs-nodes') ?? []).length, 2, 'a missing blob lost the other files');
  });
});
