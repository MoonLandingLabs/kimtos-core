// A LIVE install gate, for the contexts that outlive the answer.
//
// `installedApps.ts` answers "is this app installed?" once. That is enough for the new tab, which
// re-renders constantly — and wrong for a CONTENT SCRIPT, which is injected once into a page that
// may stay open for days: a user who uninstalls (or installs) an app would see nothing happen
// until they reloaded the page.
//
// The installed set already lives in `chrome.storage` precisely so the page can read it, and
// `chrome.storage.onChanged` is available to content scripts. So the gate is a subscription
// rather than a snapshot.

import { STORE_NS, appInstalled } from './installedApps.js';

interface ChangeArea {
  addListener(fn: (changes: Record<string, unknown>, area: string) => void): void;
  removeListener(fn: (changes: Record<string, unknown>, area: string) => void): void;
}
interface ChromeLike {
  storage?: { onChanged?: ChangeArea };
}
const onChangedArea = (): ChangeArea | undefined => (globalThis as { chrome?: ChromeLike }).chrome?.storage?.onChanged;

/**
 * Run `fn` whenever any of `keys` changes in `chrome.storage.local`. Returns an unsubscribe.
 *
 * No chrome.storage at all (i.e. `vite dev`) is not an error — there is simply nothing to
 * watch, and the caller's initial value stands.
 */
export function subscribeLocal(keys: string[], fn: () => void): () => void {
  const area = onChangedArea();
  if (!area) return () => {};
  const handler = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local') return;
    if (keys.some((k) => k in changes)) fn();
  };
  area.addListener(handler);
  return () => area.removeListener(handler);
}

/**
 * Watch a boolean gate. `onChange` is called once with the initial answer, and again ONLY when
 * the answer actually changes — a caller can therefore treat it as "switch on" / "switch off"
 * and does not have to guard against being told the same thing repeatedly (which would rebuild
 * a shadow root on every unrelated settings write).
 */
export function watchGate(
  compute: () => Promise<boolean>,
  onChange: (on: boolean) => void,
  keys: string[],
): () => void {
  let last: boolean | undefined;
  const evaluate = (): void => {
    void compute().then((on) => {
      if (on === last) return;
      last = on;
      onChange(on);
    });
  };
  evaluate();
  return subscribeLocal(keys, evaluate);
}

/** The common case: switch on while the app is installed. */
export const watchAppInstalled = (appId: string, onChange: (on: boolean) => void): (() => void) =>
  watchGate(() => appInstalled(appId), onChange, [STORE_NS]);
