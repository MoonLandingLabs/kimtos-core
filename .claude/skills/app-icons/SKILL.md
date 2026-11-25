---
name: app-icons
description: >-
  The kimtos app icon system — one shared set of inline-SVG line glyphs on
  accent-gradient squircle tiles, used identically by the extension dock/App
  Store and the marketing site. Use whenever adding an app icon, changing a
  glyph, giving a new app its tile, debugging why an app shows a letter monogram
  instead of an icon, or touching anything in @kimtos/icons. Covers the glyph
  design rules, where every piece lives, the exact edit + rebuild, and how both
  surfaces render it. Trigger on: "app icon", "icon", "glyph", "tile",
  "@kimtos/icons", "monogram", "APP_GLYPHS", "appGlyphSvg", "paintAppTile".
---

# kimtos — app icon system

Every app's icon is an inline **SVG line-mark on a squircle tile built from the
app's own accent color**. No image files, no Twemoji, nothing fetched — it must
work offline (the extension is offline-first) and read on any wallpaper, light or
dark. One shared set powers **both** the extension and the marketing site.

## Single source of truth

`shared-modules/icons/src/glyphs.ts` (the `@kimtos/icons` package):

- `type AppId` — the union of every app id that has a glyph.
- `const APP_GLYPHS: Record<AppId, string>` — app **id** → the inner SVG markup of
  a **24×24** glyph.
- `glyphFor(id)` / `hasAppIcon(id)` — lookups (return `undefined` when absent).

Helpers in `shared-modules/icons/src/index.ts`:

- `appTileGradient(accent)` — the Big-Sur-style gradient CSS for a tile.
- `appGlyphSvg(id, className?)` — the full `<svg>…</svg>` for an id.
- `paintAppTile(tileEl, app)` — paints gradient + glyph onto a DOM element
  (returns `false` if the app has no glyph, so the caller falls back to a monogram).

## Glyph design rules (match the existing set)

- Grid: **`viewBox="0 0 24 24"`**. The stored value is the **inner markup only**
  (`<path>`/`<rect>`/`<circle>`), not the outer `<svg>`.
- Draw with **`currentColor`** — never hardcode a color. That's what lets the same
  glyph render white-on-gradient in the dock and accent-on-glass elsewhere.
- Stroke style: `fill="none"`, `stroke-width` ≈ **1.9** (a hair thicker for very
  sparse marks), **round** `stroke-linecap`/`stroke-linejoin`. A filled glyph (e.g.
  `kimtai`'s sparkle) uses `fill="currentColor"` with no stroke — rare, deliberate.
- One clean line mark that reads at 16px (favicon) through 128px (store listing).
- Keep it centered with a little breathing room (marks roughly span x/y 3–21).

## Rendering — both surfaces use the SAME glyph

- **Extension** — `components/appIcon.ts` re-exports the `@kimtos/icons` helpers;
  `paintAppTile()` draws the tile in the dock (`views/appDock.ts`), the App Store
  (`views/appStore.ts`, `components/appDetail.ts`), and onboarding. The accent comes
  from the app descriptor / `meta.ts`. If `paintAppTile` returns `false`, a letter
  **monogram** (`lib/format.ts`) is shown — the graceful fallback.
- **Marketing site** — `www/components/AppGrid.vue` uses `appTileGradient(a.c)` +
  `appGlyphSvg(a.id)` for the identical tiles. (This replaced the old
  `assets/icons/*.png` Twemoji + their CC-BY credit — do not reintroduce image
  files.)

## To add / change an app's icon

1. Add (or edit) the entry in `APP_GLYPHS` keyed by the app **id** (must equal the
   `meta.ts` `id` / folder name — the tile is looked up by id).
2. Add the id to the `AppId` union (new apps).
3. **Rebuild the package:** `npm run build -w @kimtos/icons` (both the extension
   and the site consume its built `dist`). Skipping this leaves a stale glyph and
   the tile falls back to a monogram.
4. Verify: `npm run build -w @kimtos/extension` and `npm run typecheck -w @kimtos/www`.

Renaming an app id? The glyph key is one of the reference sites — see the
`app-rename` skill.

## Common gotcha

An app shows a **letter monogram** instead of its icon ⇒ no `APP_GLYPHS[id]` (id
mismatch, or `@kimtos/icons` not rebuilt after the edit). Check the id matches
`meta.ts` exactly and rebuild the package.
