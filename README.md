# KimtOS

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **KimtOS v1 is free and open source (MIT), and the source is right here on GitHub.**
> There are **no accounts, no backend and no servers**: it is a Chrome extension that runs
> entirely in your browser, plus a static website and docs.

KimtOS turns every new browser tab into a private, local-first workspace — a **Chrome
new-tab (Manifest V3) extension** with a dock of daily tools over a rotating wallpaper.

Your notes, tasks, PDFs, clipboard and recordings live in your browser (IndexedDB), and
the AI tools (chat, voice→text, image→text, grammar) run **on-device** with
WebAssembly/WebGPU — so your content never leaves your machine. KimtOS collects no data at
all. Every app is free.

## Free and open source

KimtOS is a **free, open-source** project released under the [MIT License](LICENSE). Every
app is free for everyone. There is **no account** to create, no sign-in, no payment, plan,
trial or paywall of any kind, and nothing to host: the extension runs entirely in your
browser. Model files are downloaded once from Hugging Face (a public host), and a few
optional cards call public APIs you switch on yourself (weather, developer news).

Bugs and questions go to the
[GitHub issue tracker](https://github.com/MoonLandingLabs/kimtos-core/issues). There is no support
desk or chat.

### Build and install from source

Requires the Node and npm versions pinned in `.nvmrc` and `package.json` (see
[CONTRIBUTING.md](CONTRIBUTING.md)).

```bash
git clone https://github.com/MoonLandingLabs/kimtos-core kimtos-core
cd kimtos-core
make install     # install all workspaces
make build       # build the extension -> extension/dist
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and
select `extension/dist`. No account, API key or server is required for the apps to work.

- **Documentation:** [`docs/`](docs/)
- **Issues and questions:** [GitHub issues](https://github.com/MoonLandingLabs/kimtos-core/issues)

## Repo layout

A single npm-workspaces monorepo:

| Workspace          | What it is                                                                       |
| ------------------ | -------------------------------------------------------------------------------- |
| `extension/`       | `@kimtos/extension` — the MV3 new-tab extension (Vite + TypeScript)              |
| `www/`             | `@kimtos/www` — the static marketing site (Nuxt 4, `nuxt generate`)              |
| `www-docs/`        | `@kimtos/www-docs` — the static docs site (VitePress)                            |
| `shared-modules/*` | shared packages — `@kimtos/config`, `@kimtos/icons`, `@kimtos/prompts`, and more |

## Quick start

```bash
make install     # install all workspaces
make dev         # extension Vite dev server (http://localhost:5173)
make www         # Nuxt static marketing site (http://localhost:8799)
make build       # build the extension → extension/dist
make docs        # docs site dev server
```

Load the extension: `chrome://extensions` → **Developer mode** → **Load unpacked** →
`extension/dist`. Run `make help` for every target. Full setup (the Node/npm pins) and
the branch/PR workflow are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

| Topic                     | Where                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| Full documentation        | [`docs/`](docs/)                                                         |
| Architecture & data layer | [`docs/extension/architecture.md`](docs/extension/architecture.md)       |
| Creating an app           | [`docs/extension/creating-an-app.md`](docs/extension/creating-an-app.md) |
| Releasing                 | [`docs/extension/releasing.md`](docs/extension/releasing.md)             |
| App conventions           | [`CLAUDE.md`](CLAUDE.md)                                                 |

## License

KimtOS is released under the [MIT License](LICENSE).

KimtOS is built on open-source components, which remain under their own licences;
their notices are reproduced in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

© 2026 Mahmoud Emad
