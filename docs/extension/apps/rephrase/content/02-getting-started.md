# Getting Started

Open **Rewordit** from the dock. Because it runs on the on-device model, it
needs a model downloaded before it can rewrite anything.

## Download a model first

Rewordit uses whichever on-device model you have in **KimtAI**. If you have not
downloaded one yet, Rewordit shows a short notice and an **Open KimtAI** button —
open KimtAI, download a model (the small default is enough), then come back.

Once a model is present, Rewordit picks one automatically:

- your **active** KimtAI model, if it is downloaded; otherwise
- the recommended small model, if you have it; otherwise
- the first downloaded model.

## Rewrite a sentence

1. **Type or paste** a sentence or short passage into the box.
2. **Pick a creativity level** (see below) — Balanced is the default.
3. Click **Rephrase**, or press **⌘/Ctrl+Enter**.

The result appears below and streams in word by word as the model generates it.
When it finishes, you get a **Copy** button and a **Rephrase again** button to
request another wording of the same input.

## When the rewrite is flagged

Once the model finishes, Rewordit compares the rewrite with your original text.
If a number, time or date changed, if the rewrite is far longer or far shorter
than the original, or if a question stopped being a question, it **rewrites once
more on its own** at the most conservative setting.

If that second attempt is also off, the result is shown with a warning naming
what changed — for example "A number or time changed: 25 became 27." The text
stays on screen so you can still read it, but it is not offered as a faithful
rewrite. Switching to **Precise**, shortening the input, or rephrasing again
usually fixes it.

A softer note appears when the model returns your sentence unchanged: the
meaning is safe, but nothing was actually reworded.

## Creativity levels

The level controls how far the rewrite may stray from the original wording — the
meaning is always kept fixed by the prompt.

| Level        | Strays…                                    |
| ------------ | ------------------------------------------ |
| **Precise**  | Least — small, safe substitutions.         |
| **Balanced** | A moderate rewrite (the default).          |
| **Creative** | Most — freer rephrasing and restructuring. |

## Tips

- Rewordit is built for **one sentence or a short passage** at a time, not long
  documents.
- The model keeps roughly the **same length** and the **same language** as your
  input, and preserves facts, numbers, names, tone, and intent.
- If the output looks empty or off, just **Rephrase again** — small on-device
  models vary run to run.
- The check catches changed numbers, times and dates, not shifted nuance. Read
  the rewrite before you use it somewhere that matters.

## As an agent tool (not active yet)

Rewordit declares a **`rephrase_text`** tool — text plus an optional `style`
(`precise`, `balanced`, or `creative`), using the same on-device model. **It does
not run today:** no shipped on-device model is reliable enough to call tools, so
the assistant cannot reword text for you. Use the app itself.
