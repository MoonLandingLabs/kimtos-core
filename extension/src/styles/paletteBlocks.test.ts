// The palette blocks in base.css, asserted against each other.
//
// Two invariants, one file, both learned the hard way:
//
//   1. Every block declares `color-scheme`, matching the palette it defines. This is the
//      ONLY thing the browser reads out of base.css — every token below it is ours, and
//      the browser cannot see any of them. Without it the controls the BROWSER draws (a
//      <select>'s drop-down list, checkboxes, sliders, colour/file pickers, scrollbars)
//      come up light on a dark page, which is what #1160 reported: the Appearance mode
//      picker's own drop-down was white while it sat on the dark Settings panel.
//
//   2. The two LIGHT blocks declare exactly the same properties. The light palette is
//      deliberately written out twice — `@media (prefers-color-scheme: light)` for System
//      mode and `:root[data-theme='light']` for the explicit pick — because plain CSS
//      cannot share one block between a media query and an attribute selector. Nothing
//      asserted they stayed in step, and a token added to one and not the other is
//      invisible until a user in the other mode hits it. #1160 added a line to both,
//      which is exactly the moment that drift starts.
//
// It reads the stylesheet as text on purpose: there is no DOM here, and the point is the
// SOURCE structure, not what one browser computes from it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { baseCss, blockBody as bodyOf, declaredProps, declaredValue as value } from '../test/cssBlocks.js';

const css = baseCss();

/** The body of a block in base.css. The shared reader throws when the selector is gone, which
 *  is the same failure the old local copy asserted. */
const blockBody = (opener: string): string => bodyOf(css, opener);

// The dark base is `:root {` at the start of a line; the light ones are keyed by their
// own selectors. `--panel` tells us which palette a block actually defines.
const BLOCKS = [
  { name: 'dark base :root', opener: '\n:root {', scheme: 'dark' },
  { name: '@media prefers-color-scheme: light', opener: ':root:not([data-theme]) {', scheme: 'light' },
  { name: ":root[data-theme='light']", opener: ":root[data-theme='light'] {", scheme: 'light' },
] as const;

describe('base.css palette blocks', () => {
  for (const { name, opener, scheme } of BLOCKS) {
    test(`${name} declares color-scheme: ${scheme}`, () => {
      const body = blockBody(opener);
      assert.equal(
        value(body, 'color-scheme'),
        scheme,
        `${name} must declare \`color-scheme: ${scheme}\` — without it the browser draws its own ` +
          `controls (select drop-downs, checkboxes, scrollbars) in the wrong palette (#1160)`,
      );
    });
  }

  test('the two light blocks declare the same properties', () => {
    const media = declaredProps(blockBody(':root:not([data-theme]) {'));
    const attr = declaredProps(blockBody(":root[data-theme='light'] {"));
    const only = (a: string[], b: string[]): string[] => [...new Set(a)].filter((p) => !b.includes(p)).sort();
    assert.deepEqual(
      { onlyInMediaQuery: only(media, attr), onlyInAttributeBlock: only(attr, media) },
      { onlyInMediaQuery: [], onlyInAttributeBlock: [] },
      'the light palette is written out twice and the copies have drifted — add the property to both',
    );
  });

  test('the dark base defines every colour token the light blocks override', () => {
    const dark = declaredProps(blockBody('\n:root {'));
    const missing = [...new Set(declaredProps(blockBody(":root[data-theme='light'] {")))]
      .filter((p) => !dark.includes(p))
      .sort();
    assert.deepEqual(
      missing,
      [],
      'a light block overrides a token the dark base never defines, so dark falls back to nothing',
    );
  });
});
