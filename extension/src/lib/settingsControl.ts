// Settings, as AnubisDB must be able to manage them.
//
// AnubisDB is the console over everything an app has stored: browse it, back it up, clear it.
// For settings, two of those three were fiction (#225):
//
//   CLEAR   `clearApp()` deleted the `settings:<appId>` key from dataStore.kv. But kv is only
//           a MIRROR — the app reads chrome.storage (`store.apps[<id>]`), which still held the
//           settings, and store.ts's mirrorPrefs() rewrote the key on the next save. The
//           console said "cleared"; nothing was cleared, and the key came back.
//
//   IMPORT  a backup carries `settings:<appId>`, and importing wrote it back into kv — which
//           nothing reads. The app went on reading chrome.storage, so restoring a backup
//           silently did not restore its settings.
//
// WHY THE MIRROR EXISTS, AND WHY IT STAYS. Settings cannot simply move into IndexedDB: the
// SERVICE WORKER AND CONTENT SCRIPTS read some of this state, and a content script cannot open
// our IndexedDB (its `indexedDB` is the visited page's origin, not ours). chrome.storage has to
// remain the live copy. The mirror is what makes settings visible in AnubisDB and portable in a
// backup.
//
// So the fix is not to move the data — it is to make AnubisDB's WRITES authoritative. Every
// function here goes to chrome.storage first (the copy that is actually read) and treats kv as
// what it is: a projection.
import { dataStore } from './dataStore.js';
import { store, GENERAL_KEY, SETTINGS_PREFIX, type Settings } from '../models/store.js';
import { clearAppConfig, clearAllAppConfig, replaceAppConfig } from './appConfig.js';
import { clearCsConfig, restoreCsConfigFromDb } from './csConfigMirror.js';

/** The pre-split backup shape: one object, per-app config nested under `apps`. Old backups on
 *  users' disks still carry it, and a restore must not silently drop them (#249). */
const LEGACY_PREFS_KEY = `${SETTINGS_PREFIX}prefs`;

/**
 * Split the `settings:*` kv keys into the two things they actually are.
 *
 * Pure, and separated from the I/O on purpose: this is the part with the edge cases (the
 * content-script keys look like app keys but are NOT app config — `settings:grammit-anywhere`
 * is a chrome.storage key that csConfigMirror owns, and writing it into `store.apps.grammit`
 * would invent a setting the app never declared).
 */
export function splitSettingsKv(entries: [string, unknown][]): {
  general: Partial<Settings> | null;
  apps: Record<string, Record<string, unknown>>;
} {
  let general: Partial<Settings> | null = null;
  const apps: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of entries) {
    if (!key.startsWith(SETTINGS_PREFIX)) continue;
    if (!value || typeof value !== 'object') continue; // junk in a hand-edited backup

    if (key === GENERAL_KEY) {
      general = { ...(general ?? {}), ...(value as Partial<Settings>) };
      continue;
    }

    // LEGACY: `settings:prefs` is the older backup shape — everything in one object, with the
    // per-app config NESTED under `apps`. A user restoring a backup taken before the split must
    // not silently lose their settings. This was handled in the Settings import and NOT here, so
    // the same old backup restored fully from Settings and partially from AnubisDB (#249).
    if (key === LEGACY_PREFS_KEY) {
      const { apps: legacyApps, ...rest } = value as {
        apps?: Record<string, Record<string, unknown>>;
      };
      general = { ...(general ?? {}), ...(rest as Partial<Settings>) };
      for (const [id, cfg] of Object.entries(legacyApps ?? {})) {
        if (cfg && typeof cfg === 'object') apps[id] = cfg;
      }
      continue;
    }

    const id = key.slice(SETTINGS_PREFIX.length);
    // `settings:<app>-<name>` is content-script config, not app config — csConfigMirror owns it
    // and restores it separately. App ids never contain '-', which is what makes this decidable.
    if (id.includes('-') || !id) continue;
    apps[id] = value as Record<string, unknown>;
  }
  return { general, apps };
}

/**
 * Adopt the settings sitting in dataStore.kv — after an Import, which writes them there.
 *
 * Without this, a restored backup put settings in a store nothing reads. The `account` and
 * `authTokens` keys are retired (there are no accounts), so an older backup that still carries
 * them has them stripped here rather than written back into the store.
 */
export async function applySettingsFromDb(): Promise<void> {
  const keys = await dataStore.kv.keys();
  const entries: [string, unknown][] = [];
  for (const k of keys) {
    if (k.startsWith(SETTINGS_PREFIX)) entries.push([k, await dataStore.kv.get(k)]);
  }
  const { general, apps } = splitSettingsKv(entries);

  if (general) {
    const { account: _a, authTokens: _t, apps: _apps, ...safe } = general as Record<string, unknown>;
    await store.set(safe as Partial<Settings>);
  }
  for (const [id, config] of Object.entries(apps)) await replaceAppConfig(id, config);

  // The content-script keys live in chrome.storage under their own names; this pushes the
  // restored mirror back onto them, so a backup re-arms capture / grammar-anywhere.
  await restoreCsConfigFromDb();
}

/**
 * THE ONE DOOR for restoring a backup. Import the data, then adopt the settings it carries.
 *
 * `dataStore.importAll` alone is not a restore. It rebuilds the DB — including the `settings:*`
 * kv keys — but kv is a MIRROR: the apps read chrome.storage, so an import that stops there
 * leaves every setting exactly as it was. That is the whole of #225, and it kept happening
 * anyway, because each caller had to remember to follow the import with the adopt step:
 *
 *   AnubisDB "Delete app data" undo   went through importData      correct
 *   AnubisDB "Erase all" undo         called dataStore.importAll   settings stayed erased (#249)
 *   Settings "Import backup"          hand-rolled its own copy     drifted (it alone handled the
 *                                                                  legacy key, so an old backup
 *                                                                  restored differently depending
 *                                                                  on which button you pressed)
 *
 * Two call sites out of three got it wrong in two different ways, which says the rule cannot
 * live in the callers. It lives here. `settingsControl.test.ts` asserts nothing calls
 * `dataStore.importAll` outside this module, so a third bypass cannot ship.
 */
export async function restoreFullBackup(parsed: unknown): Promise<void> {
  await dataStore.importAll(parsed as Parameters<typeof dataStore.importAll>[0]);
  await applySettingsFromDb();
}

/** Clear one app's settings for real: chrome.storage first, then the mirror it projects to. */
export async function clearAppSettings(appId: string): Promise<void> {
  await clearAppConfig(appId);
  await clearCsConfig(appId);
  await dataStore.kv.del(SETTINGS_PREFIX + appId);
}

/** Clear EVERY app's settings (the global wipe). Preferences are untouched:
 *  wiping app data should not reset their theme. */
export async function clearAllAppSettings(): Promise<void> {
  await clearAllAppConfig();
  await clearCsConfig();
  for (const k of await dataStore.kv.keys()) {
    if (k.startsWith(SETTINGS_PREFIX) && k !== GENERAL_KEY) await dataStore.kv.del(k);
  }
}
