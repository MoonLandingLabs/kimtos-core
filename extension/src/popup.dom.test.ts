// The toolbar popup, rendered in a real DOM (#1110).
//
// `lib/pageActions.test.ts` pins the DECISION; this pins what the user actually gets: the rows
// that decision produced, the app grouping, the bound shortcut beside each row, the primary
// "Open KimtOS" that must never regress to a dead button, the quiet line on a chrome:// page,
// the permission row, and arrow-key navigation. Between them there is no untested gap between
// "the rule says show three rows" and "three rows appear and do something".
//
// Each case imports src/popup.ts under a fresh URL query, because the module runs `main()` at
// import time — that is the whole surface, so a test has to be allowed to boot it more than once.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type DomEnv } from './test/domEnv.js';
import { FAKEFORM_ACTIONS, FAKEFORM_APP_ID } from './lib/fakeformShared.js';
import { CLIPBOARD_APP_ID, CLIPBOARD_PICKER_COMMAND, PAGE_ACTION_RUN } from './lib/pageActions.js';

interface FakeOptions {
  /** The `kimtos` storage blob (workspace id + installed set). */
  store?: Record<string, unknown>;
  /** What `chrome.tabs.query` reports for the active tab. */
  tab?: { id?: number; url?: string };
  /** Do we hold the all-sites host permission? */
  allSites?: boolean;
  /** Does a permission request succeed? */
  grantOnRequest?: boolean;
  /** What the service worker answers a PAGE_ACTION_RUN with. */
  runOk?: boolean;
}

interface Harness {
  /** Everything sent to the service worker. */
  messages: { type?: string; command?: string; tabId?: number }[];
  /** Tabs opened via chrome.tabs.create. */
  created: number;
  /** Permission requests made. */
  requested: number;
  /** Fire a chrome.storage change, as an install or uninstall in another window does. */
  change: (blob: Record<string, unknown>) => void;
  cleanup: () => void;
}

const BOTH_INSTALLED = {
  workspaceId: 'u1',
  installedAppsByUser: { u1: [FAKEFORM_APP_ID, CLIPBOARD_APP_ID] },
};

function installChromeFor(options: FakeOptions): Harness {
  const data: Record<string, unknown> = { kimtos: options.store ?? BOTH_INSTALLED };
  const handlers: ((changes: Record<string, unknown>, area: string) => void)[] = [];
  const harness: Harness = {
    messages: [],
    created: 0,
    requested: 0,
    change: (blob) => {
      data.kimtos = blob;
      for (const h of [...handlers]) h({ kimtos: { newValue: blob } }, 'local');
    },
    cleanup: () => {
      delete (globalThis as Record<string, unknown>).chrome;
    },
  };
  let allSites = options.allSites ?? true;

  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) out[k] = data[k];
          return Promise.resolve(out);
        },
        set: (items: Record<string, unknown>) => {
          Object.assign(data, items);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (fn: (c: Record<string, unknown>, a: string) => void) => handlers.push(fn),
        removeListener: () => {},
      },
    },
    tabs: {
      query: () => Promise.resolve([options.tab ?? { id: 4, url: 'https://example.com/signup' }]),
      create: () => {
        harness.created += 1;
        return Promise.resolve({});
      },
    },
    commands: {
      getAll: () =>
        Promise.resolve([
          { name: 'fakeform-fill-form', shortcut: 'Alt+Shift+F' },
          { name: CLIPBOARD_PICKER_COMMAND, shortcut: 'Alt+Shift+V' },
          { name: 'fakeform-fill-input', shortcut: '' },
        ]),
    },
    permissions: {
      contains: () => Promise.resolve(allSites),
      request: () => {
        harness.requested += 1;
        if (options.grantOnRequest) allSites = true;
        return Promise.resolve(Boolean(options.grantOnRequest));
      },
      onAdded: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
    },
    runtime: {
      sendMessage: (msg: { type?: string; command?: string; tabId?: number }) => {
        harness.messages.push(msg);
        return Promise.resolve({ ok: options.runOk ?? true });
      },
    },
  };
  return harness;
}

let booted = 0;
let env: DomEnv | null = null;
let chromeHarness: Harness | null = null;

/** Boot the popup against a fresh DOM + a fake browser, and return what it rendered. */
async function boot(options: FakeOptions = {}): Promise<{ root: HTMLElement; chrome: Harness; closed: () => number }> {
  env = installDom('<!doctype html><html><body><div id="popup"></div></body></html>');
  chromeHarness = installChromeFor(options);
  let closes = 0;
  Object.defineProperty(globalThis.window, 'close', { configurable: true, value: () => (closes += 1) });

  await import(`./popup.js?case=${(booted += 1)}`);
  await settle(5);
  const root = env.document.getElementById('popup') as HTMLElement;
  return { root, chrome: chromeHarness, closed: () => closes };
}

afterEach(() => {
  chromeHarness?.cleanup();
  env?.cleanup();
  chromeHarness = null;
  env = null;
});

const rows = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const labels = (root: HTMLElement): string[] =>
  rows(root).map((r) => r.querySelector('.popup-row-label')?.textContent ?? '');
const text = (root: HTMLElement): string => root.textContent ?? '';

describe('the popup, rendered', () => {
  test('with both apps installed, an ordinary page gets Open KimtOS plus every page action', async () => {
    const { root } = await boot();
    assert.deepEqual(labels(root), [
      'Open KimtOS',
      ...FAKEFORM_ACTIONS.map((a) => a.label),
      'Paste from clipboard history',
    ]);
  });

  test('rows are grouped under the owning app', async () => {
    const { root } = await boot();
    assert.deepEqual(
      [...root.querySelectorAll('.popup-group-name')].map((n) => n.textContent),
      ['FakeForm', 'Clipboard'],
    );
  });

  test('each row teaches the shortcut the user actually has bound', async () => {
    const { root } = await boot();
    const keys = [...root.querySelectorAll('.popup-key')].map((k) => k.textContent);
    assert.deepEqual(keys, ['Alt+Shift+F', 'Alt+Shift+V']);
    // An unbound command shows no key rather than the manifest's suggestion.
    assert.ok(!keys.includes(''));
  });

  test('"Open KimtOS" still opens a tab in one click, and closes the popup', async () => {
    const { root, chrome, closed } = await boot();
    rows(root)[0]?.click();
    await settle(5);
    assert.equal(chrome.created, 1);
    assert.equal(closed(), 1);
  });

  test('clicking an action asks the worker to run that command in this tab', async () => {
    const { root, chrome, closed } = await boot({ tab: { id: 42, url: 'https://example.com/' } });
    rows(root)[1]?.click();
    await settle(5);
    assert.deepEqual(chrome.messages, [{ type: PAGE_ACTION_RUN, command: FAKEFORM_ACTIONS[0].command, tabId: 42 }]);
    assert.equal(closed(), 1);
  });

  test('a run the worker refuses says so instead of closing on a lie', async () => {
    const { root, closed } = await boot({ runOk: false });
    rows(root)[1]?.click();
    await settle(5);
    assert.equal(closed(), 0);
    assert.match(text(root), /could not run/i);
  });

  test('a user with neither app installed is offered no app row at all', async () => {
    const { root } = await boot({
      store: { workspaceId: 'u1', installedAppsByUser: { u1: [] } },
    });
    assert.deepEqual(labels(root), ['Open KimtOS']);
    assert.match(text(root), /No page actions/i);
  });

  test('a chrome:// page gets one quiet line, not dead rows', async () => {
    const { root } = await boot({ tab: { id: 4, url: 'chrome://extensions' } });
    assert.deepEqual(labels(root), ['Open KimtOS']);
    assert.match(text(root), /cannot host page actions/i);
  });

  test('without site access the injectable actions remain, and one row offers to fix it', async () => {
    const { root } = await boot({ allSites: false });
    assert.deepEqual(labels(root), [
      'Open KimtOS',
      ...FAKEFORM_ACTIONS.map((a) => a.label),
      'Allow KimtOS on websites',
    ]);
    assert.match(text(root), /need access to the current site/i);
  });

  test('granting the permission repaints, and the clipboard row appears', async () => {
    const { root, chrome } = await boot({ allSites: false, grantOnRequest: true });
    const grant = rows(root).at(-1);
    assert.equal(grant?.querySelector('.popup-row-label')?.textContent, 'Allow KimtOS on websites');
    grant?.click();
    await settle(5);
    assert.equal(chrome.requested, 1);
    assert.ok(labels(root).includes('Paste from clipboard history'));
  });

  test('an uninstall while the popup is open takes the rows away', async () => {
    const { root, chrome } = await boot();
    assert.ok(labels(root).length > 1);
    chrome.change({ workspaceId: 'u1', installedAppsByUser: { u1: [] } });
    await settle(5);
    assert.deepEqual(labels(root), ['Open KimtOS']);
  });

  test('it is a menu: the first row has focus, and the arrows walk it', async () => {
    const { root } = await boot();
    const items = rows(root);
    assert.equal(env?.document.activeElement, items[0]);
    const press = (key: string): void => {
      root.dispatchEvent(
        new (globalThis as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent('keydown', {
          key,
          bubbles: true,
        }),
      );
    };
    press('ArrowDown');
    assert.equal(env?.document.activeElement, items[1]);
    press('ArrowUp');
    assert.equal(env?.document.activeElement, items[0]);
    press('End');
    assert.equal(env?.document.activeElement, items.at(-1));
    press('Home');
    assert.equal(env?.document.activeElement, items[0]);
  });

  test('the palette follows an Appearance change, it is not read once at boot (#1174)', async () => {
    // The popup is dismissed on blur, so in practice it rarely outlives a theme change — but it
    // shipped the same three copied lines as the side panel, and one surface being quietly
    // different is how they drifted apart. Same call, same guarantee, asserted the same way.
    const themed = (theme: string): Record<string, unknown> => ({ ...BOTH_INSTALLED, workspaces: { u1: { theme } } });
    const { chrome } = await boot({ store: themed('dark') });
    const root = (): Element => env!.document.documentElement;
    assert.equal(root().getAttribute('data-theme'), 'dark', 'boots on the stored palette');

    chrome.change(themed('light'));
    await settle(5);
    assert.equal(root().getAttribute('data-theme'), 'light', 'a change made on another surface reaches this one');

    // 'system' means NO attribute, so base.css's @media decides and the OS drives it.
    chrome.change(themed('system'));
    await settle(5);
    assert.equal(root().hasAttribute('data-theme'), false, 'System hands the choice back to the OS');
  });
});
