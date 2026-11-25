// Clipboard app — shared, DOM-free primitives usable from ALL three contexts:
// the new-tab page, the background service worker, and the capture content
// script. Deliberately imports nothing that touches the extension's IndexedDB or
// the DOM (the content script must not bundle dataStore/idb), so this holds only
// types, constants, pure helpers, and the cross-context capture-control state
// (kept in chrome.storage.local so SW + content script + UI share one source).

import { appInstalled, workspaceIdOf, STORE_NS } from './installedApps.js';
import { watchAppInstalled } from './storageWatch.js';

/** This app's id — its id in apps/clipboard/meta.ts. */
export const CLIPBOARD_APP_ID = 'clipboard';

export type ClipType = 'text' | 'link' | 'color' | 'image';

/** Where a clip was copied from (for the source chip in the UI). */
export interface ClipSource {
  url: string;
  title: string;
  favicon?: string;
}

/** One saved clipboard entry (records collection `clipboard-items`). */
export interface ClipItem {
  id: string;
  type: ClipType;
  text: string;
  preview: string;
  hash: string;
  bytes: number;
  favorite: boolean;
  tags: string[];
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  source?: ClipSource;
  /** Image clips only: the mime type. The blob lives at `clipboard:<id>`. */
  mime?: string;
}

/**
 * What does picking this clip actually DELIVER?
 *
 * An image clip's `text` is `''` — its content is a blob, not a string. The in-page picker read
 * `clip.text` and pasted it anyway, and pasting `''` is not a no-op: it replaces the user's
 * SELECTION with nothing (in a text field and in a contentEditable), or overwrites the system
 * clipboard with an empty string when no field is focused. An action invoked to insert something
 * silently deleted something (#250).
 *
 * `type` was already being sent to the picker for exactly this decision, and was never read. So
 * the decision lives here, in the module both the service worker and the content script import,
 * and it is made once rather than assumed at each call site.
 *
 * `none` is the important case: a clip that can deliver nothing must do nothing.
 */
export type ClipDelivery = { kind: 'text'; text: string } | { kind: 'image'; id: string } | { kind: 'none' };

export function deliveryFor(clip: { id?: string; type?: string; text?: string } | null | undefined): ClipDelivery {
  if (!clip) return { kind: 'none' };
  if (clip.type === 'image') return clip.id ? { kind: 'image', id: clip.id } : { kind: 'none' };
  const text = clip.text ?? '';
  return text ? { kind: 'text', text } : { kind: 'none' };
}

/** The blob-store key for an image clip's bytes. */
export const imageBlobKey = (id: string): string => `clipboard:${id}`;

/** Capture behaviour — read by the content script + SW, edited from the app. */
export interface CaptureState {
  monitorEnabled: boolean;
  excludedSites: string[];
  maxItems: number;
  /** Show the little "Saved to Kimtos Clipboard" note on the page after a copy. */
  notify: boolean;
  /** Also capture copied images (off by default — browsers rarely fire it). */
  captureImages: boolean;
  pausedUntil?: number;
}

/** dataStore partition names (app-id prefixed → auto-mapped in AnubisDB). */
export const CLIP_COLLECTION = 'clipboard-items';
export const TAGS_KEY = 'clipboard:tags';
/** chrome.storage.local keys shared across contexts. */
const CAPTURE_KEY = 'clipboard:capture';
export const CHANGED_KEY = 'clipboard:changed';

/** Skip anything larger than this (chars) — clipboard managers cap huge pastes. */
export const MAX_CLIP_LEN = 100_000;
/** Skip images bigger than this (bytes) — keep IndexedDB reasonable. */
export const MAX_IMG_BYTES = 5_000_000;

export const DEFAULT_CAPTURE: CaptureState = {
  monitorEnabled: true,
  excludedSites: [],
  maxItems: 500,
  notify: true,
  captureImages: false,
};

/** Fast, synchronous FNV-1a hash → hex. Only for dedupe (text is re-compared on
 *  a hash hit, so a collision can never merge two different clips). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const URL_RE = /^https?:\/\/\S+$/i;
// The CSS Color 4 surface: hex in all four lengths (#rgb, #rgba, #rrggbb, #rrggbbaa)
// and every functional syntax. BOTH halves are fully anchored — the function needs its
// closing ")" with nothing after it — so a bare "rgb(" or a colour embedded in a longer
// string ("background: #fff") stays text (#948).
const COLOR_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)$/i;

export function classifyText(s: string): ClipType {
  const t = s.trim();
  if (URL_RE.test(t)) return 'link';
  if (COLOR_RE.test(t)) return 'color';
  return 'text';
}

/** A single-line, length-capped display string. */
export function previewOf(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 200 ? `${one.slice(0, 200)}…` : one;
}

/** UTF-8 byte length (available in page, worker, and content-script contexts). */
export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// --- cross-context capture state (chrome.storage.local, dev-safe) -------------

interface LocalArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
interface ChangeArea {
  addListener(fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
  removeListener(fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
}
interface ChromeLike {
  storage?: { local?: LocalArea; onChanged?: ChangeArea };
}
const chromeApi = (): ChromeLike | undefined => (globalThis as { chrome?: ChromeLike }).chrome;
const localArea = (): LocalArea | null => chromeApi()?.storage?.local ?? null;

// Capture settings are PER-WORKSPACE (#489): the stored value is `{ byWs: { [workspaceId]:
// CaptureState } }`, and every context (service worker, content script, UI) resolves the active
// workspace from the `kimtos` blob (`workspaceIdOf`), so the capture on/off and exclusion list
// (a bank, a password manager) always land under the same key. The `byWs` wrapper is an
// unambiguous marker of the new shape (the shared `csConfigMirror` detects it generically); a
// pre-#489 value is a bare `CaptureState` scalar (no `byWs`), adopted into the current workspace.
interface CaptureWrap {
  byWs: Record<string, Partial<CaptureState>>;
}
const isWrapped = (v: unknown): v is CaptureWrap =>
  !!v && typeof v === 'object' && 'byWs' in (v as object) && typeof (v as CaptureWrap).byWs === 'object';

/** Current capture settings for the active workspace (defaults when unset or under `vite dev`). */
export async function getCaptureState(): Promise<CaptureState> {
  const local = localArea();
  if (!local) return { ...DEFAULT_CAPTURE };
  const got = await local.get([CAPTURE_KEY, STORE_NS]);
  const ws = workspaceIdOf(got[STORE_NS]);
  const stored = got[CAPTURE_KEY];
  // Wrapped → this workspace's entry. Legacy scalar → applies to every workspace until the next
  // `setCaptureState` migrates it into the wrapper.
  const value = isWrapped(stored) ? (stored.byWs[ws] ?? {}) : ((stored as Partial<CaptureState>) ?? {});
  return { ...DEFAULT_CAPTURE, ...value };
}

/** Merge a patch into the ACTIVE workspace's capture settings and persist. */
export async function setCaptureState(patch: Partial<CaptureState>): Promise<CaptureState> {
  const local = localArea();
  const got = (await local?.get([CAPTURE_KEY, STORE_NS])) ?? {};
  const ws = workspaceIdOf(got[STORE_NS]);
  const stored = got[CAPTURE_KEY];
  // Wrapped → ride along; a legacy scalar → adopt it into the current workspace (its de-facto
  // owner). Other workspaces keep their own entries untouched.
  const byWs = isWrapped(stored) ? { ...stored.byWs } : stored ? { [ws]: stored as Partial<CaptureState> } : {};
  const next = { ...DEFAULT_CAPTURE, ...(byWs[ws] ?? {}), ...patch };
  byWs[ws] = next;
  await local?.set({ [CAPTURE_KEY]: { byWs } satisfies CaptureWrap });
  return next;
}

/** Signal (to open app windows) that the clip set changed — the SW can't reach
 *  the page's dataStore listeners, so it pokes this instead. */
export function bumpChanged(): void {
  void localArea()?.set({ [CHANGED_KEY]: Date.now() });
}

function subscribe(key: string, fn: () => void): () => void {
  const onChanged = chromeApi()?.storage?.onChanged;
  if (!onChanged) return () => {};
  const handler = (changes: Record<string, unknown>, area: string): void => {
    if (area === 'local' && key in changes) fn();
  };
  onChanged.addListener(handler);
  return () => onChanged.removeListener(handler);
}

/** Fire when the clip set changes in another context (i.e. an SW capture). */
export const onClipsChanged = (fn: () => void): (() => void) => subscribe(CHANGED_KEY, fn);
/** Fire when capture settings change (content script live-reloads its state). */
export const onCaptureChanged = (fn: () => void): (() => void) => subscribe(CAPTURE_KEY, fn);

// --- Installed gate -----------------------------------------------------------
// The capture pipeline runs only when the app is INSTALLED — otherwise the always-injected
// content script would capture the clipboard of a user who never asked for it.
//
// The rule is NOT restated here. It lives in lib/installedApps.ts (the one rule every context
// shares, fed with the only state a content script / the service worker can read).

/** Is the Clipboard app installed? */
export const clipboardActive = (): Promise<boolean> => appInstalled(CLIPBOARD_APP_ID);

// A synchronous cache so per-copy / per-focus checks don't await the store. Start
// OFF (false): until the real verdict resolves via watchAppInstalled, the in-field paste
// button / picker / hotkey must not briefly appear for a user who has not installed the app
// (#469). The SW backstops the data either way, so this only closes the visible-chrome window.
let activeCache = false;
export const clipboardActiveCached = (): boolean => activeCache;

/** Prime + keep the sync cache fresh (call once from the content script).
 *  The live-gate machinery is shared with Grammit Anywhere and anything injected next
 *  (lib/storageWatch.ts) — one copy is the point. */
export function initActiveCache(): void {
  watchAppInstalled(CLIPBOARD_APP_ID, (on) => {
    activeCache = on;
  });
}
