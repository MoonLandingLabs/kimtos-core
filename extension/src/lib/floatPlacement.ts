// Where to put a floating panel anchored to a field, so it stays fully on-screen.
//
// Grammit Anywhere's suggestions panel used to anchor at `field.left` and open upward from the
// field's bottom with no bounds check, so near the right edge it spilled off-screen and near the
// top it was clipped (#308). This is the pure geometry — no DOM — so it can be unit-tested:
//
//   - Horizontal: align to the field's left, then CLAMP so the panel never crosses either edge.
//   - Vertical: prefer BELOW the field (a normal dropdown); if it doesn't fit, FLIP above; if it
//     fits neither (a panel taller than the space on both sides), clamp it on-screen.
//
// All values are viewport coordinates (as from getBoundingClientRect); the caller adds any scroll
// offset. `margin` keeps a small gap from the viewport edge; `gap` is the space to the field.

export interface Anchor {
  left: number;
  top: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Which way it opened, for the caller to style a caret/shadow if it wants. */
  placement: 'below' | 'above';
}

export function floatPlacement(
  anchor: Anchor,
  panel: Size,
  viewport: Size,
  { gap = 6, margin = 8 }: { gap?: number; margin?: number } = {},
): Placement {
  // Horizontal: start at the field's left edge, then keep the whole panel on-screen. Clamp the
  // right side first, then the left, so a panel wider than the viewport still starts at `margin`
  // rather than being pushed off the left.
  let left = anchor.left;
  left = Math.min(left, viewport.width - margin - panel.width);
  left = Math.max(margin, left);

  // Vertical: below is the default; flip above when below would overflow the bottom and there is
  // room above; otherwise clamp within the viewport.
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - gap - panel.height;
  const fitsBelow = belowTop + panel.height <= viewport.height - margin;
  const fitsAbove = aboveTop >= margin;

  let top: number;
  let placement: 'below' | 'above';
  if (fitsBelow) {
    top = belowTop;
    placement = 'below';
  } else if (fitsAbove) {
    top = aboveTop;
    placement = 'above';
  } else {
    // Neither side fits fully — keep it on-screen, preferring to align near the field.
    top = Math.max(margin, Math.min(belowTop, viewport.height - margin - panel.height));
    placement = belowTop <= aboveTop ? 'below' : 'above';
  }

  return { left, top, placement };
}
