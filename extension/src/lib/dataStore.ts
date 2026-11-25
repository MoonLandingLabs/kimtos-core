// Local data store — every app's records and uploaded blobs, kept on-device.
// Records live in one IndexedDB store partitioned by `collection`; files live in
// a `blobs` store and are exposed as object URLs; `kv` holds caches. App handlers
// (`*.local.js`) build on this.
//
// Workspaces (#406): all app data is scoped to the ACTIVE workspace. There are no accounts, so
// this is one id per install — `local`, or the id an older profile already stored its data
// under (models/store.ts `workspaceId`). The scoping is INTERNAL: handlers still call
// `list('notes-pages')` etc.; this module stamps the active workspace on every read/write.
// The settings store sets the active workspace (`setWorkspace`), and `migrateToWorkspaces`
// moves a pre-workspace install's data into it once. Model weights live in Cache Storage (not here) and
// are device-global; their kv tracking flags (see isGlobalKvKey) stay global too, so
// switching users never re-downloads a model.

import { idb } from './idb.js';

const RECORDS = 'records';
const BLOBS = 'blobs';
const KV = 'kv';

// --- workspaces ------------------------------------------------------------

/** The default workspace: what a fresh install writes to. */
export const LOCAL_WORKSPACE = 'local';

/** NUL — never appears in a collection name or app key, so it is an unambiguous
 *  workspace-prefix separator for the string-keyed `blobs`/`kv` stores and record `_pk`. */
const WS_SEP = '\u0000';

let activeWorkspace: string = LOCAL_WORKSPACE;

/** kv keys that are DEVICE-GLOBAL, never namespaced by workspace:
 *  - `kimtai:downloaded` / `kimtai:speed` — model download tracking + per-device speed
 *    benchmark. Kept global so a model cached under one workspace is never re-offered or
 *    re-downloaded for another (#406).
 *
 *  The `settings:*` mirror is now PER-USER (#472) — settings became per-workspace in
 *  chrome.storage, so the mirror follows. `migrateSettingsMirror` removes the old global
 *  mirror keys left by pre-#472 installs. */
const GLOBAL_KV_EXACT = new Set(['kimtai:downloaded', 'kimtai:speed']);

/** True for a kv key that stays device-global (excluded from per-user namespacing). */
export function isGlobalKvKey(key: string): boolean {
  return GLOBAL_KV_EXACT.has(key);
}

/** The active workspace's stored record primary key. */
const recPk = (collection: string, id: string): string => `${activeWorkspace}${WS_SEP}${collection}:${id}`;
/** Prefix a blob key with the active workspace. */
const blobKey = (key: string): string => `${activeWorkspace}${WS_SEP}${key}`;
/** Resolve a kv key to its stored form: global keys raw, everything else workspace-scoped. */
const kvStoredKey = (key: string): string => (isGlobalKvKey(key) ? key : `${activeWorkspace}${WS_SEP}${key}`);

/** A workspace's stored-key prefix (e.g. `<userId>\0`). AnubisDB uses it to filter blobs/kv
 *  to a workspace and peel the prefix back off for attribution — `WS_SEP` is private here. */
export function workspacePrefix(workspace: string): string {
  return `${workspace}${WS_SEP}`;
}

/** A record as stored (internal fields included). */
type Row = { _pk: string; workspace: string; collection: string; id: string } & Record<string, unknown>;
/** A record as returned (internal fields stripped). */
export type DataRecord = { id: string } & Record<string, unknown>;

// Hide internal fields (_pk/workspace/collection are rest-siblings, intentionally dropped).
const strip = ({ _pk, workspace, collection, ...rest }: Row): DataRecord => rest as DataRecord;

// 8-char hex id.
function uid(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Cache object URLs so repeated `blobUrl(key)` calls return the same URL (and so
// we can revoke it on overwrite/delete). Keyed by the STORED (workspace-scoped) key.
const urlCache = new Map<string, string>();

function dropUrl(storedKey: string): void {
  const url = urlCache.get(storedKey);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(storedKey);
  }
}

// Change notifications — fired after any mutating op so live views (e.g. the
// AnubisDB data console) can auto-refresh instead of needing a manual reload.
// In-tab only (IndexedDB has no cross-tab signal); consumers that also care
// about other tabs re-scan on focus/visibility too.
const changeListeners = new Set<() => void>();
const emitChange = (): void => {
  for (const fn of changeListeners) fn();
};
const afterChange = <T>(result: T): T => {
  emitChange();
  return result;
};

/** Set the active workspace (`local`, or the id an older profile kept). Called by the
 *  settings store; every subsequent read/write is scoped to it. */
function setWorkspace(workspace: string | null | undefined): void {
  const next = workspace || LOCAL_WORKSPACE;
  // `store.set` calls this on EVERY write, so a no-op guard keeps it from emitting a change each time.
  if (next === activeWorkspace) return;
  activeWorkspace = next;
  emitChange(); // live views (AnubisDB console) re-read the new workspace
}

/** The active workspace id. */
function getWorkspace(): string {
  return activeWorkspace;
}

interface DataExport {
  format: 'kimtos-data';
  version: number;
  exportedAt: number;
  records: Row[];
  kv: Record<string, unknown>;
  blobs: Record<string, string>;
}

export const dataStore = {
  uid,
  setWorkspace,
  getWorkspace,
  LOCAL_WORKSPACE,

  // Subscribe to any local data mutation (records/blobs/kv). Returns an
  // unsubscribe function. Fires once per mutating call; batch consumers debounce.
  onChange(fn: () => void): () => void {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  },

  async list(collection: string): Promise<DataRecord[]> {
    return (await idb.getAllByIndex<Row>(RECORDS, 'workspace_collection', [activeWorkspace, collection])).map(strip);
  },

  async get(collection: string, id: string): Promise<DataRecord | null> {
    const row = await idb.get<Row>(RECORDS, recPk(collection, id));
    return row ? strip(row) : null;
  },

  async put(collection: string, record: { id?: string } & Record<string, unknown>): Promise<DataRecord> {
    const id = record.id || uid();
    const row: Row = { ...record, id, collection, workspace: activeWorkspace, _pk: recPk(collection, id) };
    await idb.put(RECORDS, row);
    emitChange();
    return strip(row);
  },

  async patch(collection: string, id: string, patch: Record<string, unknown>): Promise<DataRecord | null> {
    const row = await idb.get<Row>(RECORDS, recPk(collection, id));
    if (!row) return null;
    const next: Row = {
      ...row,
      ...patch,
      id,
      collection,
      workspace: activeWorkspace,
      _pk: recPk(collection, id),
    };
    await idb.put(RECORDS, next);
    emitChange();
    return strip(next);
  },

  async remove(collection: string, id: string): Promise<void> {
    await idb.del(RECORDS, recPk(collection, id));
    emitChange();
  },

  // Delete every record in a collection (used when a user erases an app's data
  // on uninstall). No-op for an empty/unknown collection. Scoped to the active workspace.
  async clearCollection(collection: string): Promise<void> {
    for (const { id } of await this.list(collection)) await this.remove(collection, id);
  },

  // True if any of the given collections holds at least one record. Used to decide
  // whether an app has data worth offering to erase on uninstall.
  async hasAny(...collections: string[]): Promise<boolean> {
    for (const c of collections) if ((await this.list(c)).length) return true;
    return false;
  },

  // --- binary files ---
  async putBlob(key: string, blob: Blob): Promise<void> {
    const sk = blobKey(key);
    await idb.put(BLOBS, blob, sk);
    dropUrl(sk);
    emitChange();
  },

  async blobUrl(key: string): Promise<string | null> {
    const sk = blobKey(key);
    const cached = urlCache.get(sk);
    if (cached) return cached;
    const blob = await idb.get<Blob>(BLOBS, sk);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(sk, url);
    return url;
  },

  // The raw Blob (e.g. to hand a stored recording to another app for processing).
  async getBlob(key: string): Promise<Blob | null> {
    return (await idb.get<Blob>(BLOBS, blobKey(key))) || null;
  },

  async delBlob(key: string): Promise<void> {
    const sk = blobKey(key);
    await idb.del(BLOBS, sk);
    dropUrl(sk);
    emitChange();
  },

  // Which blobs under `prefix` exist, as app-facing keys (workspace prefix stripped) —
  // the read-side twin of clearBlobsByPrefix. One pass, so a list view can answer "which
  // of these do I already have?" without a lookup per row.
  async blobKeysByPrefix(prefix: string): Promise<string[]> {
    const storedPrefix = blobKey(prefix);
    const cut = blobKey('').length;
    return (await idb.getAllKeys(BLOBS))
      .map(String)
      .filter((sk) => sk.startsWith(storedPrefix))
      .map((sk) => sk.slice(cut));
  },

  // Delete every blob whose key starts with `prefix` (e.g. an app's `pdf:` files),
  // within the active workspace.
  async clearBlobsByPrefix(prefix: string): Promise<void> {
    const storedPrefix = blobKey(prefix);
    for (const key of await idb.getAllKeys(BLOBS)) {
      const sk = String(key);
      if (sk.startsWith(storedPrefix)) {
        await idb.del(BLOBS, sk);
        dropUrl(sk);
        emitChange();
      }
    }
  },

  // --- small key/value (caches) ---
  kv: {
    get: <T = unknown>(key: string): Promise<T | undefined> => idb.get<T>(KV, kvStoredKey(key)),
    set: (key: string, value: unknown): Promise<unknown> => idb.put(KV, value, kvStoredKey(key)).then(afterChange),
    del: (key: string): Promise<unknown> => idb.del(KV, kvStoredKey(key)).then(afterChange),
    // Caller-facing keys VISIBLE in the active workspace: global keys (raw) plus this
    // workspace's own keys (with the workspace prefix stripped). Other workspaces hidden.
    keys: async (): Promise<string[]> => {
      const wsPrefix = `${activeWorkspace}${WS_SEP}`;
      const out: string[] = [];
      for (const raw of await idb.getAllKeys(KV)) {
        const k = String(raw);
        if (k.startsWith(wsPrefix)) out.push(k.slice(wsPrefix.length));
        else if (isGlobalKvKey(k)) out.push(k);
      }
      return out;
    },
  },

  // --- portability: the user owns (and can back up) their data ---
  // Scoped to the ACTIVE workspace: a backup never includes the records of older workspaces
  // (data a profile kept from a removed account) that happen to share the device.
  async exportAll(): Promise<DataExport> {
    const records = (await idb.getAll<Row>(RECORDS)).filter((r) => r.workspace === activeWorkspace);
    const kv: Record<string, unknown> = {};
    for (const key of await this.kv.keys()) kv[key] = await this.kv.get(key);
    const blobs: Record<string, string> = {};
    const wsPrefix = `${activeWorkspace}${WS_SEP}`;
    for (const raw of await idb.getAllKeys(BLOBS)) {
      const sk = String(raw);
      if (!sk.startsWith(wsPrefix)) continue;
      const blob = await idb.get<Blob>(BLOBS, sk);
      if (blob) blobs[sk.slice(wsPrefix.length)] = await blobToDataUrl(blob);
    }
    return { format: 'kimtos-data', version: 1, exportedAt: Date.now(), records, kv, blobs };
  },

  // Restore into the ACTIVE workspace: records are re-stamped and blob/kv keys are
  // re-scoped to the current workspace, so a backup is portable across workspaces.
  async importAll(data: Partial<DataExport> | undefined): Promise<void> {
    if (data?.format !== 'kimtos-data') throw new Error('Not a Kimtos data file.');
    for (const record of data.records || []) {
      const collection = String(record.collection);
      const id = String(record.id);
      await idb.put(RECORDS, {
        ...record,
        id,
        collection,
        workspace: activeWorkspace,
        _pk: recPk(collection, id),
      });
    }
    for (const [key, value] of Object.entries(data.kv || {})) await idb.put(KV, value, kvStoredKey(key));
    for (const [key, dataUrl] of Object.entries(data.blobs || {})) {
      await idb.put(BLOBS, await (await fetch(dataUrl)).blob(), blobKey(key));
    }
    emitChange();
  },

  // One-time migration of a PRE-workspace install into `target` (the current user's
  // workspace, or `local`). Idempotent via a global flag. Records gain a `workspace`
  // field and a re-keyed `_pk`; per-user blobs/kv keys gain the workspace prefix; model
  // and settings keys (isGlobalKvKey) are left device-global. See #406.
  async migrateToWorkspaces(target: string): Promise<void> {
    const FLAG = '__ws_migrated';
    const TARGET_KEY = '__ws_migrate_target';
    if (await idb.get(KV, FLAG)) return;
    // Pin the target on the FIRST run and reuse it on every resume. The migration is not
    // atomic (each row/blob/key is its own transaction and the flag is written last), and
    // it runs in whatever context opens first (a new tab or the background worker). Without
    // pinning, an interrupted run that resumes under a DIFFERENT workspace id would stamp
    // the remaining pre-workspace rows with a different workspace — permanently splitting one
    // dataset across two workspaces. Pinning lands all pre-workspace data in one workspace (#406).
    let ws = (await idb.get<string>(KV, TARGET_KEY)) ?? '';
    if (!ws) {
      ws = target || LOCAL_WORKSPACE;
      await idb.put(KV, ws, TARGET_KEY);
    }

    // Records: stamp workspace + re-key any row that predates workspaces.
    for (const row of await idb.getAll<Row>(RECORDS)) {
      if (row.workspace) continue; // already migrated
      const collection = String(row.collection);
      const id = String(row.id);
      const newPk = `${ws}${WS_SEP}${collection}:${id}`;
      await idb.put(RECORDS, { ...row, workspace: ws, collection, id, _pk: newPk });
      if (row._pk !== newPk) await idb.del(RECORDS, row._pk);
    }

    // Blobs: all per-user. Re-key any that lack a workspace prefix.
    for (const raw of await idb.getAllKeys(BLOBS)) {
      const sk = String(raw);
      if (sk.includes(WS_SEP)) continue; // already prefixed
      const blob = await idb.get<Blob>(BLOBS, sk);
      if (blob) {
        await idb.put(BLOBS, blob, `${ws}${WS_SEP}${sk}`);
        await idb.del(BLOBS, sk);
      }
    }

    // kv: move per-user keys under the workspace; leave device-global keys alone.
    for (const raw of await idb.getAllKeys(KV)) {
      const k = String(raw);
      if (k === FLAG || k.startsWith('__') || k.includes(WS_SEP) || isGlobalKvKey(k)) continue;
      const value = await idb.get(KV, k);
      await idb.put(KV, value, `${ws}${WS_SEP}${k}`);
      await idb.del(KV, k);
    }

    await idb.put(KV, true, FLAG);
    await idb.del(KV, TARGET_KEY);
    emitChange();
  },

  // One-time cleanup for #472: the `settings:*` mirror became per-user, so the OLD global
  // (un-prefixed) mirror keys left by pre-#472 installs are stale — the store rewrites the
  // mirror per-workspace on the next save. Delete them once. Per-user mirror keys are
  // workspace-prefixed (`<ws>\0settings:…`), so they never start with `settings:` and are
  // left untouched.
  async migrateSettingsMirror(): Promise<void> {
    const FLAG = '__settings_mirror_migrated';
    if (await idb.get(KV, FLAG)) return;
    for (const raw of await idb.getAllKeys(KV)) {
      const k = String(raw);
      if (k.startsWith('settings:')) await idb.del(KV, k);
    }
    await idb.put(KV, true, FLAG);
    emitChange();
  },

  // The distinct workspaces present on-device (#473), each with a rough size and item count,
  // so AnubisDB can list and switch between them. Records carry a `workspace` field; blob/kv
  // keys carry a `<ws>\0` prefix (device-global kv keys — model tracking, settings mirror —
  // have none and are skipped, as are internal `__flags`). The active workspace is always
  // included, even when empty. Active first, then largest.
  async listWorkspaces(): Promise<Array<{ id: string; bytes: number; count: number }>> {
    const enc = new TextEncoder();
    const stats = new Map<string, { bytes: number; count: number }>();
    const bump = (ws: string, bytes: number): void => {
      const s = stats.get(ws) ?? { bytes: 0, count: 0 };
      s.bytes += bytes;
      s.count += 1;
      stats.set(ws, s);
    };
    const wsOf = (raw: string): string | null => {
      const i = raw.indexOf(WS_SEP);
      return i > 0 ? raw.slice(0, i) : null;
    };
    for (const row of await idb.getAll<Row>(RECORDS)) {
      if (row.workspace) bump(row.workspace, enc.encode(JSON.stringify(row)).length);
    }
    for (const raw of await idb.getAllKeys(BLOBS)) {
      const ws = wsOf(String(raw));
      if (ws) bump(ws, (await idb.get<Blob>(BLOBS, raw))?.size ?? 0);
    }
    for (const raw of await idb.getAllKeys(KV)) {
      const ws = wsOf(String(raw));
      if (ws) bump(ws, enc.encode(JSON.stringify((await idb.get(KV, raw)) ?? null)).length);
    }
    if (!stats.has(activeWorkspace)) stats.set(activeWorkspace, { bytes: 0, count: 0 });
    return [...stats.entries()]
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => (a.id === activeWorkspace ? -1 : b.id === activeWorkspace ? 1 : b.bytes - a.bytes));
  },
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
