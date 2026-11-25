// Per-app configuration, persisted in the store under `apps[appId]`. Each app
// declares a `settings` schema; defaults come from it, overrides from the user.

import { store } from '../models/store.js';
import { POPOUT_SETTINGS } from './pip.js';

interface SettingsField {
  key: string;
  default: unknown;
}
interface AppLike {
  id: string;
  popout?: boolean;
  settings?: SettingsField[];
}

// An app's settings schema: the shared floating-window fields (for any app that opts
// into pop-out) plus whatever the app declares itself. THE one place the two are
// merged — defaults and the Settings UI both read it, so they cannot disagree, and a
// new pop-out app gets the floating-window controls without copying anything (#197).
//
// Generic in the field type so each caller keeps its own: the Settings view needs the
// full field (label, hint, options) to render a control, while the defaults below need
// only `key` and `default`.
export function appSettings<T extends SettingsField>(app: { popout?: boolean; settings?: T[] }): T[] {
  return [...(app.popout ? (POPOUT_SETTINGS as unknown as T[]) : []), ...(app.settings ?? [])];
}

function appDefaults(app: AppLike): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of appSettings(app)) defaults[field.key] = field.default;
  return defaults;
}

export function getAppConfig(app: AppLike): Record<string, unknown> {
  const stored = (store.get('apps') || {})[app.id] || {};
  return { ...appDefaults(app), ...stored };
}

export async function setAppConfig(appId: string, key: string, value: unknown): Promise<void> {
  const all = { ...(store.get('apps') || {}) };
  all[appId] = { ...(all[appId] || {}), [key]: value };
  await store.set({ apps: all });
}

// Read a single stored value by app id (no descriptor needed), with a fallback
// when the user hasn't set it yet. Handy for shared components that only know the
// app id (e.g. the audio recorder reading each app's "recording source").
export function getAppValue(appId: string, key: string, fallback?: unknown): unknown {
  const stored = (store.get('apps') || {})[appId] || {};
  return key in stored ? stored[key] : fallback;
}

// ---------------------------------------------------------------------------
// The AUTHORITATIVE writes. AnubisDB is the manager over everything an app stored, so its
// clear/import have to reach the real store — not the `settings:<id>` mirror in dataStore.kv.
//
// Deleting the mirror alone did nothing: the app reads chrome.storage, and store.ts's
// mirrorPrefs() rewrote the key on the very next save, so cleared settings came back (#225).
// ---------------------------------------------------------------------------

/** Forget an app's stored settings entirely (it falls back to its declared defaults). */
export async function clearAppConfig(appId: string): Promise<void> {
  const all = { ...(store.get('apps') || {}) };
  if (!(appId in all)) return;
  delete all[appId];
  await store.set({ apps: all });
}

/** Replace one app's stored settings wholesale — used when a backup is restored. */
export async function replaceAppConfig(appId: string, config: Record<string, unknown>): Promise<void> {
  const all = { ...(store.get('apps') || {}) };
  all[appId] = { ...config };
  await store.set({ apps: all });
}

/** Forget EVERY app's settings (the global wipe). */
export async function clearAllAppConfig(): Promise<void> {
  await store.set({ apps: {} });
}
