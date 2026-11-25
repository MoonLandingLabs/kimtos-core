# Per-App Documentation

Each app in the suite has its own documentation booklet under `docs/extension/apps/<id>/`.
The booklets are plain Markdown — version-controlled, easy to diff — and a small
generator renders them into a static HTML docs site (diagrams and code
highlighting load from a CDN in the browser).

## Layout

```
docs/extension/apps/<id>/
├── booklet.toml          # manifest: title, subtitle, accent, order
└── content/
    ├── 01-overview.md
    ├── 02-getting-started.md
    ├── 03-architecture.md
    └── 04-reference.md
```

Chapters are discovered **alphabetically**, so the `01-`, `02-` … prefixes
control their order.

## Conventions

- **One `# H1` per file** — it becomes the chapter title.
- **Never skip heading levels** — `#` → `##` → `###`, in order.
- Scale the depth to the app: a simple app may need only `01-overview.md`; a
  rich one gets overview + getting-started + architecture + reference.
- Most apps include an **architecture** chapter with a module table and a
  ` ```mermaid ` diagram of the data/compute flow.
- Frame content as **local-first / on-device** — the user's data stays on the
  device and is never uploaded. Every app is free and there is no account. Apps with `optIn: true` in `meta.ts` ship
  uninstalled and are added from the App Store; note that where relevant.

## `booklet.toml`

A small manifest with flat keys:

```toml
title    = "NotaBoard"
subtitle = "A whiteboard for notes, sketches and quick diagrams"
accent   = "#10b981"   # the app's accent color (used in the docs theme)
order    = 6           # position on the docs index (lower first)
formats  = ["html"]
```

## Building

From the repo root:

```bash
make docs           # the docs site's dev server → http://localhost:5173
make docs-build     # the same site, built into www-docs/dist
```

These booklets are the **source**, and the docs site (`www-docs`, VitePress) is the
only thing that renders them: `www-docs/scripts/build-content.mjs` assembles one page
per app from `booklet.toml` plus the numbered chapters, and publishes it. ` ```mermaid ` blocks render as diagrams and code blocks are
syntax-highlighted.

The extension used to carry a _second_ renderer of these same files, whose output was
git-ignored and deployed nowhere — it was retired in #182. There is one renderer now.

## Adding docs for a new app

1. Create `docs/extension/apps/<id>/booklet.toml` and `docs/extension/apps/<id>/content/01-overview.md`.
2. Follow the conventions above (use `notaboard` as the reference example).
3. Run `make docs` and open your app's page on the local site.
