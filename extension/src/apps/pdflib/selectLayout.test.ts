// Turning on Select must not change the shape of a row.
//
// It did. `.pdf-item.is-selected` and `.pdf-item-select` carried a copy of `.pdf-open`'s ruleset —
// `flex-direction: column`, `background: none`, `border: none`. `.pdf-open` is the INNER column
// that stacks a title over its subtitle, where a column is correct; `.pdf-item` is the ROW. So
// pressing Select turned every row into a column (checkbox above cover above title), and
// `.pdf-item`'s own `align-items: center` centred the result: one enormous entry per row, with the
// border and hover surface stripped off.
//
// The properties were never written for a row. They arrived when the old shared `apps.css` grouped
// these two selectors with `.mt-history-open`, which genuinely is that shape, and a later refactor
// copied the whole ruleset to each member of the group.
//
// Asserted against the SOURCE rather than a rendered page, because that is where the mistake is
// legible: the claim is "the select-mode rules do not touch layout", and no screenshot proves that
// for the states nobody happened to open.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockBody, declaredProps } from '../../test/cssBlocks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = (): string => readFileSync(join(HERE, 'pdflib.css'), 'utf8');

/** Anything that could move, resize or re-flow a row. A select-mode rule may declare none of
 *  these: the row's geometry belongs to `.pdf-item` and must be identical in both modes. */
const LAYOUT_PROPS = [
  'display',
  'flex',
  'flex-direction',
  'flex-flow',
  'grid-template-columns',
  'align-items',
  'justify-content',
  'padding',
  'margin',
  'width',
  'height',
  'gap',
];

describe('PDF Library: entering Select must not restyle the row', () => {
  for (const selector of ['.pdf-item-select', '.pdf-item.is-selected']) {
    test(`${selector} declares no layout property`, () => {
      const declared = declaredProps(blockBody(css(), selector));
      const offending = declared.filter((p) => LAYOUT_PROPS.includes(p));
      assert.deepEqual(
        offending,
        [],
        `${selector} sets ${offending.join(', ')} — select mode must not change a row's shape`,
      );
    });
  }

  test('the row itself still lays out as a horizontal flex row', () => {
    // The other half: the assertion above would also pass if `.pdf-item` had lost its own layout.
    const item = blockBody(css(), '.pdf-item {');
    assert.match(item, /display:\s*flex/, '.pdf-item is the row, and it stays a flex row');
    assert.ok(
      !/flex-direction:\s*column/.test(item),
      'a column here would stack the cover above the title in BOTH modes',
    );
  });

  test('a picked row is still visibly picked', () => {
    // Removing the broken block must not leave selection invisible — the point of the mode is
    // knowing what you are about to delete.
    const picked = blockBody(css(), '.pdf-item.is-selected');
    assert.ok(/border-color|background|outline|box-shadow/.test(picked), 'a selected row needs some visible mark');
  });
});
