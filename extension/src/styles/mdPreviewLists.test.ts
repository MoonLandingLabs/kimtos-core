// A rendered ordered list must have room for its own numbers.
//
// The number of a list item is drawn OUTSIDE the item, in the space the list's `padding-left`
// reserves for it, so that padding is the entire budget the marker box has. `.md-preview`
// gave every list 1.4em, and measured in Chrome at that block's own 14px in `--font` a marker
// box costs 1.18em for one digit, 1.80em for two and 2.41em for three. So every list that
// reached 10 overflowed its own padding.
//
// That would be harmless if it only hung outside the list. It does not: an `.md-preview` host
// is typically a scroll container, `overflow-y: auto` forces `overflow-x` to `auto` with it,
// and a left-to-right box cannot scroll left of its own start — so the overhang is clipped and
// unreachable, not merely off-screen. Notes' split view paints its `.md-preview` straight onto
// the scroller with no left padding of its own, so a twelve-item list read `9. 0. 1. 2.` and
// nothing the user could do brought the digits back (#1296).
//
// Asserted on the stylesheet as text, like `paletteBlocks.test.ts` and
// `apps/pdflib/selectLayout.test.ts`, because it has to be: the failure is a layout effect and
// there is no layout engine here. What CAN be pinned is the declared budget, and that is the
// thing that was wrong.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { componentsCss, declaredValue, withoutComments } from '../test/cssBlocks.js';

/** The widest marker we size for: `100.` through `999.`, measured in Chrome at 14px in `--font`. */
const THREE_DIGIT_EM = 2.41;

/** The bodies of every rule naming `selector`, in source order — which is cascade order here,
 *  since all of these selectors have the same specificity. */
function rulesFor(css: string, selector: string): string[] {
  const bodies: string[] = [];
  for (const [, selectors, body] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (selectors.split(',').some((s) => s.trim() === selector)) bodies.push(body);
  assert.ok(bodies.length, `no rule in components.css selects \`${selector}\` any more — update this test`);
  return bodies;
}

/** What the cascade actually leaves `selector` with, however many rules contribute to it. */
function effective(selector: string, prop: string): string {
  const values = rulesFor(componentsCss(), selector)
    .map((body) => declaredValue(body, prop))
    .filter((v): v is string => v !== null);
  assert.ok(values.length, `\`${selector}\` declares no ${prop}`);
  return values[values.length - 1];
}

/** An em value as a number. Rejects any other unit: the marker scales with the font size, so a
 *  padding that does not is only correct at one size. */
function ems(value: string, what: string): number {
  const m = /^([\d.]+)em$/.exec(value);
  assert.ok(m, `${what} is \`${value}\`, which is not an em — the marker it has to fit scales with font-size`);
  return Number(m[1]);
}

describe('.md-preview lists reserve room for their markers', () => {
  test('the budget is stated as a longhand, so reading it is reading the truth', () => {
    // Everything below reads `padding-left`. A `padding` shorthand would override it in the
    // cascade while leaving that longhand in place, so the assertions would keep passing on a
    // value the browser had already discarded — a guard that reports green on the bug it exists
    // to catch. Cheaper to forbid the shorthand than to reimplement shorthand expansion here.
    for (const selector of ['.md-preview ol', '.md-preview ul'])
      for (const body of rulesFor(componentsCss(), selector))
        assert.equal(
          declaredValue(body, 'padding'),
          null,
          `${selector} declares the \`padding\` shorthand, which silently overrides the ` +
            `padding-left this test reads. Use padding-left.`,
        );
  });

  test('an ordered list has room for a three-digit number', () => {
    const pad = ems(effective('.md-preview ol', 'padding-left'), '.md-preview ol padding-left');
    assert.ok(
      pad >= THREE_DIGIT_EM,
      `.md-preview ol reserves ${pad}em for its markers, but \`100.\` needs ${THREE_DIGIT_EM}em ` +
        `(\`10.\` needs 1.80em). Anything short is clipped away by the scroll container, not wrapped (#1296).`,
    );
  });

  test('a bullet list is left alone', () => {
    // The other half. Widening `ul` too would also pass the test above while indenting every
    // bullet list in the app for a problem bullets never had — a bullet marker is 1.18em at most.
    assert.equal(effective('.md-preview ul', 'padding-left'), '1.4em');
  });
});
