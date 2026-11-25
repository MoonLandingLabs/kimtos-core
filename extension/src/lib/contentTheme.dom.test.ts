// Resolving the theme for a surface drawn onto somebody else's page.
//
// The rule is `lib/theme.ts`'s: an explicit Light/Dark pick wins, and 'system' — the default —
// falls back to the OS. The route is different (a content script cannot use `models/store.ts`;
// it reads the `kimtos` chrome.storage blob directly), so the rule has to be re-asserted here
// rather than inherited.
//
// The live half is the part that actually shipped broken elsewhere: the user picks Appearance on
// the NEW TAB, and an in-page surface may have been sitting on a page for days by then, so a
// value read once at injection is wrong for as long as the tab stays open (#1173, and #1174 for
// the same bug on our own surfaces).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';
import { watchContentTheme, themeShadowHost, THEME_ATTR, __resetContentTheme } from './contentTheme.js';

/**
 * A `kimtos` storage blob with the Appearance setting in the workspace partition it lives in.
 *
 * When an account is given, `local` is left on 'system' deliberately: a test that passes only
 * because the setting was ALSO written to the device-wide partition would prove nothing about
 * reading the adopted workspace's own.
 */
const blob = (theme?: string, account: { id: string } | null = null) => ({
  ...(account ? { workspaceId: account.id } : {}),
  workspaces: account ? { local: { theme: 'system' }, [account.id]: { theme } } : { local: { theme } },
});

/** Pin the OS preference happy-dom reports, so 'system' is decidable in a test. */
function setOsDark(env: DomEnv, dark: boolean): void {
  Object.defineProperty(env.window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => ({
      matches: dark && q.includes('dark'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: env.window.matchMedia,
  });
}

describe('content-script theme', () => {
  let env: DomEnv;
  let fake: FakeChrome | null = null;

  beforeEach(() => {
    env = installDom();
    __resetContentTheme();
  });
  afterEach(() => {
    __resetContentTheme();
    fake?.cleanup();
    fake = null;
    env.cleanup();
  });

  test('System follows the OS', async () => {
    setOsDark(env, true);
    fake = installChrome({ kimtos: blob('system') });
    __resetContentTheme();
    const seen: string[] = [];
    watchContentTheme((t) => seen.push(t));
    await settle(5);
    assert.equal(seen.at(-1), 'dark');
  });

  test('System follows the OS the other way too', async () => {
    setOsDark(env, false);
    fake = installChrome({ kimtos: blob('system') });
    __resetContentTheme();
    const seen: string[] = [];
    watchContentTheme((t) => seen.push(t));
    await settle(5);
    assert.equal(seen.at(-1), 'light');
  });

  test('an explicit Light pick beats a dark OS', async () => {
    setOsDark(env, true);
    fake = installChrome({ kimtos: blob('light') });
    __resetContentTheme();
    const seen: string[] = [];
    watchContentTheme((t) => seen.push(t));
    await settle(5);
    assert.equal(seen.at(-1), 'light', 'this is the whole bug: Appearance must beat the OS');
  });

  test('an explicit Dark pick beats a light OS', async () => {
    setOsDark(env, false);
    fake = installChrome({ kimtos: blob('dark') });
    __resetContentTheme();
    const seen: string[] = [];
    watchContentTheme((t) => seen.push(t));
    await settle(5);
    assert.equal(seen.at(-1), 'dark');
  });

  test("a profile adopted from an old account reads that workspace's setting, not `local`'s", async () => {
    setOsDark(env, true);
    // The `local` workspace says system (so: dark); the adopted old-account workspace says light.
    fake = installChrome({ kimtos: blob('light', { id: 'user-7' }) });
    __resetContentTheme();
    const seen: string[] = [];
    watchContentTheme((t) => seen.push(t));
    await settle(5);
    assert.equal(seen.at(-1), 'light', 'settings are per-workspace (#472)');
  });

  test('a change to the setting reaches an already-open surface', async () => {
    setOsDark(env, true);
    fake = installChrome({ kimtos: blob('system') });
    __resetContentTheme();
    const host = env.document.createElement('div') as unknown as HTMLElement;
    themeShadowHost(host);
    await settle(5);
    assert.equal(host.getAttribute(THEME_ATTR), 'dark');

    fake.set('kimtos', blob('light'));
    await settle(5);
    assert.equal(host.getAttribute(THEME_ATTR), 'light', 'no reload: the surface repaints in place');
  });

  test('unsubscribing stops the repaints', async () => {
    setOsDark(env, true);
    fake = installChrome({ kimtos: blob('system') });
    __resetContentTheme();
    const host = env.document.createElement('div') as unknown as HTMLElement;
    const untheme = themeShadowHost(host);
    await settle(5);
    untheme();
    fake.set('kimtos', blob('light'));
    await settle(5);
    assert.equal(host.getAttribute(THEME_ATTR), 'dark', 'a torn-down surface must not be written to');
  });

  test('the listener fires immediately, before storage has answered', () => {
    setOsDark(env, false);
    fake = installChrome({ kimtos: blob('dark') });
    __resetContentTheme();
    const seen: string[] = [];
    watchContentTheme((t) => seen.push(t));
    // Synchronous first call: the surface paints on the OS preference rather than unstyled,
    // then corrects itself when the stored pick lands.
    assert.deepEqual(seen, ['light']);
  });

  test('no chrome.storage at all is not an error', async () => {
    setOsDark(env, true);
    __resetContentTheme();
    const seen: string[] = [];
    watchContentTheme((t) => seen.push(t));
    await settle(5);
    assert.deepEqual(seen, ['dark'], 'under `vite dev` the OS preference simply stands');
  });
});
