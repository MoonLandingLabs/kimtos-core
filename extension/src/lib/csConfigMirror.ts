// Content-script config → shared-DB mirror.
//
// A couple of small settings live in `chrome.storage.local` as their own keys
// (not in the `kimtos` settings blob) because **content scripts read them**, and
// a content script cannot open the extension's IndexedDB — its `indexedDB` is the
// visited page's origin, not ours. So the LIVE copy has to stay in chrome.storage.
//
// To keep the "everything lives in / derives from AnubisDB" invariant, we mirror
// those keys into the shared DB (dataStore.kv) so they (a) show up in AnubisDB and
// (b) ride along in the Export/Import backup — exactly like models/store.ts mirrors
// the preferences. The mirror key is `settings:<appId>-<name>` so AnubisDB
// attributes it to the owning app (see anubisdb/registry.ts). This module is the
// bridge: sync/watch push chrome.storage → DB; restore (on Import) pushes DB back
// to chrome.storage so a restored backup re-arms capture / grammar-anywhere.

import { dataStore } from './dataStore.js';
import { workspaceIdOf, activeWorkspace, STORE_NS } from './installedApps.js';

// The CS values are per-user (#489): stored as `{ byWs: { [workspaceId]: value } }`. The mirror
// (dataStore.kv, per-user as of #472) and any restore/clear act on the ACTIVE workspace's slice
// ONLY — mirroring the whole map would put every user's config into one user's kv and leak it
// into that user's backup (the installedAppsByUser lesson, #406). A pre-#489 value is a bare
// scalar (no `byWs`) — the device-wide value, which is the active user's until migrated.
interface Wrap {
  byWs: Record<string, unknown>;
}
const isWrapped = (v: unknown): v is Wrap =>
  !!v && typeof v === 'object' && 'byWs' in (v as object) && typeof (v as Wrap).byWs === 'object';
/** The active workspace's slice of a CS value (the whole value when it is a legacy scalar). */
const sliceForWs = (value: unknown, ws: string): unknown => (isWrapped(value) ? value.byWs[ws] : value);
/** Put `slice` under the active workspace, preserving every other workspace's entry. */
const withWsSlice = (value: unknown, ws: string, slice: unknown): Wrap => {
  const byWs = isWrapped(value) ? { ...value.byWs } : {};
  byWs[ws] = slice;
  return { byWs };
};

interface LocalArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
interface ChangeArea {
  addListener(fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
}
interface ChromeLike {
  storage?: { local?: LocalArea; onChanged?: ChangeArea };
}
const chromeApi = (): ChromeLike | undefined => (globalThis as { chrome?: ChromeLike }).chrome;
const localArea = (): LocalArea | null => chromeApi()?.storage?.local ?? null;

// chrome.storage.local key → dataStore.kv mirror key (settings:<appId>-<name>).
// Keep both mappings 1:1 with the content-script config the apps actually store.
const CS_CONFIG: Record<string, string> = {
  grammitAnywhere: 'settings:grammit-anywhere', // Grammit "check anywhere" (content/writer.ts)
  'clipboard:capture': 'settings:clipboard-capture', // Clipboard capture state (clipboardShared.ts)
};

/** Push the ACTIVE workspace's config values into the shared DB (per-user mirror, #489). */
export async function syncCsConfigToDb(): Promise<void> {
  const local = localArea();
  if (!local) return; // vite dev / no extension APIs
  try {
    const got = await local.get([...Object.keys(CS_CONFIG), STORE_NS]);
    const ws = workspaceIdOf(got[STORE_NS]);
    for (const [csKey, dbKey] of Object.entries(CS_CONFIG)) {
      const slice = sliceForWs(got[csKey], ws);
      if (slice !== undefined) await dataStore.kv.set(dbKey, slice);
    }
  } catch {
    /* best-effort mirror */
  }
}

/** Live-mirror config changes (from any context — SW, content, UI) into the DB — the active
 *  workspace's slice only. */
export function watchCsConfig(): void {
  const onChanged = chromeApi()?.storage?.onChanged;
  if (!onChanged) return;
  onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [csKey, dbKey] of Object.entries(CS_CONFIG)) {
      if (csKey in changes) {
        void (async () => {
          try {
            await dataStore.kv.set(dbKey, sliceForWs(changes[csKey].newValue, await activeWorkspace()));
          } catch {
            /* best-effort mirror */
          }
        })();
      }
    }
  });
}

/** Restore config from the DB mirror back into chrome.storage (used after Import, so a backup
 *  re-arms the content-script settings). The mirror is the ACTIVE user's slice, so it is written
 *  under the active workspace, leaving other workspaces' entries intact. */
export async function restoreCsConfigFromDb(): Promise<void> {
  const local = localArea();
  if (!local) return;
  try {
    const got = await local.get([...Object.keys(CS_CONFIG), STORE_NS]);
    const ws = workspaceIdOf(got[STORE_NS]);
    for (const [csKey, dbKey] of Object.entries(CS_CONFIG)) {
      const v = await dataStore.kv.get(dbKey);
      if (v !== undefined) await local.set({ [csKey]: withWsSlice(got[csKey], ws, v) });
    }
  } catch {
    /* best-effort restore */
  }
}

/** The mirror keys this module owns, so AnubisDB can tell which belong to an app. */
export const csConfigKeys = (): [string, string][] => Object.entries(CS_CONFIG);

/**
 * Clear content-script config — for one app, or all of it.
 *
 * Deleting the MIRROR is not enough and never was: the live value lives in chrome.storage,
 * which is what the content script actually reads, and `watchCsConfig` would push it straight
 * back into the DB on the next change. So clear the live key first, then the mirror (#225).
 */
export async function clearCsConfig(appId?: string): Promise<void> {
  const local = localArea();
  const owned = Object.entries(CS_CONFIG).filter(([, dbKey]) => !appId || dbKey.startsWith(`settings:${appId}-`));
  try {
    if (local && owned.length) {
      const got = await local.get([...owned.map(([csKey]) => csKey), STORE_NS]);
      const ws = workspaceIdOf(got[STORE_NS]);
      for (const [csKey] of owned) {
        const stored = got[csKey];
        if (isWrapped(stored)) {
          // Drop only the active workspace's slice; keep every co-user's config (#489).
          const byWs = { ...stored.byWs };
          delete byWs[ws];
          if (Object.keys(byWs).length) await local.set({ [csKey]: { byWs } });
          else await local.remove(csKey);
        } else if (stored !== undefined) {
          await local.remove(csKey); // legacy device-wide scalar → this user's, so remove it
        }
      }
    }
    for (const [, dbKey] of owned) await dataStore.kv.del(dbKey);
  } catch {
    /* best-effort: a failed clear must not strand the rest of the wipe */
  }
}
