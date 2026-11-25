// The camera bubble's geometry — the part of the compositor a user can see and now
// change while the clip is running (#1246).
//
// `draw()` needs a live canvas, so the arithmetic it depends on lives in two pure
// functions instead, and these are the tests `mixer.ts` never had. What they pin:
// the bubble lands in the corner asked for, a square one keeps the camera's aspect,
// a circular one is a TRUE circle (square box, clip radius = half its width), and
// the cover crop is what stops that circle squashing a 16:9 face into an oval.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bubbleRect, coverCrop, BUBBLE_DEFAULTS, CAM_CORNERS, type BubbleStyle } from './mixer.js';

const FRAME_W = 1280;
const FRAME_H = 720;
const CAM_W = 640;
const CAM_H = 360; // 16:9, like the frame
const MARGIN = Math.round(FRAME_W * 0.022); // 28

const style = (patch: Partial<BubbleStyle> = {}): BubbleStyle => ({
  corner: BUBBLE_DEFAULTS.corner,
  shape: BUBBLE_DEFAULTS.shape,
  size: BUBBLE_DEFAULTS.size,
  ...patch,
});
const rect = (patch: Partial<BubbleStyle> = {}, camW = CAM_W, camH = CAM_H) =>
  bubbleRect(FRAME_W, FRAME_H, camW, camH, style(patch));

describe('bubbleRect — corner arithmetic', () => {
  test('each corner is inset from its own two edges by the same margin', () => {
    const { w, h } = rect();
    const expected: Record<string, { x: number; y: number }> = {
      br: { x: FRAME_W - w - MARGIN, y: FRAME_H - h - MARGIN },
      bl: { x: MARGIN, y: FRAME_H - h - MARGIN },
      tr: { x: FRAME_W - w - MARGIN, y: MARGIN },
      tl: { x: MARGIN, y: MARGIN },
    };
    for (const corner of CAM_CORNERS) {
      const r = rect({ corner });
      assert.equal(r.x, expected[corner].x, `${corner} x`);
      assert.equal(r.y, expected[corner].y, `${corner} y`);
    }
  });

  test('the four corners are four DIFFERENT boxes', () => {
    const seen = new Set(CAM_CORNERS.map((corner) => `${rect({ corner }).x},${rect({ corner }).y}`));
    assert.equal(seen.size, CAM_CORNERS.length);
  });

  // Including the shape a portrait webcam takes: at the largest size a 9:16 camera
  // is taller than a 16:9 frame, so the box has to be clamped or it hangs off an
  // edge. The degenerate entries are here because the first clamp only held for
  // plausible aspects — rounding the clamped width back up re-inflated the height
  // past the bound, and a steep enough aspect has no integer width that fits at all.
  test('the bubble always sits inside the frame, whatever the camera aspect', () => {
    const cameras: [number, number][] = [
      [640, 360], // 16:9
      [640, 480], // 4:3
      [720, 1280], // portrait 9:16
      [480, 1920], // absurdly tall
      [1, 360], // degenerate: a sliver, steeper than the frame
      [4000, 1], // degenerate: a hairline, flatter than the frame
      [1, 4000], // degenerate: no integer width keeps this aspect in frame
      [0, 0], // not reported yet
    ];
    for (const corner of CAM_CORNERS) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        for (const shape of ['square', 'circle'] as const) {
          for (const [camW, camH] of cameras) {
            const at = `${corner}/${size}/${shape}/${camW}x${camH}`;
            const r = rect({ corner, size, shape }, camW, camH);
            // The margin is kept on BOTH edges, so a clamped bubble never ends up
            // flush against the edge opposite the corner it is pinned to.
            assert.ok(r.w > 0 && r.h > 0, `${at} has no area`);
            assert.ok(r.x >= MARGIN && r.y >= MARGIN, `${at} loses its top-left margin`);
            assert.ok(r.x + r.w <= FRAME_W - MARGIN, `${at} loses its right margin`);
            assert.ok(r.y + r.h <= FRAME_H - MARGIN, `${at} loses its bottom margin`);
            assert.ok(r.r <= Math.min(r.w, r.h) / 2, `${at} rounds its corners more than its own size`);
          }
        }
      }
    }
  });

  test('a portrait camera at the largest size is clamped, not stretched off the frame', () => {
    const r = rect({ size: 'lg', shape: 'square' }, 720, 1280);
    assert.ok(r.w < Math.round(FRAME_W * 0.32), 'the clamp narrowed the box');
    assert.ok(Math.abs(r.h / r.w - 1280 / 720) < 0.01, 'the camera aspect survived the clamp');
  });

  // The clamp divides the height budget by the aspect, and that quotient is almost
  // never a whole number of pixels. It has to round DOWN: rounding to nearest picks a
  // width one pixel wider, whose implied height is over the budget again and gets
  // truncated — so the box keeps its width but loses the aspect. 1000x1777 is a case
  // where the two disagree (664/1.777 = 373.66), pinned exactly.
  test('the clamp rounds the width down, so the height it implies still fits', () => {
    const r = rect({ size: 'lg', shape: 'square' }, 1000, 1777);
    assert.deepEqual({ w: r.w, h: r.h }, { w: 373, h: 663 });
    assert.ok(r.h <= FRAME_H - 2 * MARGIN, 'the implied height is inside the budget, not truncated to it');
  });

  // A circle's box is square, so a 16:9 frame can always fit one: at the largest size
  // it is 410 square, against a height budget of 664. It takes a SHORT frame to reach
  // the clamp at all — which is the only way to prove the clamp keeps it circular.
  test('a circle too tall for a short frame is clamped, and stays a circle', () => {
    const shortFrame = { w: 2000, h: 300 };
    const r = bubbleRect(shortFrame.w, shortFrame.h, CAM_W, CAM_H, style({ size: 'lg', shape: 'circle' }));
    assert.ok(r.w < Math.round(shortFrame.w * 0.32), 'the clamp narrowed the circle');
    assert.equal(r.w, r.h, 'a clamped circle is still square');
    assert.equal(r.r, r.w / 2, 'a clamped circle is still clipped to a circle');
    assert.ok(r.y >= 0 && r.y + r.h <= shortFrame.h, 'and it fits the short frame');
  });
});

describe('bubbleRect — size', () => {
  // Medium is deliberately the 24% bubble the app drew before it was resizable, so
  // an existing user's recordings do not change shape under them.
  test('the three sizes are 16%, 24% and 32% of the frame width', () => {
    assert.equal(rect({ size: 'sm' }).w, Math.round(FRAME_W * 0.16));
    assert.equal(rect({ size: 'md' }).w, Math.round(FRAME_W * 0.24));
    assert.equal(rect({ size: 'lg' }).w, Math.round(FRAME_W * 0.32));
  });

  test('an unrecognised stored size falls back to medium rather than a NaN box', () => {
    const r = bubbleRect(FRAME_W, FRAME_H, CAM_W, CAM_H, style({ size: 'huge' as never }));
    assert.equal(r.w, rect({ size: 'md' }).w);
    assert.ok(Number.isFinite(r.h));
  });
});

describe('bubbleRect — aspect', () => {
  test('a square bubble matches the camera aspect', () => {
    const r = rect({ shape: 'square' }, 1280, 720);
    assert.equal(r.h, Math.round(r.w * (720 / 1280)));
  });

  test('a 4:3 camera gives a taller square bubble than a 16:9 one', () => {
    const wide = rect({ shape: 'square' }, 1280, 720);
    const tall = rect({ shape: 'square' }, 640, 480);
    assert.equal(tall.h, Math.round(tall.w * (480 / 640)));
    assert.ok(tall.h > wide.h);
  });

  test('a camera that has not reported its size yet falls back to 16:9', () => {
    const r = rect({ shape: 'square' }, 0, 0);
    assert.equal(r.h, Math.round(r.w * 0.5625));
  });

  test('a circular bubble is square, so the camera aspect does not change it', () => {
    const wide = rect({ shape: 'circle' }, 1280, 720);
    const tall = rect({ shape: 'circle' }, 640, 480);
    assert.equal(wide.w, wide.h);
    assert.deepEqual(wide, tall);
  });

  // The clamp is driven by the BOX's aspect, not the camera's — a circle is square,
  // so a portrait camera must not shrink it. It only ever crops what is drawn in.
  test('a portrait camera does not shrink a circular bubble', () => {
    assert.deepEqual(
      rect({ shape: 'circle', size: 'lg' }, 720, 1280),
      rect({ shape: 'circle', size: 'lg' }, 1280, 720),
    );
  });
});

describe('bubbleRect — the clip radius', () => {
  test('a circle clips at half its width, which is a true circle', () => {
    const r = rect({ shape: 'circle' });
    assert.equal(r.r, r.w / 2);
    assert.equal(r.r, r.h / 2);
  });

  test('a square clips at a soft corner, not a circle and not a hard edge', () => {
    const r = rect({ shape: 'square' });
    assert.ok(r.r > 0, 'a square bubble still has rounded corners');
    assert.ok(r.r < r.w / 2, 'a square bubble is not clipped to a circle');
  });
});

describe('coverCrop', () => {
  test('a 16:9 camera in a square box is cropped to its centre square', () => {
    const c = coverCrop(1280, 720, 200, 200);
    assert.deepEqual(c, { sx: (1280 - 720) / 2, sy: 0, sw: 720, sh: 720 });
  });

  test('a matching aspect is not cropped at all', () => {
    assert.deepEqual(coverCrop(1280, 720, 640, 360), { sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  test('a 4:3 camera in a 16:9 frame is cropped top and bottom', () => {
    const c = coverCrop(640, 480, 1280, 720);
    assert.equal(c.sw, 640, 'the full width is used');
    assert.equal(c.sh, 360, 'the overhanging height is trimmed');
    assert.equal(c.sy, (480 - 360) / 2, 'the trim is centred');
  });

  test('the crop keeps the box aspect, so nothing is ever stretched', () => {
    for (const [srcW, srcH, dw, dh] of [
      [1280, 720, 200, 200],
      [640, 480, 300, 169],
      [1920, 1080, 410, 410],
      [800, 800, 400, 225],
    ]) {
      const c = coverCrop(srcW, srcH, dw, dh);
      assert.ok(Math.abs(c.sw / c.sh - dw / dh) < 1e-9, `${srcW}x${srcH} -> ${dw}x${dh}`);
      assert.ok(c.sw <= srcW && c.sh <= srcH, 'the crop stays inside the source');
      assert.ok(c.sx >= 0 && c.sy >= 0, 'the crop starts inside the source');
    }
  });

  // A camera that has not reported its size, or a box measured before layout, must
  // not put a NaN into drawImage: a zero destination makes the scale zero, and
  // 0 / 0 is what the guard exists to keep out.
  test('a degenerate camera or box yields a finite crop, not NaN', () => {
    for (const [srcW, srcH, dw, dh] of [
      [0, 0, 200, 200],
      [1280, 720, 0, 0],
      [1280, 720, 200, 0],
      [0, 720, 200, 200],
      [1280, 0, 200, 200],
    ]) {
      const c = coverCrop(srcW, srcH, dw, dh);
      for (const [name, v] of Object.entries(c)) {
        assert.ok(Number.isFinite(v), `${name} is ${v} for ${srcW}x${srcH} -> ${dw}x${dh}`);
        assert.ok(v >= 0, `${name} is negative for ${srcW}x${srcH} -> ${dw}x${dh}`);
      }
    }
  });
});
