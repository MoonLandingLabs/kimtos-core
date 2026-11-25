// Which apps are "installed" (shown in the dock + home). Everything is auto-
// discovered in apps/index.js; this just tracks the user's installed subset.
// Opt-in apps ship uninstalled so their on-device models only download when the
// user actually wants them.

import { store } from './store.js';
import { apps } from '../apps/index.js';
import { allAppMetas } from '../apps/metaIndex.js';

// Installed out of the box = every app except the opt-in ones (`optIn: true` in each
// apps/<id>/meta.ts, so this stays in sync automatically). The opt-in
// ones — the on-device AI/media tools — ship uninstalled and are added via onboarding or
// the App Store, so an app's model only downloads when the user adds it.
export const DEFAULT_APPS: string[] = allAppMetas()
  .filter((m) => !m.optIn || m.required)
  .map((m) => m.id);

// Apps that are infrastructure, not tools: always installed, never uninstallable.
// Declared with `required: true` in meta.ts (today: AnubisDB, the console over the one
// shared on-device database). Derived, never a hardcoded id — see meta.ts for why (#176).
const REQUIRED_APPS: string[] = allAppMetas()
  .filter((m) => m.required)
  .map((m) => m.id);

export const isRequired = (id: string): boolean => REQUIRED_APPS.includes(id);

// The installed set for this install's workspace (the only one: there are no accounts). An absent workspace entry means "never chosen" → the defaults; an empty
// array is a real state (user uninstalled everything), so we keep them distinct.
function installedIds(): string[] {
  const byUser = store.get('installedAppsByUser') || {};
  const ids = byUser[store.workspaceId()];
  if (ids) return ids;
  // Transition read (#406): until migrateInstalledApps() partitions it at startup, a
  // profile still has only the legacy device-wide list — use it. Steady state, the
  // migration has nulled the legacy field, so this falls through to the defaults for a
  // never-configured workspace. Mirrors lib/installedApps.ts's content-script fallback.
  return store.get('installedApps') || DEFAULT_APPS;
}

/** One-time migration of the legacy device-wide `installedApps` into `target`'s
 *  per-user set, then null the legacy field. Idempotent; runs on app start (#406). */
export async function migrateInstalledApps(target: string): Promise<void> {
  const legacy = store.get('installedApps');
  if (legacy == null) return; // nothing to migrate (fresh install or already migrated)
  const byUser = { ...(store.get('installedAppsByUser') || {}) };
  if (!(target in byUser)) byUser[target] = legacy;
  await store.set({ installedAppsByUser: byUser, installedApps: null });
}

export function isInstalled(id: string): boolean {
  // A required app is installed by definition. This is not just belt-and-braces: profiles
  // already in the wild may have uninstalled AnubisDB before it was required, and an
  // `installedApps` array written back then does not contain it. Reading the flag here heals
  // those profiles instead of stranding them without a data console.
  if (isRequired(id)) return true;
  return installedIds().includes(id);
}

// Installed app descriptors, in the canonical apps order.
export function installedApps() {
  const ids = installedIds();
  return apps.filter((a) => ids.includes(a.id) || isRequired(a.id));
}

export async function setInstalled(id: string, on: boolean): Promise<void> {
  // Uninstalling a required app is not an error the user should have to discover — the UI
  // does not offer it (installButton/appDetail show "Required" and onboarding locks it on).
  // This is the backstop, so no future caller can route around the model.
  if (!on && isRequired(id)) return;
  const set = new Set(installedIds());
  if (on) set.add(id);
  else set.delete(id);
  // A required app is always in the persisted set, so a profile written now is correct even
  // if it is later read by code that does not check the flag.
  for (const rid of REQUIRED_APPS) set.add(rid);
  // Persist in the stable apps order so the dock layout is deterministic, under the
  // active workspace so each user keeps their own installed set (#406).
  const ids = apps.map((a) => a.id).filter((x: string) => set.has(x));
  const byUser = { ...(store.get('installedAppsByUser') || {}) };
  byUser[store.workspaceId()] = ids;
  await store.set({ installedAppsByUser: byUser });
}
