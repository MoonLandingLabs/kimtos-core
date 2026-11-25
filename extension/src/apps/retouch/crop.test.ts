// The crop-coordinate math, checked against the bug it exists for (#615).
//
// The defect: the crop overlay lives in the scrollable wrap's content space, but the
// pointer math ignored the scroll — so once a maximized window scrolled the canvas, the
// drawn selection and the applied crop diverged and the crop landed on the wrong region.
// The fix works entirely in content space, which absorbs the scroll. These tests pin
// that: the mapping is a pure function of content-space inputs (hence scroll-invariant),
// scales X and Y independently, and clamps to the image.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  selToPixels,
  clampToCanvas,
  pixelsToSel,
  resizeSel,
  applyAspectPx,
  boundsOf,
  fullImagePx,
  type CanvasGeom,
} from './crop.js';

// A 800x600 image displayed at half size (400x300), its top-left at content (10, 20).
const g = (over: Partial<CanvasGeom> = {}): CanvasGeom => ({
  left: 10,
  top: 20,
  dispW: 400,
  dispH: 300,
  pixW: 800,
  pixH: 600,
  ...over,
});

describe('retouch crop coordinate mapping (#615)', () => {
  test('maps a content-space selection to image pixels (2x display)', () => {
    // A box from display (60,50) spanning 100x90 → subtract the canvas origin, x2 scale.
    assert.deepEqual(selToPixels({ x: 60, y: 50, w: 100, h: 90 }, g()), { x: 100, y: 60, w: 200, h: 180 });
  });

  test('scroll-invariant: a shared scroll offset on pointer and canvas cancels', () => {
    // Scrolling the wrap adds the same scrollTop/Left to BOTH the pointer-derived
    // selection and the canvas origin (that is how index.ts reads them). So the offset
    // must cancel: the same picture location maps to the same pixels at any scroll. The
    // old bug added it to only one of the two, so this is the exact regression.
    const base = selToPixels({ x: 60, y: 50, w: 100, h: 90 }, g());
    const d = 237; // pretend the wrap scrolled by 237px in each axis
    const scrolled = selToPixels({ x: 60 + d, y: 50 + d, w: 100, h: 90 }, g({ left: 10 + d, top: 20 + d }));
    assert.deepEqual(scrolled, base);
  });

  test('X and Y scale independently (a stretched display cannot skew one axis)', () => {
    // 800x600 image shown at 400x200 → sx=2, sy=3. Y must use sy, not sx.
    const px = selToPixels({ x: 10, y: 20, w: 10, h: 10 }, g({ dispW: 400, dispH: 200 }));
    assert.equal(px.x, 0); // (10-10)*2
    assert.equal(px.y, 0); // (20-20)*3
    assert.equal(px.w, 20); // 10*2
    assert.equal(px.h, 30); // 10*3
  });

  test('clamps the crop to the image bounds', () => {
    // A selection that starts before the image and runs past its right/bottom edge.
    const px = selToPixels({ x: -50, y: -50, w: 100000, h: 100000 }, g());
    assert.deepEqual(px, { x: 0, y: 0, w: 800, h: 600 });
  });

  test('a degenerate display size does not divide by zero', () => {
    const px = selToPixels({ x: 0, y: 0, w: 10, h: 10 }, g({ dispW: 0, dispH: 0 }));
    assert.equal(Number.isFinite(px.w), true);
    assert.equal(Number.isFinite(px.h), true);
  });

  test('clampToCanvas keeps a drag point on the picture', () => {
    // Above-left of the canvas → snaps to its top-left; far below-right → its bottom-right.
    assert.deepEqual(clampToCanvas(-100, -100, g()), { x: 10, y: 20 });
    assert.deepEqual(clampToCanvas(99999, 99999, g()), { x: 410, y: 320 });
    // A point inside is unchanged.
    assert.deepEqual(clampToCanvas(200, 150, g()), { x: 200, y: 150 });
  });
});

// The real crop editor (#617). The selection lives in image pixels; the handle math
// runs in content space and is a pure function, so it is pinned here without a DOM.
describe('retouch crop editor geometry (#617)', () => {
  test('boundsOf gives the canvas edges in content space', () => {
    assert.deepEqual(boundsOf(g()), { left: 10, top: 20, right: 410, bottom: 320 });
  });

  test('fullImagePx selects the whole image', () => {
    assert.deepEqual(fullImagePx(g()), { x: 0, y: 0, w: 800, h: 600 });
  });

  test('pixelsToSel is the inverse of selToPixels (round-trips)', () => {
    const px = { x: 100, y: 60, w: 200, h: 180 };
    assert.deepEqual(pixelsToSel(px, g()), { x: 60, y: 50, w: 100, h: 90 });
    assert.deepEqual(selToPixels(pixelsToSel(px, g()), g()), px);
  });

  const b = boundsOf(g());
  const start = { x: 60, y: 50, w: 100, h: 90 }; // edges l60 t50 r160 b140

  test('an edge grip resizes one side', () => {
    assert.deepEqual(resizeSel(start, 'e', 20, 0, b), { x: 60, y: 50, w: 120, h: 90 });
    assert.deepEqual(resizeSel(start, 'n', 0, -10, b), { x: 60, y: 40, w: 100, h: 100 });
  });

  test('a corner grip resizes both adjoining sides', () => {
    assert.deepEqual(resizeSel(start, 'nw', -10, -10, b), { x: 50, y: 40, w: 110, h: 100 });
  });

  test('a grip clamps to the canvas bounds', () => {
    // Drag the west edge far past the left of the image → pinned at left=10.
    assert.deepEqual(resizeSel(start, 'w', -1000, 0, b), { x: 10, y: 50, w: 150, h: 90 });
  });

  test('a grip never collapses below the min size', () => {
    // Drag the east edge left past the west edge → width holds at the 8px default min.
    assert.deepEqual(resizeSel(start, 'e', -1000, 0, b), { x: 60, y: 50, w: 8, h: 90 });
  });

  test('move translates the box and keeps it inside the canvas', () => {
    assert.deepEqual(resizeSel(start, 'move', 1000, 0, b), { x: 310, y: 50, w: 100, h: 90 });
    assert.deepEqual(resizeSel(start, 'move', -1000, -1000, b), { x: 10, y: 20, w: 100, h: 90 });
  });

  test('a ratio-locked corner keeps the aspect (square)', () => {
    const sq = resizeSel({ x: 60, y: 50, w: 100, h: 100 }, 'se', 40, 10, b, { aspect: 1 });
    assert.equal(sq.w, sq.h);
  });

  test('a ratio-locked corner shrinks to fit the bounds, ratio intact', () => {
    // Anchored near the bottom edge: only ~20px of height is available, so the square
    // shrinks to ~20px rather than busting the canvas.
    const near = { x: 60, y: 300, w: 15, h: 15 };
    const out = resizeSel(near, 'se', 1000, 1000, b, { aspect: 1 });
    assert.equal(out.w, out.h); // still square
    assert.ok(out.y + out.h <= b.bottom + 0.001); // stays within the canvas bottom (320)
    assert.ok(out.h <= 20 + 0.001);
  });

  const dims = { pixW: 800, pixH: 600 };
  test('applyAspectPx refits to 1:1, centred and clamped', () => {
    assert.deepEqual(applyAspectPx({ x: 0, y: 0, w: 800, h: 600 }, 1, dims), { x: 100, y: 0, w: 600, h: 600 });
  });

  test('applyAspectPx refits to 16:9, centred and clamped', () => {
    const r = applyAspectPx({ x: 0, y: 0, w: 800, h: 600 }, 16 / 9, dims);
    assert.deepEqual(r, { x: 0, y: 75, w: 800, h: 450 });
    assert.ok(Math.abs(r.w / r.h - 16 / 9) < 0.01);
  });
});

// Crop under the continuous, cursor-anchored zoom + pan (#1124). The new model draws the canvas
// with `transform: translate(pan) scale(zoom)` in a non-scrolling viewport, so its content-space
// origin IS the pan and its displayed size IS the pixel size times the zoom. The crop maths is
// unchanged (it reads the canvas's live rect), and these pin that it still selects the exact
// region at 200%+ and after panning — the states the old discrete zoom never exercised.
describe('retouch crop under zoom + pan (#1124)', () => {
  // The CanvasGeom index.ts computes at zoom Z, pan (panX,panY): left/top = pan (scrollLeft/Top
  // are now always 0), displayed size = pixel size * Z.
  const zoomed = (Z: number, panX: number, panY: number, pixW = 800, pixH = 600): CanvasGeom => ({
    left: panX,
    top: panY,
    dispW: pixW * Z,
    dispH: pixH * Z,
    pixW,
    pixH,
  });

  test('a viewport selection maps to the right image pixels at 2x with a pan', () => {
    const g = zoomed(2, -500, -300);
    // Image pixels x:100..300 (w200), y:60..240 (h180) sit in the viewport at left + px*Z:
    // x = -500 + 100*2 = -300 (w 400), y = -300 + 60*2 = -180 (h 360).
    const px = selToPixels({ x: -300, y: -180, w: 400, h: 360 }, g);
    assert.deepEqual(px, { x: 100, y: 60, w: 200, h: 180 });
  });

  test('round-trips a pixel rect through content space at 3x, panned', () => {
    const g = zoomed(3, -1200, -400);
    const rect = { x: 250, y: 175, w: 120, h: 90 };
    assert.deepEqual(selToPixels(pixelsToSel(rect, g), g), rect);
  });

  test('pan does not change which pixels a fixed image region maps to', () => {
    // The same image region, framed at two different pans, is the same pixels: the selection's
    // viewport coords shift with the canvas origin exactly, so they cancel — the transform-model
    // analogue of the scroll-invariance the crop maths was built on (#615).
    const region = { x: 300, y: 200, w: 160, h: 120 };
    const gA = zoomed(2.5, -100, -50);
    const gB = zoomed(2.5, -640, -430);
    assert.deepEqual(selToPixels(pixelsToSel(region, gA), gA), region);
    assert.deepEqual(selToPixels(pixelsToSel(region, gB), gB), region);
  });

  test('a selection dragged past the image edge at high zoom clamps to the image', () => {
    const g = zoomed(4, -2000, -1500);
    const px = selToPixels({ x: -1e6, y: -1e6, w: 2e6, h: 2e6 }, g);
    assert.deepEqual(px, { x: 0, y: 0, w: 800, h: 600 });
  });
});
