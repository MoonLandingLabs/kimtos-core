// A DOM for the tests that need one.
//
// The extension's highest-blast-radius code is its CONTENT SCRIPTS — they run on every page the
// user visits, and when they break they break silently, everywhere. Until now none of it could
// be tested at all: there was no DOM in the test runner, so a shadow root, a listener or an
// injected <style> could only be verified by reading the file (#227). That is not a control —
// Grammit Anywhere's scroll/resize handlers were anonymous arrows, so `removeEventListener`
// could never have detached them, and nothing noticed for months (#223).
//
// happy-dom over jsdom: it boots in ~195 ms against jsdom's ~446 ms, and supports the two
// things this codebase actually needs — `attachShadow`, and the native `value` setter that a
// form filler has to go through for React to notice a write (#222).
//
// KNOWN LIMIT — the CSS Custom Highlight API (`CSS.highlights`, `new Highlight()`) exists in
// NEITHER happy-dom nor jsdom. Grammit Anywhere paints contentEditable underlines with it, and
// that path stays untestable here; `supportsHighlights()` simply reports false, so the code
// takes its textarea branch. Testing the highlight path needs a real browser.

import { Window } from 'happy-dom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

/** The globals a content script reads off `globalThis` the moment it is imported. */
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'CSS',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLDivElement',
  'HTMLButtonElement',
  'ShadowRoot',
  'Range',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'InputEvent',
  'FocusEvent',
  // models/store.ts falls back to localStorage when there is no chrome.storage (i.e. `vite dev`),
  // so anything that reads a setting needs it.
  'localStorage',
  'sessionStorage',
  'getSelection',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const;

export interface DomEnv {
  window: Window;
  document: Document;
  /** Remove every global this installed, so one test's DOM cannot leak into the next. */
  cleanup: () => void;
}

/**
 * Install a fresh DOM onto `globalThis`.
 *
 * Call this BEFORE importing the module under test: a content script attaches its listeners and
 * reads `chrome` at module scope, so by the time an ordinary top-level `import` has run, it is
 * already too late. The pattern is:
 *
 *     const env = installDom();
 *     installChrome({ ... });
 *     const mod = await import('../content/writer.js');   // dynamic, so the DOM exists first
 */
export function installDom(html = '<!doctype html><html><body></body></html>'): DomEnv {
  const win = new Window({ url: 'https://example.test/' });
  win.document.write(html);

  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of DOM_GLOBALS) {
    const value = (win as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    // Node defines some of these itself (`navigator` is a getter with no setter), so a plain
    // assignment throws. Define the property instead of assigning to it.
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      // getSelection / getComputedStyle are methods — they must keep their `this`.
      value: typeof value === 'function' && key.startsWith('get') ? (value as () => unknown).bind(win) : value,
    });
  }

  // happy-dom has no IndexedDB, and the shared dataStore IS IndexedDB — so anything that touches
  // storage (every app, the settings mirror, the whole app controller) threw asynchronously, AFTER
  // the test had ended, as an unhandled rejection. fake-indexeddb is a real implementation, so the
  // store actually works in a test rather than being mocked away.
  for (const [key, value] of [
    ['indexedDB', indexedDB],
    ['IDBKeyRange', IDBKeyRange],
  ] as const) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  // happy-dom has no ResizeObserver, and the shared dialog uses one to keep a window inside the
  // viewport. A no-op is the honest stub: there is no layout in a headless DOM to observe.
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    saved.set('ResizeObserver', undefined);
  }

  return {
    window: win,
    document: win.document as unknown as Document,
    cleanup: () => {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete g[key];
      }
      void win.close();
    },
  };
}

// ── a fake chrome.storage, for the gates a content script reads ────────────────────────────

type Handler = (changes: Record<string, unknown>, area: string) => void;

export interface FakeChrome {
  /** Write a key and fire onChanged, exactly as chrome.storage.local does. */
  set(key: string, value: unknown): void;
  /** Every message the script sent to the service worker. */
  messages: unknown[];
  /** Push a message TO the content script, as the service worker does (e.g. open the picker). */
  send(msg: unknown): void;
  cleanup: () => void;
}

/** What the content script sends the worker. */
export type SwMessage = { type?: string; [k: string]: unknown };

export function installChrome(
  initial: Record<string, unknown> = {},
  // How the fake service worker answers runtime.sendMessage. The default keeps the old
  // behaviour ({ stored: true }); a test that exercises a worker round-trip (e.g. Grammit's
  // spell check, `{ type: 'grammit:spell' }`) passes its own responder.
  respond: (msg: SwMessage) => unknown = () => ({ stored: true }),
): FakeChrome {
  const data: Record<string, unknown> = { ...initial };
  const handlers: Handler[] = [];
  const messages: unknown[] = [];
  const inbox: ((msg: unknown) => void)[] = []; // listeners the content script registered

  // One storage area over a plain object. Both call styles are in use in this codebase:
  // promise-based (installedApps) and callback-based (writer's `enabled()`), so the fake has
  // to honour both.
  const area = (backing: Record<string, unknown>) => ({
    get: (
      keys: string | string[],
      cb?: (v: Record<string, unknown>) => void,
    ): Promise<Record<string, unknown>> | void => {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) out[k] = backing[k];
      if (cb) {
        cb(out);
        return;
      }
      return Promise.resolve(out);
    },
    set: (items: Record<string, unknown>) => {
      Object.assign(backing, items);
      return Promise.resolve();
    },
    remove: (key: string) => {
      delete backing[key];
      return Promise.resolve();
    },
  });

  // `session` is a SEPARATE area with its own backing, exactly like the real one: the app session
  // (#1172) lives there precisely because the browser clears it and never touches `local`. Sharing
  // one object here would let a test pass while the real areas disagreed.
  const sessionData: Record<string, unknown> = {};

  const chrome = {
    storage: {
      local: area(data),
      session: area(sessionData),
      onChanged: {
        addListener: (fn: Handler) => handlers.push(fn),
        removeListener: (fn: Handler) => {
          const i = handlers.indexOf(fn);
          if (i >= 0) handlers.splice(i, 1);
        },
      },
    },
    runtime: {
      lastError: undefined,
      // A responder may return a PROMISE, and the reply then lands asynchronously — which is what
      // the real worker does, and the only way a test can hold a message in flight and act while it
      // is pending. The presence claim is exactly that: the window between "the page asked" and
      // "the page learned its role" is where a page can still be told to do the wrong thing.
      sendMessage: (msg: SwMessage, cb?: (r: unknown) => void) => {
        messages.push(msg);
        const reply = respond(msg) as unknown;
        if (reply && typeof (reply as PromiseLike<unknown>).then === 'function')
          void (reply as PromiseLike<unknown>).then((r) => cb?.(r));
        else cb?.(reply);
      },
      // The service worker pushes messages TO the content script too (the clipboard picker is
      // opened this way, by the Alt+Shift+V command). Without this a content script can only be
      // observed, never driven.
      onMessage: {
        addListener: (fn: (msg: unknown) => void) => inbox.push(fn),
        removeListener: (fn: (msg: unknown) => void) => {
          const i = inbox.indexOf(fn);
          if (i >= 0) inbox.splice(i, 1);
        },
      },
    },
  };

  const g = globalThis as unknown as Record<string, unknown>;
  const had = 'chrome' in g;
  const before = g.chrome;
  g.chrome = chrome;

  return {
    messages,
    send(msg) {
      for (const fn of [...inbox]) fn(msg);
    },
    set(key, value) {
      data[key] = value;
      for (const h of [...handlers]) h({ [key]: { newValue: value } }, 'local');
    },
    cleanup: () => {
      if (had) g.chrome = before;
      else delete g.chrome;
    },
  };
}

/** Let the module under test finish the async reads it kicked off (a gate, a storage get). */
export const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
