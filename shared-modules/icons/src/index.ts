// @kimtos/icons — the shared app-icon system, used by both the extension
// (extension/) and the marketing site (www/). Dependency-free: it owns the glyphs
// (glyphs.ts), the accent→gradient formula, and the small helpers each consumer
// needs — string builders for markup, plus a DOM helper.
//
// A "vivid" app icon is a squircle tile filled with a gradient derived from the
// app's accent (lighter top → accent → a touch darker base, the Big Sur read),
// with the app's white glyph on top. Inline SVG only — nothing is fetched.

import { APP_GLYPHS, glyphFor, type AppId } from './glyphs.js';
import { FILE_GLYPHS, fileGlyphFor, type FileKind } from './fileGlyphs.js';

export { APP_GLYPHS, glyphFor, type AppId };
export { FILE_GLYPHS, fileGlyphFor, type FileKind };

/** The minimum an app needs to render its icon. */
export interface IconApp {
  id: string;
  accent?: string;
}

type RGB = [number, number, number];

const rgb = (hex: string): RGB => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return [r ?? 0, g ?? 0, b ?? 0];
};
const hex2 = (c: number): string =>
  Math.max(0, Math.min(255, Math.round(c)))
    .toString(16)
    .padStart(2, '0');
const mix = (a: string, b: string, t: number): string => {
  const x = rgb(a);
  const y = rgb(b);
  return `#${hex2(x[0] + (y[0] - x[0]) * t)}${hex2(x[1] + (y[1] - x[1]) * t)}${hex2(x[2] + (y[2] - x[2]) * t)}`;
};

/** Whether we have a glyph for this app id (callers fall back to a monogram). */
export const hasAppIcon = (id: string): boolean => glyphFor(id) !== undefined;

// THE TILE CARRIES A WHITE GLYPH, SO THE TILE IS WHAT HAS TO BE DARK ENOUGH.
//
// The tile is one shape with one ink: a squircle of accent with the app's glyph in white.
// That ink is white on the marketing site and, until #151, near-black in the extension --
// the same tile, drawn two ways, because each surface picked its own ink. And the site's
// white glyph was not even legible: Grammit's green tile reads 1.74:1 against white.
//
// One tile, one rule: the glyph is ALWAYS white, and the accent is darkened just enough to
// carry it. A glyph is a graphical object, so the bar is 3:1 (WCAG 1.4.11), not 4.5:1.
//
// The bar applies to the LIGHTEST part of the tile, not the accent -- the gradient's top
// stop lifts toward white, and a glyph crosses it. That highlight is therefore expensive:
// at the old 42% it cost 62% darkening on the worst accent (a near-black tile). At 18% it
// costs at most 35% and the tile still reads as its colour, so the highlight is 18% now.
const TILE_HIGHLIGHT = 0.18;
const TILE_SHADOW = 0.14;

const luminance = (color: string): number => {
  const [r, g, b] = rgb(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contrast of white against `color` (WCAG). */
const onWhite = (color: string): number => 1.05 / (luminance(color) + 0.05);

/**
 * The accent, darkened just enough that WHITE on it clears `min`. Returned untouched when
 * it already does (the dark accents -- Thoth, DevTools -- never move).
 *
 * This lives HERE, not in the extension, because the extension is not the only surface that
 * paints an accent: the marketing site and the docs draw the same tiles from this package.
 * When the ink rule lived in two places they disagreed, and the tile was white-glyphed on
 * the site and black-glyphed in the app (#151). One rule, one home.
 *
 *   4.5  white TEXT on it   (WCAG 1.4.3)
 *   3    white GLYPH on it  (WCAG 1.4.11 -- a glyph is a graphic, not text)
 */
export function groundFor(accent: string, min: number): string {
  // An accent we cannot parse is not an accent we may guess at: hand it back untouched
  // rather than silently paint some derived black.
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent.trim())) return accent;
  for (let k = 0; k <= 100; k++) {
    const ground = mix(accent, '#000000', k / 100);
    if (onWhite(ground) >= min) return ground;
  }
  return '#000000'; // unreachable: white on black is 21:1
}

/**
 * The accent, darkened until the tile's LIGHTEST stop still carries a white glyph at 3:1.
 * The bar is the highlight, not the accent -- the glyph crosses it.
 */
export function tileBase(accent: string): string {
  for (let k = 0; k <= 100; k++) {
    const base = mix(accent, '#000000', k / 100);
    if (onWhite(mix(base, '#ffffff', TILE_HIGHLIGHT)) >= 3) return base;
  }
  return '#000000';
}

/** The tile fill for an accent, as a CSS `background` value. */
export function appTileGradient(accent: string): string {
  const base = tileBase(accent);
  return `linear-gradient(165deg, ${mix(base, '#ffffff', TILE_HIGHLIGHT)}, ${base} 52%, ${mix(base, '#000000', TILE_SHADOW)})`;
}

/**
 * The app's glyph as a ready-to-inject `<svg>` string (empty when unknown). The
 * default stroke matches the UI icon set; shapes in glyphs.ts may override it.
 */
export function appGlyphSvg(id: string, className = 'app-glyph'): string {
  const g = glyphFor(id);
  if (g === undefined) return '';
  return (
    `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g}</svg>`
  );
}

/**
 * A FILE-TYPE glyph as a ready-to-inject `<svg>` string — same line-mark conventions as
 * `appGlyphSvg`, but background-less: it inherits the surrounding text colour rather than
 * sitting on an accent tile (that is the whole difference between the two sets — see
 * fileGlyphs.ts).
 *
 * Takes a `FileKind`, so a caller passing the viewer's `ViewKind` only compiles while every
 * kind it can detect has a glyph here. A kind we somehow do not know still renders the
 * `binary` sheet rather than nothing — a listing row must never be iconless.
 */
export function fileGlyphSvg(kind: FileKind, className = 'file-glyph'): string {
  const g = fileGlyphFor(kind) ?? FILE_GLYPHS.binary;
  return (
    `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g}</svg>`
  );
}

/**
 * A complete, standalone app-icon TILE as an `<svg>` string — the app's accent
 * gradient (matches `appTileGradient`) with its white glyph on top. Unlike
 * `appGlyphSvg` + a CSS tile, this bakes the gradient + white into the SVG, so it
 * drops straight into an `<img>`, an og-image, an email, or a `data:` URI where
 * there's no CSS/`currentColor` context. Empty string when the app has no glyph.
 */
export function appTileSvg(id: string, accent = '#3b82f6', size = 128): string {
  const g = glyphFor(id);
  if (g === undefined) return '';
  const gid = `at-${id}`;
  const scale = 58 / 24; // the glyph fills 58% of the 100-unit tile (like the CSS tiles)
  const off = (100 - 58) / 2;
  // Same ground as appTileGradient -- the SVG tile and the CSS tile are the same tile.
  const base = tileBase(accent);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-hidden="true">` +
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${mix(base, '#ffffff', TILE_HIGHLIGHT)}"/>` +
    `<stop offset="0.52" stop-color="${base}"/>` +
    `<stop offset="1" stop-color="${mix(base, '#000000', TILE_SHADOW)}"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="100" rx="23" ry="23" fill="url(#${gid})"/>` +
    `<g transform="translate(${off} ${off}) scale(${scale})" style="color:#fff" fill="none" ` +
    `stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${g}</g>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// The kimtos brand mark — "Roof & dock": a roof over three dock tiles (a home
// page with your apps beneath it). Unlike the single-accent app tiles, the brand
// tile carries a multi-stop indigo→teal gradient, so the family reads as "one
// home, many apps". It's a self-contained <svg> (nav logo + favicon source), and
// the same source the manifest PNGs are rasterised from.
// ---------------------------------------------------------------------------

/** Brand gradient stops, light → mid → deep (indigo → teal). */
export const BRAND_GRADIENT_STOPS = ['#8aa2ff', '#5b6cff', '#18b6a4'] as const;

/** The brand tile fill as a CSS `background` value (matches the SVG gradient). */
export const brandTileGradient = (): string =>
  `linear-gradient(150deg, ${BRAND_GRADIENT_STOPS[0]} 0%, ${BRAND_GRADIENT_STOPS[1]} 46%, ${BRAND_GRADIENT_STOPS[2]} 100%)`;

// Roof + three dock tiles, white, on a 100×100 grid.
const BRAND_GLYPH =
  '<path d="M18 48 L50 23 L82 48" fill="none" stroke="#fff" stroke-width="8.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/>' +
  '<g fill="#fff">' +
  '<rect x="26" y="58" width="14" height="15" rx="4.2"/>' +
  '<rect x="43" y="58" width="14" height="15" rx="4.2"/>' +
  '<rect x="60" y="58" width="14" height="15" rx="4.2"/>' +
  '</g>';

/**
 * The kimtos mark as a complete, standalone `<svg>` string at `size` px — a
 * squircle tile with the brand gradient and the white roof-and-dock glyph.
 * Self-contained (inline gradient, no external refs), so it drops straight into
 * the site nav / a favicon and rasterises cleanly to the manifest PNGs.
 */
export function brandMarkSvg(size = 128): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 100 100" role="img" aria-label="kimtos">` +
    `<defs><linearGradient id="dh-brand" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${BRAND_GRADIENT_STOPS[0]}"/>` +
    `<stop offset="0.46" stop-color="${BRAND_GRADIENT_STOPS[1]}"/>` +
    `<stop offset="1" stop-color="${BRAND_GRADIENT_STOPS[2]}"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="100" rx="23" ry="23" fill="url(#dh-brand)"/>` +
    BRAND_GLYPH +
    `</svg>`
  );
}

/**
 * DOM helper for the extension: turn a plain square tile element into the app's
 * icon — paint the accent gradient and drop the white glyph in front. Returns
 * false (leaving the tile untouched) when the app has no glyph, so callers can
 * fall back to a monogram.
 */
export function paintAppTile(tile: HTMLElement, app: IconApp): boolean {
  if (!hasAppIcon(app.id)) return false;
  tile.classList.add('has-app-icon');
  tile.style.background = appTileGradient(app.accent ?? '#3b82f6');
  // Not user input: appGlyphSvg only ever returns a hardcoded glyph string from the
  // APP_GLYPHS table in glyphs.ts, and the hasAppIcon guard above means we never get
  // here for an id that has no entry. There is no path by which caller-supplied text
  // reaches this markup, so there is nothing for a sanitizer to do. The suppression
  // has to sit on the line directly above the call — semgrep ignores it otherwise.
  // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method
  tile.insertAdjacentHTML('afterbegin', appGlyphSvg(app.id));
  return true;
}
