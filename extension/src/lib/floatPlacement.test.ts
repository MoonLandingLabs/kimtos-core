// floatPlacement (#308): keep Grammit Anywhere's panel on-screen — flip vertically, clamp
// horizontally. Pure geometry, so every edge case is a plain assertion.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { floatPlacement } from './floatPlacement.js';

const VIEW = { width: 1000, height: 800 };
const PANEL = { width: 300, height: 200 };

describe('floatPlacement', () => {
  test('opens below the field when there is room, aligned to its left', () => {
    const p = floatPlacement({ left: 100, top: 300, bottom: 320 }, PANEL, VIEW);
    assert.equal(p.placement, 'below');
    assert.equal(p.left, 100);
    assert.equal(p.top, 326); // bottom(320) + gap(6)
  });

  test('flips above the field when there is no room below', () => {
    const p = floatPlacement({ left: 100, top: 700, bottom: 750 }, PANEL, VIEW);
    assert.equal(p.placement, 'above');
    assert.equal(p.top, 494); // top(700) - gap(6) - height(200)
  });

  test('clamps to the right edge so the panel never spills off-screen', () => {
    const p = floatPlacement({ left: 900, top: 300, bottom: 320 }, PANEL, VIEW);
    // left is pulled in so left + width stays within viewport - margin.
    assert.equal(p.left, VIEW.width - 8 - PANEL.width); // 692
    assert.ok(p.left + PANEL.width <= VIEW.width - 8);
  });

  test('clamps to the left edge', () => {
    const p = floatPlacement({ left: 2, top: 300, bottom: 320 }, PANEL, VIEW);
    assert.equal(p.left, 8); // margin
  });

  test('a panel wider than the viewport starts at the margin, not off the left', () => {
    const p = floatPlacement(
      { left: 50, top: 300, bottom: 320 },
      { width: 300, height: 200 },
      { width: 200, height: 800 },
    );
    assert.equal(p.left, 8);
  });

  test('when it fits neither above nor below, it stays on-screen', () => {
    const tiny = { width: 1000, height: 250 };
    const p = floatPlacement({ left: 100, top: 100, bottom: 140 }, PANEL, tiny);
    assert.ok(p.top >= 8, 'not clipped at the top');
    assert.ok(p.top + PANEL.height <= tiny.height, 'not clipped at the bottom');
  });
});
