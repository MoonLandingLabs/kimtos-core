# Contributing

**KimtOS v1 is a free, open-source project (MIT).** Contributions are welcome under the terms in
[LICENSE](LICENSE). There is no payment, plan or account gate anywhere in it, and there is no
backend or server to run: it is a Chrome extension plus static sites.

KimtOS is a Chrome MV3 new-tab extension in an npm-workspaces monorepo written in
TypeScript — the extension, the static marketing site, the static docs site, and
shared packages, built with Vite.

## Setup

This repo runs **Node 22** (from [`.nvmrc`](.nvmrc)) and **npm 11** (from
`packageManager` in `package.json`) — the same pair CI uses. `make` refuses to run on anything else and tells you what to do.

Both pins are load-bearing, and neither is a floor:

- On **Node 24**, Nuxt's dev server dies inside Node's module loader, while every
  build and CI check stays green ([#149](https://github.com/MoonLandingLabs/kimtos-core/issues/149)).
- **npm 11 is not what Node 22 gives you** — Node 22 bundles npm 10.9.8, and npm 10
  writes a different lockfile (it strips the `libc` fields npm 11 records). Since
  `make` shells out to `npm install`, the wrong npm silently rewrites
  `package-lock.json` on every build ([#143](https://github.com/MoonLandingLabs/kimtos-core/issues/143)).
  So installing the pinned npm is a real step, not a formality.

```bash
git clone https://github.com/MoonLandingLabs/kimtos-core
cd kimtos-core
nvm use             # Node 22, per .nvmrc
npm i -g npm@11     # node 22 bundles npm 10; the repo pins 11
make install        # one root install for every workspace
make dev            # http://localhost:5173 (storage falls back to localStorage in dev)
```

To bump Node, edit `.nvmrc`; `make lint` fails if a workflow pin
disagrees, and `make smoke` tells you whether the dev servers survive it.

Load the built extension: `make build` → `chrome://extensions` → enable
**Developer mode** → **Load unpacked** → select `extension/dist`.

## Workflow

Work on a branch and land it through a pull request with CI green.

> `main` is the release branch, so always use a branch and a pull request, never a direct
> push.

Bugs and questions go to the
[GitHub issue tracker](https://github.com/MoonLandingLabs/kimtos-core/issues).

1. Branch off `main`.
2. Keep changes focused and match the surrounding code style.
3. Run the checks locally before pushing:
   ```bash
   make lint                                        # ESLint
   npm run typecheck -w @kimtos/extension           # tsc --noEmit
   npm run format:check -w @kimtos/extension        # Prettier — `make format` to fix
   make build                                       # must succeed
   npm run format:check                             # root Prettier — what the Formatting job runs
   npm run check                                    # every Conventions guard, in CI's order
   ```
   `npm run check` reads the guard list out of the _Conventions_ job rather than
   restating it, so it always runs exactly what CI runs.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit
   subjects (`feat(extension): …`, `fix(www): …`, `chore(infra): …`). Never add a
   `Co-Authored-By` or "Generated with…" trailer.
5. Open a PR against `main` with a clear title — it becomes part of the
   auto-generated release changelog.

## Dependencies

Adding a runtime dependency to the extension adds its licence to what we ship.
After changing them, regenerate the notices:

```bash
node scripts/gen-third-party-notices.mjs
```

This is no longer on your memory: `scripts/check-npm-notices.mjs` fails the build
when `THIRD-PARTY-NOTICES.md` stops describing the packages we ship — a component
that left the lockfile, a version or licence that moved, or a package the extension
imports with no entry. The exact regeneration diff runs as
`node scripts/check-npm-notices.mjs --bundle` in the _Unit tests_ job. It used to be
this paragraph alone, and a dependency shipped unattributed for it (#1101).

Avoid **copyleft** (GPL/LGPL/AGPL/MPL) and **non-commercial** (CC-BY-NC)
dependencies in anything that ships — they are incompatible with this project's
permissive distribution. The generator lists what actually reaches users, so a copyleft
licence appearing in `THIRD-PARTY-NOTICES.md` is a stop-and-think signal.

## Where things live

- **Architecture & data layer:** [docs/extension/architecture.md](docs/extension/architecture.md)
- **Adding an app:** [docs/extension/creating-an-app.md](docs/extension/creating-an-app.md)
  — one auto-discovered folder, no registry to edit.
- **Releases:** [docs/extension/releasing.md](docs/extension/releasing.md)
- **Chrome Web Store:** [docs/extension/chrome-web-store.md](docs/extension/chrome-web-store.md)

## Security and conduct

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Everyone taking part
agrees to the [code of conduct](CODE_OF_CONDUCT.md).
