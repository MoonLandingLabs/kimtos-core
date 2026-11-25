# Shared modules docs

Framework-agnostic packages under `shared-modules/`, consumed across the
monorepo by the extension and the static sites. All TypeScript, built to
`dist/`.

- **@kimtos/config** (`../../shared-modules/config/`) — the single
  source of truth for shared runtime constants (the docs and store URLs in `DEFAULTS`, the
  "New" badge rule, the extension's cache/storage/z-index names) plus the base
  TypeScript/ESLint config. Isomorphic, so it's safe to import anywhere.
- **[@kimtos/icons](../../shared-modules/icons/README.md)** — the macOS-style
  app-icon system (glyphs + accent gradient), rendered by both the extension
  dock and the site's `AppGrid.vue`.
- **[@kimtos/prompts](../../shared-modules/prompts/README.md)** — the shared
  prompt library (Markdown prompts + a model-agnostic render SDK).
- **@kimtos/releaser** (`../../shared-modules/releaser/`) — the release/changelog
  engine behind the `make release-*` targets and the tag workflow.
