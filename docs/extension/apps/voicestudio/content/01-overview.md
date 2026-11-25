# Overview

**Voice Studio** turns written text into spoken audio. Pick one of 28 voices,
type or paste anything from a single word to a whole article, and the app reads
it back in a clip you can play, keep and export as a WAV file. It is part of the
kimtos new-tab app suite, and it is free, with no account needed.

Everything happens **on your device**. The speech model runs inside your browser,
so the text you type and the audio it produces never leave the machine — there is
no server doing the synthesis, and nothing to upload. After the one-time model
download the app works with no network at all.

## Highlights

- **A picker of 28 voice cards** — US and UK, female and male, each a distinct
  speaker built into the model, shown as a card with its accent, gender and
  quality grade. Search by name and filter by accent, gender or the top picks.
- **Play a sample before you commit** — every card has a play button that speaks
  a short sample line in that voice. Auditioning does not change your selection,
  does not block anything else you are doing, and each sample is kept, so hearing
  a voice a second time is instant and works offline.
- **Settings that stick** — your voice, speed and whether every clip is saved
  automatically are app settings, reachable from the settings control in the
  window's title bar or from Settings ▸ Apps. They survive closing the window.
- **Long-form narration** — paste an entire article. The text is split at
  sentence boundaries, spoken piece by piece, and stitched back into **one
  continuous clip** with no audible seams.
- **Speed control** — slow a passage down to 0.5x or push it to 2x, in 0.1x
  steps.
- **Play, save, export** — every render gets a player, a **Download WAV** button
  and a **Save to clips** button.
- **Saved clips** — kept in a history sidebar with the text that produced them,
  so you can reopen a clip, replay it, or download it again later.
- **Multi-select delete** — switch the sidebar into select mode (or drag across
  rows) to remove several clips at once, with one-tap undo.
- **Cancel a long render** — a **Cancel** button stops narration between chunks
  rather than leaving you waiting out a mistake.
- **Agent tools (declared, not active)** — Voice Studio declares tools to list
  voices, speak text, list clips and delete a clip. No on-device model shipped
  today can drive them, so they do not run; they are there for when one can.

## Privacy model

Voice Studio makes exactly one kind of network request, and it is not about your
text:

- **Synthesis runs in your browser.** The Kokoro-82M speech model executes
  locally on WebAssembly, in a background worker. Your text is never sent
  anywhere to be spoken.
- **The model downloads once (~90 MB)** from the kimtos content host, along with
  a small style file (~0.5 MB) for each voice you actually use. Both are cached
  by the browser, so later sessions work **offline**.
- **Your clips stay local.** Saved audio and the text beside it live in your
  browser's local storage on this machine. There is no sync, no account data in
  the clip, and no third-party call.

Voice Studio is free and needs no account to install or use; your content never
leaves the device.

## What it is good at, and what it is not

Kokoro-82M is a small model, and the honest picture is worth having up front:

- **English only.** The model's repository carries voices for other languages,
  but they were trained against a different pronunciation frontend from the one
  the extension runs, so they would be mispronounced. Only the English voices
  ship.
- **Voices differ in quality.** The model's authors graded their own speakers,
  and those grades are on every card: the A and B voices are noticeably cleaner
  than the D and F ones. The four strongest are one filter away, under **Top
  picks**.
- **Pronunciation is rule-based.** Unusual names, invented words and heavy
  jargon can come out wrong. Speaking a single word is the fastest way to check
  one.
- **It is a reading voice, not an acting one.** There is no emotion, emphasis or
  pause control beyond speed — the model exposes speed and nothing else, and the
  app deliberately does not invent controls the model cannot honour.
