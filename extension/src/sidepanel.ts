// KimtOS Clipboard — the Chrome side-panel host. Mounts the SAME clipboard app
// UI (render + local routes + dataStore) into a standalone extension page pinned
// beside any tab. Reuses the full style bundle (base/shell/components + the app's
// own CSS via its import) and mirrors the new-tab theme.
//
// Clipboard is optional, so this page is gated on the install state exactly like the new-tab
// shell (isInstalled): Chrome can open a side panel on its own — from the toolbar's panel
// picker, with no help from us — so gating only the context menu that opens it would still run
// the app for someone who removed it.
import './styles/main.css';
import './styles/sidepanel.css';
import { el } from './lib/dom.js';
import { store } from './models/store.js';
import { isInstalled } from './models/installed.js';
import { followTheme } from './lib/theme.js';
import clipboardApp from './apps/clipboard/index.js';

/** The app isn't in the user's set — say how to add it. */
function notInstalledNotice(): HTMLElement {
  const box = el('div', 'panel-notice');
  box.append(
    el('h3', 'panel-notice-title', 'Clipboard isn’t installed'),
    el('p', 'panel-notice-body', 'Add it from the App Store on your KimtOS new tab, then reopen this panel.'),
  );
  return box;
}

let cleanup: (() => void) | null = null;

// The panel's contents, decided from the CURRENT installed set.
//
// A side panel is pinned beside a tab and stays open for days — so a user who uninstalls Clipboard
// elsewhere must not leave the whole app running here, in a window they never close. It repaints
// whenever the persisted store changes.
function paint(panel: HTMLElement): void {
  if (cleanup) {
    cleanup(); // stop the app before replacing it
    cleanup = null;
  }

  const id = clipboardApp.id;
  if (!isInstalled(id)) {
    panel.replaceChildren(notInstalledNotice());
    return;
  }
  panel.replaceChildren();
  if (typeof clipboardApp.render === 'function') cleanup = clipboardApp.render(panel) || null;
}

async function main(): Promise<void> {
  await store.init(); // hydrate settings from chrome.storage first

  // Follow the user's Light/Dark choice — and KEEP following it. This used to apply the theme
  // once, here, and never again, so changing Appearance on the new tab left this panel on the
  // palette it booted with (#1174): a side panel stays open for days.
  followTheme();

  const panel = document.getElementById('clip-panel');
  if (!panel) return;

  paint(panel);
  store.subscribe(() => paint(panel));
}

void main();
