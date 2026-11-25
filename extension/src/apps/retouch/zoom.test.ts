// Retouch's zoom stepping (#652).
//
// The rule that matters: stepping starts from the scale actually on screen, which in
// Fit mode is a MEASURED number that is almost never one of the stops. Stepping from
// such a value must land on the neighbouring stop — not snap to 100%, and not stand
// still — and it must clamp at both ends rather than wrap.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextZoom,
  clampZoom,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEPS,
  normalizeWheelDelta,
  zoomFactor,
  scaleByWheel,
  anchorPan,
  clampPan,
  type Pan,
} from './zoom.js';

describe('nextZoom', () => {
  test('steps to the neighbouring stop from an exact stop', () => {
    assert.equal(nextZoom(1, 1), 1.5);
    assert.equal(nextZoom(1, -1), 0.75);
  });

  test('steps from a measured Fit scale to the neighbouring stop, not to 100%', () => {
    assert.equal(nextZoom(0.38, 1), 0.5);
    assert.equal(nextZoom(0.38, -1), 0.25);
  });

  test('clamps instead of wrapping at both ends', () => {
    assert.equal(nextZoom(MAX_ZOOM, 1), MAX_ZOOM);
    assert.equal(nextZoom(MIN_ZOOM, -1), MIN_ZOOM);
    assert.equal(nextZoom(99, 1), MAX_ZOOM);
    assert.equal(nextZoom(0.001, -1), MIN_ZOOM);
  });

  test('every stop is reachable by walking up from the minimum', () => {
    const walked: number[] = [MIN_ZOOM];
    let z = MIN_ZOOM;
    for (let i = 0; i < ZOOM_STEPS.length; i++) {
      const next = nextZoom(z, 1);
      if (next === z) break;
      walked.push(next);
      z = next;
    }
    assert.deepEqual(walked, [...ZOOM_STEPS]);
  });
});

describe('clampZoom', () => {
  test('keeps a value inside the supported range', () => {
    assert.equal(clampZoom(2), 2);
    assert.equal(clampZoom(0), MIN_ZOOM);
    assert.equal(clampZoom(1000), MAX_ZOOM);
  });
});

// ---- continuous, cursor-anchored zoom + pan (#1124) ----

describe('normalizeWheelDelta', () => {
  test('pixel-mode deltas pass through unchanged', () => {
    assert.equal(normalizeWheelDelta(120, 0, 800), 120);
    assert.equal(normalizeWheelDelta(-42, 0, 800), -42);
  });
  test('line-mode deltas scale to ~16px per line', () => {
    assert.equal(normalizeWheelDelta(3, 1, 800), 48);
    assert.equal(normalizeWheelDelta(-1, 1, 800), -16);
  });
  test('page-mode deltas scale by the viewport height', () => {
    assert.equal(normalizeWheelDelta(1, 2, 640), 640);
    assert.equal(normalizeWheelDelta(-2, 2, 500), -1000);
  });
});

describe('zoomFactor', () => {
  test('scrolling up (negative delta) zooms in, down zooms out', () => {
    assert.ok(zoomFactor(-100) > 1);
    assert.ok(zoomFactor(100) < 1);
  });
  test('a zero delta is a no-op factor', () => {
    assert.equal(zoomFactor(0), 1);
  });
  test('is multiplicatively symmetric: an in-step and the matching out-step cancel', () => {
    assert.ok(Math.abs(zoomFactor(-80) * zoomFactor(80) - 1) < 1e-9);
  });
  test('a single violent flick is clamped to at most 4x / 0.25x per event', () => {
    assert.equal(zoomFactor(-100000), 4);
    assert.equal(zoomFactor(100000), 0.25);
  });
});

describe('scaleByWheel', () => {
  test('applies the factor and clamps to the supported range', () => {
    assert.equal(scaleByWheel(1, 0), 1);
    assert.ok(scaleByWheel(1, -100) > 1);
    assert.equal(scaleByWheel(MAX_ZOOM, -100000), MAX_ZOOM); // cannot exceed the max
    assert.equal(scaleByWheel(MIN_ZOOM, 100000), MIN_ZOOM); // cannot fall below the min
  });
});

describe('anchorPan — the cursor stays put across a zoom (the core #1124 fix)', () => {
  // The image point under the cursor, in image (canvas) pixels, given a pan/scale.
  const imgPointUnderCursor = (pan: Pan, scale: number, at: { x: number; y: number }) => ({
    x: (at.x - pan.x) / scale,
    y: (at.y - pan.y) / scale,
  });
  // Where that image point lands in the viewport, given a pan/scale.
  const viewportOf = (pan: Pan, scale: number, p: { x: number; y: number }) => ({
    x: pan.x + p.x * scale,
    y: pan.y + p.y * scale,
  });

  test('the image point under the cursor is unmoved after zooming in', () => {
    const pan = { x: 0, y: 0 };
    const scale = 1;
    const at = { x: 100, y: 50 };
    const before = imgPointUnderCursor(pan, scale, at);
    const next = anchorPan(pan, scale, 2, at);
    const after = viewportOf(next, 2, before);
    assert.ok(Math.abs(after.x - at.x) < 1e-9);
    assert.ok(Math.abs(after.y - at.y) < 1e-9);
  });

  test('holds with a non-zero starting pan and an arbitrary cursor', () => {
    const pan = { x: -237, y: 88 };
    const scale = 1.5;
    const at = { x: 412, y: 173 };
    const before = imgPointUnderCursor(pan, scale, at);
    const next = anchorPan(pan, scale, 3.25, at);
    const after = viewportOf(next, 3.25, before);
    assert.ok(Math.abs(after.x - at.x) < 1e-9);
    assert.ok(Math.abs(after.y - at.y) < 1e-9);
  });

  test('holds when zooming OUT too', () => {
    const pan = { x: -400, y: -300 };
    const scale = 4;
    const at = { x: 300, y: 200 };
    const before = imgPointUnderCursor(pan, scale, at);
    const next = anchorPan(pan, scale, 1, at);
    const after = viewportOf(next, 1, before);
    assert.ok(Math.abs(after.x - at.x) < 1e-9);
    assert.ok(Math.abs(after.y - at.y) < 1e-9);
  });

  test('an unchanged scale leaves the pan untouched', () => {
    assert.deepEqual(anchorPan({ x: 12, y: 34 }, 2, 2, { x: 500, y: 500 }), { x: 12, y: 34 });
  });

  test('a zoom in then back out about the same cursor returns to the start', () => {
    const pan = { x: -50, y: -20 };
    const at = { x: 220, y: 140 };
    const zoomedIn = anchorPan(pan, 1, 2.5, at);
    const backOut = anchorPan(zoomedIn, 2.5, 1, at);
    assert.ok(Math.abs(backOut.x - pan.x) < 1e-9);
    assert.ok(Math.abs(backOut.y - pan.y) < 1e-9);
  });

  test('guards against a zero current scale (no NaN)', () => {
    const p = anchorPan({ x: 5, y: 5 }, 0, 2, { x: 10, y: 10 });
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  });
});

describe('clampPan — keep the scaled image reachable', () => {
  const content = { w: 800, h: 600 };

  test('an axis that fits the viewport is centred', () => {
    // 800x600 at 0.5 → 400x300, inside an 800x800 viewport → centred at ((800-400)/2, (800-300)/2).
    const p = clampPan({ x: 999, y: -999 }, 0.5, content, { w: 800, h: 800 });
    assert.deepEqual(p, { x: 200, y: 250 });
  });

  test('an overflowing axis is clamped so neither edge enters the viewport', () => {
    // 800x600 at 2 → 1600x1200 in a 400x400 viewport. Valid pan range per axis is [view-size, 0].
    assert.deepEqual(clampPan({ x: 100, y: 100 }, 2, content, { w: 400, h: 400 }), { x: 0, y: 0 });
    assert.deepEqual(clampPan({ x: -9999, y: -9999 }, 2, content, { w: 400, h: 400 }), { x: -1200, y: -800 });
  });

  test('a pan already within range is left unchanged', () => {
    assert.deepEqual(clampPan({ x: -300, y: -200 }, 2, content, { w: 400, h: 400 }), { x: -300, y: -200 });
  });

  test('mixed: one axis overflows and is clamped, the other fits and is centred', () => {
    // 800x600 at 1 → 800x600. Viewport 500 wide (width overflows), 800 tall (height fits).
    const p = clampPan({ x: -1000, y: 42 }, 1, content, { w: 500, h: 800 });
    assert.equal(p.x, -300); // clamped to view.w - size = 500 - 800
    assert.equal(p.y, 100); // centred: (800 - 600) / 2
  });
});
