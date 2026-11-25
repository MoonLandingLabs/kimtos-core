// The page half of single-instance (#1172). See `lib/presenceShared.ts` for why this exists.
//
// The worker decides; this asks, listens for being displaced, and stands down cleanly where the
// extension APIs are absent (`vite dev`), so development behaves exactly as it does today rather
// than as something subtly different.
import {
  PRESENCE_CLAIM,
  PRESENCE_FOCUS,
  PRESENCE_KEY,
  PRESENCE_RELEASE,
  PRESENCE_WORK_KEY,
  type ClaimResult,
  type HolderJob,
  type Presence,
  type PresenceWork,
} from './presenceShared.js';

/** This PAGE's id — new on every load, including a reload of the same tab. That is the point: a
 *  reloading page must be able to take primacy back from the record its previous life left behind,
 *  and a tab id could not tell the two apart. */
export const pageId: string =
  globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Are the extension messaging APIs here at all? Under `vite dev` they are not. */
const canMessage = (): boolean => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);

function send<T>(msg: Record<string, unknown>, fallback: T): Promise<T> {
  if (!canMessage()) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (reply: T) => {
        // Reading lastError is what stops Chrome logging "Unchecked runtime.lastError" when the
        // worker is asleep or gone; a page that cannot reach it must still come up.
        void chrome.runtime.lastError;
        resolve(reply ?? fallback);
      });
    } catch {
      resolve(fallback);
    }
  });
}

/**
 * Ask to be the page that runs the apps.
 *
 * Without the extension APIs this always grants — dev has one page and no worker to arbitrate, and
 * a dev build that refused to run its own apps would be worse than useless.
 */
export function claimPrimary({ force = false }: { force?: boolean } = {}): Promise<ClaimResult> {
  return send<ClaimResult>({ type: PRESENCE_CLAIM, pageId, force }, { primary: true });
}

/** Bring the page that IS running the apps to the front.
 *
 *  Resolves false when that tab has closed since we were refused — the caller needs to know,
 *  because a 'Switch to it' that quietly does nothing strands the user on a page showing them
 *  nothing else. */
export function focusHolder(tabId: number): Promise<boolean> {
  return send<{ ok: boolean }>({ type: PRESENCE_FOCUS, tabId }, { ok: false }).then((r) => Boolean(r?.ok));
}

/** Tell the worker this page is going away, so the next one claims without a liveness probe. */
export function releasePrimary(): Promise<void> {
  return send<{ ok: boolean }>({ type: PRESENCE_RELEASE, pageId }, { ok: false }).then(() => undefined);
}

/**
 * Call `onDisplaced` when another page takes over.
 *
 * This is the half that actually stops the audio: the page that lost is the one holding the live
 * players and the microphone, and it only learns it lost by watching the record change.
 *
 * Returns an unsubscribe function.
 */
export function watchForDisplacement(onDisplaced: (holder: Presence) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string): void => {
    if (areaName !== 'session' || !(PRESENCE_KEY in changes)) return;
    const next = changes[PRESENCE_KEY].newValue as Presence | undefined;
    // Cleared (the holder's tab closed) is not a displacement — nobody took it. Only a record
    // naming a DIFFERENT page means these apps are no longer ours to run.
    if (next && next.pageId !== pageId) onDisplaced(next);
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ---------------------------------------------------------------------------
// What the holder is working on (#1270)
// ---------------------------------------------------------------------------
//
// The takeover notice asks for consent to destroy work it could not name, because nothing ever
// crossed the gap between the two pages: the holder's KimtManager is an in-memory registry in a
// context the second page cannot reach. So the holder writes its rows down, and the second page
// reads them.
//
// PUBLISHING IS BEST-EFFORT AND SILENT. A storage write that fails costs a less specific sentence,
// which is exactly what the notice said before; it must never be able to stop a page coming up.

const sessionArea = (): chrome.storage.SessionStorageArea | null =>
  typeof chrome !== 'undefined' ? (chrome.storage?.session ?? null) : null;

/**
 * Say what THIS page is working on, or clear the record when it is working on nothing.
 *
 * Clearing on empty matters as much as writing: a list left behind by work that has since finished
 * would have the notice naming a job that no longer exists, and a warning that is sometimes false is
 * one users learn to click past.
 */
export function publishWork(jobs: readonly HolderJob[]): void {
  const area = sessionArea();
  if (!area) return;
  try {
    const done = jobs.length
      ? area.set({ [PRESENCE_WORK_KEY]: { pageId, jobs } satisfies PresenceWork })
      : area.remove(PRESENCE_WORK_KEY);
    void Promise.resolve(done).catch(() => {});
  } catch {
    /* see above: a page that cannot publish still runs */
  }
}

/**
 * Is this record still the CURRENT holder's?
 *
 * A page that dies without running its teardown — discarded, crashed, force-closed — leaves its
 * work record behind, and `chrome.tabs.onRemoved` clears only the presence record. Matching the two
 * page ids is what makes that leftover detectable rather than a confident lie about a tab that is
 * not doing anything any more.
 */
const workOf = (presence: Presence | null, work: PresenceWork | null): readonly HolderJob[] =>
  presence && work && work.pageId === presence.pageId ? work.jobs : [];

/** What the page that holds the apps is working on right now. Empty when we cannot tell. */
export async function readHolderWork(): Promise<readonly HolderJob[]> {
  const area = sessionArea();
  if (!area) return [];
  try {
    const got = await area.get([PRESENCE_KEY, PRESENCE_WORK_KEY]);
    return workOf(
      (got[PRESENCE_KEY] as Presence | undefined) ?? null,
      (got[PRESENCE_WORK_KEY] as PresenceWork | undefined) ?? null,
    );
  } catch {
    return [];
  }
}

/**
 * Call `onWork` whenever the holder's list changes, so the notice keeps up with a job that
 * finishes, fails or starts while the user is still reading it.
 *
 * A snapshot alone would be worse than nothing on the two transitions that matter most: work that
 * ends while the notice is up would leave a warning about nothing, and work that STARTS after the
 * notice was drawn would not be warned about at all.
 *
 * Returns an unsubscribe.
 */
export function watchHolderWork(onWork: (jobs: readonly HolderJob[]) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string): void => {
    // Either key moving can change the answer: the work list obviously, and the presence record
    // because it is what decides whether that list is still anybody's.
    if (areaName !== 'session' || (!(PRESENCE_WORK_KEY in changes) && !(PRESENCE_KEY in changes))) return;
    void readHolderWork().then(onWork);
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
