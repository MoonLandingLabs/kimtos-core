// Persistent key/value state. The LIVE store is chrome.storage.local (extension)
// / localStorage (vite dev) — the service worker and content scripts read it
// there (clipboard capture gating reads installedApps). There is no account and no server: all
// of it lives in this browser. In addition, the user's PREFERENCES are mirrored into
// the shared kimtos DB (dataStore.kv) — non-app prefs under `settings:general`,
// each app's config under `settings:<appId>` — so they (a) show up in AnubisDB and
// (b) ride along in the Export/Import backup, minus transient caches, which never
// leave the device. (Content-script config that
// can't use the DB is bridged in separately — see lib/csConfigMirror.ts.)

import { dataStore } from '../lib/dataStore.js';
import { csConfigKeys } from '../lib/csConfigMirror.js';

const NAMESPACE = 'kimtos';
// The preferences mirror in the shared DB (→ AnubisDB + backup). Keyed in a
// dedicated `settings:` kv namespace so it never collides with an app's own data
// (apps use `<id>:…` / `<id>-…` / `history:…`). The non-app prefs go under
// `settings:general` (→ system bucket); each app's own config goes under
// `settings:<appId>` so AnubisDB attributes it to that app.
export const SETTINGS_PREFIX = 'settings:';
export const GENERAL_KEY = 'settings:general';

interface FocusState {
  duration: number;
  running: boolean;
  endsAt: number | null;
  remaining: number;
}

export interface Settings {
  name: string;
  theme: 'system' | 'light' | 'dark';
  homeLayout: 'web' | 'kimtai';
  clock24h: boolean;
  dockScrollHint: boolean;
  dockPinned: string[];
  bgBlur: number;
  homeReadit: boolean;
  /** Home cards the user has hidden: `{ [appId]: false }`. Absent = shown.
   *  Keyed by app id like `tipsSeen`, so an app that declares a `widget` gets its
   *  Settings toggle generated — there is no hand-maintained list to fall out of
   *  step with (#83). */
  homeWidgets: Record<string, boolean>;
  homeWeather: boolean;
  homeFocus: boolean;
  homeTips: boolean;
  weatherUnit: string;
  weatherCoords: { lat: number; lon: number } | null;
  weatherCache: { data: unknown; at: number } | null;
  focus: FocusState;
  pinnedBgId: string | null;
  lastBgId: string | null;
  hiddenBgIds: string[];
  onboarded: boolean;
  pipNoteSeen: boolean;
  /** The once-a-day "rate KimtOS on the Chrome Web Store" reminder (see views/reviewNudge.ts):
   *  when it last ran, and whether the user switched it off — by ticking "Never show this
   *  again" or by going to the store to rate (either way, the ask is answered). */
  reviewNudge: { lastAt: number; off: boolean };
  tipsSeen: Record<string, boolean>;
  // Legacy, pre-workspaces (#406): a single device-wide installed set. Migrated once into
  // `installedAppsByUser` under this install's workspace, then left null. Read only by the
  // one-time migration in installed.ts.
  installedApps: string[] | null;
  // Installed apps, keyed by workspace id (see `workspaceId` below: `local` unless this profile
  // once had an account). Absent workspace → DEFAULT_APPS.
  installedAppsByUser: Record<string, string[]>;
  apps: Record<string, Record<string, unknown>>;
}

const DEFAULTS: Settings = {
  name: '',
  theme: 'system', // 'system' | 'light' | 'dark' — Appearance setting
  homeLayout: 'web', // 'web' (search via the browser's own engine) | 'kimtai' (typing opens KimtAI)
  clock24h: true,
  dockScrollHint: true, // nudge the dock on open when it overflows, to reveal more apps
  dockPinned: ['tabs'], // apps fixed on the left of the dock (right-click to pin more); KimtAI is fixed-centre
  bgBlur: 3,
  homeReadit: true,
  homeWidgets: {}, // { [appId]: false } — only the cards the user turned off
  homeWeather: false, // opt-in (the Tips card points users here)
  homeFocus: false, // opt-in
  homeTips: true,
  weatherUnit: 'celsius',
  weatherCoords: null, // { lat, lon } cached to avoid re-prompting
  weatherCache: null, // { data, at } last fetched weather
  focus: { duration: 1500, running: false, endsAt: null, remaining: 1500 },
  pinnedBgId: null,
  lastBgId: null,
  hiddenBgIds: [], // bundled wallpapers the user removed (restorable via Settings)
  onboarded: false, // first-run onboarding shows once, then prepares the AI models
  pipNoteSeen: false, // one-time heads-up about the floating-window (pop-out) feature
  reviewNudge: { lastAt: 0, off: false }, // lastAt 0 = never asked; the first load starts the clock
  tipsSeen: {}, // { [appId]: true } — first-time per-app tips the user has dismissed
  installedApps: null, // legacy device-wide set; migrated into installedAppsByUser then nulled (#406)
  installedAppsByUser: {}, // { [workspaceId]: appIds } — installed apps; absent → DEFAULT_APPS
  apps: {},
};

const useChromeStorage = typeof chrome !== 'undefined' && Boolean(chrome.storage) && Boolean(chrome.storage.local);

// --- workspace (#472) ------------------------------------------------------
//
// There are no accounts: everything lives in this browser, under ONE workspace id. It is `local`
// on a fresh install. A profile that once signed in to a KimtOS account keeps that account's id
// as its workspace id (see `workspaceIdFrom`), so the data it already wrote — settings, installed
// apps, notes, files, content-script config — stays under the very key it was stored under and
// nothing has to be moved. The id is never shown or sent anywhere.
//
// The persisted shape is `{ workspaceId, …deviceFields, workspaces: { [wsId]: perUserSettings } }`.
// The public get/set/subscribe API is unchanged: `cache` is the merged view for the workspace
// (device fields + its settings).
const DEVICE_KEYS = ['installedApps', 'installedAppsByUser'] as const;
type DeviceKey = (typeof DEVICE_KEYS)[number];
const isDeviceKey = (k: string): k is DeviceKey => (DEVICE_KEYS as readonly string[]).includes(k);

type PerUserSettings = Omit<Settings, DeviceKey>;
interface Persisted {
  workspaceId: string;
  installedApps: Settings['installedApps'];
  installedAppsByUser: Settings['installedAppsByUser'];
  workspaces: Record<string, Partial<PerUserSettings>>;
}

function emptyPersisted(): Persisted {
  return { workspaceId: dataStore.LOCAL_WORKSPACE, installedApps: null, installedAppsByUser: {}, workspaces: {} };
}

let persisted: Persisted = emptyPersisted();
let cache: Settings = { ...DEFAULTS };
const listeners = new Set<(s: Settings) => void>();

/** The workspace id this install's data lives under. */
function activeWorkspace(): string {
  return persisted.workspaceId;
}

/** Rebuild the merged `cache` for the active workspace: DEFAULTS, overlaid with that
 *  workspace's per-user settings, then the device fields from the top level. */
function rebuildCache(): void {
  cache = {
    ...DEFAULTS,
    ...(persisted.workspaces[activeWorkspace()] ?? {}),
    installedApps: persisted.installedApps,
    installedAppsByUser: persisted.installedAppsByUser,
  };
}

// Fields that must NOT ride along in a backup: transient caches and the installed-app map.
//
// `installedAppsByUser` (and the legacy `installedApps`) are DEVICE-WIDE: the map is keyed by
// workspace id, and a backup is scoped to ONE workspace's data (see dataStore.exportAll), so
// shipping the map would embed other workspace ids in the file and restoring it would clobber
// installs the snapshot predates (#406).
const NON_PORTABLE = new Set<keyof Settings>(['weatherCache', 'installedApps', 'installedAppsByUser']);
/** The portable subset of settings (what goes into the DB mirror + backup). */
export function portableSettings(s: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of Object.keys(s) as (keyof Settings)[]) {
    if (!NON_PORTABLE.has(k)) (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}
/**
 * Which `settings:*` keys should the mirror delete?
 *
 * The `settings:` namespace has TWO writers, and this one is not the only one: `csConfigMirror`
 * owns `settings:grammit-anywhere` and `settings:clipboard-capture` (the content-script config
 * that cannot live in the DB, because a content script's `indexedDB` is the visited page's
 * origin). Their suffixes are not app ids, so the old prune deleted them on every single save —
 * and `mirrorPrefs` runs on EVERY `store.set()`, so opening a new tab was enough. A user's
 * clipboard-capture exclusion list was wiped from the backup, and Import silently restored
 * "capture on, nothing excluded" (#248).
 *
 * Ownership is asked of the OWNER (`csConfigKeys()`), not inferred from the string. That way a
 * third content-script key is protected the day it is added, with no second list to keep in step
 * — and a key REMOVED from that registry stops being owned and is correctly cleaned up.
 *
 * Pure, so the decision can be tested apart from the I/O.
 */
export function settingsKeysToPrune(existing: string[], keptAppIds: string[], ownedKeys: string[]): string[] {
  const keep = new Set(keptAppIds);
  const owned = new Set(ownedKeys);
  return existing.filter(
    (k) =>
      k.startsWith(SETTINGS_PREFIX) && k !== GENERAL_KEY && !owned.has(k) && !keep.has(k.slice(SETTINGS_PREFIX.length)),
  );
}

// Best-effort: keep the DB mirror in step with the live store. Non-app prefs →
// `settings:general`; each app's config → `settings:<appId>` (so it maps to that
// app in AnubisDB). Prunes per-app keys for apps whose config was removed, but never
// the keys csConfigMirror owns (see above). Never blocks a save.
//
// `kv` is injected so a test can drive the REAL function against a fake store: testing the pure
// helper alone would still pass if this function stopped using it and deleted everything anyway.
export async function mirrorPrefs(s: Settings, kv: typeof dataStore.kv = dataStore.kv): Promise<void> {
  try {
    const { apps, ...general } = portableSettings(s);
    await kv.set(GENERAL_KEY, general);
    const cfg = (apps ?? {}) as Record<string, Record<string, unknown>>;
    for (const [id, c] of Object.entries(cfg)) await kv.set(SETTINGS_PREFIX + id, c);
    const owned = csConfigKeys().map(([, dbKey]) => dbKey);
    for (const k of settingsKeysToPrune(await kv.keys(), Object.keys(cfg), owned)) {
      await kv.del(k);
    }
  } catch {
    /* mirror is best-effort — a failed write never breaks the live save */
  }
}

// The raw persisted blob — either the NEW `{ …device, workspaces }` shape or a
// pre-#472 FLAT `Settings` blob, disambiguated by `init()`.
async function load(): Promise<Record<string, unknown>> {
  if (useChromeStorage) {
    const data = await chrome.storage.local.get(NAMESPACE);
    return (data?.[NAMESPACE] as Record<string, unknown>) ?? {};
  }
  try {
    const raw = localStorage.getItem(NAMESPACE);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function save(): Promise<void> {
  if (useChromeStorage) {
    await chrome.storage.local.set({ [NAMESPACE]: persisted });
  } else {
    localStorage.setItem(NAMESPACE, JSON.stringify(persisted));
  }
}

// Overloaded so `get()` returns the whole Settings and `get('key')` returns that
// field's type. (Overloads aren't allowed on object-literal methods, so it's a
// standalone function composed into `store` below.)
function get(): Settings;
function get<K extends keyof Settings>(key: K): Settings[K];
function get(key?: keyof Settings): unknown {
  return key === undefined ? { ...cache } : cache[key];
}

// The home-card flags used to be three named booleans, one per app that happened to
// have a card (#83). They are now one record keyed by app id. Carry a hidden card
// across so a dev build doesn't silently un-hide it.
const LEGACY_HOME_FLAGS: Record<string, string> = {
  homeTasks: 'tasks',
  homeBook: 'pdflib',
  homeNotes: 'notes',
};

function migrateHomeWidgets(loaded: Partial<Settings>): Record<string, boolean> {
  const widgets = { ...(loaded.homeWidgets ?? {}) };
  for (const [flag, appId] of Object.entries(LEGACY_HOME_FLAGS)) {
    // Only `false` is meaningful — absent means shown, so a `true` needs no entry.
    if ((loaded as Record<string, unknown>)[flag] === false && widgets[appId] === undefined) {
      widgets[appId] = false;
    }
  }
  return widgets;
}

// `homeLayout` used to be named after the DEFAULT SEARCH ENGINE ('google') rather than after
// what the mode is (search the web with whichever engine you chose). The name leaked into the
// UI — Settings told a DuckDuckGo user their search bar was Google (#177) — so the mode is
// 'web' now. Every existing profile has 'google' on disk; map it forward, or a returning
// user opens Settings and finds NO option selected, because their stored value matches none
// of the choices. Behaviour never depended on this value (only `=== 'kimtai'` is ever
// tested), so this is purely about the profile agreeing with the UI.
export function migrateHomeLayout(loaded: Partial<Settings>): Settings['homeLayout'] {
  const stored = (loaded as Record<string, unknown>).homeLayout;
  if (stored === 'kimtai') return 'kimtai';
  return 'web'; // 'web', the legacy 'google', absent, or anything unrecognised
}

// The recording source used to be ONE either/or setting per app: 'mic', or 'system'
// meaning system audio WELDED to the microphone. It is two independent switches now,
// so that system-only capture never asks for a mic it does not need (#1327). Carry the
// remembered choice across with its meaning intact — 'system' meant "both" — or a user
// who had picked it would silently stop recording their own voice.
//
// Idempotent: the legacy key is dropped, so a second pass finds nothing to do. Runs for
// every workspace on every load, not only for a pre-#472 flat blob, because the profiles
// that HAVE this setting are the already-migrated ones.
export function migrateRecSource(apps: Record<string, unknown> | undefined): void {
  for (const cfg of Object.values(apps ?? {})) {
    const app = cfg as Record<string, unknown>;
    if (!app || typeof app !== 'object' || !('recSource' in app)) continue;
    if (app.recMic === undefined) app.recMic = true; // both legacy values kept the mic
    if (app.recSystem === undefined) app.recSystem = app.recSource === 'system';
    delete app.recSource;
  }
}

// Forward migration for the retired accounts and paid-plan machinery. Old profiles carry fields
// that no longer mean anything — the signed-in `account` (id, email, name, avatar, plan…), the
// `authTokens`, and a home-alert toggle in each workspace's settings. They are dropped silently on
// load (and so vanish from disk on init()'s save), and everything else in the blob is left exactly
// as it was.

/** The workspace id to keep using. A blob already in the new shape carries `workspaceId`. One
 *  written while an account was signed in has no such field, but its data lives under the
 *  account's id, so that id is adopted as the workspace id (and nothing else about the account
 *  is kept). Anything else — a fresh install, or a profile that never signed in — is `local`. */
export function workspaceIdFrom(loaded: Record<string, unknown>): string {
  const own = loaded.workspaceId;
  if (typeof own === 'string' && own) return own;
  const account = loaded.account as { id?: unknown } | null | undefined;
  if (account && typeof account === 'object' && typeof account.id === 'string' && account.id) return account.id;
  return dataStore.LOCAL_WORKSPACE;
}

/** Per-user settings keys that no longer exist and are stripped from persisted workspaces. */
const RETIRED_SETTINGS_KEYS = ['homeGrantAlert'];
/** Top-level keys that are not settings: the retired account and its tokens, the structure itself. */
const RETIRED_KEYS = ['account', 'authTokens', 'workspaceId', 'workspaces'];

function dropRetiredSettings<T extends object>(settings: T): T {
  const out = { ...settings } as Record<string, unknown>;
  for (const k of RETIRED_SETTINGS_KEYS) delete out[k];
  return out as T;
}

// Turn the raw persisted blob into the `{ …device, workspaces }` structure. A NEW blob
// (has a `workspaces` object) is used as-is; a pre-#472 FLAT blob is migrated — device
// fields stay top-level, every other field moves into the CURRENT user's workspace, with
// the legacy homeLayout/homeWidgets migrations applied there (they only ever mattered for
// a flat blob). Idempotent: a migrated blob has `workspaces`, so it takes the first branch.
function toPersisted(loaded: Record<string, unknown>): Persisted {
  const base = emptyPersisted();
  base.workspaceId = workspaceIdFrom(loaded);
  base.installedApps = (loaded.installedApps as Persisted['installedApps']) ?? null;
  base.installedAppsByUser = (loaded.installedAppsByUser as Persisted['installedAppsByUser']) ?? {};

  if (loaded.workspaces && typeof loaded.workspaces === 'object') {
    base.workspaces = Object.fromEntries(
      Object.entries(loaded.workspaces as Record<string, Partial<PerUserSettings>>).map(([id, ws]) => [
        id,
        dropRetiredSettings(ws),
      ]),
    );
    for (const ws of Object.values(base.workspaces)) migrateRecSource(ws.apps);
    return base;
  }

  const target = base.workspaceId;
  const perUser: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(loaded)) {
    if (isDeviceKey(k) || RETIRED_KEYS.includes(k) || RETIRED_SETTINGS_KEYS.includes(k)) continue;
    perUser[k] = v;
  }
  perUser.homeLayout = migrateHomeLayout(loaded as Partial<Settings>);
  perUser.homeWidgets = migrateHomeWidgets(loaded as Partial<Settings>);
  migrateRecSource(perUser.apps as Record<string, unknown> | undefined);
  base.workspaces[target] = perUser as Partial<PerUserSettings>;
  return base;
}

// Adopt a persisted blob written by ANOTHER context. The new tab, the side panel and the
// service worker each run their own copy of this module with its own in-memory `persisted`;
// chrome.storage is the one shared truth, so a change made in one surface reaches the others.
// Memory-only on purpose: adopting must never save() or mirror, or two contexts would
// ping-pong writes forever.
function adopt(raw: Record<string, unknown>): void {
  const next = toPersisted(raw);
  // Our own set() also fires onChanged; adopting what we just wrote must be a no-op so
  // local writes don't double-notify subscribers.
  if (JSON.stringify(next) === JSON.stringify(persisted)) return;
  persisted = next;
  rebuildCache();
  dataStore.setWorkspace(activeWorkspace());
  listeners.forEach((fn) => fn(cache));
}

// A single named handler, (re-)registered on every init(): Chrome treats adding the same
// listener twice as a no-op, and a test that swaps in a fresh fake chrome between cases
// still gets the store wired to the CURRENT one.
function onExternalChange(changes: { [key: string]: chrome.storage.StorageChange }, area: string): void {
  if (area !== 'local' || !(NAMESPACE in changes)) return;
  adopt((changes[NAMESPACE].newValue as Record<string, unknown>) ?? {});
}

function watchExternalChanges(): void {
  if (useChromeStorage && chrome.storage.onChanged) chrome.storage.onChanged.addListener(onExternalChange);
}

async function init(): Promise<Settings> {
  persisted = toPersisted(await load());
  rebuildCache();
  watchExternalChanges();
  await save(); // persist the migrated shape so a flat blob is upgraded on disk once
  // The settings MIRROR is written through dataStore.kv, which keys by dataStore's own
  // workspace pointer — so it MUST agree with our workspace id before we mirror, or the seed
  // (and later saves) land in the wrong kv partition. The store is the authority on the id, so
  // it drives the pointer here and in set() (#472). Cheap: setWorkspace is a no-op unless the
  // workspace actually changed.
  dataStore.setWorkspace(activeWorkspace());
  // Seed the DB mirror for existing users who haven't changed a setting since the
  // mirror landed, so their preferences appear in AnubisDB + backups right away.
  void dataStore.kv.get(GENERAL_KEY).then((existing) => {
    if (existing === undefined) void mirrorPrefs(cache);
  });
  return cache;
}

async function set(patch: Partial<Settings>): Promise<Settings> {
  // Device keys write to the top level; everything else writes to the workspace's settings.
  const perUserPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (isDeviceKey(k)) (persisted as unknown as Record<string, unknown>)[k] = v;
    else perUserPatch[k] = v;
  }
  const ws = activeWorkspace();
  if (Object.keys(perUserPatch).length) {
    persisted.workspaces[ws] = { ...(persisted.workspaces[ws] ?? {}), ...perUserPatch };
  }
  rebuildCache();
  // Must precede `mirrorPrefs`, so the mirror lands in the right kv partition (#472). A no-op
  // when the workspace is unchanged, which it is for every write.
  dataStore.setWorkspace(activeWorkspace());
  await save();
  void mirrorPrefs(cache);
  listeners.forEach((fn) => fn(cache));
  return cache;
}

function subscribe(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The workspace id this install's data lives under: `local`, or the id a pre-accounts-removal
 *  profile already had (see `workspaceIdFrom`). */
const workspaceId = (): string => activeWorkspace();

export const store = { init, get, set, subscribe, workspaceId };
