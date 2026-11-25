// Which apps are installed, in one place — readable from every context.
//
// This module is deliberately small and free of DOM, IndexedDB and `store`/`session` imports, so
// a CONTENT SCRIPT can bundle it. A content script runs in the visited page's world: its
// `indexedDB` is that site's origin, not ours, so it can never read our DB. All it can read is the
// `kimtos` chrome.storage blob that models/store.ts persists. Every context therefore passes the
// state it can see to the same rule and gets the same verdict back — which is what stopped the
// clipboard and Grammit checks from drifting apart.
//
// Installed means "the user added it". Nothing else decides whether an app may run: there is no
// account, plan or entitlement term in any of this.
//
// The id lists come from the GENERATED `data/appInstall.ts` (derived from each app's meta.ts), so
// nothing here hardcodes an app id or a count.

import { APP_IDS, REQUIRED_APP_IDS, OPT_IN_APP_IDS } from '../data/appInstall.js';

/** The slice of the persisted store the install rule needs. */
export interface InstalledState {
  /** The user's chosen app set. `null`/absent = never chosen, so the defaults apply. */
  installedApps?: string[] | null;
}

/** The chrome.storage.local key models/store.ts persists the whole store under. Exported so a
 *  caller can also SUBSCRIBE to it (chrome.storage.onChanged) and re-check when it changes. */
export const STORE_NS = 'kimtos';

/** Infrastructure, not a tool: always installed, never uninstallable. Declared as
 *  `required: true` in meta.ts and generated into REQUIRED_APP_IDS, so content scripts reach the
 *  same verdict as the new tab's model. */
export function isAppRequired(appId: string): boolean {
  return REQUIRED_APP_IDS.includes(appId);
}

/** Installed out of the box = every app except the opt-in ones (`optIn: true` in meta.ts), plus
 *  every required app. Opt-in apps ship uninstalled so their on-device models and page scripts
 *  only run when the user actually asks for them. Derived from the metas, so a new app needs no
 *  edit here. */
export function defaultApps(): string[] {
  return APP_IDS.filter((id) => !OPT_IN_APP_IDS.includes(id) || isAppRequired(id));
}

/** Is the app in the user's installed set? `installedApps: null` means "never chosen", which
 *  falls back to the defaults; an empty array is a real state (the user uninstalled everything),
 *  so the two are kept distinct.
 *
 *  A REQUIRED app is installed regardless of what the state says — including for a profile
 *  written before the app was required, whose `installedApps` array simply does not contain it.
 *  Healing those is the point: otherwise an old profile is stranded with no data console. */
export function isAppInstalled(appId: string, s: InstalledState): boolean {
  if (isAppRequired(appId)) return true;
  return (s.installedApps ?? defaultApps()).includes(appId);
}

interface LocalArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
}
interface ChromeLike {
  storage?: { local?: LocalArea };
}
const localArea = (): LocalArea | null => (globalThis as { chrome?: ChromeLike }).chrome?.storage?.local ?? null;

/** The workspace id from a `kimtos` storage blob: `'local'`, or the id a profile that once had a
 *  Kimtos account kept (models/store.ts writes it as `workspaceId`; there are no accounts any
 *  more). This is the one place content-script-side code resolves the workspace, so per-workspace
 *  chrome.storage keys — installed apps, clipboard capture, grammit-anywhere — all pick the same
 *  partition. Pure; takes the blob a caller already read, so it adds no extra chrome.storage
 *  round-trip. */
export function workspaceIdOf(blob: unknown): string {
  const id = (blob as { workspaceId?: unknown } | undefined)?.workspaceId;
  return typeof id === 'string' && id ? id : 'local';
}

/** The active workspace id, read from chrome.storage. `'local'` under `vite dev` (no
 *  chrome.storage) or on a profile that never had an account. For callers that don't already hold the blob. */
export async function activeWorkspace(): Promise<string> {
  const local = localArea();
  if (!local) return 'local';
  return workspaceIdOf((await local.get(STORE_NS))[STORE_NS]);
}

/** The installed-apps state from chrome.storage, or `null` when there is no chrome.storage at all
 *  (i.e. `vite dev`), so the caller can pick a dev-safe default. */
export async function readInstalledState(): Promise<InstalledState | null> {
  const local = localArea();
  if (!local) return null;
  const data = await local.get(STORE_NS);
  const s =
    (data[STORE_NS] as {
      installedApps?: string[] | null;
      installedAppsByUser?: Record<string, string[]>;
    }) || {};
  // Installed set: resolve the workspace id from the same blob. Falls back to the legacy device-wide `installedApps`
  // until the new-tab migration runs.
  const installedApps = s.installedAppsByUser?.[workspaceIdOf(data[STORE_NS])] ?? s.installedApps;
  return { installedApps };
}

/** Is `appId` installed for the active workspace? Dev-safe: `vite dev` has no chrome.storage, so
 *  there is nothing to read — treat it as installed rather than refuse every write. */
export async function appInstalled(appId: string): Promise<boolean> {
  const s = await readInstalledState();
  if (!s) return true;
  return isAppInstalled(appId, s);
}
