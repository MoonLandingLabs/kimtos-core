// The page actions the toolbar popup offers — ONE declarative list, and the pure rule that
// decides which of them are worth showing right now (#1110).
//
// Clicking the toolbar icon used to open a new tab and nothing else. That is the one moment the
// user is looking at a PAGE and reaching for KimtOS, and the actions that belong to that moment
// already shipped — they were only reachable through keyboard shortcuts nobody finds. So this is
// a discoverability surface, not a new engine: every entry names a `command` that the service
// worker ALREADY dispatches (see background/pageCommands.ts), and the popup invokes it through
// the very same function the keyboard shortcut does.
//
// ADDING AN ACTION FOR A NEW APP: add one entry to PAGE_ACTIONS below. Nothing in the popup
// needs to change — the gating, the grouping, the glyph, the shortcut hint and the keyboard
// handling are all derived. Do NOT add an entry whose command the worker cannot dispatch; the
// point of keying on the command is that a row and its handler cannot drift apart.
//
// Deliberately free of DOM and `chrome` imports so it stays pure and testable: the popup passes
// the context in, and gets back exactly what to render.

import { isAppInstalled, type InstalledState } from './installedApps.js';
import { FAKEFORM_ACTIONS, FAKEFORM_APP_ID } from './fakeformShared.js';

/** Clipboard's id — the folder name under apps/ and the key in the installed set. */
export const CLIPBOARD_APP_ID = 'clipboard';

/** The `commands` key that opens Clipboard's in-page history picker. */
export const CLIPBOARD_PICKER_COMMAND = 'open-clipboard-picker';

/** The popup asks the service worker to run a page action. The worker holds the handlers and
 *  the tab is not the sender, so the message carries the tab id explicitly. */
export const PAGE_ACTION_RUN = 'page-action:run';

/** The shape of that message — stated once, so both ends agree. */
export interface PageActionRunMessage {
  type: typeof PAGE_ACTION_RUN;
  /** The manifest `commands` key to dispatch. */
  command: string;
  /** The tab to act on. */
  tabId: number;
}

/**
 * What a page action needs from the browser before it can touch the page.
 *
 * - `inject` — the worker puts the code into the tab on demand with `chrome.scripting`.
 *   `activeTab` covers that on whatever page the user invoked us from, so these run without the
 *   broad all-sites grant.
 * - `content-script` — needs a script that is REGISTERED ahead of time
 *   (background/contentScripts.ts), which needs the optional all-sites host grant. Without it
 *   `desiredContentScripts()` returns empty and there is nothing in the page to talk to, so
 *   offering the row would be offering a button that does nothing.
 */
export type PageActionAccess = 'inject' | 'content-script';

/** What kind of page the user is on. */
export type PageKind =
  /** An ordinary http/https page — a content script can live here. */
  | 'web'
  /** chrome://, the Web Store, an extension page, a view-source: — no script can ever run. */
  | 'restricted';

/** Everything the filter needs to know. Supplied by the popup; pure data. */
export interface PageActionContext {
  /** The installed set, read from the `kimtos` storage blob. */
  installed: InstalledState;
  /** What the current tab is. */
  pageKind: PageKind;
  /** Is the page `https:`? The optional host grant covers https only, so a registered content
   *  script can never reach an `http:` page however the permission is answered. */
  secure: boolean;
  /** Do we hold the optional all-sites host permission right now? */
  hasAllSites: boolean;
}

/** One row in the popup. */
export interface PageAction {
  /** Stable id — also the manifest `commands` key, so the row, its handler and the shortcut
   *  hint are the same fact stated once. */
  id: string;
  /** The app that owns it: decides the gate, the glyph and the grouping. */
  appId: string;
  /** The user-facing label. */
  label: string;
  /** What it needs from the browser (see PageActionAccess). */
  access: PageActionAccess;
  /** Anything beyond the standard gates. Optional — most actions need none. */
  when?: (ctx: PageActionContext) => boolean;
}

/**
 * Every page action, in the order they are offered.
 *
 * FakeForm's four are DERIVED from FAKEFORM_ACTIONS rather than restated: that list already
 * owns the label and the command key for the badge menu, the right-click menu and the keyboard
 * commands, and a fourth copy here is a fourth thing to drift.
 */
export const PAGE_ACTIONS: readonly PageAction[] = [
  ...FAKEFORM_ACTIONS.map((spec): PageAction => ({
    id: spec.command,
    appId: FAKEFORM_APP_ID,
    label: spec.label,
    access: 'inject',
  })),
  {
    id: CLIPBOARD_PICKER_COMMAND,
    appId: CLIPBOARD_APP_ID,
    label: 'Paste from clipboard history',
    access: 'content-script',
  },
];

/**
 * The one thing the popup needs to say beyond the rows themselves.
 *
 * - `restricted` — this page can never host a page action. One quiet line beats five dead rows.
 * - `grant-host` — at least one action was hidden ONLY because the all-sites grant is missing,
 *   and granting it would bring the row back. This is the honest prompt surface the extension
 *   never had: Chrome's own menu says "Can't Read or Change Site's Data" and we said nothing.
 */
export type PopupNotice = 'restricted' | 'grant-host';

/** What the popup should render for a given context. */
export interface PopupModel {
  /** The rows to show, in registry order. Hidden means hidden — never a greyed-out row. */
  actions: PageAction[];
  /** At most one line of explanation, or `null` when the rows speak for themselves. */
  notice: PopupNotice | null;
}

/** Does the browser let a content script — ours or anyone's — run on this URL? Pure. */
export function pageKindOf(url: string | undefined | null): PageKind {
  // No URL at all means we hold no access to this tab and cannot see what it is (Chrome
  // redacts the URL without `tabs` or a host grant, and it never grants `activeTab` on a page
  // it will not let us script). Treating that as restricted is the conservative answer: the
  // popup says one quiet line instead of offering rows that would fail.
  if (!url) return 'restricted';
  if (!/^https?:\/\//i.test(url)) return 'restricted';
  // The Web Store is special-cased by Chrome itself: no extension may script it, on either of
  // the two hosts it is served from.
  const host = hostOf(url);
  if (host === 'chrome.google.com' && /^https:\/\/chrome\.google\.com\/webstore\b/i.test(url)) return 'restricted';
  if (host === 'chromewebstore.google.com') return 'restricted';
  return 'web';
}

/** The hostname of a URL, lowercased, or `''` when it will not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Is this page `https:`? (The optional host grant only covers https.) */
export function isSecurePage(url: string | undefined | null): boolean {
  return Boolean(url) && /^https:\/\//i.test(String(url));
}

/** Can this action reach the page, given what we hold? Pure; the second half of the gate. */
function hasAccess(action: PageAction, ctx: PageActionContext): boolean {
  // `inject` rides on `activeTab`, which Chrome grants for the tab the user invoked us from —
  // including by opening this popup — so it needs nothing else.
  if (action.access === 'inject') return true;
  return ctx.hasAllSites && ctx.secure;
}

/**
 * THE filter. Given (installed apps, page kind, host-permission state), exactly
 * the actions to show — and the one thing to say about the ones that are missing.
 *
 * The rules, in order:
 *
 * 1. A restricted page hosts nothing. Say so once, offer nothing.
 * 2. An action appears only if its app is INSTALLED (`isAppInstalled` — the shared rule, so an
 *    app the user has not added is absent rather than greyed out; this is a tool, not a
 *    storefront).
 * 3. …and only if it can actually reach the page.
 * 4. If something was dropped by 3 alone AND granting the permission would fix it, say so.
 *
 * An `http:` page drops its content-script actions silently: the optional host grant covers
 * https only, so asking the user to grant it would not bring the row back, and a prompt that
 * cannot help is worse than no prompt.
 *
 * `registry` defaults to PAGE_ACTIONS and exists so a test can drive the rule with actions of
 * its own (a `when` predicate, an access mode) without the shipped list having to grow one.
 */
export function pageActionsFor(ctx: PageActionContext, registry: readonly PageAction[] = PAGE_ACTIONS): PopupModel {
  if (ctx.pageKind === 'restricted') return { actions: [], notice: 'restricted' };

  const installed = registry.filter((a) => isAppInstalled(a.appId, ctx.installed) && (a.when?.(ctx) ?? true));
  const actions = installed.filter((a) => hasAccess(a, ctx));
  const blockedByGrant = installed.length > actions.length && ctx.secure && !ctx.hasAllSites;

  return { actions, notice: blockedByGrant ? 'grant-host' : null };
}

/** The apps that own the given actions, in first-appearance order — the popup groups by app. */
export function appsOf(actions: readonly PageAction[]): string[] {
  return [...new Set(actions.map((a) => a.appId))];
}
