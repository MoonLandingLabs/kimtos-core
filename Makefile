# kimtos monorepo (npm workspaces): the Chrome extension (extension/), the static marketing
# site (www/), the docs site (www-docs/), and shared packages (shared-modules/*). v1 has no
# backend, no accounts and no servers. One root install; per-package scripts run via `npm run -w`.

EXT := @kimtos/extension
WWW := @kimtos/www
DOCS := @kimtos/www-docs

.DEFAULT_GOAL := help
.PHONY: help check-toolchain smoke install shared icons prompts favicons audit dev www www-build build preview lint format docs docs-build optimize-images clean \
	release-notes release-check release-report release-prepare release-tag release

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | \
		awk -F':.*## ' '{ printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }'

install: ## Install all workspaces (root)
	npm install

# ── The toolchain: Node and npm ──────────────────────────────────────
# Two pins, two sources of truth: .nvmrc holds the Node major (CI reads it via
# node-version-file; scripts/check-node-pins.mjs asserts no workflow hardcodes one),
# and package.json's `packageManager` holds the npm
# version. This guard is what holds both lines locally.
#
# NODE, because the wrong one does not fail cleanly. On Node 24, Nuxt's
# loadBuilder() trips an internal assertion in Node's CJS-in-ESM translator, so
# `make www` dies with "Loading @nuxt/vite-builder builder failed" and a stack
# trace that blames Node — intermittently, and only for the dev server, while
# `nuxt generate` and every CI check stay green (#149). Better to refuse up front
# than to let a contributor debug an upstream loader race.
#
# NPM, because pinning Node to 22 is precisely what hands you the WRONG npm:
# node 22 bundles npm 10.9.8, while packageManager pins npm 11 — and the two write
# different lockfiles (npm 11 records `libc` for optional platform deps, npm 10
# strips them). Since every make target shells out to `npm install`, an unguarded
# npm 10 silently rewrites package-lock.json on every single build (#143). CI
# already installs the pinned npm explicitly; this is the same line for humans.
#
# Guarded here rather than with npm's engine-strict on purpose: .npmrc is shared
# with CI, whose npm may differ — so engine-strict would hard-fail there. make is what
# contributors type, so this is the seam to guard.
NODE_WANT := $(shell tr -dc '0-9' < .nvmrc)
NPM_WANT := $(shell node -p "require('./package.json').packageManager.split('@')[1].split('.')[0]" 2>/dev/null)

check-toolchain:
	@have=$$(node -p 'process.versions.node' 2>/dev/null); \
	if [ "$${have%%.*}" != "$(NODE_WANT)" ]; then \
		printf 'This repo runs Node $(NODE_WANT) (see .nvmrc). You are on v%s.\n' "$$have"; \
		printf 'Run `nvm use` (or install Node $(NODE_WANT)) and try again.\n'; \
		exit 1; \
	fi
	@have=$$(npm --version 2>/dev/null); \
	if [ "$${have%%.*}" != "$(NPM_WANT)" ]; then \
		printf 'This repo runs npm $(NPM_WANT) (see packageManager in package.json). You are on %s,\n' "$$have"; \
		printf 'which is what Node $(NODE_WANT) bundles — and it writes a DIFFERENT lockfile (#143).\n'; \
		printf 'Run `npm i -g npm@$(NPM_WANT)` and try again.\n'; \
		exit 1; \
	fi

# Auto-install: keep node_modules in step with the lockfile so a fresh checkout
# (or a pulled lockfile change) bootstraps itself before any build. Every target
# that runs a workspace script depends on this — that's what fixes the confusing
# "tsc: command not found" you'd otherwise hit before the first `make install`.
# EVERY package.json, not just the root's: a workspace's deps live in its own manifest, so
# `node_modules: package.json` alone meant that adding a dependency to www/ or the extension
# never triggered an install — make would happily build against the old tree (#143).
WORKSPACE_MANIFESTS := $(wildcard */package.json shared-modules/*/package.json)
INSTALL_LOCK := .make/install.lock

# check-toolchain is order-only (`|`): it is phony, so it runs on every make that
# reaches here, but it must not make node_modules look stale and reinstall.
# Installs are SERIALIZED per checkout. Two processes in the same checkout — an agent
# running `npm install` while another runs the gate — delete the toolchain out from under
# each other: eslint vanishes mid-run and you get `command not found` (127), which reads
# like a broken merge and sends you hunting a bug that does not exist (#154).
#
# Worktrees are NOT the problem: each has its own node_modules (they are siblings of the
# main checkout, so node never resolves across). The collision is within ONE directory.
#
# mkdir, not flock: `mkdir` is atomic on every platform and flock does not exist on macOS.
# The lock is released even if npm dies, because of the trap.
node_modules: package-lock.json package.json $(WORKSPACE_MANIFESTS) | check-toolchain
	@mkdir -p .make
	@i=0; while ! mkdir "$(INSTALL_LOCK)" 2>/dev/null; do \
		if [ $$i -eq 0 ]; then printf 'waiting: another install is running in this checkout...\n'; fi; \
		i=$$((i+1)); \
		if [ $$i -gt 600 ]; then \
			printf 'Timed out after 10 min waiting for %s.\n' "$(INSTALL_LOCK)"; \
			printf 'If no install is running, remove it: rm -rf %s\n' "$(INSTALL_LOCK)"; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	trap 'rm -rf "$(INSTALL_LOCK)"' EXIT INT TERM; \
	npm install
	@touch node_modules

# ── Shared packages (@kimtos/*) ──────────────────────────────────────
# EVERY shared package is compiled and its dist/ is gitignored, so a workspace
# that imports one cannot run until that dist exists. Until #111 the Makefile
# built only TWO of them (icons, prompts) — so `make www` died with "Cannot find
# module '@kimtos/config'" (www/nuxt.config.ts imports it), and no target could
# repair it. The dist was only ever built as a side effect of npm's `prepare`
# hook, which is why CI and a freshly-installed machine were fine while a machine
# that had run `git clean` was permanently broken.
#
# So the list is DERIVED, not hand-maintained: any shared package with a `build`
# script is built. Adding a sixth needs no edit here.
SHARED_PKGS := $(shell grep -l '"build"' shared-modules/*/package.json | xargs -n1 dirname | xargs -n1 basename)
STAMP_DIR := .make
SHARED_STAMPS := $(patsubst %,$(STAMP_DIR)/%.built,$(SHARED_PKGS))

# One stamp per package, depending on its sources — so `make dev` twice does NOT
# re-run tsc five times. Touching a package's source invalidates only its stamp.
define SHARED_RULE
$(STAMP_DIR)/$(1).built: $(shell find shared-modules/$(1) -type f -not -path '*/dist/*' -not -path '*/node_modules/*' 2>/dev/null) | node_modules
	npm run build -w @kimtos/$(1)
	@mkdir -p .make
	@touch $$@
endef
$(foreach p,$(SHARED_PKGS),$(eval $(call SHARED_RULE,$(p))))

shared: $(SHARED_STAMPS) ## Build every shared @kimtos/* package into its dist (incremental)

icons: $(STAMP_DIR)/icons.built ## Build the shared @kimtos/icons package (app glyphs + brand mark) into its dist

prompts: $(STAMP_DIR)/prompts.built ## Build the shared @kimtos/prompts package (Markdown prompts + SDK) into its dist

favicons: shared ## Write the www favicon.svg from the shared brand mark (@kimtos/icons)
	node scripts/gen-favicons.mjs

dev: shared ## Run the extension's Vite dev server (http://localhost:5173)
	npm run dev -w $(EXT)

www: shared ## Run the Nuxt static marketing site dev server (http://localhost:3000)
	npm run dev -w $(WWW)

www-build: favicons ## Statically generate the site into www/.output/public
	npm run generate -w $(WWW)

build: shared | check-deps ## Build the extension into extension/dist (load it unpacked)
	npm run build -w $(EXT)

preview: node_modules ## Preview the production build
	npm run preview -w $(EXT)

audit: node_modules ## Fail on any NEW moderate-or-worse dependency advisory
	node scripts/check-audit.mjs

smoke: shared ## Boot every dev server (extension, www, docs), assert it comes up, kill it
	node scripts/smoke-dev.mjs

# A half-installed node_modules is the failure that cost the most (#154): the toolchain
# vanishes mid-run and `eslint: command not found` reads like a broken merge, not like an
# environment problem. Nothing about that message says "another process is installing".
# So check for it and say it, before the gate runs and lies to you.
check-deps:
	@if [ -d node_modules ] && [ ! -x node_modules/.bin/eslint ]; then \
		printf 'node_modules exists but the toolchain is missing (no .bin/eslint).\n'; \
		printf 'An install is probably running in THIS checkout right now (#154) — wait for it.\n'; \
		printf 'If nothing is running, the tree is half-built: run `make install`.\n'; \
		exit 1; \
	fi

lint: shared | check-deps ## Lint the extension, and assert every Node pin still agrees with .nvmrc
	npm run lint -w $(EXT)
	node scripts/check-node-pins.mjs

format: node_modules ## Format the extension with Prettier
	npm run format -w $(EXT)

# The docs site. `docs` used to mean something else entirely — the
# extension's own booklet renderer, which read the SAME booklet.toml + chapters that the
# docs site reads, wrote to a gitignored folder, and was deployed nowhere. So `make docs`
# succeeded and built an artifact nobody ships, while the site it looked like it ran had
# no target at all (#182). The renderer is gone; the name belongs to the real thing.
docs: shared | check-deps ## Run the docs site's dev server (http://localhost:5173)
	npm run dev -w $(DOCS)

docs-build: shared | check-deps ## Build the docs site into www-docs/dist
	npm run build -w $(DOCS)

optimize-images: ## Downscale wallpaper images for performance
	bash scripts/optimize-images.sh

clean: ## Remove the built extension
	rm -rf extension/dist

# The release logic lives in @kimtos/releaser (shared-modules/releaser), which has tests.
# It used to be ~20 lines of shell in this file — unreadable, untestable, and rebuilt three
# times in a week. See #121.
release-notes: shared ## Preview the generated notes for the pending range (last tag..HEAD)
	@node scripts/release.mjs notes

release-check: shared ## Assert every app + deployable has a changelog and a matching version, and the lockfile agrees
	@node scripts/release.mjs check

release-report: shared ## What the pending release actually touches (apps, workspaces, PRs)
	@node scripts/release.mjs report

# A release is TWO commands, not one (#1208). `release-prepare` writes the notes and commits
# them on a branch; that branch goes through a PR like every other change; `release-tag` tags
# the merged commit. Each refuses to run where the other belongs, so the review step is not
# something you can forget to do.
release-prepare: shared ## Write the release notes and commit them on a branch (no push, no tag). Usage: make release-prepare VERSION=0.6.0
	@node scripts/release.mjs prepare "$(VERSION)"

release-tag: shared ## Tag the merged release commit and push the tag, from main. Usage: make release-tag VERSION=0.6.0
	@node scripts/release.mjs tag "$(VERSION)"

# A signpost, not a target that does anything. `make release` is in people's fingers, and
# "No rule to make target" would not tell them what replaced it.
release: ## Split into release-prepare and release-tag — see docs/extension/releasing.md
	@echo "make release is gone — it pushed main without review and tagged in one step (#1208)."
	@echo
	@echo "  1. bump extension/manifest.json + extension/package.json"
	@echo "  2. git checkout -b main_chore_release_$(or $(VERSION),x.y.z)"
	@echo "     make release-prepare VERSION=$(or $(VERSION),x.y.z)   # notes + commit"
	@echo "     push, open a PR, get it reviewed, merge it"
	@echo "  3. run the Release workflow as a dry run"
	@echo "  4. git checkout main && git pull"
	@echo "     make release-tag VERSION=$(or $(VERSION),x.y.z)       # tag + push the tag"
	@echo
	@echo "docs/extension/releasing.md has the whole thing."
	@exit 1
