// The layout → Tesseract page-segmentation mapping. Guards #725: leaving the mode
// unset gave us Tesseract's library default of 6 (single uniform block), which
// silently drops headings and interleaves a sidebar into the body text. The
// default here must stay full automatic page analysis (3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LAYOUT, LAYOUT_OPTIONS, pageSegMode } from './ocrLayout.js';

test('the default layout is automatic page analysis, not single block', () => {
  assert.equal(DEFAULT_LAYOUT, 'auto');
  assert.equal(pageSegMode(DEFAULT_LAYOUT), '3');
  assert.notEqual(pageSegMode(DEFAULT_LAYOUT), '6');
});

test('each layout maps to its Tesseract page-segmentation mode', () => {
  assert.equal(pageSegMode('auto'), '3');
  assert.equal(pageSegMode('column'), '4');
  assert.equal(pageSegMode('block'), '6');
  assert.equal(pageSegMode('sparse'), '11');
});

test('the Layout setting offers every layout, and the default is one of them', () => {
  const values = LAYOUT_OPTIONS.map((o) => o.value);
  assert.deepEqual(values, ['auto', 'column', 'block', 'sparse']);
  assert.ok(values.includes(DEFAULT_LAYOUT));
  for (const o of LAYOUT_OPTIONS) assert.ok(o.label.length > 0, `${o.value} has no label`);
});

test('an absent or unknown layout falls back to the default', () => {
  assert.equal(pageSegMode(undefined), '3');
  assert.equal(pageSegMode(''), '3');
  assert.equal(pageSegMode('nonsense'), '3');
});
