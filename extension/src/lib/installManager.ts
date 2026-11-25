// Global install/uninstall manager. Operations run in the background and survive
// the App Store dialog being closed — closing the store never cancels a download,
// and reopening it shows the live progress. Two event channels:
//   onProgress      — fires on every progress tick (the store updates its buttons)
//   onInstalledChange — fires only when the installed set actually changes
//                       (the dock + home refresh, so no flicker during a download)

import { appModel, appModelKey } from './appModels.js';
import { setInstalled, isInstalled, isRequired } from '../models/installed.js';
import { HOST_SCRIPT_APPS, isHostScriptApp, removeAllSites } from './hostPermission.js';
import { apps } from '../apps/index.js';
import { kimtManager as km, type JobContext } from './kimtManager.js';

// THE JOBS THEMSELVES LIVE IN `lib/kimtManager.ts`, the orchestrator (#1172). This module keeps
// the install/uninstall MECHANICS and the vocabulary its callers already speak; what it no longer
// keeps is a second record of what is in flight. There used to be one here — an `ops` map — and it
// was invisible to everything except the App Store, which is why a download the user had started
// could not be found from anywhere else. Everything below now derives from the registry, so there
// is exactly one answer to "is this app busy?".
interface Op {
  kind: 'install' | 'uninstall';
  ratio: number | null;
  /** Whether this op's Stop would actually stop it — see `ModelEntry.cancellable`. */
  cancellable: boolean;
}
type Listener = () => void;

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';
const appName = (appId: string): string => apps.find((a) => a.id === appId)?.name ?? 'this app';

const changeListeners = new Set<Listener>();
const notifyChange = (): void => changeListeners.forEach((fn) => fn());

/** Progress now comes from the orchestrator, so a caller subscribing here hears about every kind of
 *  work, not only installs. */
export const onProgress = (fn: Listener): (() => void) => km.subscribe(fn);
export const onInstalledChange = (fn: Listener): (() => void) => (
  changeListeners.add(fn),
  () => changeListeners.delete(fn)
);

const jobKindOf = (job: { kind: string }): Op['kind'] => (job.kind === 'uninstall' ? 'uninstall' : 'install');

export const currentOp = (appId: string): Op | null => {
  const job = km.jobFor(appId);
  // `cancellable` travels with the op because the BUTTON has to know. It used to assume every
  // install could be cancelled, which was true only because every install claimed to be — once
  // that claim became honest, an ✕ on a download whose engine cannot stop would be a control
  // that does nothing at all (#1302).
  return job ? { kind: jobKindOf(job), ratio: job.progress(), cancellable: job.cancellable } : null;
};
export const isBusy = (appId: string): boolean => km.jobFor(appId) !== null;
export const opError = (appId: string): string | null => km.failedFor(appId)?.error() ?? null;
// True while any app is DOWNLOADING (install / model re-fetch). Used to warn — via
// a snackbar — that closing a dialog won't cancel the download. Uninstalls (fast,
// no download) don't count.
export const anyDownloading = (): boolean => km.active().some((j) => j.kind === 'download');

// Clear any lingering error messages (e.g. when the App Store is reopened).
export function clearInstallErrors(): void {
  // INSTALL errors only. This is called when the App Store opens, and clearing everything meant a
  // Denoise failure the user had not seen yet vanished as a side effect of opening a dialog that
  // had nothing to do with it.
  km.clearFailed({ lane: 'network' });
}

// Pull a 0..1 download ratio out of an engine's progress payload, if present.
const toRatio = (p: unknown): number | null => (p as { ratio?: number } | null | undefined)?.ratio ?? null;

/**
 * Run an install/uninstall as a registered job.
 *
 * The orchestrator owns the queue, the abort signal, the progress and the failure; this only says
 * what the work IS. That is the whole point of routing through it: a download started from the App
 * Store is the same object KimtManager lists and the user can stop, rather than a private promise
 * only this file knows about.
 */
function run(appId: string, kind: Op['kind'], work: (ctx: JobContext) => Promise<void>): boolean {
  if (isBusy(appId)) return false; // already in flight
  km.clearFailed({ appId }); // a retry starts clean
  km.start({
    appId,
    kind: kind === 'uninstall' ? 'uninstall' : 'download',
    title: kind === 'uninstall' ? `Removing ${appName(appId)}` : `Downloading ${appName(appId)}`,
    // An uninstall is fast and destructive halfway through — there is nothing safe to interrupt, so
    // the row offers no Stop rather than a button that silently does nothing.
    //
    // A DOWNLOAD offers one only when its engine actually honours the signal, which the model
    // entry declares. It used to be unconditional, so six installs rendered an enabled Stop,
    // deleted the row when it was pressed, and kept downloading up to 300 MB — the user believing
    // they had stopped it (#1302). Same rule, same reason: no button beats a button that lies.
    cancellable: kind !== 'uninstall' && (appModel(appId)?.cancellable ?? false),
    run: async (ctx) => {
      let changed = false;
      try {
        await work(ctx);
        // Work that COMPLETED after the user cancelled (an engine that cannot abort its own fetch)
        // must not count as a change — it already skipped setInstalled.
        changed = !ctx.signal.aborted;
      } catch (e) {
        if (isAbort(e) || ctx.signal.aborted) return; // a user cancel is not a failure
        // Offline is the common cause and the one with an obvious remedy, so it is said plainly
        // rather than surfacing whatever the fetch layer threw.
        throw new Error(
          !navigator.onLine
            ? `you're offline. Reconnect to the internet and try again.`
            : e instanceof Error
              ? e.message
              : String(e),
          { cause: e },
        );
      } finally {
        if (changed) notifyChange();
      }
    },
  });
  return true;
}

/** Cancel an in-flight install/download: abort the fetch (where the engine supports it) and reset
 *  the button immediately. The app is left uninstalled and re-installable. An engine that cannot
 *  abort its own network may still finish caching in the background, but the setInstalled guard in
 *  `install`/`ensureModel` keeps it from silently re-installing. */
export function cancel(appId: string): void {
  km.jobFor(appId)?.cancel();
}

export function install(appId: string): void {
  run(appId, 'install', async (ctx) => {
    const model = appModel(appId);
    if (model) {
      if (!navigator.onLine)
        throw new Error(`you're offline. Connect to the internet to download ${appName(appId)}'s model.`);
      await model.download((p) => ctx.progress(toRatio(p)), ctx.signal);
    }
    if (ctx.signal.aborted) return; // cancelled during the download — leave it uninstalled
    await setInstalled(appId, true);
  });
}

// Apps whose config moved on while they were busy, so the re-fetch could not start. NOT the
// requests themselves — see `ensureModel`.
const pendingRecheck = new Set<string>();
let offRecheck: (() => void) | null = null;

/** Run the re-checks that were waiting for their app to be free. */
function flushRechecks(): void {
  for (const appId of [...pendingRecheck]) {
    if (isBusy(appId)) continue; // still working; the next change of state will come back here
    pendingRecheck.delete(appId);
    ensureModel(appId);
  }
  // Nothing waiting means nothing to listen for. The subscription is attached only while it has
  // something to do, so this module holds no permanent listener on the orchestrator.
  if (!pendingRecheck.size) {
    offRecheck?.();
    offRecheck = null;
  }
}

// Re-fetch an installed app's assets for its current config — called when a
// download-affecting setting changes (e.g. a bigger model, a new OCR language,
// enabling AI grammar) so that USING the app never triggers a download. No-op if
// the app isn't installed or has no model.
//
// Returns whether it actually started a download, so the caller can say so. "Is this app busy?"
// is not the same question: an earlier download still running would answer yes while this
// request was dropped, and announcing THAT as the new model's download would name a size the
// running transfer is not fetching.
//
// A request that CANNOT start now is remembered rather than dropped. It used to be thrown away,
// so changing a model twice in a row left the app configured for one it had never fetched, and
// the download then happened at use time — the wait #1306 is about, right after the user had been
// told a download was under way (#1310).
//
// What is remembered is the APP, not the request: whatever eventually runs reads the config as it
// is THEN. So three quick changes collapse into one fetch of the final choice, and a stale choice
// from two changes ago can never be fetched, which is exactly what queueing the requests would
// have done.
export function ensureModel(appId: string): boolean {
  const model = appModel(appId);
  if (!isInstalled(appId) || !model) return false; // nothing to fetch, so nothing to remember
  const started = run(appId, 'install', async (ctx) => {
    if (!navigator.onLine)
      throw new Error(`you're offline. Connect to the internet to download ${appName(appId)}'s model.`);
    await model.download((p) => ctx.progress(toRatio(p)), ctx.signal);
  });
  if (started) return true;
  pendingRecheck.add(appId);
  offRecheck ??= km.subscribe(flushRechecks);
  return false;
}

// True when another *installed* app shares this app's model cache, so freeing it
// here would break that other app.
function modelSharedByOther(appId: string): boolean {
  const key = appModelKey(appId);
  if (!key) return false;
  return apps.some((a) => a.id !== appId && isInstalled(a.id) && appModelKey(a.id) === key);
}

// Wipe an app's on-device data (history, documents, …). Apps that own data
// declare a `clearData()` on their descriptor; others have nothing to erase.
async function clearAppData(appId: string): Promise<void> {
  await apps.find((a) => a.id === appId)?.clearData?.();
}

// `eraseData` also deletes the user's saved data for this app; by default the
// data is kept for the next install. The model cache is freed only when no other
// installed app still depends on it.
export function uninstall(appId: string, { eraseData = false }: { eraseData?: boolean } = {}): void {
  // A required app cannot be uninstalled (#176), and the refusal has to happen HERE, not in
  // setInstalled: this function frees the model and erases the user's data FIRST. A guard
  // further down would let a caller wipe the data and then decline to uninstall — the worst
  // of both. Refuse before anything is destroyed.
  if (isRequired(appId)) return;
  run(appId, 'uninstall', async () => {
    if (!modelSharedByOther(appId)) await appModel(appId)?.remove();
    if (eraseData) await clearAppData(appId);
    await setInstalled(appId, false);
    // Uninstalling a content-script app: once neither Grammit nor Clipboard remains, release the
    // all-sites host permission so the grant follows the feature (#637). The content script itself
    // is unregistered by the background reconcile that the setInstalled write triggers.
    if (isHostScriptApp(appId) && !HOST_SCRIPT_APPS.some(isInstalled)) {
      await removeAllSites();
    }
  });
}
