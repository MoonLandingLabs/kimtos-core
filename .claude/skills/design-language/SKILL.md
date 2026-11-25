---
name: design-language
description: >-
  The Kimtos visual design language, a Material 3 Expressive ("Google-like")
  system: Google Sans type, Material Symbols icons, a Google-blue tonal color
  system with container/on-container pairs, pill buttons, 28-32px containers,
  expressive shapes (cookie, clover, burst, flower, sun) behind tool icons, and
  spring motion. Use whenever you design or restyle ANY Kimtos UI: a marketing
  page on www, a new app window in the extension, the
  mobile app, a dialog, a card, a button, an empty state, or a landing section.
  Covers tokens (light and dark), type scale, shape scale, components, the shape
  generator, tool color mapping, layout, copy rules and a done-checklist.
  Colour tokens still live where `theming` says; brand mark and app glyphs still
  come from `use-icons` / `app-icons`. Trigger on: "design", "UI", "style",
  "restyle", "make it look like", "Google-like", "Material", "M3", "landing
  page", "hero", "section", "card", "button", "chip", "polish", "new screen".
---

# Kimtos design language (Material 3 Expressive)

Kimtos looks and feels like a first-party Google product: calm white surfaces,
Google Sans, a blue tonal system, fully rounded controls, and a few playful
Material 3 Expressive shapes that give each tool a personality. It is the
direction the owner approved on 2026-09-29 (see `reference/kimtos-google.html`
in this folder, the approved homepage concept). Every new surface follows it.

**The three rules that make or break it:**

1. **Tonal, not loud.** Color arrives as _container_ backgrounds with a matching
   _on-container_ text color (`#D3E3FD` with `#041E49`), never as saturated
   gradients or glows. Solid `--md-primary` is reserved for the one main action
   per view.
2. **Round, not boxy.** Buttons and chips are pills; cards are 28px; hero and
   section containers are 32px; a tool's icon always sits on an expressive shape.
3. **Calm, then springy.** Nothing moves on its own except very slow decorative
   shape rotation. Interaction feedback uses the spring curve, briefly.

## Who owns what (do not duplicate)

| Concern                                               | Owner                                             | This skill adds                    |
| ----------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| Where colour tokens are defined, light/dark mechanics | `theming` skill (`extension/src/styles/base.css`) | the token _values_ and roles below |
| Brand mark, favicon, app tile glyphs                  | `use-icons` / `app-icons` (`@kimtos/icons`)       | how to place them in this language |
| Modals, confirms, windows in the extension            | `dialogs` skill (`createDialog`)                  | only the visual styling            |

Never hand-draw the Kimtos logo or an app glyph. The approved concept shows the
mark recoloured in blue; that is a proposal. If it is adopted, change it once in
`@kimtos/icons` (`BRAND_GRADIENT_STOPS` / `brandMarkSvg`) so every surface follows.

## 1. Color tokens

Name tokens by Material role. The marketing site is **light only** (the owner
wants a pure white page in every theme). App surfaces (extension, mobile)
keep System / Light / Dark via the `theming` skill, so every token below has a
dark value too.

| Token                         | Light     | Dark      | Use                                                                         |
| ----------------------------- | --------- | --------- | --------------------------------------------------------------------------- |
| `--md-primary`                | `#0B57D0` | `#A8C7FA` | the one main action, links, active icons, focus ring                        |
| `--md-on-primary`             | `#FFFFFF` | `#062E6F` | text/icons on primary                                                       |
| `--md-primary-hover`          | `#0842A0` | `#D3E3FD` | filled button hover                                                         |
| `--md-primary-container`      | `#D3E3FD` | `#0842A0` | tonal button, FAB, selected-strong areas, final CTA band                    |
| `--md-on-primary-container`   | `#041E49` | `#D3E3FD` | text on the above                                                           |
| `--md-secondary-container`    | `#C2E7FF` | `#004A77` | selected chip, active nav pill, segmented selection                         |
| `--md-on-secondary-container` | `#001D35` | `#C2E7FF` | text on the above                                                           |
| `--md-surface`                | `#FFFFFF` | `#131314` | page and card background                                                    |
| `--md-surface-low`            | `#F8FAFD` | `#1B1B1C` | quiet sections, rows, tool cards, footer                                    |
| `--md-surface-container`      | `#F0F4F9` | `#1E1F20` | search bar, hero stage, hover fill                                          |
| `--md-surface-high`           | `#E9EEF6` | `#282A2C` | dividers inside cards, progress tracks                                      |
| `--md-on-surface`             | `#1F1F1F` | `#E3E3E3` | body and heading text                                                       |
| `--md-on-surface-variant`     | `#444746` | `#C4C7C5` | secondary text, inactive icons                                              |
| `--md-outline`                | `#747775` | `#8E918F` | segmented button borders                                                    |
| `--md-outline-variant`        | `#C4C7C5` | `#444746` | chip and card outlines                                                      |
| `--md-snackbar`               | `#313033` | `#E3E3E3` | snackbar surface (text `#F4EFF4` / `#313033`, action `#A8C7FA` / `#0B57D0`) |

### Tonal pairs for tools and categories

Each pair is `[container, on-container]`. Use the container as a shape or card
fill and the on-container for the icon/text on it. Never put white text on a
container, and never use the container colour as text.

| Name   | Light pair            | Dark pair             |
| ------ | --------------------- | --------------------- |
| blue   | `#D3E3FD` / `#041E49` | `#0842A0` / `#D3E3FD` |
| sky    | `#C2E7FF` / `#001D35` | `#004A77` / `#C2E7FF` |
| green  | `#C4EED0` / `#072711` | `#0F5223` / `#C4EED0` |
| yellow | `#FFE082` / `#3D2E00` | `#5B4300` / `#FFE082` |
| pink   | `#FFD8E4` / `#3E001D` | `#7D2950` / `#FFD8E4` |
| violet | `#E8DEF8` / `#1D192B` | `#4A4458` / `#E8DEF8` |
| orange | `#FFDBC8` / `#341100` | `#6E2E00` / `#FFDBC8` |
| teal   | `#B2EBF2` / `#002022` | `#004F54` / `#B2EBF2` |

### Tool to colour and shape (keep it stable everywhere)

| Tool                  | Tone   | Shape  | Material Symbol      |
| --------------------- | ------ | ------ | -------------------- |
| File Converter        | blue   | cookie | `swap_horiz`         |
| Voice & Image to Text | green  | clover | `mic` / `graphic_eq` |
| AI Notebook           | violet | flower | `menu_book`          |
| PDF Library           | yellow | burst  | `auto_stories`       |
| Whiteboard            | pink   | sun    | `draw`               |

A tool keeps the same tone and shape on the hero, in the feature showcase, in
lists, in the app, and on mobile. Audience cards: Professionals blue, Students
green, Business yellow.

The four Google product colours (`#4285F4`, `#EA4335`, `#FBBC04`, `#34A853`) are
**only** for the real third-party platform logos (Chrome, Google Play). Never
use them as a Kimtos palette or arrange them as a Kimtos mark.

## 2. Typography

Fonts (all SIL OFL, from Google Fonts):

- **Google Sans Flex**: display and headlines (`opsz` 144 on the hero).
- **Google Sans**: body, labels, buttons.
- **Google Sans Code**: code, commands, file sizes if monospaced.

```css
--md-font-display: 'Google Sans Flex', 'Google Sans', Roboto, Arial, sans-serif;
--md-font-text: 'Google Sans', 'Google Sans Flex', Roboto, Arial, sans-serif;
--md-font-code: 'Google Sans Code', ui-monospace, Menlo, monospace;
```

Web pages may load them from `fonts.googleapis.com`. **The extension is
offline-first**: self-host the woff2 files in `extension/public/fonts/` and add
the OFL notice to `THIRD-PARTY-NOTICES.md` (same rule as models: anything we ship
is attributed). Never let an app window depend on the network to render text.

Scale (weight 500 for display and headlines; Google Sans does not use 700+ for
headlines):

| Role       | Size / line-height                | Tracking | Where                                          |
| ---------- | --------------------------------- | -------- | ---------------------------------------------- |
| Display    | `clamp(46px, 7vw, 88px)` / 1.04   | -0.04em  | hero h1 only                                   |
| Headline L | `clamp(34px, 4.6vw, 56px)` / 1.12 | -0.02em  | section titles                                 |
| Headline M | `clamp(28px, 3.4vw, 44px)` / 1.12 | -0.02em  | panel / tile titles                            |
| Title      | 17-22px / 1.3, weight 500         | 0        | card titles, app bar                           |
| Body L     | `clamp(18px, 1.8vw, 22px)` / 1.5  | 0        | section lead, colour `--md-on-surface-variant` |
| Body       | 16px / 1.5                        | 0        | default                                        |
| Label      | 13-15px, weight 500               | 0        | buttons, chips, nav, captions                  |

Highlight a phrase in a headline by colouring it `--md-primary` (never a
gradient text effect). Headings are sentence case.

## 3. Shape, elevation, spacing

| Token             | Value   | Use                                                               |
| ----------------- | ------- | ----------------------------------------------------------------- |
| `--md-shape-full` | `100px` | buttons, nav pills, search bar, selected chips, snackbar action   |
| `--md-shape-xl`   | `32px`  | hero stage, section panels, audience cards, final CTA band (40px) |
| `--md-shape-lg`   | `28px`  | cards, FAQ container, tool cards (morph to 40px on hover)         |
| `--md-shape-md`   | `20px`  | rows, inner cards, dropzones                                      |
| `--md-shape-sm`   | `12px`  | unselected filter chips, file-type tiles                          |
| `--md-shape-xs`   | `8px`   | assist chips, snackbar, language picker                           |

Elevation is rare. Only three levels:

- level 0: flat (almost everything; separate with surface tones, not shadows)
- level 1 (cards on a tinted panel): `0 1px 2px rgba(60,64,67,.2), 0 2px 6px 2px rgba(60,64,67,.1)`
- level 2 (app bar after scroll, hovered filled button, snackbar): `0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15)`

Layout: content max width 1240px, 24px side gutter, sections separated by
`clamp(88px, 11vw, 140px)`. Stack to one column under ~900px. Use `gap`, not
margins, between siblings.

## 4. Icons

- **UI icons**: Material Symbols Rounded, filled (`"FILL" 1, "wght" 500, "opsz" 24`),
  20-26px. Self-host in the extension (Apache 2.0, attribute it).
- **App tiles and the brand mark**: always `@kimtos/icons`, never a Material Symbol.
- **Platform logos** (Chrome, App Store/Apple, Google Play, Web globe): full-colour
  official marks, only to mean "available on". Mark unreleased platforms "Soon".

## 5. Expressive shapes

Tool icons sit on a polar-curve shape. One generator, used everywhere:

```js
// n lobes, a = lobe depth (0..1). Returns an SVG path in a 100x100 box.
const SHAPES = {
  cookie: [9, 0.1],
  clover: [4, 0.34],
  burst: [12, 0.08],
  flower: [6, 0.2],
  sun: [8, 0.16],
  gem: [5, 0.14],
};
function shapePath(name) {
  const [n, a] = SHAPES[name];
  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const t = (i / 240) * Math.PI * 2;
    const r = 48 * (1 - a) + (48 * a * (Math.cos(n * t) + 1)) / 2;
    pts.push(`${(50 + r * Math.cos(t - Math.PI / 2)).toFixed(2)} ${(50 + r * Math.sin(t - Math.PI / 2)).toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}
// <span class="shp"><svg viewBox="0 0 100 100"><path d="${shapePath('cookie')}" fill="#D3E3FD"/></svg><span class="ms" style="color:#041E49">swap_horiz</span></span>
```

Rules:

- A shape holds **an icon, never text**. 48-64px next to a tool, up to ~260px as
  decoration.
- Decoration is sparse: at most two or three shapes per section, partly off the
  container edge, in pastel container colours, behind content (`z-index:-1`,
  `pointer-events:none`).
- In the extension, generate the path once at build time (or memoise it), not per
  render.

## 6. Motion

```css
--md-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* overshoot, for feedback */
--md-standard: cubic-bezier(0.2, 0, 0, 1); /* plain transitions */
```

- Hover on a shape: `rotate(30deg) scale(1.06)` over 0.6s with `--md-spring`.
- Press on any button: `scale(.96)`.
- Selected filter chip morphs 12px to pill (`border-radius` 0.35s spring).
- Tool cards morph 28px to 40px on hover.
- Arrows in "Try it" / primary buttons nudge 3-4px right on hover.
- Snackbar and new cards enter with a short spring from 10-24px below.
- Decorative shapes may rotate continuously, 60-80s per turn, no faster.
- Nothing else autoplays: no marquees, no looping demos, no parallax.
- `@media (prefers-reduced-motion: reduce)` turns all of the above off.

## 7. Components

| Component        | Recipe                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filled button    | 48px tall (40px small), `--md-shape-full`, `--md-primary` / `--md-on-primary`, weight 500, hover `--md-primary-hover` + level 2                                   |
| Tonal button     | same shape, `--md-primary-container` / `--md-on-primary-container`                                                                                                |
| Text button      | `--md-primary` text, transparent, hover `rgba(11,87,208,.08)`                                                                                                     |
| Top app bar      | 64px, white 94% + blur, flat at top, level 2 after the page scrolls; nav items are 40px pills; the section in view gets `--md-primary` text on an 8% primary fill |
| Search bar       | 52px pill, `--md-surface-container`, leading `search` icon, avatar at the end, one line with ellipsis                                                             |
| Navigation rail  | 88px, `--md-surface-low`; FAB (56px, 16px radius, primary container) on top; active item = 56x32 pill in secondary container; hide under 640px                    |
| Filter chips     | 40px, 12px radius, outline-variant border; selected = secondary container, no border, pill radius, leading `check`; arrow keys and Home/End move selection        |
| Segmented button | outline border, full radius, selected segment secondary container with `check`                                                                                    |
| Assist chip      | 32px, 8px radius, outline-variant, primary-coloured leading icon; icon-only on phones                                                                             |
| Card             | `--md-surface`, 28px, level 1 when it sits on a tinted panel, flat otherwise                                                                                      |
| Feature showcase | chips above one 32px `--md-surface-low` panel with a **fixed min-height** so switching tabs never shifts the page                                                 |
| List / FAQ       | 28px `--md-surface-low` container, items 20px radius, open item turns `--md-surface`, trailing `expand_more` rotates 180deg                                       |
| Snackbar         | `--md-snackbar`, 8px radius, one line + one text action in light blue                                                                                             |
| Linear progress  | 4px, primary on primary-container track                                                                                                                           |
| Footer           | `--md-surface-low`, link columns, bottom row: brand, About/Privacy/Terms/Help, language picker at the end                                                         |

State layers: hover adds `currentColor` at 4-8% over the element; focus is a
3px `--md-primary` outline with 3px offset.

## 8. Page recipes

**Marketing page (www)**, in this order: top app bar, hero (headline with a
primary-coloured phrase, one-line lead, filled + tonal CTA, "Available on"
platform chips, product UI inside a 32px `--md-surface-container` stage), feature
showcase (chips + panel per core tool), more tools grid (shape + name + one line +
"Try it"), audiences (three tonal cards), security + everywhere tiles, FAQ list,
primary-container final CTA, footer. Show the product; do not use stock
illustrations.

**App window (extension / web app / mobile)**: navigation rail (desktop) or bottom
navigation (mobile), a search bar at the top, a greeting title, tool shortcuts on
shapes, "Recent" rows with assist chips, snackbar for completed background work.
Empty states: one shape with the tool icon, one sentence, one tonal button.

## 9. Copy rules

- Plain, friendly, sentence case, like Google product copy: "Convert any file in
  seconds", "Try it", "Start drawing".
- **Do not use Google's name, logo, or "by Google".** Kimtos uses Google's open
  design language; it is not a Google product, and implying otherwise is off limits.
- **No prices, plans, "Pro", or trial wording, ever.** Everything is free.
- **No emoji** (the repo rule and `scripts/check-emoji.mjs`). Use a Material Symbol.
- Agent/MCP claims must match what actually ships: the `check-agent-claims`
  script still fails present-tense capability claims in marketing copy. Update
  that rule and the copy together, never one without the other.
- Mark unreleased platforms and features honestly ("Soon", "Coming soon").

## 10. Done checklist

- [ ] Every colour is a token from section 1; no stray hex in components (see `theming`)
- [ ] Tonal pairs used correctly: container fill + on-container text
- [ ] One filled primary button per view; everything else tonal or text
- [ ] Buttons and chips are pills; cards 28px; big containers 32px
- [ ] Each tool uses its fixed tone, shape and symbol (section 1 table)
- [ ] Brand mark and app glyphs come from `@kimtos/icons`
- [ ] Fonts and Material Symbols are self-hosted where the surface must work offline, and attributed
- [ ] Hover/press/focus states present; chips work with arrow keys
- [ ] No autoplay beyond slow decorative rotation; reduced-motion respected
- [ ] Switching tabs or chips does not shift layout
- [ ] Phone width (390px): no horizontal scroll, rail hidden, rows truncate, chips go icon-only
- [ ] Light and dark both correct on app surfaces; the marketing site stays white
- [ ] No Google branding, no prices/plans, no emoji, no unshipped-capability claims

## Reference

- `reference/kimtos-google.html` in this folder is the approved homepage concept
  (standalone HTML: open it in a browser). Treat it as the visual source of truth
  for spacing, component shapes and motion when this document is not specific
  enough. Its app data and copy are illustrative; real app data comes from
  `www/data/apps.ts` and `@kimtos/icons`.
- Material 3: https://m3.material.io/ (Expressive shapes, motion, components)
- Google Sans / Google Sans Flex / Google Sans Code: Google Fonts (SIL OFL)
- Material Symbols: https://fonts.google.com/icons (Apache 2.0)
