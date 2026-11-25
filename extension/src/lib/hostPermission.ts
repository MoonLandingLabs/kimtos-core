// Runtime control of the all-sites host permission (#637). The extension no longer requests
// `https://*/*` at install — it is an OPTIONAL permission, granted only when the user turns on a
// feature that must run on the pages they use it on: the two content-script apps (Grammit's
// writing assistant, Clipboard capture) and PDF import-by-URL. Mirrors apps/tabs/chromeTabs.ts,
// which does the same for the Tabs app's optional API permissions.
//
// Imported by the background service worker (via contentScripts.ts), so it stays free of the apps
// registry / models — importing `models/installed` here would drag the lazily-loaded apps into
// the self-contained background bundle (#115). The "is any host-app still installed?" decision
// therefore lives with the caller (installManager), which already knows.

/** The apps whose content scripts must run on every site. Enabling one requests the all-sites
 *  grant; uninstalling the last one releases it; and the background reconcile registers a
 *  content script for each installed one. The single source of truth for "needs all-sites". */
export const HOST_SCRIPT_APPS = ['grammit', 'clipboard', 'fakeform'] as const;

/** Does this app need the all-sites grant (a content-script app)? The one membership test,
 *  used by the install button, onboarding and the uninstall cleanup. */
export const isHostScriptApp = (id: string): boolean => (HOST_SCRIPT_APPS as readonly string[]).includes(id);

const ALL_SITES: chrome.permissions.Permissions = { origins: ['https://*/*'] };

const permsApi = (): boolean => typeof chrome !== 'undefined' && Boolean(chrome.permissions);

/** Do we currently hold the all-sites host permission? False under `vite dev` (no chrome). */
export const hasAllSites = async (): Promise<boolean> => {
  if (!permsApi()) return false;
  try {
    return await chrome.permissions.contains(ALL_SITES);
  } catch {
    return false;
  }
};

/** Request the all-sites grant. MUST be called from a user gesture (a click). Returns whether
 *  the user granted it. */
export const requestAllSites = async (): Promise<boolean> => {
  if (!permsApi()) return false;
  try {
    return await chrome.permissions.request(ALL_SITES);
  } catch {
    return false;
  }
};

/** Release the all-sites grant — called after uninstalling the last content-script app so the
 *  permission footprint follows the feature. The caller decides WHEN (once no host-app remains);
 *  this just performs it. Best-effort; a lingering grant is harmless, so failures are swallowed. */
export const removeAllSites = async (): Promise<void> => {
  if (!permsApi()) return;
  try {
    await chrome.permissions.remove(ALL_SITES);
  } catch {
    /* best-effort */
  }
};
