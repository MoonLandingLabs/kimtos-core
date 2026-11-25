# kimtos docs

**KimtOS v1 is free and open source ([MIT](../LICENSE)), with the source on
[GitHub](https://github.com/MoonLandingLabs/kimtos-core).** It has no accounts, no backend and no
servers: a Chrome extension that runs entirely in your browser, plus a static website and docs.

Documentation, organized per package (mirrors the monorepo layout).

- **[extension/](extension/)** — the browser extension:
  [architecture](extension/architecture.md), [releasing](extension/releasing.md),
  and the [per-app booklets](extension/apps/) — the source the docs site publishes
  (`make docs`).
- **[www/](www/)** — the static marketing site (Nuxt, `nuxt generate`).
- **[shared-modules/](shared-modules/)** — shared packages (`@kimtos/icons`, …).

Each package also carries its own `README.md` in its directory.

Cross-cutting topics (not tied to one package):

- **[security-scanning.md](security-scanning.md)** — the security scanning setup.
