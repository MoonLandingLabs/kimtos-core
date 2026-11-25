// Tiny promise wrapper over IndexedDB — the single local database for kimtos.
// Fixed schema (never changes per app): one `records` store keyed by `_pk`
// (`<workspace>\0<collection>:<id>`) with a `collection` index and a
// `[workspace, collection]` compound index (per-user workspaces, #406), plus
// `blobs` and `kv` stores.
//
// v2 (#406) added the `workspace_collection` compound index that `dataStore.list`
// queries to scope records to the active workspace. The row data is migrated
// separately (async, reading the active workspace id) by `dataStore.migrateToWorkspaces`,
// since `onupgradeneeded` runs a synchronous transaction and cannot read chrome.storage.

const DB_NAME = 'kimtos';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      let records: IDBObjectStore;
      if (!db.objectStoreNames.contains('records')) {
        records = db.createObjectStore('records', { keyPath: '_pk' });
        records.createIndex('collection', 'collection', { unique: false });
      } else {
        // Existing store: reach it through the upgrade transaction to add an index.
        records = req.transaction!.objectStore('records');
      }
      // Per-user workspaces (#406): scope record queries to (workspace, collection).
      // Rows written before v2 have no `workspace` field, so they are absent from this
      // index until `dataStore.migrateToWorkspaces` backfills them on first run.
      if (!records.indexNames.contains('workspace_collection')) {
        records.createIndex('workspace_collection', ['workspace', 'collection'], { unique: false });
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Run one request in a transaction and resolve with its result once the
// transaction commits (durable writes).
function run<T>(
  store: string,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = op(tx.objectStore(store));
        let result: T | undefined;
        if (req)
          req.onsuccess = () => {
            result = req.result;
          };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const idb = {
  get: <T = unknown>(store: string, key: IDBValidKey): Promise<T | undefined> =>
    run<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  getAll: <T = unknown>(store: string): Promise<T[]> =>
    run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>) as Promise<T[]>,
  getAllKeys: (store: string): Promise<IDBValidKey[]> =>
    run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()) as Promise<IDBValidKey[]>,
  getAllByIndex: <T = unknown>(store: string, index: string, value: IDBValidKey): Promise<T[]> =>
    run<T[]>(store, 'readonly', (s) => s.index(index).getAll(value) as IDBRequest<T[]>) as Promise<T[]>,
  put: (store: string, value: unknown, key?: IDBValidKey): Promise<unknown> =>
    run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
  del: (store: string, key: IDBValidKey): Promise<unknown> => run(store, 'readwrite', (s) => s.delete(key)),
};
