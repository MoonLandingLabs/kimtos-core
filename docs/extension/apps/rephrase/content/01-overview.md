# Overview

**Rewordit** rewrites a sentence or short passage in different words while
keeping its **exact meaning**. Paste the text, pick how far it may stray, and it
returns a fresh wording — same facts, same tone, same intent. It is part of the
kimtos new-tab app suite and is free, with no account needed.

Everything runs **fully on-device**. Rewordit uses the on-device **KimtAI**
model (the same small language model that powers KimtAI), which runs entirely in
your browser. Your text never leaves the machine — there is no backend, no
account, and no network call.

## Highlights

- **Reword without losing meaning** — the model keeps the facts, numbers, names,
  tone, intent, and roughly the same length, and only changes the wording.
- **Every rewrite is checked** — Rewordit compares the result against your text
  and tells you when a number, time or date changed, when the rewrite ballooned
  or collapsed, or when a question stopped being a question.
- **Precise / Balanced / Creative** — three creativity levels control how far
  the rewrite strays from the original phrasing.
- **Runs on the on-device model** — generation happens locally on the downloaded
  KimtAI model; nothing is uploaded.
- **Copy and rewrite again** — copy the result in one click, or ask for another
  wording of the same input.
- **Agent tool (declared, not active)** — Rewordit declares a `rephrase_text`
  tool for a future on-device assistant. No shipped model can call it yet.

## What it can and cannot promise

The rewrite comes from a **small language model running on your own machine**,
not from a large hosted one. Such a model sometimes drifts: it can adjust a
number, shift a tense, or continue the sentence instead of rewording it.

Rewordit does not hide that. After every rewrite it runs a check against your
original text and, when the check finds drift, it rewrites once more at the most
conservative setting and then shows you exactly what changed. What the check can
prove — a changed, dropped or invented number, time or date; a rewrite far longer
or shorter than the original; a question that stopped being a question — it will
always catch. What it cannot prove — a synonym that shifts the nuance, a hedge
like "about", a meaning flipped without changing a number — is beyond any local
test, so read the result before you use it.

## Requirements

Rewordit needs a downloaded on-device model to run. If none is present yet, it
points you to **KimtAI** to download one first (a small model is enough). See
[Getting Started](02-getting-started.md).

## Privacy model

Rewordit sends nothing to a server. The input text is handed to the local model
running in a Web Worker in your browser, and the rewritten text comes straight
back. There are no analytics and no third-party calls — the text you rephrase and
the result both stay on your device.
