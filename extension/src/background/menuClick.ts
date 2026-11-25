// What a right-click menu item does — extracted from the service worker so the one rule that
// matters here can actually be tested.
//
// THE RULE: `chrome.sidePanel.open()` MUST BE CALLED SYNCHRONOUSLY, in direct response to the
// user's click. Chrome enforces a user-gesture requirement, and an `await` — any await, however
// quick — spends the gesture. The handler used to re-check the install state first:
//
//   chrome.contextMenus.onClicked.addListener((info, tab) => {
//     void (async () => {
//       if (!(await clipboardActive())) return;      // <-- the gesture dies here
//       ...
//       void chrome.sidePanel.open({ windowId }).catch(() => {});   // <-- rejected, silently
//
// So "Open Kimtos Clipboard panel" did nothing, and the empty catch made sure nobody found out
// (#257). The bug is not that the check is wrong; it is that it cannot be awaited BEFORE the
// open, and nobody noticed because the failure was thrown away.
//
// That check was also protecting nothing. The side panel gates ITSELF (`sidepanel.ts` shows a
// not-installed notice), and it must: Chrome can open the panel from the toolbar's own
// panel picker with no help from us, so gating the menu alone was never a gate at all.
//
// The other items keep the re-check. They write to the store and message tabs — a menu can
// outlive the install state that created it (the service worker suspends), and those paths do not
// gate themselves.

export interface MenuInfo {
  menuItemId: string | number;
  selectionText?: string;
  pageUrl?: string;
}

export interface MenuTab {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

export interface MenuDeps {
  /** Open the side panel. MUST be reachable without awaiting anything first. */
  openPanel: (windowId: number) => Promise<void>;
  /** Is Clipboard installed? Async — so it can never precede `openPanel`. */
  isActive: () => Promise<boolean>;
  openPicker: (tabId: number | undefined) => void;
  saveSelection: (clip: { text: string; source: { url: string; title: string; favicon?: string } }) => Promise<void>;
  /** Report a failure. The old code swallowed it, which is why a dead feature stayed dead. */
  onError: (message: string, error: unknown) => void;
}

/**
 * Handle a context-menu click.
 *
 * Returns a promise for the async work, so callers can await it in tests. The SIDE PANEL branch
 * deliberately runs before that promise is created — it is synchronous, and it must stay that
 * way. If you find yourself adding an `await` above it, the feature breaks and says nothing.
 */
export function handleMenuClick(info: MenuInfo, tab: MenuTab | undefined, deps: MenuDeps): Promise<void> {
  // ── synchronous, gesture-bearing path ─────────────────────────────────────
  if (info.menuItemId === 'clip-open-panel') {
    if (tab?.windowId == null) {
      deps.onError('side panel: no windowId on the clicked tab', info);
      return Promise.resolve();
    }
    // No await before this line. Ever.
    return deps.openPanel(tab.windowId).catch((e) => {
      // A rejection here is the user-gesture error, or a panel that is not configured. It is a
      // real failure with a real cause, and the user just clicked a menu item that did nothing —
      // so it gets said out loud rather than dropped.
      deps.onError('side panel failed to open', e);
    });
  }

  // ── everything else may await ─────────────────────────────────────────────
  return (async () => {
    // Re-check rather than trusting the menu: the service worker suspends, so a menu can outlive
    // the install state that created it — and the save path writes to the store, which does not
    // gate itself (#68).
    if (!(await deps.isActive())) return;

    if (info.menuItemId === 'clip-open-picker') {
      deps.openPicker(tab?.id);
      return;
    }
    if (info.menuItemId === 'clip-save-selection' && info.selectionText) {
      await deps.saveSelection({
        text: info.selectionText,
        source: { url: info.pageUrl || tab?.url || '', title: tab?.title || '', favicon: tab?.favIconUrl },
      });
    }
  })();
}
