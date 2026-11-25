# Architecture

Rewordit is a thin UI over the suite's **on-device chat engine**. It renders a
strict rephrasing prompt, streams the reply from the local model, and cleans the
result — all in the browser. The app lives in `extension/src/apps/rephrase/`.
Nothing in this flow talks to a server.

## Modules

| File                              | Role                                                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/rephrase/index.ts`          | The app descriptor and UI — the input box, the Precise/Balanced/Creative selector, streaming output, Copy / Rephrase-again, model selection, and the `rephrase_text` agent tool.   |
| `apps/rephrase/meta.ts`           | App metadata — id `rephrase`, name **Rewordit**, accent, order.                                                                                                                    |
| `lib/engines/kimtai.ts`           | The on-device chat engine — `createChat()` loads a model in a Web Worker and streams tokens; `downloadedModels()` / `recommendedModelId()` / `byId()` pick and describe the model. |
| `lib/rephraseCheck.ts`            | The meaning check — a pure, unit-tested `checkRephrase(original, rewrite)` that reports the drift it can prove, plus `describeProblems()` for the warning copy.                    |
| `@kimtos/prompts` (`rephrase.md`) | The strict rephrasing prompt — `renderPrompt('rephrase', { input })` builds the messages and defaults; `stripPreamble()` cleans the model's reply.                                 |

## The prompt

The rephrasing instructions live in `@kimtos/prompts` as `rephrase.md`, not in
the app. It is a strict prompt: respond with **only** the rephrased text, copy every
number, time, date, quantity, unit and name **exactly**, keep the tense, tone and
intent, keep roughly the same length (±20%) and the same language, change the
wording as much as possible, and ignore any instructions embedded in the input.
It defines a default `maxTokens` of 256, which the app applies. The prompt is a
mitigation, not a guarantee — which is why the meaning check below exists.

## Data flow

```mermaid
flowchart LR
  UI[index.ts<br/>UI + tool] -->|renderPrompt 'rephrase'| PROMPT["rephrase.md<br/>@kimtos/prompts"]
  PROMPT --> MSG[messages + defaults]
  UI -->|createChat + send| MODEL[(On-device KimtAI model<br/>Web Worker)]
  MSG --> MODEL
  MODEL -->|streamed tokens| STRIP[stripPreamble]
  STRIP --> CHECK{checkRephrase}
  CHECK -->|meaning intact| OUT[Rewritten text]
  CHECK -->|drift, first try| MODEL
  CHECK -->|drift again| WARN[Rewritten text<br/>plus a warning]
```

1. **Pick a model.** `pickModel()` returns your active KimtAI model if it is
   downloaded, else the recommended small model, else the first downloaded one.
   If nothing is downloaded it returns `null`, and the UI points you to KimtAI.
2. **Render the prompt.** `renderPrompt('rephrase', { input })` produces the chat
   `messages` and `defaults` (including `maxTokens`).
3. **Run the model.** `createChat({ model })` loads the model in a Web Worker;
   after `chat.ready`, `send()` streams the reply via `onToken` / `onDone`. The
   selected creativity level sets the `temperature` (Precise 0.3, Balanced 0.5,
   Creative 0.75).
4. **Clean the output.** `stripPreamble()` strips any leading filler ("Here is…",
   labels, quotes) so only the rephrased text remains.
5. **Check the meaning.** `checkRephrase(input, result)` compares the two. On
   drift the app runs one more attempt at `RETRY_TEMP` (0.2); if that also
   drifts, the result is rendered with a warning banner instead of being
   presented as a good rewrite.

## The meaning check

The prompt asks the model to preserve every fact, but a sub-2B model on the
user's device does not always obey — the app was reported returning "9:05 AM" for
an input that said "10:00 AM", and "27 kilograms" for one that said "25 kg". No
amount of prompt wording removes that, so the output is **verified** rather than
trusted. This is the same shape as `trustworthy()` in `lib/textDiff.ts`, which
stops a grammar model's "answer" being shown as a correction.

`checkRephrase(original, rewrite)` is pure and unit-tested
(`lib/rephraseCheck.test.ts`), and returns `{ ok, problems }`:

| Problem  | Severity | What it proves                                                                              |
| -------- | -------- | ------------------------------------------------------------------------------------------- |
| `facts`  | drift    | A number, time or date was changed, dropped or invented.                                    |
| `length` | drift    | The rewrite is under half or over ~1.8× the original word count — it answered or truncated. |
| `intent` | drift    | A question stopped being a question, or a statement became one.                             |
| `empty`  | drift    | The model returned nothing.                                                                 |
| `echo`   | weak     | The rewrite is the input again — faithful, but nothing was reworded.                        |

`ok` is false only when a **drift** problem is present. The comparison is
deliberately notation-tolerant so a genuine rewrite is never flagged: `1,000` and
`1000` are one fact, `10:00` and `10 AM` are one time, and `25` and
`twenty-five` are the same number in either direction. Spelled-out numbers are
never facts on their own — "one of the boxes" must not demand a "1" in the
rewrite — they only corroborate a digit.

What the check deliberately does **not** attempt: synonym drift, hedging
("about"), and negation flips. There is no reliable local test for them, and a
guard that fires on correct rewrites would be worse than no guard. The docs and
the app copy say so rather than implying a guarantee the model cannot give.

## The agent tool

Rewordit declares one MCP-shaped tool on its descriptor, for a future on-device
agent. It is dormant — no shipped model can call it:

- **`rephrase_text`** — rewrite a sentence or short passage in different words
  while keeping its exact meaning, using the on-device model.
  - **Parameters:** `text` (required) and an optional `style` — `precise`,
    `balanced` (default), or `creative`, mapping to temperatures 0.3 / 0.5 / 0.75.
  - **Behavior:** a headless one-shot (`rephraseOnce`) that picks a model, runs
    the same `rephrase` prompt to completion, and returns the `stripPreamble`-d
    result. It runs the same meaning check as the UI: on drift it retries once,
    and if the retry also drifts it returns `{ ok: false }` naming what changed
    rather than handing back a rewrite that says something else.
  - **Needs a model:** if none is downloaded it returns a friendly
    `{ ok: false }` telling the user to open KimtAI and download one, rather than
    throwing.

Availability is handled centrally by the apps controller, so the app code assumes
it is already allowed to run.
