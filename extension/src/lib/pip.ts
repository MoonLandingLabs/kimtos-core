// Document Picture-in-Picture helper — pops a piece of the UI out into an
// always-on-top OS window (the same browser feature Google Meet uses), so it
// stays visible while the user browses other tabs and sites. Everything stays
// on-device: the PiP window is a same-origin child of this page, so the moved
// DOM keeps its event listeners and shares our IndexedDB/JS — no copy, no upload.
//
// Note: a Document PiP window lives only as long as this page does. Keep this
// tab open and browse in other tabs to keep the floating window around.

// The Document Picture-in-Picture API isn't in the standard DOM lib yet.
import { setAccent } from './accent.js';

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}
declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export const pipSupported = (): boolean => 'documentPictureInPicture' in window;

// Preset floating-window sizes (the per-app "Floating window size" setting picks
// one). The window is still drag-resizable by the user on top of this.
export const PIP_SIZES = {
  compact: { width: 380, height: 520 },
  standard: { width: 560, height: 720 },
  large: { width: 880, height: 940 },
};
export const DEFAULT_PIP_SIZE = 'standard';

// The two settings EVERY `popout: true` app gets — declared once, here, and merged
// in by `appSettings()` (lib/appConfig.ts). They are not an app's own settings: the
// runtime already reads them generically (appsController's `canPopOut` and the size
// lookup), so an app that opts into pop-out has always obeyed them. Only Notes ever
// declared them, so Clipboard and Retouch shipped a pop-out the user could neither
// turn off nor resize, while the docs claimed every app could (#197).
//
// The size options are DERIVED from PIP_SIZES rather than retyped: a fourth preset
// appears in every app's dropdown by adding it above, and there is no second list to
// forget. Notes used to hand-write this list — one fact, two copies.
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const POPOUT_SETTINGS = [
  {
    key: 'popout',
    label: 'Floating window',
    hint: 'Show a “pop out” button in the title bar so you can keep this app in a small, always-on-top window while you browse other tabs (like Google Meet). Needs a browser that supports it; keep this tab open.',
    type: 'select',
    default: 'on',
    options: [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
  },
  {
    key: 'pipSize',
    label: 'Floating window size',
    hint: 'How big the floating window opens. You can still drag its edges to resize it afterwards.',
    type: 'select',
    default: DEFAULT_PIP_SIZE,
    options: Object.keys(PIP_SIZES).map((size) => ({ value: size, label: capitalize(size) })),
  },
];

// Mirror our stylesheets into the PiP document so the moved UI looks identical.
// (A separate document doesn't inherit the opener's <style>/<link> tags.)
function copyStyles(pipDoc: Document): void {
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    pipDoc.head.appendChild(node.cloneNode(true));
  }
}

// A PiP document doesn't inherit the opener's <html> attributes or injected CSS
// vars, so the theme (data-theme + the injected --z-*/--bg-blur props) wouldn't
// reach it — the floating window stayed on the base dark palette. Mirror them.
function applyThemeTo(pipRoot: HTMLElement): void {
  pipRoot.style.cssText = document.documentElement.style.cssText;
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme) pipRoot.setAttribute('data-theme', theme);
  else pipRoot.removeAttribute('data-theme');
}

// Open floating windows, so a Light/Dark toggle can retheme them while they're up.
const openPipWindows = new Set<Window>();

// Push the current theme onto every open floating window. Wired as the new tab's `onChange`
// callback to followTheme() (lib/theme.ts), which is what re-applies the theme on a change —
// deliberately NOT called by applyTheme() itself, so the side panel and the toolbar popup do
// not pull this module into their bundles for windows they can never open (#1174).
export function syncPipTheme(): void {
  for (const pip of openPipWindows) {
    const root = pip.document?.documentElement;
    if (root) applyThemeTo(root);
  }
}

interface OpenPipOptions {
  width?: number;
  height?: number;
  accent?: string;
  onClose?: () => void;
}

// Open a floating window. Must be called synchronously inside a user gesture
// (a click) — the Picture-in-Picture API requires it. Resolves to the PiP
// `window`; `onClose` fires when the user (or code) closes it.
export async function openPipWindow({
  width = 560,
  height = 720,
  accent,
  onClose,
}: OpenPipOptions = {}): Promise<Window> {
  if (!pipSupported()) throw new Error('This browser does not support floating windows.');
  // Clamp to the screen so a "Large" request never asks for an off-screen window.
  const w = Math.min(width, (window.screen?.availWidth || 1280) - 40);
  const h = Math.min(height, (window.screen?.availHeight || 800) - 80);
  const pip = await window.documentPictureInPicture!.requestWindow({ width: w, height: h });
  copyStyles(pip.document);
  const pipRoot = pip.document.documentElement;
  pipRoot.classList.add('pip-root');
  applyThemeTo(pipRoot); // follow Light/Dark (before --accent so the app tint wins)
  if (accent) setAccent(pipRoot, accent);
  openPipWindows.add(pip);
  pip.addEventListener(
    'pagehide',
    () => {
      openPipWindows.delete(pip);
      onClose?.();
    },
    { once: true },
  );
  return pip;
}
