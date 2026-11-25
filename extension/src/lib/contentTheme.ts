// The palette for UI we draw onto OTHER PEOPLE'S pages.
//
// `styles/base.css` is the source of truth for colour, and a content script cannot read one
// token of it: it runs in the VISITED PAGE's document, so our `:root` and its `data-theme`
// attribute are simply not there. Every in-page surface therefore carried its own copy of the
// palette, and the copies had already drifted into three different darks — and four of the five
// pinned that dark outright, so a user on Light mode got a dark popover hanging off a light page
// with no setting anywhere that changed it (#1173).
//
// This is the one mirror. It holds the SAME VALUES as base.css, and `contentTheme.test.ts`
// reads base.css and fails if a value here stops matching the token it mirrors — which is what
// makes a hand-copied palette safe to keep. `content/writer.ts` had the right shape before this
// existed (local vars flipped for light mode) and its comment called itself "the sanctioned
// different-document exception to the tokens-only rule"; this is that exception, once.
//
// Only BRAND colour stays inline: the Kimtos gradient and its blue are the mark, not the
// palette, and `content/brand.ts` already says so.
//
// The API is deliberately LIVE-ONLY. There is no "what is the theme right now" export, because
// the answer expires: the user picks Appearance on the new tab, and an in-page surface may have
// been sitting on a page for days by then. `themeShadowHost` is the whole interface, and it
// keeps following. That is the same bug `followTheme` exists for on our own pages (#1174), and
// the shape `storageWatch.ts` already uses for the installed-app gate (#223).

import { STORE_NS, workspaceIdOf } from './installedApps.js';
import { subscribeLocal } from './storageWatch.js';

export type ContentTheme = 'light' | 'dark';

/** Set on the shadow HOST; the light half of the palette hangs off it. */
export const THEME_ATTR = 'data-kimtos-theme';

/**
 * The theme-dependent tokens, mirrored from base.css as `[dark, light]`.
 *
 * Keyed by the base.css token name WITHOUT its `--`, so `panel` mirrors `--panel` and is
 * exposed here as `--kt-panel`. One name, no translation table — a mapping between two sets of
 * names is one more thing that can drift, and drift is the whole reason this file has a test.
 */
export const PALETTE = {
  panel: ['rgba(28, 28, 32, 0.98)', '#f5f5f8'],
  text: ['#ffffff', '#1d1d1f'],
  'text-secondary': ['rgba(255, 255, 255, 0.62)', 'rgba(0, 0, 0, 0.5)'],
  hairline: ['rgba(255, 255, 255, 0.14)', 'rgba(0, 0, 0, 0.08)'],
  surface: ['rgba(255, 255, 255, 0.05)', 'rgba(0, 0, 0, 0.04)'],
  'surface-hover': ['rgba(255, 255, 255, 0.09)', 'rgba(0, 0, 0, 0.06)'],
  field: ['rgba(0, 0, 0, 0.25)', 'rgba(0, 0, 0, 0.05)'],
  scrim: ['rgba(0, 0, 0, 0.55)', 'rgba(0, 0, 0, 0.26)'],
  shadow: ['0 12px 40px rgba(0, 0, 0, 0.32)', '0 16px 50px rgba(0, 0, 0, 0.12)'],
  danger: ['#f87171', '#b91c1c'],
} as const satisfies Record<string, readonly [string, string]>;

/**
 * Tokens base.css declares ONCE, for both themes. Same keying as `PALETTE`; the test asserts
 * these are absent from the light block, so a token that later grows a light value cannot sit
 * here quietly pinned to its dark one.
 */
export const CONSTANTS = {
  accent: '#2563eb',
  'on-accent': '#ffffff',
} as const satisfies Record<string, string>;

const vars = (i: 0 | 1): string =>
  Object.entries(PALETTE)
    .map(([name, pair]) => `    --kt-${name}: ${pair[i]};`)
    .join('\n');

const constantVars = (): string =>
  Object.entries(CONSTANTS)
    .map(([name, value]) => `    --kt-${name}: ${value};`)
    .join('\n');

/**
 * Put this in every shadow root that paints our palette, and call `themeShadowHost` on its host.
 *
 * Dark is the default so a root that never gets the attribute still looks right, which is what
 * happens for the one frame before the stored setting has been read.
 */
export const CONTENT_THEME_CSS = `
  :host {
${constantVars()}
${vars(0)}
  }
  :host([${THEME_ATTR}='light']) {
${vars(1)}
  }
`;

// --- resolving the active theme ------------------------------------------------------------
//
// Same rule as `lib/theme.ts`'s `resolvedTheme()`: an explicit Light/Dark pick wins, and
// 'system' — the default — falls back to the OS. Reached differently, because a content script
// cannot use `models/store.ts`: it reads the `kimtos` chrome.storage blob directly, exactly as
// `installedApps.ts` does for the installed set, and resolves the per-workspace partition with the
// same shared helper so it reads the active workspace's setting rather than the device's (#472).

interface LocalArea {
  get(keys: string): Promise<Record<string, unknown>>;
}
interface ChromeLike {
  storage?: { local?: LocalArea };
}
const localArea = (): LocalArea | null => (globalThis as { chrome?: ChromeLike }).chrome?.storage?.local ?? null;

const darkQuery = (): MediaQueryList | null => globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
const osTheme = (): ContentTheme => (darkQuery()?.matches ? 'dark' : 'light');

/** The Appearance setting from the blob a caller already read. Pure. */
function settingOf(blob: unknown): 'system' | 'light' | 'dark' {
  const workspaces = (blob as { workspaces?: Record<string, { theme?: unknown }> } | undefined)?.workspaces;
  const theme = workspaces?.[workspaceIdOf(blob)]?.theme;
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

// One resolution for the whole bundle, not one per surface: a page can be showing a chip, a menu
// and a toast at once, and three copies would mean three storage reads and three listeners.
let setting: 'system' | 'light' | 'dark' = 'system';
let current: ContentTheme = osTheme();
const listeners = new Set<(t: ContentTheme) => void>();
let wired = false;

function recompute(): void {
  const next = setting === 'system' ? osTheme() : setting;
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn(current);
}

function readSetting(): void {
  const local = localArea();
  // No chrome.storage at all (i.e. `vite dev`) is not an error — the OS preference stands.
  if (!local) return;
  void local
    .get(STORE_NS)
    .then((data) => {
      setting = settingOf(data[STORE_NS]);
      recompute();
    })
    .catch(() => {
      // The extension context was invalidated (an update/reload while this page stayed open).
    });
}

/** Wire the two things that can change the answer, once for the bundle. */
function wire(): void {
  if (wired) return;
  wired = true;
  // The stored pick, and every later change to it — the same `chrome.storage.onChanged` feed the
  // install gate rides on, and the same key. It is a SECOND listener, not a share of the
  // gate's: `subscribeLocal` adds one per call and does not dedupe across callers. What `wired`
  // buys is one listener for the whole bundle however many surfaces it draws, which is the part
  // that would otherwise scale with the chip, the menu and the toast all being on screen at once.
  subscribeLocal([STORE_NS], readSetting);
  // The OS preference, which matters only in System mode but costs nothing to keep hooked.
  darkQuery()?.addEventListener?.('change', recompute);
  readSetting();
}

/**
 * Follow the active theme. `fn` is called immediately with the best answer available (the OS
 * preference, until the stored setting arrives) and again whenever it changes. Returns an
 * unsubscribe.
 */
export function watchContentTheme(fn: (theme: ContentTheme) => void): () => void {
  wire();
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

/**
 * Keep a shadow host's palette attribute in step with the active theme. Returns an unsubscribe —
 * call it wherever the surface already tears its host down.
 */
export function themeShadowHost(host: HTMLElement): () => void {
  return watchContentTheme((theme) => host.setAttribute(THEME_ATTR, theme));
}

/** Test-only: forget the resolved answer and the listeners between cases. */
export function __resetContentTheme(): void {
  darkQuery()?.removeEventListener?.('change', recompute);
  listeners.clear();
  setting = 'system';
  current = osTheme();
  wired = false;
}
