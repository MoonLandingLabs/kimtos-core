// Pure crop-coordinate math for Retouch, split out of index.ts so it can be tested
// without a DOM.
//
// The bug this guards (#615): the crop overlay is an absolutely-positioned child of
// the SCROLLABLE canvas wrap, so its left/top live in the wrap's scroll-content
// space (they move with scrollTop). The pointer math must live in that same space —
// otherwise, once a maximized window makes the centered canvas overflow and scroll,
// the drawn selection and the applied crop diverge by scrollTop and the crop lands on
// the wrong region. Everything here works in scroll-content pixels, which already
// absorb the scroll, so the mapping is scroll-invariant by construction.

/** A selection rectangle, in the wrap's scroll-content pixels. */
export interface Sel {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The canvas as laid out: its top-left in scroll-content space, its displayed (CSS)
 *  size, and its intrinsic pixel size. */
export interface CanvasGeom {
  left: number;
  top: number;
  dispW: number;
  dispH: number;
  pixW: number;
  pixH: number;
}

/** Map a content-space selection to integer canvas pixels, clamped to the image. X
 *  and Y scale independently so a non-uniform display size can't skew one axis. */
export function selToPixels(sel: Sel, g: CanvasGeom): { x: number; y: number; w: number; h: number } {
  const sx = g.dispW ? g.pixW / g.dispW : 1;
  const sy = g.dispH ? g.pixH / g.dispH : 1;
  const x = Math.min(Math.max(0, Math.round((sel.x - g.left) * sx)), g.pixW);
  const y = Math.min(Math.max(0, Math.round((sel.y - g.top) * sy)), g.pixH);
  const w = Math.min(g.pixW - x, Math.max(0, Math.round(sel.w * sx)));
  const h = Math.min(g.pixH - y, Math.max(0, Math.round(sel.h * sy)));
  return { x, y, w, h };
}

/** Clamp a content-space point to the canvas box, so a drag can't select outside the
 *  image (the box stays on the picture). */
export function clampToCanvas(px: number, py: number, g: CanvasGeom): { x: number; y: number } {
  return {
    x: Math.min(Math.max(px, g.left), g.left + g.dispW),
    y: Math.min(Math.max(py, g.top), g.top + g.dispH),
  };
}

// --- Real crop editor (#617) ---------------------------------------------------
// The selection is stored canonically in IMAGE pixels (`PixelRect`), so it survives a
// window resize / maximize: we re-project it to content space each paint. The handle
// math below runs in content space (1:1 with the cursor) and the caller maps the result
// back to pixels with `selToPixels`. Because `.rt-canvas` is `object-fit: contain` with
// no explicit size, its display scale is uniform on both axes, so a content-space aspect
// ratio equals the pixel aspect ratio — which is why the ratio lock can be computed here.

/** A crop rectangle in image pixels — the canonical selection state. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The eight resize grips plus the move region (drag the box interior). */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

/** The canvas edges in content space — the box may not cross these. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const edges = (s: Sel): { l: number; t: number; r: number; b: number } => ({
  l: s.x,
  t: s.y,
  r: s.x + s.w,
  b: s.y + s.h,
});
const fromEdges = (l: number, t: number, r: number, b: number): Sel => ({ x: l, y: t, w: r - l, h: b - t });

/** The canvas box as content-space bounds. */
export function boundsOf(g: CanvasGeom): Bounds {
  return { left: g.left, top: g.top, right: g.left + g.dispW, bottom: g.top + g.dispH };
}

/** The whole image, as a pixel rect (the default selection when crop mode opens). */
export function fullImagePx(g: CanvasGeom): PixelRect {
  return { x: 0, y: 0, w: g.pixW, h: g.pixH };
}

/** Project an image-pixel rect to a content-space selection — the inverse of
 *  `selToPixels`, used to paint the overlay and to reflect numeric-field edits. */
export function pixelsToSel(px: PixelRect, g: CanvasGeom): Sel {
  const sx = g.pixW ? g.dispW / g.pixW : 1;
  const sy = g.pixH ? g.dispH / g.pixH : 1;
  return { x: g.left + px.x * sx, y: g.top + px.y * sy, w: px.w * sx, h: px.h * sy };
}

/** Resolve a handle/move drag into a new content-space selection, clamped to the canvas
 *  and never smaller than `min`. A locked `aspect` (w/h) is honoured for corner grips;
 *  edge grips resize a single side (the caller disables them while a ratio is locked). */
export function resizeSel(
  start: Sel,
  handle: Handle,
  dx: number,
  dy: number,
  b: Bounds,
  opts: { aspect?: number; min?: number } = {},
): Sel {
  const min = opts.min ?? 8;
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 0;

  if (handle === 'move') {
    const w = Math.min(start.w, b.right - b.left);
    const h = Math.min(start.h, b.bottom - b.top);
    return { x: clamp(start.x + dx, b.left, b.right - w), y: clamp(start.y + dy, b.top, b.bottom - h), w, h };
  }

  const movesL = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesR = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesT = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesB = handle === 'sw' || handle === 's' || handle === 'se';
  const isCorner = (movesL || movesR) && (movesT || movesB);

  let { l, t, r, b: bo } = edges(start);
  if (movesL) l = clamp(l + dx, b.left, r - min);
  if (movesR) r = clamp(r + dx, l + min, b.right);
  if (movesT) t = clamp(t + dy, b.top, bo - min);
  if (movesB) bo = clamp(bo + dy, t + min, b.bottom);

  if (!aspect || !isCorner) return fromEdges(l, t, r, bo);

  // Ratio-locked corner: anchor the opposite corner, size from the larger drag axis,
  // then shrink to fit both the bounds and the ratio.
  const anchorX = movesL ? r : l;
  const anchorY = movesT ? bo : t;
  const availW = movesR ? b.right - anchorX : anchorX - b.left;
  const availH = movesB ? b.bottom - anchorY : anchorY - b.top;

  let w = Math.max(Math.abs((movesL ? l : r) - anchorX), Math.abs((movesT ? t : bo) - anchorY) * aspect);
  let h = w / aspect;
  const fit = Math.min(1, w ? availW / w : 1, h ? availH / h : 1);
  w = Math.max(w * fit, min, min * aspect);
  h = w / aspect;

  const nl = movesL ? anchorX - w : anchorX;
  const nr = movesL ? anchorX : anchorX + w;
  const nt = movesT ? anchorY - h : anchorY;
  const nb = movesT ? anchorY : anchorY + h;
  return fromEdges(nl, nt, nr, nb);
}

/** Refit a pixel rect to a target `ratio` (w/h), keeping its centre and clamping to the
 *  image — the aspect-preset action. */
export function applyAspectPx(px: PixelRect, ratio: number, dims: { pixW: number; pixH: number }): PixelRect {
  const cx = px.x + px.w / 2;
  const cy = px.y + px.h / 2;
  let w = px.w;
  let h = w / ratio;
  const maxW = Math.min(cx, dims.pixW - cx) * 2;
  const maxH = Math.min(cy, dims.pixH - cy) * 2;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  const x = clamp(Math.round(cx - w / 2), 0, dims.pixW);
  const y = clamp(Math.round(cy - h / 2), 0, dims.pixH);
  return { x, y, w: Math.min(Math.round(w), dims.pixW - x), h: Math.min(Math.round(h), dims.pixH - y) };
}
