# Chrome Web Store listing assets

Marketing images for the extension's Chrome Web Store listing. These are **not bundled into
the extension** — they are store-listing assets only.

**Seven of the eight screenshots are real product captures** — the live UI in light theme,
photographed from a seeded demo workspace — framed in the gallery style the store's two-up
carousel renders: a brand-gradient headline band with the product below it. Google's
Featured-badge bar wants the actual user experience on screen, not marketing slides (#1065).
The eighth (`screenshot-8-privacy.png`) is the one **designed** explainer — a "why + how"
card on the same brand gradient. The two promo tiles are also designed from the real brand
system (`brandMarkSvg` + `appTileSvg` + `BRAND_GRADIENT_STOPS` from `@kimtos/icons`, and the
app catalog in `www/data/apps.ts`), so the tiles and glyphs are the actual product icons.

> **The store shows at most 5 screenshots per listing** (1280×800 or 640×400 —
> developer.chrome.com/docs/webstore/images). This repo carries eight so the strongest set
> can be chosen per campaign; you upload five in the dashboard. A recommended live five, to
> "catch every user": **1 hero, 7 multi-window multitasking, 3 App Store, 8 why-Kimtos, and
> one of 2 Notes / 6 two-tools** — a home, a breadth shot, a depth shot, the multitasking
> wow, and the privacy hook.

Every app is free, so no slide contains an upgrade button or a locked tile — the listing shows
what the product does. The home dock installs ten apps — a clean single row
that stops short of the bottom-right corner controls (shuffle / favourite / full screen), which
a wider dock hid.

**What a slide may show.** The UI is real: every pixel is the shipped app rendering the
seeded records. The _content_ is staged demo data authored in `capture.mjs` — that is what a
product screenshot is. What it must never do is imply a capability the product lacks. That is
why **no slide shows a KimtAI conversation**: a hand-written assistant reply would read as
the on-device model's own output, and the small models we ship do not write like that (same
rule as CLAUDE.md's dormant-agent convention). Transcription and OCR results _are_ seeded
(slide 6), because Whisper and Tesseract on a clear input are deterministic, accurate
operations — a representative sample, not a flattering invention. Seed apps whose screenshot
is true because the app really did render what you gave it.

Every file is exact-dimension, **24-bit PNG with no alpha channel** (`sharp` `.flatten()`),
which is what the store requires (it rejects alpha and wrong sizes).

| File                         | Size     | Store slot                                             |
| ---------------------------- | -------- | ------------------------------------------------------ |
| `screenshot-1-hero.png`      | 1280×800 | REAL capture — the new tab: dock, clock, widget cards  |
| `screenshot-2-notes.png`     | 1280×800 | REAL capture — Notes maximized, split Markdown/preview |
| `screenshot-3-store.png`     | 1280×800 | REAL capture — the App Store dialog                    |
| `screenshot-4-board.png`     | 1280×800 | REAL capture — NotaBoard, a sticky-note canvas         |
| `screenshot-5-files.png`     | 1280×800 | REAL capture — KimtFS, the on-device file system       |
| `screenshot-6-tools.png`     | 1280×800 | REAL capture — Voice to Text + Image to Text, tiled    |
| `screenshot-7-multitask.png` | 1280×800 | REAL capture — DevTools + Tasks + Calculator, three up |
| `screenshot-8-privacy.png`   | 1280×800 | Designed — why Kimtos / how it works / privacy         |
| `promo-small-440x280.png`    | 440×280  | Small promo tile                                       |
| `promo-marquee-1400x560.png` | 1400×560 | Marquee promo tile                                     |

The "Global promo video" (YouTube URL) slot is optional and left unset — there is no video.

## Per-app social cards (`app-cards/`)

`app-cards/app-<id>.png` is one 1600×900 card per shipped app, in the same brand treatment as
the listing assets, for introducing the apps a couple at a time rather than as a wall of
twenty-two. One size serves both networks: it is X's 16:9 in-stream landscape, and LinkedIn
centre-crops it to 1.91:1 without touching anything that carries meaning.

```bash
node extension/store-assets/app-cards.mjs        # -> extension/store-assets/app-cards/
```

**Every word on a card comes from the app's own `meta.ts`**, through the generated
`www/data/apps.ts` — name, accent, tier, `tech`, `desc` and the three `points`. Nothing is
written in the renderer. Copy invented at render time is copy nobody reviews, and it is how a
card ends up claiming something the app does not do; when a card reads badly the fix belongs
in the app's meta, where the docs and the marketing site improve with it. The one piece of
layout intelligence is that the type steps down a ladder when an app's `desc` is long
(Retouch's runs to 190 characters), so no app's description is truncated to fit.

These cards **do not depict the interface** — they are title cards, and honest about being
so. The listing slides frame real captures precisely so the store shows the true UI; a
hand-drawn approximation of a window would be a mock-up presented as a screenshot, which is
what that pipeline exists to avoid. Adding a real per-app capture to each card is a genuine
improvement and a much larger job: roughly half the apps open on an empty state, so each
would need its own seeded demo data in `capture.mjs` before it was worth photographing.

## Regenerate

Two steps, both from the repo root. The raw captures in `captures/` are **committed**, so
step 1 is only needed when the product UI changed; step 2 alone re-composes the slides.

```bash
# 1. Re-photograph the product (needs a local Chrome; override with KIMTOS_CHROME).
#    Boots the extension dev server, seeds the demo workspace (onboarding done,
#    light theme, realistic notes, tasks, a board, a file tree and clipboard history),
#    captures the single-app surfaces, then opens app windows via the launcher (⌘/) and
#    tiles them for the two multi-window desktops. All at 2x into captures/.
node extension/store-assets/capture.mjs

# 2. Compose the listing assets (needs @kimtos/icons built — `make shared` — and sharp).
node extension/store-assets/generate.mjs extension/store-assets
```

The generator prints each file's dimensions, channel count, and alpha flag so a bad export is
obvious, and **fails hard if the app catalog parses to zero apps** (a quote-style change in
the generated `www/data/apps.ts` once made it render empty slides while exiting 0). Edit the
slide copy in `generate.mjs`; edit the seeded demo content and the captured surfaces in
`capture.mjs`. The version pill in the captures is set to the manifest version — under
`vite dev` it would show the dev fallback, which is not what the installed build displays.
