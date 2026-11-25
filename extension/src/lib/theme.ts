import { store } from '../models/store.js';

// The active light/dark theme: an explicit Light/Dark pick, or the OS preference
// in System mode. Use this whenever code needs to know the effective theme (the
// wallpaper default, a new NotaBoard's paper, etc.).
export function resolvedTheme(): 'light' | 'dark' {
  const t = store.get('theme');
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Pin the Appearance setting on a document root.
 *
 * 'system' means no attribute, so `base.css`'s `@media (prefers-color-scheme)` decides and the
 * OS retints the page with no JS at all; 'light'/'dark' pin `data-theme`, overriding the OS.
 *
 * Takes a root because a floating (pop-out) window is a different document — see
 * `lib/pip.ts`, which mirrors the attribute onto its own `<html>`.
 */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  const theme = store.get('theme');
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * Apply the theme now AND on every change. Returns an unsubscribe.
 *
 * Three surfaces render our palette — the new tab, the Clipboard side panel and the toolbar
 * popup — and each had its own copy of the two lines above. Two of them applied the theme once
 * at startup and never again, so changing Appearance left the side panel on the palette it
 * booted with until the user closed and reopened it. A side panel is pinned beside a tab and
 * stays open for days, so "once at startup" is the whole bug (#1174). The three copies are also
 * how it drifted in the first place: the new tab grew `syncPipTheme()` and the other two did not.
 *
 * `onChange` is the caller's extra work — the new tab retints its pop-out windows and re-picks
 * the wallpaper. It is a callback rather than something this module knows about, so the side
 * panel and popup do not pull `lib/pip.ts` and the background controller into their bundles.
 *
 * It fires ONLY when the theme really changed, which is why the last value is kept here:
 * `store.subscribe` hands over the whole settings object with no diff, so a bare re-run would
 * have the new tab re-pick its wallpaper on every settings write — a blur nudge, a toggled home
 * card — not just on a theme one.
 */
export function followTheme(onChange?: () => void): () => void {
  let last = store.get('theme');
  applyTheme();
  return store.subscribe(() => {
    const next = store.get('theme');
    if (next === last) return;
    last = next;
    applyTheme();
    onChange?.();
  });
}
