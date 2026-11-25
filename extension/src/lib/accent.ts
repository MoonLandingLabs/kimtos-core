// THE INK IS NOT THE VARIABLE. THE GROUND IS.
//
// Applying an accent means applying the colour AND the surfaces that have to carry ink on
// it. Get that pair wrong and it is visible on every button in the product — twice now:
//
//   before #129  --on-accent was a fixed white. Measured, white fails WCAG AA on ALL
//                nineteen accents (Grammit 1.74:1, Denoise 1.81, the brand blue 3.68).
//                Half the palette is light; white ink on it was simply illegible.
//
//   #129         so the ink was derived from the accent's luminance instead: white on a
//                dark accent, near-black on a light one. Sound reasoning, wrong end of the
//                pair — fifteen of nineteen accents are light, so buttons and app-tile
//                glyphs came out BLACK, in BOTH themes (a luminance test does not know
//                what theme it is in). That is #151, and it looked broken.
//
// Both inks are bad because the question was wrong. Ink and ground are a PAIR that must
// clear a contrast bar together, and the ground is the one with room to move. So: the ink
// is WHITE, always, in both themes — and a solid accent surface is the accent DARKENED just
// enough to carry it.
//
//   --accent           the true brand colour. NEVER darkened. Borders, tints, washes, text.
//   --on-accent        white. Always.
//   --accent-solid     white TEXT on it   >= 4.5:1  (WCAG 1.4.3)    at most 40% darker
//   --accent-solid-ui  white GLYPH on it  >= 3:1    (WCAG 1.4.11)   at most 25% darker
//
// The darkening itself lives in @kimtos/icons, which paints the same accents on the
// marketing site and the docs. When that rule lived in two places the two disagreed, and
// the same app tile shipped white-glyphed on the site and black-glyphed in the app.
import { groundFor } from '@kimtos/icons';

/** The brand accent, for a surface with no per-app colour. Mirrors --accent in base.css. */
export const DEFAULT_ACCENT = '#2563eb';

const WHITE = '#ffffff';

/** Ground for a solid accent surface carrying white TEXT (WCAG 1.4.3, 4.5:1). */
export const solidFor = (accent: string): string => groundFor(accent, 4.5);

/** Ground for a solid accent surface carrying a white GLYPH or icon (WCAG 1.4.11, 3:1). */
export const solidUiFor = (accent: string): string => groundFor(accent, 3);

/**
 * Set an element's accent AND everything derived from it. Use this, never `--accent` alone
 * — the whole point is that the accent and the surfaces carrying ink on it cannot drift
 * apart, which is what happened when 14 call sites each set `--accent` by hand.
 */
export function setAccent(el: HTMLElement, accent: string | undefined | null): void {
  if (!accent) return;
  el.style.setProperty('--accent', accent);
  el.style.setProperty('--on-accent', WHITE);
  el.style.setProperty('--accent-solid', solidFor(accent));
  el.style.setProperty('--accent-solid-ui', solidUiFor(accent));
}
