// Kimtos background service worker — added for the Clipboard app (the extension
// had none before). Content scripts can't reach the extension's IndexedDB, so
// this always-available context receives captured copies and persists them via
// the shared dataStore, serves the history to the in-page picker, and owns the
// context-menu items + the paste-history hotkey.
//
// MV3 event-driven: the SW may suspend between events; every listener re-wakes it,
// so we do all work inside listeners and keep no long-lived in-memory state.

/* global chrome */
import { addClip, addImageClip, listClips } from '../lib/clipboardStore.js';
import { handleMenuClick } from './menuClick.js';
import { runFakeForm, type FakeFormDeps } from './fakeform.js';
import { reconcileContentScripts } from './contentScripts.js';
import { registerPresence } from './presence.js';
import {
  MAX_CLIP_LEN,
  bumpChanged,
  clipboardActive,
  getCaptureState,
  hostOf,
  imageBlobKey,
  type ClipSource,
} from '../lib/clipboardShared.js';
import { dataStore } from '../lib/dataStore.js';
import { STORE_NS, appInstalled, workspaceIdOf } from '../lib/installedApps.js';
import { syncAllTabs, syncPopupFor } from './toolbarClick.js';
import {
  FAKEFORM_ACTIONS,
  FAKEFORM_APP_ID,
  FAKEFORM_RUN,
  actionForMenuId,
  isFakeFormAction,
} from '../lib/fakeformShared.js';
import { PAGE_ACTION_RUN } from '../lib/pageActions.js';
import { runPageCommand, type PageCommandDeps } from './pageCommands.js';
import { loadSpeller, type SpellIssue } from '../lib/spellcheck.js';

/** Grammit's id — the folder name under apps/ and the key in the installed set. */
const GRAMMIT_APP_ID = 'grammit';

interface Incoming {
  type?: string;
  text?: string;
  url?: string;
  title?: string;
  n?: number;
  id?: string;
  dataUrl?: string;
  mime?: string;
  action?: unknown;
  command?: unknown;
  tabId?: unknown;
}

// This service worker does not load the settings store, so it pins the active data workspace
// (#406) straight from the `kimtos` storage blob before any clip read/write — otherwise clips
// would land in the wrong partition. Awaited at the top of every clip handler so a cold-started
// worker never races it.
async function syncWorkspace(): Promise<void> {
  try {
    const data = await chrome.storage.local.get(STORE_NS);
    const workspace = workspaceIdOf(data[STORE_NS]);
    dataStore.setWorkspace(workspace);
    // Run the one-time pre-workspace migration here too (idempotent, flag-guarded). The new
    // tab normally does this, but a clip saved/read via the worker BEFORE any tab opens after
    // an extension update would otherwise miss un-migrated history. The target is pinned on first run,
    // so migrating from here can't diverge from the tab's target (#406).
    await dataStore.migrateToWorkspaces(workspace);
  } catch {
    // No chrome.storage (should not happen in a worker) — leave the workspace as-is.
  }
}

// A capture from a page — honour monitor/pause/exclusions before storing.
// Resolves to whether the clip was stored (so the page can show a confirmation).
async function captureFromPage(msg: Incoming, sender: chrome.runtime.MessageSender): Promise<boolean> {
  await syncWorkspace();
  const text = String(msg.text ?? '');
  if (!text.trim() || text.length > MAX_CLIP_LEN) return false;
  if (!(await clipboardActive())) return false; // only when installed
  const state = await getCaptureState();
  if (!state.monitorEnabled) return false;
  if (state.pausedUntil && Date.now() < state.pausedUntil) return false;
  const host = hostOf(msg.url);
  if (host && state.excludedSites.some((p) => p && host.includes(p))) return false;
  const source: ClipSource = {
    url: msg.url || sender.tab?.url || '',
    title: msg.title || sender.tab?.title || '',
    favicon: sender.tab?.favIconUrl,
  };
  await addClip({ text, source });
  bumpChanged();
  return true;
}

// An image capture (opt-in via the captureImages setting).
async function captureImageFromPage(msg: Incoming, sender: chrome.runtime.MessageSender): Promise<boolean> {
  await syncWorkspace();
  const dataUrl = String(msg.dataUrl ?? '');
  if (!dataUrl.startsWith('data:image/')) return false;
  if (!(await clipboardActive())) return false;
  const state = await getCaptureState();
  if (!state.monitorEnabled || !state.captureImages) return false;
  if (state.pausedUntil && Date.now() < state.pausedUntil) return false;
  const host = hostOf(msg.url);
  if (host && state.excludedSites.some((p) => p && host.includes(p))) return false;
  const source: ClipSource = {
    url: msg.url || sender.tab?.url || '',
    title: msg.title || sender.tab?.title || '',
    favicon: sender.tab?.favIconUrl,
  };
  await addImageClip({ dataUrl, mime: String(msg.mime || 'image/png'), source });
  bumpChanged();
  return true;
}

// The in-page picker asks for the history (it can't read the extension DB).
async function historyForPicker(): Promise<Array<{ id: string; text: string; preview: string; type: string }>> {
  await syncWorkspace();
  if (!(await clipboardActive())) return [];
  const clips = await listClips();
  return clips.slice(0, 200).map((c) => ({ id: c.id, text: c.text, preview: c.preview, type: c.type }));
}

// The Nth most-recent clip's text (for the Alt+Shift+1/2/3 quick-paste).
async function nthClipText(n: number): Promise<string> {
  await syncWorkspace();
  if (!Number.isInteger(n) || n < 1 || !(await clipboardActive())) return '';
  const clips = await listClips();
  return clips[n - 1]?.text ?? '';
}

// One image clip's bytes, as a data URL the content script can turn back into a Blob.
async function imageClipData(id: string): Promise<{ dataUrl: string; mime: string } | null> {
  await syncWorkspace();
  if (!id || !(await clipboardActive())) return null;
  const blob = await dataStore.getBlob(imageBlobKey(id));
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (const byte of buf) bin += String.fromCharCode(byte);
  const mime = blob.type || 'image/png';
  return { dataUrl: `data:${mime};base64,${btoa(bin)}`, mime };
}

// Spell-check for Grammit's in-page checker (content/writer.ts). The dictionary is
// 60k words — far too large to bundle into a content script, which is a single IIFE
// injected into every page (importing it there inflated writer.js from 24 kB to
// 543 kB). So the worker owns it: it loads the packaged word list once and answers
// for EVERY tab, instead of each tab building its own index.
//
// The SW keeps no long-lived state by design, so the index is per-activation — a wake
// re-reads the list (a local, packaged file) on the first request and memoizes it while
// the worker lives, which is the whole typing session.
async function spellForPage(text: string): Promise<SpellIssue[]> {
  if (!text.trim()) return [];
  // Refuse independently of the content script's own gate — the worker must not spell-check
  // when Grammit is not installed.
  if (!(await appInstalled(GRAMMIT_APP_ID))) return [];
  const speller = await loadSpeller();
  return speller(text);
}

// --- FakeForm (#222) --------------------------------------------------------
//
// The in-page badge carries no filler code at all, so every action arrives here: the badge
// messages the worker, and so do the keyboard commands and the right-click items. The worker
// checks the app is installed, then injects the filler bundle into the tab on demand — which is what
// keeps the dataset and the generators off every page the user never fills.
const fakeformDeps: FakeFormDeps = {
  isActive: () => appInstalled(FAKEFORM_APP_ID),
  inject: (tabId, file) => chrome.scripting.executeScript({ target: { tabId }, files: [file] }),
  send: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  onError: (message, error) => console.warn(`[kimtos] ${message}`, error),
};

// Everything a page action needs, in one place. The keyboard shortcuts and the toolbar popup
// both dispatch through `runPageCommand` with THESE deps, so the two surfaces cannot end up
// running the same action through different gates (#1110).
const pageCommandDeps: PageCommandDeps = {
  fakeform: fakeformDeps,
  clipboardActive,
  openPicker: (tabId) => openPickerInTab(tabId),
};

chrome.runtime.onMessage.addListener((msg: Incoming, sender, sendResponse) => {
  if (msg?.type === 'grammit:spell') {
    spellForPage(msg.text ?? '')
      .then((issues) => sendResponse({ ok: true, issues }))
      .catch((e) => sendResponse({ ok: false, issues: [], error: String(e) }));
    return true; // async response
  }
  if (msg?.type === PAGE_ACTION_RUN) {
    // The toolbar popup asked for a page action. It is not a tab, so it names the tab; the
    // command it names is dispatched by exactly the function the keyboard shortcut uses.
    void runPageCommand(
      String(msg.command ?? ''),
      typeof msg.tabId === 'number' ? msg.tabId : undefined,
      pageCommandDeps,
    ).then((ran) => sendResponse({ ok: ran }));
    return true; // async response
  }
  if (msg?.type === FAKEFORM_RUN) {
    // The badge asked for a fill. It cannot do it itself — by design, it holds no filler code.
    void runFakeForm(sender.tab?.id, isFakeFormAction(msg.action) ? msg.action : 'form', fakeformDeps).then((ran) =>
      sendResponse({ ok: ran }),
    );
    return true; // async response
  }
  if (msg?.type === 'clip:add') {
    captureFromPage(msg, sender)
      .then((stored) => sendResponse({ ok: true, stored }))
      .catch((e) => sendResponse({ ok: false, stored: false, error: String(e) }));
    return true; // async response
  }
  if (msg?.type === 'clip:add-image') {
    captureImageFromPage(msg, sender)
      .then((stored) => sendResponse({ ok: true, stored }))
      .catch((e) => sendResponse({ ok: false, stored: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'clip:list') {
    historyForPicker()
      .then((clips) => sendResponse({ clips }))
      .catch(() => sendResponse({ clips: [] }));
    return true;
  }
  if (msg?.type === 'clip:nth') {
    nthClipText(Number(msg.n))
      .then((text) => sendResponse({ text }))
      .catch(() => sendResponse({ text: '' }));
    return true;
  }
  // An image clip's content is a BLOB, and a content script cannot reach it — its `indexedDB` is
  // the visited page's origin, not ours. So the picker asks for the bytes, and puts them on the
  // system clipboard itself (it has the user gesture; the service worker does not).
  if (msg?.type === 'clip:image') {
    imageClipData(String(msg.id))
      .then((image) => sendResponse(image ?? { dataUrl: '' }))
      .catch(() => sendResponse({ dataUrl: '' }));
    return true;
  }
  return undefined;
});

// Ask the active tab's content script to open the in-page history picker.
function openPickerInTab(tabId: number | undefined): void {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'clip:open-picker' }).catch(() => {
    // No content script in this tab (e.g. a chrome:// page) — nothing to do.
  });
}

// Global hotkeys (Alt+Shift+V / Alt+Shift+F by default; user-editable at
// chrome://extensions/shortcuts). Every command goes through the same `runPageCommand` the
// toolbar popup uses, so a shortcut and its popup row can never drift apart (#1110).
chrome.commands.onCommand.addListener((command, tab) => {
  void runPageCommand(command, tab?.id, pageCommandDeps);
});

function installClipboardMenus(): void {
  {
    // Explicit "Save selection" — deliberate, so it bypasses monitor/exclusions.
    chrome.contextMenus.create({
      id: 'clip-save-selection',
      title: 'Save selection to Clipboard History',
      contexts: ['selection'],
    });
    // Open the in-page picker to paste a past clip — discoverable without the hotkey.
    chrome.contextMenus.create({
      id: 'clip-open-picker',
      title: 'Paste from Kimtos Clipboard…',
      contexts: ['editable', 'page'],
    });
    // Open the side panel (persistent history beside the tab).
    chrome.contextMenus.create({
      id: 'clip-open-panel',
      title: 'Open Kimtos Clipboard panel',
      contexts: ['page', 'editable'],
    });
  }
}

/** FakeForm's four actions, under one parent so they do not crowd the page's context menu. */
function installFakeFormMenus(): void {
  chrome.contextMenus.create({ id: 'fakeform-root', title: 'FakeForm', contexts: ['editable', 'page'] });
  for (const spec of FAKEFORM_ACTIONS) {
    chrome.contextMenus.create({
      id: spec.menuId,
      parentId: 'fakeform-root',
      title: spec.label,
      contexts: ['editable', 'page'],
    });
  }
}

// Clipboard's menu items must not exist for a user who hasn't installed it — otherwise
// "Kimtos Clipboard" sits in the right-click menu of every website they visit. Chrome keeps
// created menus until we remove them, so the set is re-synced on every store change rather than
// only at install time.
async function syncMenus(): Promise<void> {
  // Resolve BOTH gates first, then rebuild the whole set in one removeAll callback. removeAll
  // first so a reload (which re-fires onInstalled) can't hit a "duplicate id" error that would
  // abort before the rest of the items are created.
  const [clipboard, fakeform] = await Promise.all([clipboardActive(), appInstalled(FAKEFORM_APP_ID)]);
  chrome.contextMenus.removeAll(() => {
    if (clipboard) installClipboardMenus();
    if (fakeform) installFakeFormMenus();
  });
}

chrome.runtime.onInstalled.addListener(() => void syncMenus());
chrome.runtime.onStartup.addListener(() => void syncMenus());
// Per-tab popup state does not survive an install or a browser restart, and the manifest's
// popup is the default until we say otherwise — so establish it for the tabs already open (#1186).
chrome.runtime.onInstalled.addListener(() => void syncAllTabs());
chrome.runtime.onStartup.addListener(() => void syncAllTabs());

// Single-instance arbitration (#1172). Registered at module scope, not on an install/startup
// event: its listeners must be in place the moment the worker wakes for a page's claim, and a
// claim is itself one of the things that wakes it.
registerPresence();

// Register the Grammit/Clipboard content scripts at runtime (#637) instead of declaring them for
// every site. Reconcile on install AND update (existing users keep the now-optional all-sites
// grant, so their scripts re-register — no feature loss, no re-prompt) and on startup.
chrome.runtime.onInstalled.addListener(() => void reconcileContentScripts());
chrome.runtime.onStartup.addListener(() => void reconcileContentScripts());
// Granting/revoking the all-sites permission (e.g. via chrome://extensions) flips what can be
// registered — reconcile so the scripts appear/disappear immediately.
chrome.permissions?.onAdded.addListener(() => void reconcileContentScripts());
chrome.permissions?.onRemoved.addListener(() => void reconcileContentScripts());

// Install/uninstall lands in the `kimtos` storage blob — so the menus appear
// and disappear immediately, with no restart.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STORE_NS in changes) {
    void syncMenus();
    void syncWorkspace(); // keep the data workspace pinned to the blob's (#406)
    // Installing/uninstalling Grammit or Clipboard changes which content
    // scripts should be registered (#637).
    void reconcileContentScripts();
    // …and it changes whether the toolbar click has a menu worth opening (#1186). Every tab,
    // not just the active one: an install is not per-tab.
    void syncAllTabs();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // FakeForm's items first: they are handled entirely by runFakeForm (which re-checks the gate
  // itself), and they must not fall through to the Clipboard handler.
  const fakeform = actionForMenuId(info.menuItemId);
  if (fakeform) {
    void runFakeForm(tab?.id, fakeform, fakeformDeps);
    return;
  }
  // The body lives in menuClick.ts, and the reason is the side panel: `chrome.sidePanel.open()`
  // must be called SYNCHRONOUSLY, in direct response to this click. The old handler awaited an
  // re-check first, which spent the user gesture, so Chrome rejected the open — and
  // an empty `.catch(() => {})` threw the rejection away. The menu item did nothing and said
  // nothing (#257).
  void handleMenuClick(info, tab, {
    openPanel: (windowId) => chrome.sidePanel.open({ windowId }),
    isActive: clipboardActive,
    openPicker: openPickerInTab,
    saveSelection: async (clip) => {
      await addClip(clip);
      bumpChanged();
    },
    onError: (message, error) => console.warn(`[kimtos] ${message}`, error),
  });
});

// --- the toolbar click ------------------------------------------------------
//
// The manifest declares a toolbar `action` so the pinned icon renders in full colour — without
// one, Chrome desaturates the icon and a click does nothing (#1000) — and it declares a
// `default_popup`, so a click opens the page-actions popup (#1110).
//
// Chrome only fires `onClicked` when the clicked tab has NO popup, and `background/toolbarClick.ts`
// clears the popup per tab on pages where it would be a menu with one item (#1186): a restricted
// page, or any page for a user who has installed none of the apps that register page actions. So this
// listener and that `setPopup` call are two halves of one contract — the listener is dead
// without the clearing, and the clearing strands the click without the listener.
// `manifestAction.test.ts` asserts both halves for exactly that reason.
//
// It does the same `chrome.tabs.create({})` as the popup's primary "Open Kimtos" row, which the
// `chrome_url_overrides.newtab` override makes the Kimtos home.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({});
});

// Keep each tab's click pointed at the right thing as the user moves and navigates. `onUpdated`
// fires several times per load; only a URL change or the final `complete` can change the answer.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs
    .get(tabId)
    .then((tab) => syncPopupFor(tabId, tab.url))
    .catch(() => {}); // the tab closed between the event and the read
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url !== undefined || change.status === 'complete') void syncPopupFor(tabId, tab.url);
});

// Granting the all-sites permission turns "blocked, here is the grant button" into real rows,
// and revoking it does the reverse — in every tab at once, so re-decide for all of them.
chrome.permissions?.onAdded?.addListener(() => void syncAllTabs());
chrome.permissions?.onRemoved?.addListener(() => void syncAllTabs());
