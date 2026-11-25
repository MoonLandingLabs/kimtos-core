---
name: use-icons
description: >-
  How ANY kimtos surface or module renders the brand mark (logo + favicon) and
  the app-icon tiles from the shared @kimtos/icons module — the consumer recipes
  for Nuxt/Vue (www), vanilla TS (the extension), and static-HTML
  generators (the docs site), plus the gen-favicons no-drift pattern. Use when
  adding a logo, favicon, or app icon to a NEW surface/module/page, wiring a new
  Nuxt app's branding, or making a site "use our icons/logo". For the glyph
  SYSTEM itself (adding/changing an app's glyph, design rules) see app-icons.
  Trigger on: "logo", "favicon", "brand mark", "app icon", "@kimtos/icons",
  "brandMarkSvg", "appGlyphSvg", "paintAppTile", "gen-favicons", "consistent
  icons", "use our icons".
---

# kimtos — using @kimtos/icons from any surface

`@kimtos/icons` is the **single source of truth** for the whole brand: the app
glyphs, the accent→gradient formula, and the KimtOS mark. Every surface —
`www`, the `extension` (dock/App Store/onboarding + the
content-script toast), and the generated `docs` site — renders the SAME logo,
favicon, and app tiles from it. Inline SVG only: nothing is ever fetched, so it
works offline and under a strict CSP, and there is one place to change the brand.

**The rule:** never hardcode a brand mark, an app glyph, a tile gradient, or a
favicon. Always call `@kimtos/icons`. That's what keeps every surface identical.

## The API (quick reference)

| Export                                         | Returns                                                                           | Use for                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `brandMarkSvg(size = 128)`                     | a complete standalone `<svg>` string (gradient + roof/dock glyph, self-contained) | the **nav logo** and the **favicon**                                  |
| `brandTileGradient()` / `BRAND_GRADIENT_STOPS` | the brand gradient CSS / its stops                                                | a brand-tinted surface                                                |
| `appTileGradient(accent)`                      | a CSS `background` value (Big-Sur gradient from the app's accent)                 | the **app-tile** fill                                                 |
| `appGlyphSvg(id, className?)`                  | the app's glyph as an `<svg>` string (`currentColor`; `''` if unknown)            | the **glyph** inside an app tile                                      |
| `paintAppTile(el, {id, accent})`               | paints gradient + glyph onto a DOM element; **`false`** if the app has no glyph   | app tiles in the **extension** (DOM); caller falls back to a monogram |
| `hasAppIcon(id)` / `glyphFor(id)`              | `boolean` / the inner markup                                                      | guards / fallbacks                                                    |

Prereqs for a consumer: add `"@kimtos/icons": "*"` to the surface's
`package.json`, and make sure the package is **built** before you build the
surface (its `dist` is what's imported) — depend on the `icons` make target
(`make icons`), like `www-build`/`favicons` do.

## Recipe A — Nuxt / Vue (www)

**Logo** (nav / header):

```vue
<script setup lang="ts">
import { brandMarkSvg } from '@kimtos/icons';
const brandMark = brandMarkSvg(28);
</script>
<template>
  <a class="brand" aria-label="KimtOS">
    <span class="brand-logo" v-html="brandMark" />
    <span class="brand-name">KimtOS</span>
  </a>
</template>
```

`.brand-logo { display:inline-flex; width:28px; height:28px }` — the SVG carries
its own gradient + rounded corners. (See `www/components/TheNav.vue`.)

**App tiles** (a grid/list of apps):

```vue
<script setup lang="ts">
import { appTileGradient, appGlyphSvg } from '@kimtos/icons';
</script>
<span class="app-ic" :style="{ background: appTileGradient(a.accent) }" v-html="appGlyphSvg(a.id)" />
```

(See `www/components/AppGrid.vue`.) Style `.app-ic` with the shared tile look
(below).

**Favicon:** don't hand-write it — generate it (see "Favicons" below) and point
`nuxt.config` at **both** files. The `.ico` is not optional: a surface that ships
one and declares only the SVG is how admin's went missing unnoticed (#1321), and
`check-favicons.mjs` fails a head that declares only one of them.

```ts
app: {
  head: {
    link: [
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ];
  }
}
```

## Recipe B — vanilla TS (the extension)

Use the **DOM helper** for app tiles — it returns `false` when an app has no
glyph, so you fall back to a letter monogram:

```ts
import { paintAppTile } from '../components/appIcon.js'; // re-exports @kimtos/icons
if (!paintAppTile(tileEl, { id: app.id, accent: app.accent })) {
  tileEl.textContent = monogram(app.name); // graceful fallback
}
```

(See `components/appIcon.ts`, used by `views/appDock.ts`, `views/appStore.ts`,
onboarding.) For the brand mark in a DOM/string context, `el.innerHTML =
brandMarkSvg(28)`. In a **content script** injected into arbitrary pages, inline
the mark inside a shadow root (see `content/brand.ts`) so the page's CSS can't
touch it — never fetch it.

## Recipe C — static HTML generator (the docs site)

String-build everything; embed the favicon as a data-URI so the page stays
self-contained:

```ts
import { appTileGradient, appGlyphSvg, brandMarkSvg } from '@kimtos/icons';
const FAVICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(brandMarkSvg(64))}">`;
// app tile:
`<span class="app-tile" style="background:${appTileGradient(accent)}">${appGlyphSvg(id)}</span>`
// site logo:
`<span class="brand-logo">${brandMarkSvg(30)}</span>`;
```

(See `www-docs/scripts/build-content.mjs`.)

## The shared tile look (match it everywhere)

The glyph is drawn in `currentColor`, so the tile sets the colour (white on the
gradient). Squircle radius **23%**, a subtle gloss, glyph at **58%**:

```css
.app-tile {
  position: relative;
  border-radius: 23%;
  display: grid;
  place-items: center;
  color: #fff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 6px 16px rgba(15, 23, 42, 0.14);
}
.app-tile::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.22), transparent 46%);
  pointer-events: none;
}
.app-tile svg {
  position: relative;
  z-index: 1;
  width: 58%;
  height: 58%;
  display: block;
}
```

(www calls it `.app-ic`, the docs `.app-tile` — same treatment.)

## Favicons — generate them, never hand-edit

`www/public/favicon.svg` is a **generated
snapshot** of `brandMarkSvg(64)`, written by `scripts/gen-favicons.mjs`
`make favicons` regenerates it. The one hand-rasterised `favicon.ico` lives in `www/public`
and the docs build copies it.
**To add a favicon to a NEW Nuxt surface:** add its `public/favicon.svg` path to
`SVG_TARGETS` (and its `.ico` to `ICO_TARGETS`) in `scripts/gen-favicons.mjs`, run
`make favicons`, and point its `nuxt.config` at BOTH files. (A static-HTML surface
uses the inline data-URI instead — no file.)

**`scripts/check-favicons.mjs` holds both public surfaces to it** — www and docs. It runs from `scripts/check-favicons.test.mjs` under the root
`npm test`, **not** from the Conventions job: it imports `@kimtos/icons`, and that
job installs nothing, so a step there dies on a clean checkout with a module error
(got wrong twice — see the note at the top of the script). It exists because this section
was prose, and prose let a surface ship an unfilled gradient or no `.ico` at all, so its host
answered `/favicon.ico` with the SPA's index page at HTTP 200 (#1321). Declare a NEW surface
there too, or it is outside the rule the same way.

## Rules & gotchas

- **Never hardcode** a brand mark, glyph, tile gradient, or favicon — one source
  of truth (`@kimtos/icons`), or surfaces drift (that's how admin ended up with a
  different "K" mark and a different favicon).
- **Never fetch an image** — inline SVG only (offline-first + CSP-safe).
- **Rebuild the package** before building a consumer — the import resolves to
  `@kimtos/icons`' built `dist`. Missing/stale dist → a stale glyph or a build
  error. Depend on `make icons`.
- **Monogram fallback** (extension only): `paintAppTile` returns `false` for an
  app with no glyph — always handle it. A letter monogram appearing instead of an
  icon means `APP_GLYPHS[id]` is missing (id mismatch) or the package wasn't
  rebuilt — see **app-icons**.
- **Favicon files are snapshots** — edit the mark in `@kimtos/icons`, then
  `make favicons`; don't touch the `.svg` files by hand.
- **The `.ico` is the one asset that cannot be regenerated here** — comparing a
  raster to an SVG needs a renderer, and this repo keeps one hand-cut file rather
  than take an image dependency. So `gen-favicons` COPIES it from `www/public`
  rather than writing it, and `scripts/favicon-ico.mark` records the digest of the
  mark it was cut from. Change the mark and `check-favicons` fails until the `.ico`
  is re-cut and that digest updated — a human step, but no longer a silent one. The
  extension's manifest PNGs are separate assets on the same footing.

## Related

- **app-icons** — the glyph SYSTEM itself: adding/changing an app's glyph, the
  design rules, the `@kimtos/icons` internals. Use that to _define_ an icon; use
  this skill to _render_ it in a surface.
- **new-app** — adding a whole app (its glyph is one step there).
