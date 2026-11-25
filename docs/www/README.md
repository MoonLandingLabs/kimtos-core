# Site (www) docs

The marketing site — Nuxt 4 (Vue 3, TypeScript), **fully static** (`nuxt generate`). It has no
backend, no accounts and no runtime server: every page is prerendered. KimtOS v1 is free and
open source (MIT) and the site says so in the hero, the footer and the legal pages.

See [`../../www/README.md`](../../www/README.md) for develop / build.

- Shared code comes from the workspace: `@kimtos/icons` (app glyphs, rendered by
  `AppGrid.vue`) and `@kimtos/config` (URL constants).
- The Privacy and Terms pages read `www/data/legal.ts`. They state truthfully that nothing is
  collected, everything stays in the browser, model files come from Hugging Face, and a few
  optional cards call public APIs. `scripts/check-network-hosts.mjs` holds the page to the
  extension's declared hosts.
- **`vue-router` must stay a declared dev dependency** of this app. nuxt ships it only as a
  nested transitive dep, so without the declaration nuxt 4.5's server build compiles a second
  copy of the router into the prerender bundle instead of importing it externally, and every
  prerendered route then fails at `app:rendered` with
  `Cannot read properties of undefined (reading 'state')` (#1003). It was first declared to
  silence a typecheck warning (#1021), but it is load-bearing: `npm run generate` is what
  catches it if it is ever dropped.
