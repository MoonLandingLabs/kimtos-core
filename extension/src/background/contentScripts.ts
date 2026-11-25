// Runtime registration of the Grammit / Clipboard content scripts (#637).
//
// These used to be DECLARED in the manifest against `https://*/*`, which forced every install to
// request all-sites access (Chrome's "read and change all your data on all websites" warning +
// the store's in-depth review). Now the base install requests no all-sites access; the scripts
// are registered at runtime once the app is installed AND the optional all-sites permission is
// held, and unregistered otherwise. Their in-page install gates (writer.ts `watchGate`,
// clipboardCapture.ts `clipboardActiveCached`) are unchanged — registration keys on INSTALLED +
// permission only, and the in-page gates follow later installs/uninstalls without a reload.
import { readInstalledState } from '../lib/installedApps';
import { HOST_SCRIPT_APPS, hasAllSites } from '../lib/hostPermission';

interface ScriptSpec {
  id: string; // stable registration id
  js: string; // the built content-script bundle
  runAt: 'document_start' | 'document_idle';
}

// The registration spec for each content-script app, KEYED off HOST_SCRIPT_APPS so TypeScript
// forces exactly one spec per app — add an app to HOST_SCRIPT_APPS and this won't compile until
// its spec is here (one source of truth for "which apps are content-script apps"). `js` / `runAt`
// match the manifest declarations these replace (writer.js document_idle, clipboard.js document_start).
const SPEC_BY_APP: Record<(typeof HOST_SCRIPT_APPS)[number], ScriptSpec> = {
  grammit: { id: 'kimtos-writer', js: 'writer.js', runAt: 'document_idle' },
  clipboard: { id: 'kimtos-clipboard', js: 'clipboard.js', runAt: 'document_start' },
  // FakeForm registers only its BADGE. The filler (fakeform-fill.js) is never registered —
  // the worker injects it with chrome.scripting.executeScript the moment a fill is asked for,
  // so its dataset and generators never load on a page nobody fills (#222).
  fakeform: { id: 'kimtos-fakeform', js: 'fakeform.js', runAt: 'document_idle' },
};

/** Every registration id we own, for the `getRegisteredContentScripts` filter in the reconcile. */
const OUR_IDS = HOST_SCRIPT_APPS.map((app) => SPEC_BY_APP[app].id);

/** Which content scripts SHOULD be registered, given the installed set and whether the all-sites
 *  host permission is held. Pure + testable. Empty when the permission isn't held — a script
 *  can't run without it, and MV3 refuses to register against a host we don't have. */
export function desiredContentScripts(
  installedApps: readonly string[],
  hasHostPermission: boolean,
): chrome.scripting.RegisteredContentScript[] {
  if (!hasHostPermission) return [];
  return HOST_SCRIPT_APPS.filter((app) => installedApps.includes(app)).map((app) => ({
    id: SPEC_BY_APP[app].id,
    js: [SPEC_BY_APP[app].js],
    matches: ['https://*/*'],
    runAt: SPEC_BY_APP[app].runAt,
  }));
}

/** Reconcile the runtime-registered content scripts to match (installed apps + host permission):
 *  register the ones that should exist, unregister the ones that shouldn't — idempotently. Called
 *  on startup, install/update, and whenever the installed set or the permission changes. On UPDATE
 *  this is what keeps existing users (who still hold the now-optional all-sites grant) from losing
 *  Grammit/Clipboard. Best-effort — never throws into a lifecycle listener. */
export async function reconcileContentScripts(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.scripting?.registerContentScripts) return;
  try {
    const state = await readInstalledState();
    const desired = desiredContentScripts(state?.installedApps ?? [], await hasAllSites());
    const desiredIds = new Set(desired.map((d) => d.id));

    const current = await chrome.scripting.getRegisteredContentScripts({ ids: OUR_IDS });
    const currentIds = new Set(current.map((c) => c.id));

    const toUnregister = current.filter((c) => !desiredIds.has(c.id)).map((c) => c.id);
    const toRegister = desired.filter((d) => !currentIds.has(d.id));

    if (toUnregister.length) await chrome.scripting.unregisterContentScripts({ ids: toUnregister });
    if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister);
  } catch (err) {
    // A duplicate-id race, a revoked permission mid-flight, or the API being unavailable — the
    // next lifecycle event reconciles again.
    console.warn('[kimtos] content-script reconcile failed:', err);
  }
}
