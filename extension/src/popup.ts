// The toolbar popup — what you can do on THIS page, right now (#1110).
//
// Clicking the pinned icon used to open a new tab and nothing else, spending the one moment the
// user is looking at a page and reaching for KimtOS on navigating away from it. Now it opens a
// short menu of the page actions that already ship: FakeForm's fills, Clipboard's paste. Those
// were only reachable through keyboard shortcuts nobody finds, so this is a discoverability
// surface — it invokes the same handlers the shortcuts do (lib/pageActions.ts explains the
// registry; background/pageCommands.ts is the one dispatcher).
//
// Two rules keep it a tool rather than a second dock:
//
//   - It only shows what is actionable RIGHT NOW. Not installed, or the page
//     cannot host it -> the row is absent, never greyed out. The whole decision is the pure
//     `pageActionsFor` in lib/pageActions.ts, which is where the tests are.
//   - "Open KimtOS" stays one click. It is the primary row and it does exactly what the old
//     `chrome.action.onClicked` listener did.
//
// Every row shows its real bound shortcut, read from `chrome.commands.getAll()` rather than the
// manifest's SUGGESTED key — a user can rebind them at chrome://extensions/shortcuts, and a
// popup that teaches the wrong key is worse than one that teaches none. Teaching the right one
// is the point: a repeat user should stop needing this popup.

import './styles/main.css';
import './styles/popup.css';
import { brandMarkSvg, paintAppTile } from './components/appIcon.js';
import { el } from './lib/dom.js';
import { monogram } from './lib/format.js';
import { hasAllSites, requestAllSites } from './lib/hostPermission.js';
import { readInstalledState, STORE_NS } from './lib/installedApps.js';
import {
  PAGE_ACTION_RUN,
  pageActionsFor,
  pageKindOf,
  isSecurePage,
  appsOf,
  type PageAction,
  type PopupModel,
} from './lib/pageActions.js';
import { appMeta } from './apps/metaIndex.js';
import { store } from './models/store.js';
import { followTheme } from './lib/theme.js';

/** The active tab this popup belongs to, plus whatever we are allowed to know about it. */
interface ActiveTab {
  id: number | undefined;
  url: string | undefined;
}

async function activeTab(): Promise<ActiveTab> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { id: tab?.id, url: tab?.url };
  } catch {
    // No tabs API (vite dev) — behave as if we can see nothing, which reads as "restricted".
    return { id: undefined, url: undefined };
  }
}

/** The bound shortcut for each `commands` key, as the user actually has it. Empty when a
 *  command is unbound (Chrome only auto-binds the few that declare a suggested key, and the
 *  user may have cleared or changed any of them). */
async function shortcuts(): Promise<Map<string, string>> {
  try {
    const all = await chrome.commands.getAll();
    return new Map(all.map((c) => [c.name ?? '', c.shortcut ?? '']));
  } catch {
    return new Map();
  }
}

/** One app's heading: its shared glyph tile plus its name, so a row is instantly attributable. */
function groupHeader(appId: string): HTMLElement {
  const meta = appMeta(appId);
  const name = meta?.name ?? appId;
  const row = el('div', 'popup-group');
  const tile = el('span', 'popup-tile has-app-icon');
  // paintAppTile returns false for an app with no glyph in @kimtos/icons — fall back to the
  // letter monogram the dock and the App Store use, and drop the gradient tile treatment.
  if (!meta || !paintAppTile(tile, { id: appId, accent: meta.accent })) {
    tile.classList.remove('has-app-icon');
    tile.textContent = monogram(name);
  }
  row.append(tile, el('span', 'popup-group-name', name));
  return row;
}

/** One action row: label on the left, its bound shortcut on the right. */
function actionRow(action: PageAction, shortcut: string, onRun: (a: PageAction) => void): HTMLElement {
  const row = el('button', 'popup-row');
  row.type = 'button';
  row.setAttribute('role', 'menuitem');
  row.append(el('span', 'popup-row-label', action.label));
  if (shortcut) row.append(el('kbd', 'popup-key', shortcut));
  row.addEventListener('click', () => onRun(action));
  return row;
}

/** The primary row. Same behaviour the toolbar click had before this popup existed. */
function openKimtosRow(): HTMLElement {
  const row = el('button', 'popup-row popup-primary');
  row.type = 'button';
  row.setAttribute('role', 'menuitem');
  const mark = el('span', 'popup-mark');
  mark.innerHTML = brandMarkSvg(20);
  row.append(mark, el('span', 'popup-row-label', 'Open KimtOS'));
  row.addEventListener('click', () => {
    void chrome.tabs.create({}).then(() => window.close());
  });
  return row;
}

/** The one row that appears when actions are hidden purely for want of site access. Requesting
 *  the permission needs a live user gesture, which a click in here is. */
function grantRow(onGranted: () => void): HTMLElement {
  const box = el('div', 'popup-notice');
  box.append(el('p', 'popup-notice-text', 'Page actions need access to the current site.'));
  const button = el('button', 'popup-row popup-grant');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  button.append(el('span', 'popup-row-label', 'Allow KimtOS on websites'));
  button.addEventListener('click', () => {
    void requestAllSites().then((granted) => {
      if (granted) onGranted();
    });
  });
  box.append(button);
  return box;
}

/** The quiet line for a page nothing can ever run on. */
function restrictedNote(): HTMLElement {
  return el('p', 'popup-note', 'This browser page cannot host page actions.');
}

/** Nothing to offer, and nothing to fix — say so rather than showing an empty box. */
function emptyNote(): HTMLElement {
  return el('p', 'popup-note', 'No page actions for this page yet.');
}

/**
 * Arrow-key navigation. This is a menu, so Tab alone is not enough: Up/Down move between rows,
 * Home/End jump to the ends, and Escape closes. Enter/Space already activate a <button>.
 */
function bindMenuKeys(root: HTMLElement): void {
  root.addEventListener('keydown', (event) => {
    const items = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number): void => {
      event.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') focus(at + 1);
    else if (event.key === 'ArrowUp') focus(at < 0 ? items.length - 1 : at - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(items.length - 1);
    else if (event.key === 'Escape') window.close();
  });
}

/** Run an action through the service worker — the same path the keyboard shortcut takes. */
async function runAction(action: PageAction, tabId: number | undefined, onFail: (message: string) => void) {
  if (tabId == null) {
    onFail('KimtOS could not reach this tab.');
    return;
  }
  try {
    const reply = (await chrome.runtime.sendMessage({
      type: PAGE_ACTION_RUN,
      command: action.id,
      tabId,
    })) as { ok?: boolean } | undefined;
    if (reply?.ok) window.close();
    else onFail(`KimtOS could not run “${action.label}” on this page.`);
  } catch {
    onFail(`KimtOS could not run “${action.label}” on this page.`);
  }
}

interface PaintOptions {
  model: PopupModel;
  keys: Map<string, string>;
  tab: ActiveTab;
  /** Re-gather and re-render (after a permission grant or an install change). */
  repaint: () => void;
  /** Move focus to the first row. Only on the first paint — a later repaint must not yank
   *  focus out from under someone already arrowing down the menu. */
  focusFirst: boolean;
}

/** Build the popup's contents from the model. Kept separate from the data gathering so a
 *  repaint is one call. */
function paint(root: HTMLElement, { model, keys, tab, repaint, focusFirst }: PaintOptions): void {
  root.replaceChildren();

  const menu = el('div', 'popup-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'KimtOS');
  menu.append(openKimtosRow());

  // One error line, reused: a second failure replaces the first rather than stacking.
  const error = el('p', 'popup-error');
  error.setAttribute('role', 'status');
  error.hidden = true;
  const fail = (message: string): void => {
    error.textContent = message;
    error.hidden = false;
  };

  for (const appId of appsOf(model.actions)) {
    menu.append(groupHeader(appId));
    for (const action of model.actions.filter((a) => a.appId === appId)) {
      menu.append(actionRow(action, keys.get(action.id) ?? '', (a) => void runAction(a, tab.id, fail)));
    }
  }

  root.append(menu);

  if (model.notice === 'restricted') root.append(restrictedNote());
  else if (model.notice === 'grant-host') root.append(grantRow(repaint));
  else if (!model.actions.length) root.append(emptyNote());
  root.append(error);

  if (focusFirst) root.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
}

async function main(): Promise<void> {
  await store.init(); // hydrate settings from chrome.storage first (theme lives there)

  // Follow the user's Light/Dark choice, exactly as the new tab and the side panel do — and, like
  // them, keep following it (#1174). This popup is dismissed on blur, so the subscription is very
  // nearly dead code here; it is the same call anyway because making one of the three surfaces
  // special is precisely how these lines drifted apart before.
  followTheme();

  const root = document.getElementById('popup');
  if (!root) return;
  bindMenuKeys(root);

  let painted = false;
  const repaint = async (): Promise<void> => {
    const [tab, keys, installed, allSites] = await Promise.all([
      activeTab(),
      shortcuts(),
      readInstalledState(),
      hasAllSites(),
    ]);
    const model = pageActionsFor({
      // No chrome.storage at all (vite dev) means there is no installed set to read; an empty
      // state is the conservative answer — rows stay hidden rather than being offered.
      installed: installed ?? {},
      pageKind: pageKindOf(tab.url),
      secure: isSecurePage(tab.url),
      hasAllSites: allSites,
    });
    paint(root, { model, keys, tab, repaint: () => void repaint(), focusFirst: !painted });
    painted = true;
  };

  await repaint();

  // The installed set can change while this popup is open — an install or uninstall in another
  // window lands in the `kimtos` storage blob. A popup that read the answer once would offer a
  // row for an app that was just removed.
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORE_NS in changes) void repaint();
  });
  // Granting or revoking site access from anywhere (including our own row) changes which rows
  // can run.
  chrome.permissions?.onAdded.addListener(() => void repaint());
  chrome.permissions?.onRemoved.addListener(() => void repaint());
}

void main();
