// The single-instance protocol, shared by the page (`lib/pagePresence.ts`) and the service worker
// (`background/presence.ts`) so neither can drift from the other's idea of the message names.
//
// WHY SINGLE-INSTANCE AT ALL. The extension IS the new-tab page, so every new tab is a separate JS
// context with its own window map, and nothing connected them. Play a clip in one tab, open
// another, and the first goes on playing where the user cannot see it, reach it or stop it —
// closing the app in the second tab cannot touch it, because it is not the page that owns it
// (#1172). Every per-app teardown in this codebase is already correct; the audio survived because
// the code that stops it was never called in the page the user walked away from.
//
// So exactly one page runs the apps. A second page is offered the choice: switch to the one that
// is running, or take over here — and taking over makes the old page release, which runs those
// teardowns. The fix is a protocol, not another `destroy()` call.

/** The presence record, in `chrome.storage.session` — so it dies with the browser session, exactly
 *  like the session it guards. `shell:` is not an app id, so AnubisDB files it under the system
 *  bucket with no registry edit. */
export const PRESENCE_KEY = 'shell:presence';

/** Which page currently owns the apps. */
export interface Presence {
  /** Identifies the PAGE, not the tab: a reload is a new page in the same tab, and the reloading
   *  page must be able to reclaim primacy from the record its previous life left behind. */
  pageId: string;
  /** The tab that page lives in, so another page can offer to switch to it. Known only to the
   *  service worker (`sender.tab.id`), which is why claiming goes through a message. */
  tabId?: number;
}

/**
 * What the holder page is WORKING on, published for the page being asked to take over (#1270).
 *
 * A separate key, deliberately. The presence record above is arbitration and only the worker may
 * write it; this is advisory, written straight from the holder page, and the worst a wrong value can
 * do is word a sentence badly. Folding it into the record would put the page in the business of
 * rewriting the thing that decides who wins, over a string.
 *
 * It is `chrome.storage.session` for the same reason presence is: it dies with the browser session,
 * and `shell:` is not an app id, so AnubisDB files it under the system bucket with no registry edit.
 */
export const PRESENCE_WORK_KEY = 'shell:presence-work';

/** One piece of background work the holder page has running — a row from its own KimtManager. */
export interface HolderJob {
  appId: string;
  /** The app's display name. Resolved by the publisher, because the reader has no window map for
   *  the other tab and an id in a sentence to a user is not a name. */
  name: string;
  /** The job's own live line, e.g. 'Cleaning audio'. */
  label: string;
  /** 0..1, or null when the work genuinely cannot be measured. Never invented. */
  ratio: number | null;
  /** Stopping it keeps what it has produced so far — see `JobSpec.savesOnStop`. */
  savesOnStop: boolean;
  /** False for work that cannot be interrupted: taking over leaves it running, and the notice has
   *  to say so rather than promise a stop that will not happen. */
  cancellable: boolean;
}

/** The published record. `pageId` is what makes a leftover from a dead tab detectable. */
export interface PresenceWork {
  pageId: string;
  jobs: readonly HolderJob[];
}

/** Page → worker: "I want to run the apps." `force` is the user choosing 'Use here instead'. */
export const PRESENCE_CLAIM = 'presence:claim';
/** Page → worker: "bring the page that IS running to the front." */
export const PRESENCE_FOCUS = 'presence:focus';
/** Page → worker: "I am going away" (pagehide), so the next page claims without a liveness probe. */
export const PRESENCE_RELEASE = 'presence:release';

export interface ClaimResult {
  /** Did this page get the apps? */
  primary: boolean;
  /** When it did not: the tab holding them, for the 'Switch to it' button. */
  holderTabId?: number;
}
