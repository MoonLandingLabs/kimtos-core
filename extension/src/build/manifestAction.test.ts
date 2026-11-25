// The regression this guards: the manifest shipped without an `action` key, so Chrome
// rendered the pinned toolbar icon desaturated and a click did nothing (#1000). The
// action must stay declared, and its icon map must stay in step with the extension's
// top-level `icons` — drift in either direction re-grays the toolbar silently.
//
// It now also guards the popup (#1110). `default_popup` is what the toolbar click opens by
// default — so the popup file must exist and must be a build input (an entry Vite is not told
// about is simply not emitted, and Chrome shows an empty popup).
//
// Since #1186 that default is only the default: the worker clears the popup per tab where it
// would be a one-item menu, which routes those clicks to `chrome.action.onClicked`. The guard
// below asserts both halves of that pairing exist.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const read = (path: string): string => readFileSync(at(path), 'utf8');

type IconMap = Record<string, string>;
const manifest = JSON.parse(read('../../manifest.json')) as {
  icons: IconMap;
  action?: { default_icon?: IconMap; default_title?: string; default_popup?: string };
  permissions?: string[];
};

describe('manifest action — the toolbar icon must render in colour', () => {
  test('an action is declared with a title', () => {
    assert.ok(manifest.action, 'manifest must declare an `action` (#1000)');
    assert.equal(manifest.action.default_title, 'Kimtos');
  });

  test('the action icon map mirrors the top-level icons', () => {
    assert.deepEqual(manifest.action?.default_icon, manifest.icons);
  });
});

describe('manifest action — the toolbar popup (#1110)', () => {
  const popup = manifest.action?.default_popup;

  test('a default_popup is declared', () => {
    assert.equal(popup, 'popup.html', 'the toolbar click must open the page-actions popup');
  });

  test('the popup file it names exists', () => {
    assert.ok(popup && existsSync(at(`../../${popup}`)), `manifest points at ${popup}, which is not in extension/`);
  });

  test('the popup is a build input, so Vite actually emits it', () => {
    const config = read('../../vite.config.ts');
    assert.match(config, /popup:\s*'popup\.html'/, 'add popup.html to rollupOptions.input or it ships empty');
  });

  // This assertion used to be its own inverse: under #1110 the popup was unconditional, so an
  // `onClicked` listener could never fire and the guard banned one. #1186 made the popup
  // per-tab, which makes the listener live — so the invariant genuinely changed rather than
  // being relaxed, and what is guarded now is the PAIRING. The two halves are useless apart:
  // a listener with nothing clearing the popup never fires, and cleared popups with no
  // listener leave the toolbar click doing nothing at all. Either alone is a silent bug that
  // only shows up as "the icon stopped working", so both are asserted together.
  test('the toolbar click has both halves: a live onClicked listener and a per-tab setPopup', () => {
    const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const worker = strip(read('../background/index.ts'));
    const toolbar = strip(read('../background/toolbarClick.ts'));

    assert.match(
      worker,
      /chrome\.action\.onClicked\.addListener/,
      'clearing a tab’s popup routes its click to onClicked — without this listener the click does nothing',
    );
    assert.match(
      worker + toolbar,
      /chrome\.action\.setPopup/,
      'nothing clears the popup per tab, so onClicked can never fire and the listener is dead code',
    );
  });

  test('activeTab is declared, so a page action can run without the all-sites grant', () => {
    assert.ok(
      manifest.permissions?.includes('activeTab'),
      'activeTab is what lets the popup fill the current tab without the broad host permission',
    );
  });
});
