# @kimtos/icons

The shared **app-icon system** — one source of truth for the macOS-style icons
used in both the browser extension (`extension/`) and the marketing site (`www/`).

TypeScript, dependency-free. Built to `dist/` (JS + `.d.ts`) so every consumer —
Vite, Nuxt, or plain Node — gets types for free.

## What's here (`src/`)

There are **two** glyph sets here, and they are not interchangeable. App glyphs are white
marks made to sit **on** an accent squircle. File glyphs are **background-less** marks that
inherit the surrounding text colour, for a file listing. Putting one in the other's record
gives it a tile it was never drawn for.

- **`glyphs.ts`** — `APP_GLYPHS` and the `AppId` union: the inner SVG markup of a
  24×24 line glyph per app, keyed by the app's canonical id (`televoica`,
  `kimtai`, `pdflib`, …). `glyphFor(id)` returns one or `undefined`.
- **`fileGlyphs.ts`** — `FILE_GLYPHS` and the `FileKind` union: one mark per **file kind**
  (folder, image, pdf, audio, video, json, markdown, code, text, archive, binary), for
  KimtFS's explorer. The kinds mirror the viewer's `detectKind()` on purpose — one
  classification drives both the preview and the icon, so they cannot disagree.
- **`index.ts`** — the renderer:
  - `appTileGradient(accent)` → CSS `background` for the squircle tile.
  - `appGlyphSvg(id, className?)` → the white glyph as an `<svg>` string.
  - `fileGlyphSvg(kind, className?)` → a file-kind glyph as an `<svg>` string, drawn in
    `currentColor` with no tile. Unknown kinds fall back to the `binary` sheet, so a row is
    never iconless.
  - `hasAppIcon(id)` → boolean.
  - `paintAppTile(el, { id, accent })` → DOM helper (extension): paints the
    gradient and injects the glyph; returns `false` if the app has no glyph so
    callers can fall back to a monogram.
  - `brandMarkSvg(size?)` / `brandTileGradient()` / `BRAND_GRADIENT_STOPS` —
    the kimtos **brand mark** and its fixed gradient (distinct from per-app
    tiles).

The tile's gloss, border and glyph sizing live in each consumer's CSS
(`.has-app-icon` / `.app-glyph` in the extension; `.app-ic` / `.app-glyph` on
the site) — this package owns the glyphs and the gradient formula.

## Build

`npm run build -w @kimtos/icons` (also runs on install via `prepare`) →
`dist/`. `exports`/`types` point there.

## How each side consumes it

- **Extension (Vite):** `import … from '@kimtos/icons'` — resolved through the
  npm workspace to `dist/index.js`, bundled into the build.
- **Site (`www/`, Nuxt):** `import … from '@kimtos/icons'` — resolved through
  the npm workspace and bundled by Nuxt (SSR-safe: `appTileGradient` /
  `appGlyphSvg` are pure).

## Adding / changing an app icon

Edit `src/glyphs.ts` (a new app uses its canonical id as the key and gets added
to `AppId`). Both surfaces pick it up — the extension on next build, the site on
next `make www`.
