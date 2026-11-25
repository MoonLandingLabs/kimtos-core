// The worker half of single-instance (#1172). It arbitrates which new-tab page runs the apps.
//
// It lives here rather than in the page for two reasons. The worker is the only context that knows
// which tab a message came from (`sender.tab.id`) — a page cannot learn its own tab id without the
// `tabs` permission, and adding one would put a new install warning in front of every user. And
// arbitration needs a single decider: two pages racing to write the same record both believe they
// won.
//
// LIVENESS IS EVENT-DRIVEN, NOT A HEARTBEAT. A background tab has its timers throttled to about
// once a minute, so a heartbeat from the page the user is not looking at goes stale exactly when
// they are using another tab — and primacy would be handed away from a page that is very much
// alive, still holding a microphone. Instead: the record is cleared when its tab closes
// (`chrome.tabs.onRemoved`), and a claim probes the incumbent with `chrome.tabs.get`. Both are
// authoritative, and neither needs the `tabs` permission — that is only required to read a tab's
// url/title, which this never does.
/* global chrome */
import {
  PRESENCE_CLAIM,
  PRESENCE_FOCUS,
  PRESENCE_KEY,
  PRESENCE_RELEASE,
  type Presence,
} from '../lib/presenceShared.js';

const readPresence = async (): Promise<Presence | null> =>
  ((await chrome.storage.session.get(PRESENCE_KEY))[PRESENCE_KEY] as Presence | undefined) ?? null;

const writePresence = (p: Presence): Promise<void> => chrome.storage.session.set({ [PRESENCE_KEY]: p });

/** Is that tab still open? The authoritative liveness test. A tab id we can no longer resolve is a
 *  tab that is gone, so the record it left behind must not keep a new page locked out. */
async function tabIsAlive(tabId: number | undefined): Promise<boolean> {
  if (typeof tabId !== 'number') return false;
  try {
    return Boolean(await chrome.tabs.get(tabId));
  } catch {
    return false; // "No tab with id" — it is gone
  }
}

/**
 * Decide whether this page runs the apps.
 *
 * Grants when: nothing holds it, the holder's tab has closed, the caller already holds it (a
 * re-claim after a reload is the same page asking again), or the user explicitly chose to take
 * over. Otherwise the caller is told which tab to switch to.
 */
export async function claim(
  pageId: string,
  tabId: number | undefined,
  force: boolean,
): Promise<{ primary: boolean; holderTabId?: number }> {
  const held = await readPresence();
  // The record is only a rival if it belongs to a DIFFERENT, still-open tab.
  //
  // The same-tab test is what makes a reload work, and leaving it out is worse than it sounds: a
  // reload is a new page id in the same tab, so the record its previous life left behind would read
  // as a live rival and the page would be told "KimtOS is already open in another tab" — pointing
  // at itself. Coming back after a reload is the entire feature; it cannot be the one case that
  // locks the user out.
  const sameTab = held?.tabId !== undefined && held.tabId === tabId;
  const contested = held && held.pageId !== pageId && !sameTab && (await tabIsAlive(held.tabId));

  // A FORCED claim is granted immediately, without waiting for the old page to confirm it has let
  // go. That leaves a brief window — one storage event's delivery — in which both pages still have
  // the apps mounted. It is bounded and self-healing (the loser tears down as soon as its listener
  // fires), and restoring never starts playback or recording on its own, so nothing new begins in
  // the new page during it; what can overlap is the old page's already-playing clip.
  //
  // Closing it properly needs a two-phase handshake — claim, wait for the loser to acknowledge its
  // teardown, then restore — with its own timeout to handle a loser that never answers. That is a
  // protocol, not a tweak, so it is tracked separately rather than half-done here (#1180).
  if (contested && !force) return { primary: false, holderTabId: held.tabId };

  await writePresence({ pageId, tabId });
  return { primary: true };
}

/** Bring the page that is running the apps to the front. */
async function focusTab(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    // The holder may be in another browser window, where activating its tab is not enough to put
    // it in front of the user.
    if (typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, { focused: true });
    return true;
  } catch {
    return false;
  }
}

/** Give up primacy, but only if this page is the one holding it — a page that already lost a
 *  takeover must not wipe the record of the page that won it on its way out. */
export async function release(pageId: string): Promise<void> {
  const held = await readPresence();
  if (held?.pageId === pageId) await chrome.storage.session.remove(PRESENCE_KEY);
}

/** Wire the worker half. Called once from `background/index.ts`. */
export function registerPresence(): void {
  chrome.runtime.onMessage.addListener((msg: { type?: string; [k: string]: unknown }, sender, sendResponse) => {
    if (msg?.type === PRESENCE_CLAIM) {
      void claim(String(msg.pageId ?? ''), sender.tab?.id, Boolean(msg.force)).then(sendResponse);
      return true; // async response
    }
    if (msg?.type === PRESENCE_FOCUS) {
      void focusTab(Number(msg.tabId)).then((ok) => sendResponse({ ok }));
      return true;
    }
    if (msg?.type === PRESENCE_RELEASE) {
      void release(String(msg.pageId ?? '')).then(() => sendResponse({ ok: true }));
      return true;
    }
    return undefined; // not ours — let the other listeners answer
  });

  // The holder's tab closed. Clearing the record here is what lets the NEXT new-tab page start
  // running apps immediately, instead of being told to switch to a tab that no longer exists.
  chrome.tabs.onRemoved.addListener((tabId) => {
    void readPresence().then((held) => {
      if (held?.tabId === tabId) void chrome.storage.session.remove(PRESENCE_KEY);
    });
  });
}
