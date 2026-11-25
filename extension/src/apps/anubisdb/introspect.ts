// AnubisDB introspection — the read/export/import/clear layer over the single
// on-device IndexedDB (`kimtos`). It reads the three fixed stores directly
// (records / blobs / kv), groups every partition under the app that owns it, and
// offers per-app + global export, import, and clear. Everything is local; a blob
// is measured by its cheap `.size` (its bytes are never loaded to do so).
//
// Per-user workspaces (#406): the console shows the ACTIVE workspace only. Records
// carry a `workspace` field; blob/kv keys carry a `<workspace>\0` prefix (device-global
// kv keys — model tracking, the settings mirror — are unprefixed and always shown).
// Keys are PEELED to their app-facing form for attribution and display, so a note
// stored as `<userId>\0notes-pages:ab12` is attributed to Notes, not to a `<userId>`
// pseudo-app. Import re-scopes into the active workspace via `dataStore`.

import { idb } from '../../lib/idb.js';
import { dataStore, isGlobalKvKey, workspacePrefix } from '../../lib/dataStore.js';
import {
  applySettingsFromDb,
  clearAppSettings,
  clearAllAppSettings,
  restoreFullBackup,
} from '../../lib/settingsControl.js';
import { appMeta, ownerOf, type AppMeta } from './registry.js';

export type Kind = 'records' | 'blobs' | 'kv';

export interface Partition {
  key: string; // 'books' | 'history:televoica' | 'pdf' | 'kv'
  kind: Kind;
  owner: string;
  label: string;
  count: number;
  bytes: number;
}
export interface AppNode extends AppMeta {
  partitions: Partition[];
  count: number;
  bytes: number;
}
export interface Snapshot {
  apps: AppNode[];
  totalBytes: number;
  totalCount: number;
  generatedAt: number;
}

// A portable, self-contained dump of one app's data (blobs inlined as data URLs).
// Keys are app-facing (workspace-peeled); restoring re-scopes them into the active
// workspace via dataStore.
export interface AppExport {
  format: 'anubisdb-app';
  version: 1;
  app: string;
  name: string;
  exportedAt: number;
  records: Record<string, unknown>[];
  blobs: Record<string, string>;
  kv: Record<string, unknown>;
}

const enc = new TextEncoder();
const jsonBytes = (v: unknown): number => {
  try {
    return enc.encode(JSON.stringify(v ?? null)).length;
  } catch {
    return 0;
  }
};

// Blob keys are `<namespace>[:/]<id>`; group by the leading namespace so each
// partition maps to a single app. `history:<app>/<uid>` → `history:<app>`. The key
// passed here is already workspace-peeled (app-facing).
function blobNamespace(key: string): string {
  const k = String(key);
  if (k.startsWith('history:')) return k.split('/')[0];
  const colon = k.indexOf(':');
  return colon > 0 ? k.slice(0, colon) : 'misc';
}

// kv keys default to the system bucket unless they carry a known app prefix.
function kvOwner(key: string): string {
  const o = ownerOf(String(key));
  return o === 'unknown' ? 'system' : o;
}

// --- workspace peeling -----------------------------------------------------

/** The app-facing form of a stored blob key in the active workspace, or null when
 *  the key belongs to another workspace (hidden). All blob keys are per-user. */
function peelBlobKey(raw: string, prefix: string): string | null {
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

/** The app-facing form of a stored kv key visible in the active workspace: this
 *  workspace's own keys (peeled) and the device-global keys (raw). Null otherwise
 *  (another workspace, or an internal `__flag`). */
function peelKvKey(raw: string, prefix: string): string | null {
  if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  if (raw.startsWith('__')) return null;
  return isGlobalKvKey(raw) ? raw : null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---- scan: the whole tree, grouped by app ---------------------------------

interface Bucket {
  kind: Kind;
  key: string;
  owner: string;
  label: string;
  count: number;
  bytes: number;
}

export async function scan(workspace: string = dataStore.getWorkspace()): Promise<Snapshot> {
  const ws = workspace;
  const prefix = workspacePrefix(workspace);
  const [records, blobKeys, kvKeys] = await Promise.all([
    idb.getAll('records') as Promise<Record<string, unknown>[]>,
    idb.getAllKeys('blobs') as Promise<IDBValidKey[]>,
    idb.getAllKeys('kv') as Promise<IDBValidKey[]>,
  ]);

  const buckets = new Map<string, Bucket>(); // `${kind} ${owner} ${key}` → bucket (owner-scoped; see bump)
  const bump = (kind: Kind, key: string, owner: string, label: string, bytes: number) => {
    // Owner MUST be in the id: kv partitions all carry the constant key 'kv' (one settings
    // row per app), so keying by kind+key alone collapsed every app's kv into ONE bucket whose
    // count summed EVERY kv key in the DB while the list showed just the first owner's — the
    // header said "7 items" over a list of 1 (#263). records/blobs keys already map to a single
    // owner, so adding owner changes nothing there.
    const id = `${kind} ${owner} ${key}`;
    let b = buckets.get(id);
    if (!b) {
      b = { kind, key, owner, label, count: 0, bytes: 0 };
      buckets.set(id, b);
    }
    b.count += 1;
    b.bytes += bytes;
  };

  for (const row of records) {
    if (row.workspace !== ws) continue; // active workspace only (#406)
    const collection = String(row.collection ?? 'unknown');
    bump('records', collection, ownerOf(collection), collection, jsonBytes(row));
  }
  for (const raw of blobKeys) {
    const appKey = peelBlobKey(String(raw), prefix);
    if (appKey == null) continue;
    const ns = blobNamespace(appKey);
    const blob = (await idb.get('blobs', raw)) as Blob | undefined;
    bump('blobs', ns, ownerOf(ns), ns, blob?.size ?? 0);
  }
  for (const raw of kvKeys) {
    const appKey = peelKvKey(String(raw), prefix);
    if (appKey == null) continue;
    const value = await idb.get('kv', raw);
    // one kv partition per owner (keyed 'kv'), so all of an app's settings/caches
    // collapse into a single row in the tree.
    bump('kv', 'kv', kvOwner(appKey), 'Settings & caches', jsonBytes(value));
  }

  const nodes = new Map<string, AppNode>();
  for (const b of buckets.values()) {
    let node = nodes.get(b.owner);
    if (!node) {
      node = { ...appMeta(b.owner), partitions: [], count: 0, bytes: 0 };
      nodes.set(b.owner, node);
    }
    node.partitions.push({ key: b.key, kind: b.kind, owner: b.owner, label: b.label, count: b.count, bytes: b.bytes });
    node.count += b.count;
    node.bytes += b.bytes;
  }

  const rank = (id: string) => (id === 'system' ? 2 : id === 'unknown' ? 3 : 1);
  const apps = [...nodes.values()].sort((a, b) => rank(a.id) - rank(b.id) || b.bytes - a.bytes);
  for (const node of apps) node.partitions.sort((a, b) => b.bytes - a.bytes);

  return {
    apps,
    totalBytes: apps.reduce((n, a) => n + a.bytes, 0),
    totalCount: apps.reduce((n, a) => n + a.count, 0),
    generatedAt: Date.now(),
  };
}

// ---- detail: the items inside one partition -------------------------------

export interface RecordItem {
  id: string;
  json: string;
  bytes: number;
}
export interface BlobItem {
  key: string;
  type: string;
  bytes: number;
}
export interface KvItem {
  key: string;
  json: string;
  bytes: number;
}
export interface PartitionItems {
  records?: RecordItem[];
  blobs?: BlobItem[];
  kv?: KvItem[];
}

export async function partitionItems(
  p: Partition,
  workspace: string = dataStore.getWorkspace(),
): Promise<PartitionItems> {
  const ws = workspace;
  const prefix = workspacePrefix(workspace);
  if (p.kind === 'records') {
    const rows = (await idb.getAllByIndex('records', 'workspace_collection', [ws, p.key])) as Record<string, unknown>[];
    return {
      records: rows.map((row) => ({
        id: String(row.id ?? ''),
        json: JSON.stringify(strip(row), null, 2),
        bytes: jsonBytes(row),
      })),
    };
  }
  if (p.kind === 'blobs') {
    const keys = (await idb.getAllKeys('blobs')) as IDBValidKey[];
    const blobs: BlobItem[] = [];
    for (const raw of keys) {
      const appKey = peelBlobKey(String(raw), prefix);
      if (appKey == null || blobNamespace(appKey) !== p.key) continue;
      const blob = (await idb.get('blobs', raw)) as Blob | undefined;
      blobs.push({ key: appKey, type: blob?.type || 'application/octet-stream', bytes: blob?.size ?? 0 });
    }
    return { blobs };
  }
  // kv — this app's keys only, within the active workspace (+ device-global keys).
  const keys = (await idb.getAllKeys('kv')) as IDBValidKey[];
  const kv: KvItem[] = [];
  for (const raw of keys) {
    const appKey = peelKvKey(String(raw), prefix);
    if (appKey == null || kvOwner(appKey) !== p.owner) continue;
    const value = await idb.get('kv', raw);
    kv.push({ key: appKey, json: JSON.stringify(value, null, 2), bytes: jsonBytes(value) });
  }
  return { kv };
}

const strip = ({ _pk, workspace, ...rest }: Record<string, unknown>) => rest;

// ---- export / import ------------------------------------------------------

export async function exportApp(
  node: AppNode,
  workspace: string = dataStore.getWorkspace(),
): Promise<{ filename: string; json: string }> {
  const ws = workspace;
  const prefix = workspacePrefix(workspace);
  const out: AppExport = {
    format: 'anubisdb-app',
    version: 1,
    app: node.id,
    name: node.name,
    exportedAt: Date.now(),
    records: [],
    blobs: {},
    kv: {},
  };
  for (const p of node.partitions) {
    if (p.kind === 'records') {
      const rows = (await idb.getAllByIndex('records', 'workspace_collection', [ws, p.key])) as Record<
        string,
        unknown
      >[];
      out.records.push(...rows);
    } else if (p.kind === 'blobs') {
      for (const raw of (await idb.getAllKeys('blobs')) as IDBValidKey[]) {
        const appKey = peelBlobKey(String(raw), prefix);
        if (appKey == null || blobNamespace(appKey) !== p.key) continue;
        const blob = (await idb.get('blobs', raw)) as Blob | undefined;
        if (blob) out.blobs[appKey] = await blobToDataUrl(blob);
      }
    } else {
      for (const raw of (await idb.getAllKeys('kv')) as IDBValidKey[]) {
        const appKey = peelKvKey(String(raw), prefix);
        if (appKey == null || kvOwner(appKey) !== node.id) continue;
        out.kv[appKey] = await idb.get('kv', raw);
      }
    }
  }
  return { filename: `${node.id}.json`, json: JSON.stringify(out, null, 2) };
}

// Restore an AnubisDB per-app dump, or a full `kimtos-data` backup. Both re-scope into
// the ACTIVE workspace (via dataStore), so a dump is portable across workspaces. Returns a
// short summary for the caller to surface.
export async function importData(parsed: unknown): Promise<string> {
  const data = parsed as { format?: string };
  if (data?.format === 'kimtos-data') {
    await restoreFullBackup(parsed); // imports the data AND adopts the settings (kv is a mirror)
    return 'Imported full backup';
  }
  if (data?.format === 'anubisdb-app') {
    const dump = parsed as AppExport;
    for (const row of dump.records || []) {
      await dataStore.put(String(row.collection), strip(row) as { id?: string } & Record<string, unknown>);
    }
    for (const [key, url] of Object.entries(dump.blobs || {})) {
      await dataStore.putBlob(key, await (await fetch(url)).blob());
    }
    for (const [key, value] of Object.entries(dump.kv || {})) await dataStore.kv.set(key, value);
    // The kv writes above put any `settings:*` back in the MIRROR, which nothing reads. Adopt
    // them into chrome.storage, or a restored backup silently does not restore the app's
    // settings (#225).
    await applySettingsFromDb();
    return `Imported ${dump.name || dump.app} data`;
  }
  throw new Error('Not a Kimtos / AnubisDB data file.');
}

// ---- clear (with a portable backup for undo) ------------------------------

// Deletes go through dataStore (records/blobs/kv) + the store (settings), which are scoped to
// the ACTIVE workspace — so clearing only ever affects the active workspace's data. AnubisDB
// disables Clear while it is VIEWING another workspace (#473), so only the active one is erased.
export async function clearApp(node: AppNode): Promise<AppExport> {
  const prefix = workspacePrefix(dataStore.getWorkspace());
  const { json } = await exportApp(node);
  const backup = JSON.parse(json) as AppExport;
  // Settings first, and through the STORE. Deleting `settings:<id>` from kv below would clear
  // the mirror only: the app reads chrome.storage, and store.ts rewrites the mirror on the next
  // save — so the settings survived the clear and then reappeared (#225).
  await clearAppSettings(node.id);
  for (const p of node.partitions) {
    if (p.kind === 'records') {
      await dataStore.clearCollection(p.key);
    } else if (p.kind === 'blobs') {
      for (const raw of (await idb.getAllKeys('blobs')) as IDBValidKey[]) {
        const appKey = peelBlobKey(String(raw), prefix);
        if (appKey != null && blobNamespace(appKey) === p.key) await dataStore.delBlob(appKey);
      }
    } else {
      for (const raw of (await idb.getAllKeys('kv')) as IDBValidKey[]) {
        const appKey = peelKvKey(String(raw), prefix);
        if (appKey != null && kvOwner(appKey) === node.id) await dataStore.kv.del(appKey);
      }
    }
  }
  return backup;
}

// Wipe the ACTIVE workspace's data (#406 — never other users' partitions). Returns a
// full `kimtos-data` backup for undo (already scoped to the active workspace).
export async function clearAll() {
  const ws = dataStore.getWorkspace();
  const prefix = workspacePrefix(ws);
  const backup = await dataStore.exportAll();
  // Every app's settings, through the store — same reason as clearApp: emptying the kv mirror
  // clears nothing the apps actually read, and the next save puts it all back (#225). The
  // user's PREFERENCES are left alone: "wipe the apps' data" must not reset their theme.
  await clearAllAppSettings();
  for (const row of (await idb.getAll('records')) as Record<string, unknown>[]) {
    if (row.workspace === ws) await idb.del('records', row._pk as IDBValidKey);
  }
  for (const raw of (await idb.getAllKeys('blobs')) as IDBValidKey[]) {
    if (String(raw).startsWith(prefix)) await dataStore.delBlob(String(raw).slice(prefix.length));
  }
  for (const raw of (await idb.getAllKeys('kv')) as IDBValidKey[]) {
    if (String(raw).startsWith(prefix)) await idb.del('kv', raw);
  }
  return backup;
}
