// Thin seam over the shared icon system (@kimtos/icons, at repo root
// shared-modules/icons) so the rest of the extension imports app icons from a local,
// stable path. The glyphs + gradient live in the shared module; the tile's gloss
// and glyph sizing live in styles/shell.css (.has-app-icon / .app-glyph).
export { paintAppTile, appTileGradient, appGlyphSvg, hasAppIcon, brandMarkSvg } from '@kimtos/icons';
