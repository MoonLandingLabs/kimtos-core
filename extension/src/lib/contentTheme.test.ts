// The content-script palette, asserted against the stylesheet it mirrors.
//
// `lib/contentTheme.ts` hand-copies values out of base.css, because a content script runs in the
// visited page's document and cannot read one token of ours. A hand-copied palette is exactly
// the shape this codebase keeps losing to: it is right on the day it is written and silently
// wrong six months later, when somebody retunes `--panel` and has no reason to know that a copy
// of it is painted onto every site the user visits. Five in-page surfaces each carried their own
// copy before this existed, and the copies had already drifted into three different darks
// (#1173).
//
// So the copy is allowed, and this is the price of it: every mirrored value is checked against
// the token it claims to mirror, in the block it belongs to.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { baseCss, blockBody, declaredValue } from '../test/cssBlocks.js';
import { PALETTE, CONSTANTS, CONTENT_THEME_CSS, THEME_ATTR } from './contentTheme.js';

const css = baseCss();
// The dark base is `:root {` at the start of a line — `\n:root {` so it cannot match
// `:root:not([data-theme])` or `:root[data-theme='light']`.
const dark = blockBody(css, '\n:root {');
const light = blockBody(css, ":root[data-theme='light'] {");

describe('the content-script palette mirrors base.css', () => {
  test('every theme-dependent value matches its token, in both blocks', () => {
    for (const [name, [darkValue, lightValue]] of Object.entries(PALETTE)) {
      const token = `--${name}`;
      assert.equal(
        declaredValue(dark, token),
        darkValue,
        `--kt-${name} no longer matches ${token} in base.css's dark :root — re-copy it`,
      );
      assert.equal(
        declaredValue(light, token),
        lightValue,
        `--kt-${name} no longer matches ${token} in base.css's light block — re-copy it`,
      );
    }
  });

  test('every theme-invariant value matches its token and really is invariant', () => {
    for (const [name, value] of Object.entries(CONSTANTS)) {
      const token = `--${name}`;
      assert.equal(declaredValue(dark, token), value, `--kt-${name} no longer matches ${token} in base.css`);
      assert.equal(
        declaredValue(light, token),
        null,
        `${token} now has a light value in base.css, so --kt-${name} cannot be a constant — move it to PALETTE`,
      );
    }
  });

  test('a token that grows a light value cannot stay in the dark-only half', () => {
    // The guard above, stated from the other side: nothing in PALETTE may be missing from a
    // block, which is how a half-copied token would look.
    for (const name of Object.keys(PALETTE)) {
      assert.notEqual(
        declaredValue(light, `--${name}`),
        null,
        `--${name} is in PALETTE but absent from the light block`,
      );
    }
  });
});

describe('the emitted stylesheet', () => {
  test('declares every variable in the dark half and every theme-dependent one in the light half', () => {
    const hostBlock = blockBody(CONTENT_THEME_CSS, ':host {');
    const lightBlock = blockBody(CONTENT_THEME_CSS, `:host([${THEME_ATTR}='light']) {`);
    for (const name of Object.keys(PALETTE)) {
      assert.notEqual(declaredValue(hostBlock, `--kt-${name}`), null, `--kt-${name} missing from :host`);
      assert.notEqual(declaredValue(lightBlock, `--kt-${name}`), null, `--kt-${name} missing from the light override`);
    }
    for (const name of Object.keys(CONSTANTS)) {
      assert.notEqual(declaredValue(hostBlock, `--kt-${name}`), null, `--kt-${name} missing from :host`);
      assert.equal(
        declaredValue(lightBlock, `--kt-${name}`),
        null,
        `--kt-${name} is invariant and must not be restated in the light override`,
      );
    }
  });

  test('dark is the default, so a root that never gets the attribute still reads', () => {
    // The one frame before the stored setting has been read is painted by :host alone.
    assert.match(CONTENT_THEME_CSS, /:host \{[^}]*--kt-panel: rgba\(28, 28, 32, 0\.98\)/);
  });
});

describe('the in-page surfaces use the palette rather than their own colours', () => {
  // The bug was five surfaces with five private palettes. A literal creeping back into one of
  // them is the same bug returning, and it is invisible until somebody opens that surface in the
  // other theme — so it fails here instead.
  //
  // The allowlist is keyed by VALUE, not by usage site, so an entry is only as honest as the
  // narrowest place that value appears. `#fff` was allowed here for the brand squircle's ink and
  // was thereby waving through two accent-gradient buttons in writer.ts that should have been
  // `--kt-on-accent` — a value-keyed allowlist cannot tell those apart, so the fix was to migrate
  // the buttons until the value really does appear only where the reason holds.
  const SURFACES = [
    'content/fakeform.ts',
    'content/toast.ts',
    'content/clipboardPicker.ts',
    'content/writer.ts',
    'lib/fieldChip.ts',
  ];
  // Colour literals these files are allowed to keep, each with a reason.
  const ALLOWED = new Set([
    '#8aa2ff', // brand gradient stops (content/brand.ts explains why the mark is inline)
    '#5b6cff',
    '#18b6a4',
    '#fff', // ink on the brand squircle, which is brand-coloured in both themes
    '#e5484d', // the spelling underline, shared with a stylesheet injected into the PAGE
  ]);

  for (const rel of SURFACES) {
    test(`${rel} declares no unexplained colour literal`, async () => {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
        // Comments explain the old colours; they are prose, not declarations.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const found = [...src.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)].map((m) => m[0]);
      const unexplained = found.filter((lit) => !ALLOWED.has(lit) && !/^rgba?\(\s*0\s*,\s*0\s*,\s*0/.test(lit));
      assert.deepEqual(unexplained, [], `${rel} hardcodes colour instead of using --kt-*`);
    });
  }
});
