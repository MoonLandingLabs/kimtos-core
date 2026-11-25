// One-time migration: `homefs-*` -> `kimtfs-*` (#188).
//
// The app was renamed. Its storage partitions are id-prefixed — `homefs-nodes` and
// `homefs:<id>` — which is what CLAUDE.md convention 6 requires and what lets AnubisDB
// attribute the data to the app. So renaming the id RENAMES THE PARTITIONS, and every file
// the user has ever saved would simply stop existing. This is the local-first file system:
// those bytes are in this browser's IndexedDB and nowhere else. There is no server copy to
// restore from, because there is no server.
//
// (The `app-rename` skill asserts no migration is ever needed because partitions are
// unprefixed. That is true of the legacy apps and false of this one — see #190.)
//
// Two properties do the work:
//
//   COPY, THEN DELETE — never move. Nothing old is dropped until its copy exists. If the
//   tab is closed mid-run, the worst case is a partial copy on the new side and the ENTIRE
//   original still on the old side, so the next run simply redoes it. The failure mode is
//   duplicated effort, never lost data.
//
//   IDEMPOTENT BY CONSTRUCTION — the trigger is "does the old collection still have rows".
//   A completed run leaves none, so a second run is a no-op. There is no version flag to
//   set, and therefore no version flag to get wrong (a flag written before the copy
//   finished would strand the data forever).
//
// Blobs cannot be enumerated: dataStore has `clearBlobsByPrefix` but no `listBlobs`. So
// their keys are derived from the node records (`homefs:<node.id>`). A blob whose node is
// already gone is unreachable anyway, and the final sweep clears it.

/** The slice of dataStore this needs — so a test can hand it a fake. */
export interface MigrationStore {
  list(collection: string): Promise<Record<string, unknown>[]>;
  put(collection: string, record: { id?: string } & Record<string, unknown>): Promise<unknown>;
  clearCollection(collection: string): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  putBlob(key: string, blob: Blob): Promise<void>;
  clearBlobsByPrefix(prefix: string): Promise<void>;
}

const OLD_NODES = 'homefs-nodes';
const NEW_NODES = 'kimtfs-nodes';
const OLD_BLOB = (id: string): string => `homefs:${id}`;
const NEW_BLOB = (id: string): string => `kimtfs:${id}`;

/**
 * Carry any `homefs` data across to `kimtfs`. Safe to call on every boot: it is a no-op
 * once the old collection is empty (a fresh profile, or an already-migrated one).
 *
 * Resolves when the store is safe to read. Never rejects — a migration that throws would
 * take the whole app down with it, and a user who cannot open KimtFS cannot rescue their
 * files either. On failure the OLD data is still intact (nothing is deleted before its copy
 * exists), so the next boot tries again.
 */
export async function migrateFromHomefs(db: MigrationStore): Promise<void> {
  try {
    const old = await db.list(OLD_NODES);
    if (!old.length) return; // the common case, on every boot after the first

    // 1. Copy every node. The ids are preserved, so `parentId` links keep pointing at the
    //    right parents and the tree survives intact.
    for (const node of old) {
      await db.put(NEW_NODES, node as { id?: string } & Record<string, unknown>);
    }

    // 2. Copy the bytes of every uploaded file, re-keyed to the new prefix.
    for (const node of old) {
      const id = String(node.id ?? '');
      if (!id || node.kind !== 'blob') continue;
      const blob = await db.getBlob(OLD_BLOB(id));
      if (blob) await db.putBlob(NEW_BLOB(id), blob);
    }

    // 3. ONLY NOW is anything deleted — every node and every byte already has a copy.
    await db.clearBlobsByPrefix('homefs:');
    await db.clearCollection(OLD_NODES);
  } catch (err) {
    // Leave the old data where it is and let the next boot retry. Do not rethrow: the app
    // must still open, or the user has no way to reach the files this is trying to save.
    console.error('KimtFS: migrating homefs data failed; the original data is untouched.', err);
  }
}
