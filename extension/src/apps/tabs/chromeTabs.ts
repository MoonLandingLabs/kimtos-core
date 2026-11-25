// A thin, typed wrapper over the browser tab APIs the Tabs app uses. Kept apart
// from the UI so the app reads cleanly and the chrome guards live in one place.
//
// Privacy: reading tab titles/URLs needs the `tabs` permission, which we request
// at runtime (optional permission) only when the user opens this app — not from
// everyone on update. `favicon` rides along in the same request: it lets the app show each
// tab's icon from the browser's own cache (lib/favicon.ts) instead of contacting the site.
// Everything here is on-device; nothing is uploaded.

const PERMS: chrome.permissions.Permissions = { permissions: ['tabs', 'tabGroups', 'sessions', 'favicon'] };

/** The nine colors Chrome allows for a tab group. */
export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;

/** Whether we're running as an extension at all (false under `vite dev`). */
export const tabsAvailable = (): boolean =>
  typeof chrome !== 'undefined' && Boolean(chrome.tabs) && Boolean(chrome.windows) && Boolean(chrome.permissions);

export const hasTabsPermission = async (): Promise<boolean> => {
  try {
    return await chrome.permissions.contains(PERMS);
  } catch {
    return false;
  }
};

/** Must be called from a user gesture (a button click). */
export const requestTabsPermission = async (): Promise<boolean> => {
  try {
    return await chrome.permissions.request(PERMS);
  } catch {
    return false;
  }
};

export interface TabItem {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  favIconUrl: string;
  active: boolean;
  audible: boolean;
  discarded: boolean;
  pinned: boolean;
  groupId: number;
}
export interface WindowGroup {
  windowId: number;
  focused: boolean;
  tabs: TabItem[];
}
export interface GroupInfo {
  id: number;
  title: string;
  color: string;
}

const UNGROUPED = -1;

function toItem(t: chrome.tabs.Tab): TabItem {
  return {
    id: t.id ?? -1,
    windowId: t.windowId ?? -1,
    index: t.index ?? 0,
    title: t.title || t.url || 'Untitled',
    url: t.url || t.pendingUrl || '',
    favIconUrl: t.favIconUrl || '',
    active: Boolean(t.active),
    audible: Boolean(t.audible),
    discarded: Boolean(t.discarded),
    pinned: Boolean(t.pinned),
    groupId: t.groupId ?? UNGROUPED,
  };
}

/** All normal browser windows with their tabs (excludes popups/devtools). */
export async function queryWindows(): Promise<WindowGroup[]> {
  const wins = await chrome.windows.getAll({ populate: true });
  return wins
    .filter((w) => w.type === 'normal')
    .map((w) => ({
      windowId: w.id ?? -1,
      focused: Boolean(w.focused),
      tabs: (w.tabs ?? []).map(toItem).sort((a, b) => a.index - b.index),
    }));
}

/** Tab-group id → label/color (empty when tab groups are unavailable). */
export async function groupMap(): Promise<Map<number, GroupInfo>> {
  const map = new Map<number, GroupInfo>();
  if (!chrome.tabGroups) return map;
  try {
    for (const g of await chrome.tabGroups.query({})) {
      map.set(g.id, { id: g.id, title: g.title ?? '', color: String(g.color) });
    }
  } catch {
    /* tabGroups permission not granted / unsupported — degrade to no groups */
  }
  return map;
}

export async function activate(id: number, windowId: number): Promise<void> {
  await chrome.tabs.update(id, { active: true });
  await chrome.windows.update(windowId, { focused: true });
}

export const closeTab = (id: number): Promise<void> => chrome.tabs.remove(id);

export async function hibernate(id: number): Promise<void> {
  await chrome.tabs.discard(id);
}

export async function openUrls(urls: string[]): Promise<void> {
  const clean = urls.filter(Boolean);
  if (clean.length) await chrome.windows.create({ url: clean });
}

/** The tabs of the window this new-tab page lives in (for "Save this window"). */
export async function currentWindowTabs(): Promise<TabItem[]> {
  const w = await chrome.windows.getCurrent({ populate: true });
  return (w.tabs ?? []).map(toItem).sort((a, b) => a.index - b.index);
}

/** Re-run `fn` whenever tabs change (open/close/move/navigate). Returns cleanup. */
export function onTabsChanged(fn: () => void): () => void {
  const t = chrome.tabs;
  // These events have different callback shapes; a no-arg listener is assignable
  // to all of them, so treat them uniformly.
  const events = [
    t.onCreated,
    t.onRemoved,
    t.onUpdated,
    t.onMoved,
    t.onActivated,
    t.onReplaced,
    t.onDetached,
    t.onAttached,
  ] as unknown as Array<chrome.events.Event<() => void>>;
  for (const e of events) e.addListener(fn);
  return () => {
    for (const e of events) e.removeListener(fn);
  };
}

// ---- move / pin / reorder ----

export async function moveTab(id: number, windowId: number, index: number): Promise<void> {
  await chrome.tabs.move(id, { windowId, index });
}
export async function moveToNewWindow(id: number): Promise<void> {
  await chrome.windows.create({ tabId: id });
}
export async function setPinned(id: number, pinned: boolean): Promise<void> {
  await chrome.tabs.update(id, { pinned });
}

// ---- tab groups (create / recolor / rename / ungroup) ----

// @types/chrome types `tabIds` as a non-empty tuple and `group()` as
// `Promise<number> & void`; cast to keep our plain-array signature ergonomic.
type TabIds = [number, ...number[]];

/** Group the given tabs into `groupId` if set, else a new group. */
export async function addToGroup(tabIds: number[], groupId?: number): Promise<void> {
  const ids = tabIds as TabIds;
  const opts = groupId != null ? { tabIds: ids, groupId } : { tabIds: ids };
  await (chrome.tabs.group(opts) as Promise<number>);
}
export async function ungroup(tabIds: number[]): Promise<void> {
  if (tabIds.length) await chrome.tabs.ungroup(tabIds as TabIds);
}
export async function updateGroup(groupId: number, changes: { title?: string; color?: string }): Promise<void> {
  await chrome.tabGroups.update(groupId, changes as chrome.tabGroups.UpdateProperties);
}
/** The tab ids currently in a group (for ungroup-all). */
export async function tabsInGroup(groupId: number): Promise<number[]> {
  const tabs = await chrome.tabs.query({ groupId });
  return tabs.map((t) => t.id).filter((id): id is number => id != null);
}

// ---- recently closed ----

export interface ClosedItem {
  sessionId: string;
  kind: 'tab' | 'window';
  title: string;
  url: string;
  favIconUrl: string;
  count: number;
}
export async function recentlyClosed(): Promise<ClosedItem[]> {
  if (!chrome.sessions) return [];
  let sessions: chrome.sessions.Session[];
  try {
    sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  } catch {
    return [];
  }
  const out: ClosedItem[] = [];
  for (const s of sessions) {
    if (s.tab) {
      out.push({
        sessionId: s.tab.sessionId ?? '',
        kind: 'tab',
        title: s.tab.title || s.tab.url || 'Tab',
        url: s.tab.url || '',
        favIconUrl: s.tab.favIconUrl || '',
        count: 1,
      });
    } else if (s.window) {
      const tabs = s.window.tabs ?? [];
      out.push({
        sessionId: s.window.sessionId ?? '',
        kind: 'window',
        title: `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`,
        url: '',
        favIconUrl: tabs[0]?.favIconUrl || '',
        count: tabs.length,
      });
    }
  }
  return out.filter((c) => c.sessionId);
}
export async function restoreClosed(sessionId: string): Promise<void> {
  if (chrome.sessions) await chrome.sessions.restore(sessionId);
}
