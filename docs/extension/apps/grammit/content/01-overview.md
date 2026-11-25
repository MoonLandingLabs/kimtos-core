# Overview

**Grammit** is a private writing assistant in the style of Grammarly. You just
type — a moment after you stop, it underlines spelling and grammar issues right
under your words. Click an underline to accept the fix. It is part of the kimtos
new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no
network call: every check runs inside your browser, and the text you write never
leaves the machine.

## Highlights

- **Live underlines** — type or paste text and Grammit flags issues as you go,
  Grammarly-style, on a backdrop that sits perfectly under your words.
- **Deterministic rules** — high-confidence fixes that are always on: common
  misspellings, missing apostrophes (contractions), the pronoun "I",
  capitalization, a/an, repeated words, spacing, subject–verb agreement, double
  negatives, comparatives, then/than, modal + of/to, and contextual homophones
  (their/there, your/you're, its/it's, to/too).
- **Real spell check** — a built-in 60k-word dictionary catches _any_
  misspelling, with frequency-ranked suggestions (loaded the first time you use
  it, no download from a server).
- **Click to fix** — clicking an underline opens a popover with one or more
  suggestions; pick one, type your own correction, or dismiss it.
- **Fix all** — apply every current suggestion at once as a single undoable edit.
- **Copy** — copy your cleaned-up text to the clipboard.
- **Optional AI deep grammar** — an on-device AI model for deeper grammar, off by
  default. When enabled it downloads once on first use and then runs locally.

## Privacy model

Grammit performs all of its analysis **on your device**:

- The deterministic rules and the spell-check dictionary run entirely in the
  browser, with no network access at all.
- The optional AI model downloads its files once (cached in the browser) and then
  runs locally; your text is never sent anywhere.
- There are no analytics and no third-party calls.

Because the whole pipeline is local, your writing stays yours — nothing is
uploaded, logged, or shared.
