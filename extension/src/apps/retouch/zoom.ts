// Pure zoom + pan maths for Retouch's viewer (#652, #1124). Kept out of index.ts for the
// same reason crop.ts is: the anchoring rule — keep the image point under the cursor fixed
// across a zoom — and the pan clamps are the parts that are easy to get subtly wrong, and a
// pure function is the part that can be tested without a canvas.

/** The discrete stops the -/+ buttons walk through, ascending. */
export const ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

// Derived from the stops, never restated — the range and the stops cannot drift apart.
export const MIN_ZOOM: number = ZOOM_STEPS[0]!;
export const MAX_ZOOM: number = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/**
 * The next stop above (`dir` 1) or below (`dir` -1) the scale currently on screen — the rule
 * the -/+ buttons follow. The pointer gesture is continuous (see `scaleByWheel`); the buttons
 * keep sensible stops.
 *
 * `current` may be a measured Fit scale (e.g. 0.38) rather than one of the stops, so this picks
 * the first stop strictly past it — that way the first click out of Fit lands on a sensible
 * neighbour instead of jumping to 100%. At either end it clamps, so repeated clicks settle
 * rather than wrap.
 */
export function nextZoom(current: number, dir: 1 | -1): number {
  const eps = 1e-3;
  const next =
    dir > 0 ? ZOOM_STEPS.find((z) => z > current + eps) : [...ZOOM_STEPS].reverse().find((z) => z < current - eps);
  return next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM);
}

/** Clamp an arbitrary zoom into the supported range. */
export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// ---- continuous, cursor-anchored zoom + pan (#1124) ----

/** A translate offset in viewport CSS px, with the transform origin at the viewport top-left. */
export interface Pan {
  x: number;
  y: number;
}
/** A point in viewport space — the cursor, or the viewport centre — in CSS px. */
export interface Point {
  x: number;
  y: number;
}
/** A size in CSS px. */
export interface Size {
  w: number;
  h: number;
}

/**
 * Normalise a wheel event's `deltaY` to pixels. Line- and page-mode wheels (`deltaMode` 1/2 —
 * some mice, older Firefox) report a handful of "lines" or "pages", not pixels, so a raw delta
 * would make those devices zoom at a crawl. 16px per line and one viewport per page mirror the
 * browser's own scroll heuristics.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number, viewportH: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * (viewportH || 800);
  return deltaY;
}

/**
 * The multiplicative factor for one wheel step. Exponential in the delta so the *perceived*
 * zoom rate is constant — each pixel of scroll multiplies the scale by the same ratio — and
 * clamped per event so one violent trackpad flick can't leap the whole range in a single frame.
 */
export function zoomFactor(deltaYpx: number): number {
  const SENSITIVITY = 0.0015;
  const f = Math.exp(-deltaYpx * SENSITIVITY);
  return Math.min(4, Math.max(0.25, f));
}

/** Apply one wheel step to a scale, clamped to the supported range. */
export function scaleByWheel(scale: number, deltaYpx: number): number {
  return clampZoom(scale * zoomFactor(deltaYpx));
}

/**
 * Cursor-anchored pan: the new translate that keeps the image point currently under `at` still
 * under `at` after the scale changes from `scale` to `nextScale`. This is the core of #1124 —
 * without it, zooming in appears to cut the image because the focal point scrolls away.
 *
 * The image point under the cursor is `(at - pan) / scale`; we want it to satisfy
 * `at = newPan + point * nextScale` after the zoom, so
 *   newPan = at - (at - pan) * (nextScale / scale).
 */
export function anchorPan(pan: Pan, scale: number, nextScale: number, at: Point): Pan {
  const r = scale > 0 ? nextScale / scale : 1;
  return { x: at.x - (at.x - pan.x) * r, y: at.y - (at.y - pan.y) * r };
}

/**
 * Keep the scaled image reachable: an axis whose scaled size fits the viewport is centred; a
 * larger one is clamped so neither edge can be dragged inside the viewport (the image always
 * covers it). Pure — content and viewport sizes in, a clamped pan out.
 */
export function clampPan(pan: Pan, scale: number, content: Size, view: Size): Pan {
  return {
    x: clampAxis(pan.x, content.w * scale, view.w),
    y: clampAxis(pan.y, content.h * scale, view.h),
  };
}

function clampAxis(p: number, size: number, view: number): number {
  if (size <= view) return (view - size) / 2; // fits → centre it
  return Math.min(0, Math.max(view - size, p)); // overflows → keep both edges outside the viewport
}
