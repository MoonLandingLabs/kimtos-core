---
name: deploy-release
description: >-
  How kimtos ships — `make build`, the release/changelog flow, and Chrome Web
  Store publishing. KimtOS v1 is free and open source (MIT) with NO backend, accounts or servers: the
  extension is published to the Chrome Web Store and the sites are static. Use whenever releasing,
  touching the Makefile, or the release changelog. Trigger on:
  "releasing", "Chrome Web Store", "changelog", "static site build".
---

# deploy-release — shipping kimtos

KimtOS v1 has no backend, no accounts and no servers of its own. The extension is loaded unpacked in
dev and published to the Chrome Web Store for release. `www/` and `www-docs/` are static sites
(`nuxt generate` / `vitepress build`) that can be hosted on any static host.

## Commands

```bash
make build          # build the extension into extension/dist (via `make shared` first). Local only.
make www-build      # statically generate the marketing site into www/.output/public
make docs-build     # build the docs site into www-docs/dist
```

- Models are not hosted by us: the extension downloads them from Hugging Face (and the non-English OCR
  packs from jsDelivr) at runtime. See `docs/extension/models.md` and the on-device-models skill.

## Release + changelog

See `docs/extension/releasing.md`. Key facts: the changelog is **bundled at build time, not fetched**,
and it is compiled from **PR titles, not commits** (`scripts/release.mjs compile` →
`extension/src/data/changelog.ts`). An empty changelog ("0 releases") is normal before the first
tagged release. Use Conventional Commit / PR titles — they become the changelog the user sees.

## Chrome Web Store

The release workflow publishes to the Chrome Web Store; it needs the CWS secrets and the one-time
developer fee. Listing text lives in `docs/extension/chrome-web-store.md`.

## Declare what you import

Every package a workspace's code OR its build scripts import MUST be declared in that workspace's
`package.json` — never rely on hoisting. A full root install hoists everything, so an undeclared
import resolves locally and in CI and breaks anywhere a scoped install is used (#575).
