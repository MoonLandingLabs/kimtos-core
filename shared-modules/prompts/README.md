# @kimtos/prompts

Shared **prompt library** for every `@kimtos` app. Prompts are authored as
Markdown (the source of truth) and a tiny, **model-agnostic** SDK renders them
into chat messages. Running a rendered prompt through a model (e.g. the
extension's on-device **KimtAI** chat engine) is the caller's job.

## Add a prompt

Drop a `prompts/<id>.md` file:

```md
---
id: rephrase
title: Strict Rephrase
description: One-line summary.
version: 1
vars: input # comma-separated {{var}} names the template needs
temperature: 0.4 # any extra keys become `defaults` (model params)
maxTokens: 256
---

## system

Instructions the model must always follow…

## examples (optional few-shot; becomes user/assistant turns)

Input: <<< some text >>>
Output: rephrased text

## user

INPUT TEXT:
<<<
{{input}}

> > >

Respond with ONLY the rephrased text now:
```

`prepare`/`build` inlines every `.md` into `src/generated.ts` (via
`scripts/build-prompts.ts`, run with `tsx`) so the text ships baked in — no
runtime `fs`, no bundler-specific `?raw`.

## SDK

```ts
import { renderPrompt, stripPreamble, listPrompts } from '@kimtos/prompts';

const p = renderPrompt('rephrase', { input: userText });
// p.messages → [{role:'system'}, …few-shot…, {role:'user'}]   (chat models)
// p.text     → single string (system + examples + user)         (no role split)
// p.defaults → { temperature: 0.4, maxTokens: 256 }

// …run p.messages through your chat model (KimtAI in the extension), then:
const clean = stripPreamble(modelReply); // drops "Sure! Here's…" + wrapping quotes
```

Notes:

- `{{var}}` values are interpolated; the `<<< >>>` block delimiters inside a value
  are neutralized (defense-in-depth against prompt injection).
- Missing declared `vars` throw, so a caller can't forget one.
