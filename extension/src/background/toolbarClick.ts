// What the toolbar click does on a given tab — the popup, or straight to Kimtos (#1186).
//
// #1110 made the click open a page-actions popup, which is right when the page HAS actions:
// FakeForm's fills and Clipboard's paste are otherwise reachable only through shortcuts nobody
// finds. It is wrong when it does not. On a `chrome://` page there is never anything to show,
// and — the bigger case — the two apps that register page actions are both optional, so a user who has
// installed neither gets a menu whose only item is "Open Kimtos", on every page, forever. That is one extra click to do
// what one click used to do.
//
// Chrome resolves the click PER TAB: clearing a tab's popup with `setPopup({ tabId, popup: '' })`
// makes a click fire `chrome.action.onClicked` instead. So the menu stays exactly where it earns
// its place and is skipped where it is empty, with no change to the popup itself.
//
// THE MANIFEST STILL DECLARES `default_popup`, AND THAT IS THE SAFETY PROPERTY. The popup is
// what happens on every tab we have not positively cleared — so a sleeping worker or a missed
// event lands on today's behaviour. The dangerous direction is the other one: clearing the popup
// on a page that DOES have actions swallows the menu. Every "we do not know" below therefore
// resolves towards SHOWING the popup, and this module clears only on a confident answer.
//
// The sharpest instance of that, and the bug the first review round caught: WE USUALLY CANNOT
// SEE THE URL. `tabs` is an optional permission the extension does not hold by default, and
// `host_permissions` covers five domains — so `tab.url` comes back undefined for ordinary sites,
// and `pageKindOf` maps a missing URL to 'restricted'. That mapping is right for `popup.ts`,
// which always runs under the `activeTab` grant the click just produced, and wrong here, where
// there is no gesture: taking it at face value cleared the popup on every ordinary page for
// exactly the users the menu exists for. So an unreadable URL is treated as the MOST
// action-friendly page instead, and we clear only when even that yields nothing — which is still
// every page for a user with none of the actions' apps installed, the case #1186 is actually about.

import { pageActionsFor, pageKindOf, isSecurePage, type PopupModel } from '../lib/pageActions.js';
import { readInstalledState } from '../lib/installedApps.js';
import { hasAllSites } from '../lib/hostPermission.js';

/** The manifest's popup, restated here because `setPopup` needs the path to put it back. */
const POPUP_PAGE = 'popup.html';

/** The browser calls this module makes, injectable so the orchestration is testable — the same
 *  shape `background/menuClick.ts` and `background/fakeform.ts` use for the same reason. */
export interface ToolbarDeps {
  readInstalledState: typeof readInstalledState;
  hasAllSites: typeof hasAllSites;
  setPopup: (details: { tabId: number; popup: string }) => Promise<void>;
  queryTabs: () => Promise<{ id?: number; url?: string }[]>;
}

const liveDeps = (): ToolbarDeps => ({
  readInstalledState,
  hasAllSites,
  setPopup: (details) => chrome.action.setPopup(details),
  queryTabs: () => chrome.tabs.query({}),
});

/**
 * Is the popup worth opening for this page? Pure — the whole decision, and the whole test
 * surface.
 *
 * Zero actions is NOT the condition, which is the subtlety worth keeping. `grant-host` means
 * the user has installed apps whose actions a missing site permission is blocking, and the popup
 * carries the only button that grants it (`popup.ts` -> `requestAllSites`). Skipping the popup
 * there would strand them with no route to the thing they installed.
 */
export function shouldShowPopup(model: PopupModel): boolean {
  return model.actions.length > 0 || model.notice === 'grant-host';
}

/**
 * The popup's own context (`popup.ts` -> `repaint`), rebuilt from what the background can see.
 *
 * Two deliberate differences, both leaning towards showing the popup, because this runs with no
 * `activeTab` grant behind it:
 *
 *   - an unreadable URL is treated as an ordinary secure page rather than a restricted one
 *     (see the module header) — we clear only if even the friendliest page has nothing;
 *   - an unreadable installed set returns null and we do not guess. `popup.ts` can afford `{}`
 *     there because a hidden row is only a cosmetic loss; here it would clear the popup.
 */
async function modelFor(url: string | undefined, deps: ToolbarDeps): Promise<PopupModel | null> {
  const [installed, allSites] = await Promise.all([deps.readInstalledState(), deps.hasAllSites()]);
  if (!installed) return null; // cannot know — the caller keeps the popup
  const known = Boolean(url);
  return pageActionsFor({
    installed,
    pageKind: known ? pageKindOf(url) : 'web',
    secure: known ? isSecurePage(url) : true,
    hasAllSites: allSites,
  });
}

/** The newest `syncPopupFor` call per tab. A redirect chain fires `onUpdated` several times, and
 *  the awaits inside mean an older computation can resolve last and write a stale answer over the
 *  current page's. Only the newest call for a tab is allowed to write. */
const latest = new Map<number, number>();
let ticket = 0;

/**
 * Point one tab's toolbar click at the popup or at `onClicked`.
 *
 * Anything unknown or thrown leaves the popup in place rather than propagating: an unreadable
 * installed set, or a tab that closed mid-flight, must never leave the click pointing nowhere.
 */
export async function syncPopupFor(tabId: number, url: string | undefined, deps = liveDeps()): Promise<void> {
  const mine = ++ticket;
  latest.set(tabId, mine);
  let popup = POPUP_PAGE;
  try {
    const model = await modelFor(url, deps);
    if (model && !shouldShowPopup(model)) popup = '';
  } catch {
    // Keep POPUP_PAGE — today's behaviour is always the safe answer.
  }
  if (latest.get(tabId) !== mine) return; // a newer navigation in this tab has overtaken us
  latest.delete(tabId);
  try {
    await deps.setPopup({ tabId, popup });
  } catch {
    // The tab went away between the decision and the write. Nothing to set.
  }
}

/**
 * Re-decide for every open tab.
 *
 * The installed set and the all-sites grant are not per-tab: installing an app or granting
 * the permission changes the answer in every window at once, and a user who has just installed
 * one must not have to reload a tab to reach it.
 */
export async function syncAllTabs(deps = liveDeps()): Promise<void> {
  try {
    const tabs = await deps.queryTabs();
    await Promise.all(tabs.map((t) => (t.id === undefined ? Promise.resolve() : syncPopupFor(t.id, t.url, deps))));
  } catch {
    // No tabs API, or the query failed. Every tab keeps the manifest's popup, which is safe.
  }
}
