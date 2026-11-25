---
name: theming
description: >-
  How colour and theming work in the kimtos extension, and the rules every agent
  must follow when touching styles. The app supports System / Light / Dark
  (Settings → Appearance). ALL colours come from CSS custom-property tokens in
  extension/src/styles/base.css — never hard-code a hex/rgba/hsl in a component
  or an inline style. Use whenever you add or change any colour, add a component
  with a background/border/text colour, build a new app's styles, or wire a new
  themeable surface. Trigger on: "colour/color", "theme", "dark mode", "light
  mode", "background", "css", "style a component", "add an app", "inline color".
---

# Theming & colour tokens (kimtos extension)

The extension is themeable: **System / Light / Dark**, chosen in Settings →
Appearance. It works only because **every colour is a token**. The single
non-negotiable rule:

> **Never hard-code a colour.** No `#hex`, no `rgb()/rgba()/hsl()` literal in a
> component rule or an inline `style`. Every colour is `var(--token)`. If the
> colour you need doesn't exist as a token, **add a token** (defined for both
> themes) — don't inline it.

If you inline a colour, that element will look wrong in one of the two themes,
because the light palette only redefines the tokens.

## How the theme system works

`extension/src/styles/base.css` is the single source of truth for colour:

- The base `:root` defines the **dark** palette (the default) plus the
  theme-invariant tokens (radii, blur, font, `--accent` and `--on-accent`).
- A **light** palette redefines the colour tokens in two places (kept identical
  on purpose — plain CSS can't share a block across a media query and an
  attribute selector):
  - `@media (prefers-color-scheme: light) { :root:not([data-theme]) { … } }` —
    drives **System** mode when the OS prefers light.
  - `:root[data-theme='light'] { … }` — the explicit **Light** pick.
- Components **only** ever read tokens (`color: var(--text)`), so redefining the
  tokens re-themes the whole app. Never style a component _inside_ the light
  block — put the value on the token, not the component.

### The runtime wiring (already built — don't re-add)

- Persisted as `store.theme: 'system' | 'light' | 'dark'` (`models/store.ts`,
  default `'system'`).
- Settings → Appearance picker: `views/settings.ts` (`THEMES` select) →
  `onChange({ theme })`.
- `applyTheme(root?)` in `lib/theme.ts` sets the attribute on `<html>`:
  `'system'` → **removes** `data-theme` (so the `@media` query decides);
  `'light'`/`'dark'` → sets `data-theme`, which **overrides** the OS.
- **A surface calls `followTheme()`, not `applyTheme()`** — it applies the theme
  now AND on every change, and returns an unsubscribe. (`applyTheme` is for a root
  that is not this document — `lib/pip.ts` mirroring onto a pop-out window — or to
  paint before `followTheme` can be wired, as the new tab does across its startup
  awaits. Neither is a substitute for subscribing.) Applying once at startup
  is the bug: the user picks the theme on the NEW TAB, so every other surface of
  ours that is on screen has to re-apply it. The side panel and the toolbar popup
  each read it once and never again, and stayed on the palette they booted with
  (#1174). `scripts/check-theme-subscribers.mjs` now fails the build on a surface
  that reads the theme and neither subscribes nor is exempt with a reason.
- A surface with extra work of its own passes it in: the new tab
  (`controllers/appController.ts`) hands `followTheme` a callback that retints the
  open pop-out windows (`syncPipTheme()`) and re-picks the wallpaper. That keeps
  `lib/theme.ts` unaware of pop-out windows, and keeps `lib/pip.ts` out of the
  side panel's and popup's bundles.

## A theme switch must reach everything on screen

CSS custom properties re-theme everything that is styled with them the moment the attribute on `<html>` changes. What
they cannot reach is anything that **read a colour and kept it**: a diagram or chart drawn to SVG or a canvas, a book or
editor from a library, a picture made in the browser, a page in an iframe. Each one subscribes to the theme (as above:
re-applying once at startup is the bug) and draws again in place, with no refresh and no reload. In the dashboard that is
`useThemeTick()` (fires on a switch, and on System when the device switches), `useDarkTheme()` for a library with a dark
flag, and `useArtifactTheme` for a page in a frame (a message with only the theme in it, target `'*'`: a sandboxed frame has an opaque
origin, so a message addressed to its host is silently dropped). Cache keys of
made pictures include the theme. A test (`a theme change shows at once`) fails on a surface that reads token colours at
draw time and does not subscribe.

## The token catalogue

Defined in `base.css`. Use these; add to them rather than inlining.

**Theme-invariant** (identical in both themes):

- `--accent` — brand blue. A per-app accent overrides `--accent` _locally_ on
  that app's root (apps set `--accent: <app colour>`); still a token, never
  inlined mid-rule.
- `--on-accent` — white text/icon sitting on an accent / coloured / image ground
  (a badge, an app-glyph squircle, a toggle knob, a label over a wallpaper thumb).
  Stays white in both themes — that's the point. Do NOT use `--text` there (it
  flips dark and vanishes on the colour).
- `--radius-lg|md|sm`, `--blur`, `--blur-strong`, `--font`.

**Theme-aware colour** (redefined per theme):

- `--text`, `--text-secondary` — foreground.
- `--danger` (red) / `--warning` (amber) — semantic; use for destructive / caution
  states, never a raw red/amber. Both are DEEPER in light than in dark, because
  they are used as ink: the dark palette's pale red on a white panel fails
  contrast. That is exactly why you must not inline your own — a literal that
  reads in one theme will not read in the other.
- `--material`, `--material-hover` — translucent panel/dock/dialog surfaces
  (composited over the wallpaper with `backdrop-filter`).
- `--panel` — an _opaque_ surface: context menus, popovers, the settings sidebar,
  app windows, the pip body (things that must not show the wallpaper through them).
- `--field` — a sunken input / well background (an inset fill, NOT the raised
  `--surface`; don't swap them or dark inputs turn into light tiles).
- `--hairline`, `--hairline-strong` — 1px borders / dividers.
- `--surface`, `--surface-hover`, `--surface-strong` — subtle fills _on_ a
  material (list rows, tiles, hover states). This is the token that replaces the
  ubiquitous `rgba(255,255,255,0.05…0.14)` fills.
- `--scrim` — modal backdrops / overlays.
- `--shadow` — the standard drop shadow.

## Adding a colour (the flow)

1. Check whether an existing token fits (a subtle fill → `--surface*`; a border →
   `--hairline*`; text → `--text*`; a red → `--danger`). Prefer reuse.
2. If nothing fits, add a token in `base.css`: one line in the base `:root`
   (dark value) **and** the matching line in **both** light blocks (the `@media`
   and the `[data-theme='light']` rule). Give it a short comment on its purpose.
   Pick a light value that keeps contrast legible — don't naively invert.
3. Use `var(--your-token)` in the component. Never the literal.

## The wallpaper

The wallpaper photo stays in both themes; theming flips the **chrome** (materials,
text, hairlines, surfaces). Text sitting directly over the wallpaper (the clock)
keeps its own `text-shadow` for legibility and is intentionally theme-independent.
Don't try to theme the wallpaper itself.

## Verifying

- **No inline colours** — check any file you touch:

  ```sh
  grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" extension/src/styles/<file>.css | grep -v "var("
  ```

  **Sanctioned exceptions** (theme-independent by nature — leave as literals):
  - **Shadows** — `box-shadow` / `text-shadow` `rgba(0,0,0,x)`. Dark shadows read
    correctly on both grounds; the geometry varies per element so they aren't one
    token.
  - **Over-image scrims** — a dark overlay sitting on a photo (wallpaper thumbnails,
    the `.cropper-stage`/media backdrops, `#000` letterboxes). It darkens an image,
    not a themed surface.
  - **The wallpaper gradients** in `base.css` (`.bg-overlay`, the fallback base).
  - **SVG `fill`/`stroke`** inside icon markup.

  Anything else that shows up in that grep is a bug — tokenize it.

- **Both themes** — after a change, open Settings → Appearance and check the
  surface in **Light** and **Dark**; don't ship a change verified in only one.
- Run the usual gate: `npm run typecheck -w @kimtos/extension`, `lint`,
  `format:check`, `build`.

## When building a new app's styles

Every background/border/text colour goes through a token from day one. Set the
app's identity colour once as a local `--accent` on the app root; everything else
uses `--material` / `--surface*` / `--hairline*` / `--text*`. A new app should add
**zero** raw colour literals to `apps.css`.
