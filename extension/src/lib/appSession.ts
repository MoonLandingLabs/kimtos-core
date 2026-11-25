// The session — what the shell remembers so the user comes back to where they were.
//
// An app's state used to live only in the JS heap of the one new-tab page that rendered it, in a
// `Map` that dies with the page (`controllers/appsController.ts`). Nothing was written down, so a
// reload lost everything, and minimize and close — which really are different in memory — became
// indistinguishable the moment the page went away (#1172).
//
// WHERE THIS LIVES, AND WHY IT IS NOT THE DATA STORE. `chrome.storage.session` is held in memory
// by the extension process and cleared when the BROWSER session ends. That is precisely the
// lifetime we want — survive a reload, start clean on a restart — so we get it from the platform
// instead of maintaining epoch stamps and an expiry sweep that would have to be right forever.
//
// It also keeps this OUT of `dataStore`. Convention 6 sends an app's persistent data to the shared
// IndexedDB so AnubisDB can attribute it and a backup can carry it. Session state is neither: it is
// ephemeral shell state that is worthless tomorrow, and writing it there would put scroll offsets
// and window coordinates in the user's data console and in every exported backup, where they would
// then need ageing out. The rule is about durable user data; this is deliberately not that.
//
// PUSH, NOT PULL. Apps hand their state over as it changes rather than being asked for it at
// unload. A tab can be killed without ever running an unload handler, so a pull model would lose
// exactly the sessions it exists to keep — the same reasoning that made `jobStore` write the job
// down BEFORE running it (#314).

/** One remembered window. Geometry is absent until the user moves or resizes it, so a restored
 *  window that was never touched re-centres itself exactly like a fresh one. */
export interface WindowState {
  appId: string;
  /** Hidden but still mounted and running — the app comes back exactly as it was. */
  minimized: boolean;
  maximized: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/** The storage this talks to. Injectable so the behaviour can be tested without a browser. */
export interface SessionArea {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  del: (key: string) => Promise<void>;
}

/** The window list is shell state, not one app's — `shell:` is not an app id, so AnubisDB's
 *  `ownerOf` files it under the system bucket with no registry edit (`apps/anubisdb/registry.ts`). */
export const WINDOWS_KEY = 'shell:windows';

/** Convention 6's naming, so an app's session sits beside its `<appId>:job` record. */
export const appSessionKey = (appId: string): string => `${appId}:session`;

/** Last resort: a store that forgets. Not persistence — just somewhere safe to write. */
const memory = new Map<string, unknown>();

/**
 * `chrome.storage.session` where it exists, `sessionStorage` under `vite dev` where it does not —
 * the same fallback shape `models/store.ts` uses for `chrome.storage.local`/`localStorage`.
 *
 * The dev shim is per-TAB, where the real one is per-browser. That difference only shows up in the
 * single-instance check (`lib/pagePresence.ts`), which needs the extension APIs anyway and stands
 * down without them, so dev degrades to today's behaviour rather than to something wrong.
 *
 * And where NEITHER exists, an in-memory map. Every write here is fire-and-forget from a UI
 * handler, so a throwing backend surfaces as an unhandled rejection with no user-visible cause —
 * losing the session is an acceptable degradation, taking the page down with it is not.
 */
function defaultArea(): SessionArea {
  const area = typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null;
  if (area)
    return {
      get: async <T>(key: string) => (await area.get(key))[key] as T | undefined,
      set: (key, value) => area.set({ [key]: value }),
      del: (key) => area.remove(key),
    };

  if (typeof sessionStorage !== 'undefined')
    return {
      get: async <T>(key: string) => {
        const raw = sessionStorage.getItem(key);
        if (raw === null) return undefined;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return undefined; // a half-written or stale-shaped value is no value
        }
      },
      set: async (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
      del: async (key) => sessionStorage.removeItem(key),
    };

  return {
    get: async <T>(key: string) => memory.get(key) as T | undefined,
    set: async (key, value) => void memory.set(key, value),
    del: async (key) => void memory.delete(key),
  };
}

/** A stored value survives a rebuild that changed this shape, so nothing is trusted on the way
 *  back in. A malformed entry is dropped rather than restored into a broken window. */
function isWindowState(v: unknown): v is WindowState {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return typeof w.appId === 'string' && w.appId.length > 0;
}

export async function getWindows(area: SessionArea = defaultArea()): Promise<WindowState[]> {
  const raw = await area.get<unknown>(WINDOWS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isWindowState).map((w) => ({ ...w, minimized: !!w.minimized, maximized: !!w.maximized }));
}

export async function setWindows(windows: WindowState[], area: SessionArea = defaultArea()): Promise<void> {
  await area.set(WINDOWS_KEY, windows);
}

/** The app's own bag, or null when it has never saved one (a fresh open). */
export async function getAppSession<T = unknown>(appId: string, area: SessionArea = defaultArea()): Promise<T | null> {
  return (await area.get<T>(appSessionKey(appId))) ?? null;
}

export async function setAppSession(appId: string, state: unknown, area: SessionArea = defaultArea()): Promise<void> {
  await area.set(appSessionKey(appId), state);
}

/**
 * Forget where the user was in this app.
 *
 * This is what makes CLOSE different from minimize, and it is the whole point of the distinction:
 * a closed app must reopen on its initial page like any desktop app, so its state cannot be left
 * lying around to be picked up by the next open.
 */
export async function clearAppSession(appId: string, area: SessionArea = defaultArea()): Promise<void> {
  await area.del(appSessionKey(appId));
}

// There is deliberately NO "clear the whole session" function here.
//
// The obvious place to want one is the handover to another page — and that is exactly where it
// would be wrong. A page that releases its apps must leave the session INTACT, because the page
// taking over is about to restore it; wiping it would hand the user an empty desktop. That is what
// the `releasing` flag in `appsController` protects, and a general-purpose clear sitting here is an
// invitation to undo it.
//
// The session ends on its own when the browser session does — `chrome.storage.session` is the whole
// expiry mechanism. Individual apps are forgotten by `clearAppSession` on close, which is the only
// forgetting the product actually has.
