// Kimtos Clipboard — capture content script, injected into every https page
// (dist/clipboard.js). Listens for `copy`/`cut`, reads the copied text, and
// forwards it to the background service worker (which persists it). Reading the
// selection / clipboardData inside the copy handler needs NO `clipboardRead`
// permission and no user-gesture prompt. Nothing is stored here — a content
// script can't reach the extension's IndexedDB.

/* global chrome */
import {
  DEFAULT_CAPTURE,
  MAX_CLIP_LEN,
  MAX_IMG_BYTES,
  clipboardActiveCached,
  getCaptureState,
  initActiveCache,
  onCaptureChanged,
  type CaptureState,
} from '../lib/clipboardShared.js';
import { initPicker } from './clipboardPicker.js';
import { showToast } from './toast.js';

// Keep the sync "is Clipboard installed?" cache fresh.
initActiveCache();

// The in-page history picker (Alt+Shift+V / right-click), so past clips can be
// pasted without switching to the Kimtos tab.
initPicker();

// Local cache of capture settings so each copy check is synchronous. Start from
// the defaults (monitor ON) so copies are never dropped while the async read of
// the stored settings is still in flight; refresh on load + on settings changes.
let state: CaptureState = { ...DEFAULT_CAPTURE };
const refresh = (): void => {
  void getCaptureState().then((s) => {
    state = s;
  });
};
refresh();
onCaptureChanged(refresh);

// Never capture from a password field (hard rule, not a setting).
function isPasswordField(node: EventTarget | null): boolean {
  return node instanceof HTMLInputElement && node.type === 'password';
}

function onCopy(e: ClipboardEvent): void {
  try {
    if (!clipboardActiveCached()) return; // only when Clipboard is installed
    const s = state;
    if (!s.monitorEnabled) return;
    if (s.pausedUntil && Date.now() < s.pausedUntil) return;
    if (s.excludedSites.some((p) => p && location.host.includes(p))) return;
    if (isPasswordField(document.activeElement) || isPasswordField(e.target)) return;

    // Image capture (opt-in) — when the copy carries an image file.
    if (s.captureImages) {
      const imgItem = [...(e.clipboardData?.items || [])].find(
        (it) => it.kind === 'file' && it.type.startsWith('image/'),
      );
      const file = imgItem?.getAsFile();
      if (file) {
        if (file.size <= MAX_IMG_BYTES) {
          const reader = new FileReader();
          reader.onload = () => {
            chrome.runtime.sendMessage(
              {
                type: 'clip:add-image',
                dataUrl: String(reader.result),
                mime: file.type,
                url: location.href,
                title: document.title,
              },
              (resp?: { stored?: boolean }) => {
                if (chrome.runtime.lastError) return;
                if (resp?.stored && s.notify) showToast('Saved to Kimtos Clipboard');
              },
            );
          };
          reader.readAsDataURL(file);
        }
        return; // handled as an image copy
      }
    }

    let text = (window.getSelection()?.toString() || '').trim();
    if (!text) text = (e.clipboardData?.getData('text/plain') || '').trim();
    if (!text || text.length > MAX_CLIP_LEN) return;

    chrome.runtime.sendMessage(
      { type: 'clip:add', text, url: location.href, title: document.title },
      (resp?: { stored?: boolean }) => {
        // Swallow "receiving end does not exist" if the SW is momentarily down.
        if (chrome.runtime.lastError) return;
        if (resp?.stored && state.notify) showToast('Saved to Kimtos Clipboard');
      },
    );
  } catch {
    // A page's odd selection/DOM shouldn't ever surface an error to the user.
  }
}

document.addEventListener('copy', onCopy, true);
document.addEventListener('cut', onCopy, true);
