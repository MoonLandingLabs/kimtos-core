// The Clipboard side panel, booted in a real DOM.
//
// This is the surface #1174 was filed about, and the one that costs something: a side panel is
// pinned beside a tab and stays open for days, so state it reads once at startup is state it is
// still wearing long afterwards. It applied the palette in `main()` and never again, so changing
// Appearance on the new tab left the panel on the palette it booted with until the user closed
// and reopened it.
//
// The panel already had this bug once, for a different piece of state — the installed set (#324),
// recorded in the comment above `paint()`. So the panel gets a test for BOTH: the palette
// follows the setting, and the contents follow the installed set.
//
// The module runs `main()` at import time — that is the whole surface — so each case imports it
// under a fresh URL query to boot it again.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type DomEnv } from './test/domEnv.js';

const CLIPBOARD = 'clipboard';

/** A stored blob for one user, with Clipboard installed or not, and a theme. */
const blobFor = (installed: boolean, theme: string): Record<string, unknown> => ({
  workspaceId: 'u1',
  installedAppsByUser: { u1: installed ? [CLIPBOARD] : [] },
  workspaces: { u1: { theme } },
});

interface Harness {
  /** Fire a chrome.storage change, as a write on any other surface does. */
  change: (blob: Record<string, unknown>) => void;
  cleanup: () => void;
}

function installChromeFor(initial: Record<string, unknown>): Harness {
  const data: Record<string, unknown> = { kimtos: initial };
  const handlers: ((changes: Record<string, unknown>, area: string) => void)[] = [];

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
    runtime: { sendMessage: () => Promise.resolve({}) },
  };

  return {
    change: (blob) => {
      data.kimtos = blob;
      for (const h of [...handlers]) h({ kimtos: { newValue: blob } }, 'local');
    },
    cleanup: () => {
      delete (globalThis as Record<string, unknown>).chrome;
    },
  };
}

let booted = 0;
let env: DomEnv | null = null;
let chromeHarness: Harness | null = null;

/**
 * Boot the panel against a fresh DOM and a fake browser.
 *
 * The tests below use a profile WITHOUT Clipboard on purpose: the panel then renders the
 * not-installed notice and the test never has to start the whole app (its IndexedDB, its listeners) to assert
 * something about the page's palette.
 */
async function boot(blob: Record<string, unknown>): Promise<Harness> {
  env = installDom('<!doctype html><html><body><div id="clip-panel"></div></body></html>');
  chromeHarness = installChromeFor(blob);
  await import(`./sidepanel.js?case=${(booted += 1)}`);
  await settle(10);
  return chromeHarness;
}

afterEach(() => {
  chromeHarness?.cleanup();
  env?.cleanup();
  chromeHarness = null;
  env = null;
});

const theme = (): string | null => env!.document.documentElement.getAttribute('data-theme');
const panelText = (): string => env!.document.getElementById('clip-panel')?.textContent ?? '';

describe('the Clipboard side panel', () => {
  test('the palette follows an Appearance change made on another surface (#1174)', async () => {
    const chrome = await boot(blobFor(false, 'dark'));
    assert.equal(theme(), 'dark', 'boots on the stored palette');

    // The user picks Light in Settings, on the new tab. That write reaches this context through
    // chrome.storage.onChanged; before #1174 nothing re-applied the attribute here, and a panel
    // the user leaves up for days stayed dark.
    chrome.change(blobFor(false, 'light'));
    await settle(10);
    assert.equal(theme(), 'light', 'the panel must retint without being closed and reopened');

    // 'system' means NO attribute, so base.css's @media (prefers-color-scheme) decides.
    chrome.change(blobFor(false, 'system'));
    await settle(10);
    assert.equal(theme(), null, 'System hands the choice back to the OS');
  });

  test('a setting that is not the theme does not disturb the palette', async () => {
    // followTheme() memoizes the last theme, because store.subscribe carries no diff. Without
    // that, every settings write would re-run the caller's extra work — on the new tab, that is
    // re-picking the wallpaper on a blur nudge.
    const chrome = await boot(blobFor(false, 'dark'));
    chrome.change({ ...blobFor(false, 'dark'), workspaces: { u1: { theme: 'dark', bgBlur: 12 } } });
    await settle(10);
    assert.equal(theme(), 'dark');
  });

  test('an app that is not installed shows the notice, not the app (#324)', async () => {
    await boot(blobFor(false, 'dark'));
    assert.match(panelText(), /isn.t installed/i, 'an uninstalled app gets the notice');
  });
});
