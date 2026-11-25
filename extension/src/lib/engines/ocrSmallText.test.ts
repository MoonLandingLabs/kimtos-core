// The small-text recovery maths. Guards #956: Tesseract sizes a page from its dominant
// text and discards blobs far below that size as noise, so a footer under a headline is
// dropped silently. These tests pin the band detection, the "already read" check that
// stops a rescan duplicating a line, and the splice that puts recovered text back in
// reading order.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type Band,
  bandsFromRowCounts,
  dominantBandHeight,
  estimateBackground,
  isUsefulRecovery,
  rowInkCounts,
  smallBands,
  spliceRecoveries,
  uncoveredBands,
  upscaleForBand,
} from './ocrSmallText.js';

/** Build a grayscale buffer: `bands` are [top, height] runs of ink on a light page. */
function page(width: number, height: number, bands: [number, number][], ink = 0, bg = 255): Uint8Array {
  const gray = new Uint8Array(width * height).fill(bg);
  for (const [top, h] of bands)
    for (let y = top; y < top + h; y++)
      // Ink every other column, so the run reads as text rather than a solid rule.
      for (let x = 0; x < width; x += 2) gray[y * width + x] = ink;
  return gray;
}

const counts = (gray: Uint8Array, w: number, h: number) => rowInkCounts(gray, w, h, estimateBackground(gray));

test('the background level is the most common luminance, on a light page and a dark one', () => {
  assert.equal(estimateBackground(page(40, 40, [[10, 6]])), 255);
  assert.equal(estimateBackground(page(40, 40, [[10, 6]], 255, 12)), 12);
});

test('ink is measured as distance from the background, so a dark screenshot works too', () => {
  const dark = page(40, 40, [[10, 6]], 255, 12);
  const c = counts(dark, 40, 40);
  assert.equal(c[9], 0);
  assert.equal(c[12], 20);
});

test('bands are the contiguous runs of inked rows', () => {
  const gray = page(100, 200, [
    [10, 40],
    [90, 20],
    [160, 8],
  ]);
  assert.deepEqual(bandsFromRowCounts(counts(gray, 100, 200), 100), [
    { top: 10, height: 40 },
    { top: 90, height: 20 },
    { top: 160, height: 8 },
  ]);
});

test('a hairline rule is not a band — it is 1-3 rows and would only yield noise', () => {
  const gray = page(100, 100, [
    [10, 20],
    [60, 2],
  ]);
  assert.deepEqual(bandsFromRowCounts(counts(gray, 100, 100), 100), [{ top: 10, height: 20 }]);
});

test('a thick solid rule is not a band either — it fills every column, text never does', () => {
  const gray = new Uint8Array(100 * 100).fill(255);
  for (let y = 10; y < 30; y++) for (let x = 0; x < 100; x++) gray[y * 100 + x] = 0; // solid bar
  for (let y = 60; y < 80; y++) for (let x = 0; x < 100; x += 2) gray[y * 100 + x] = 0; // text
  assert.deepEqual(bandsFromRowCounts(counts(gray, 100, 100), 100), [{ top: 60, height: 20 }]);
});

test('the dominant band height is the median, so one huge headline cannot skew it', () => {
  const bands: Band[] = [
    { top: 0, height: 120 },
    { top: 200, height: 40 },
    { top: 300, height: 40 },
    { top: 400, height: 40 },
    { top: 500, height: 16 },
  ];
  assert.equal(dominantBandHeight(bands), 40);
  assert.equal(dominantBandHeight([]), 0);
});

test('a band far thinner than the dominant one is flagged; a comparable one is not', () => {
  const bands: Band[] = [
    { top: 0, height: 120 },
    { top: 200, height: 40 },
    { top: 300, height: 40 },
    { top: 400, height: 30 },
    { top: 500, height: 16 },
  ];
  assert.deepEqual(smallBands(bands), [{ top: 500, height: 16 }]);
});

test('a page of one text size flags nothing, so an ordinary image pays no rescan', () => {
  const bands: Band[] = [
    { top: 0, height: 30 },
    { top: 60, height: 30 },
    { top: 120, height: 28 },
  ];
  assert.deepEqual(smallBands(bands), []);
});

test('a band the main pass already read is skipped — a rescan must never duplicate text', () => {
  const bands: Band[] = [
    { top: 100, height: 16 },
    { top: 500, height: 16 },
  ];
  const lines = [{ y0: 96, y1: 120 }];
  assert.deepEqual(uncoveredBands(bands, lines), [{ top: 500, height: 16 }]);
  assert.deepEqual(uncoveredBands(bands, []), bands);
});

test('a line that barely clips a band does not count as having read it', () => {
  const bands: Band[] = [{ top: 100, height: 20 }];
  assert.deepEqual(uncoveredBands(bands, [{ y0: 60, y1: 105 }]), bands);
});

test('the upscale is what the band needs, clamped so a sliver is not just interpolated', () => {
  assert.equal(upscaleForBand({ top: 0, height: 40 }), 1);
  assert.equal(upscaleForBand({ top: 0, height: 80 }), 1);
  assert.equal(upscaleForBand({ top: 0, height: 20 }), 2);
  assert.equal(upscaleForBand({ top: 0, height: 4 }), 6);
});

test('a rescan that found only punctuation is discarded', () => {
  assert.equal(isUsefulRecovery('Acme Cloud | Confidential'), true);
  assert.equal(isUsefulRecovery('7'), true);
  assert.equal(isUsefulRecovery('|| .. --'), false);
  assert.equal(isUsefulRecovery(''), false);
});

test('recovered text is spliced back at the point it appears on the page', () => {
  const lines = [
    { y0: 100, y1: 160 },
    { y0: 200, y1: 260 },
  ];
  const text = 'Headline\nBody line';
  assert.equal(spliceRecoveries(text, lines, [{ top: 40, text: 'Header note' }]), 'Header note\nHeadline\nBody line');
  assert.equal(spliceRecoveries(text, lines, [{ top: 180, text: 'Caption' }]), 'Headline\nCaption\nBody line');
  assert.equal(spliceRecoveries(text, lines, [{ top: 800, text: 'Footer' }]), 'Headline\nBody line\nFooter');
});

test('several recoveries keep their own top-to-bottom order', () => {
  const lines = [{ y0: 100, y1: 160 }];
  const out = spliceRecoveries('Headline', lines, [
    { top: 900, text: 'Footer' },
    { top: 20, text: 'Header' },
  ]);
  assert.equal(out, 'Header\nHeadline\nFooter');
});

test('blank lines in the main pass are preserved, and do not shift the insertion point', () => {
  const lines = [
    { y0: 100, y1: 160 },
    { y0: 400, y1: 460 },
  ];
  const out = spliceRecoveries('Headline\n\nBody', lines, [{ top: 300, text: 'Caption' }]);
  assert.equal(out, 'Headline\n\nCaption\nBody');
});

test('when the text does not line up with the boxes, the splice falls back to top or bottom', () => {
  // Two boxes but three text lines — the per-line mapping cannot be trusted.
  const lines = [
    { y0: 100, y1: 160 },
    { y0: 200, y1: 260 },
  ];
  assert.equal(spliceRecoveries('a\nb\nc', lines, [{ top: 40, text: 'Top' }]), 'Top\na\nb\nc');
  assert.equal(spliceRecoveries('a\nb\nc', lines, [{ top: 900, text: 'End' }]), 'a\nb\nc\nEnd');
});

test('nothing recovered leaves the main pass text exactly as it was', () => {
  assert.equal(spliceRecoveries('Headline\nBody', [{ y0: 1, y1: 2 }], []), 'Headline\nBody');
});

test('a recovery still lands when the main pass returned nothing at all', () => {
  assert.equal(spliceRecoveries('', [], [{ top: 500, text: 'Footer' }]), 'Footer');
});
