# Overview

**KimtAI** is a private AI chat that runs a real language model **inside your
browser tab** — not in the cloud. You download a small instruction-tuned LLM
once, and from then on every message is answered on your own machine. Not a
single token is ever sent to a server. It is part of the kimtos new-tab app
suite.

KimtAI is a **chat assistant**. It answers questions, drafts and rewrites text,
and explains things — all locally. It does **not** act on your other apps: it
cannot add a task, save a note, or change anything for you. Ask it to, and it
will tell you so rather than pretend.

## Highlights

- **A real LLM in your tab** — a small instruction-tuned model runs locally via
  [Transformers.js](https://huggingface.co/docs/transformers.js) (`@huggingface/transformers`),
  preferring **WebGPU** for speed and falling back to CPU (**WASM**) when no GPU
  is available.
- **Fully on-device** — the conversation never leaves the browser. There is no
  backend, no account, and no network round-trip for chat.
- **The model** — KimtAI runs a small chat model on your own machine, fetched on
  demand and cached, so it downloads only once. The exact model KimtOS ships is
  listed in [Getting started](./02-getting-started.md); more are planned.
- **Streaming replies** — tokens stream into the message bubble as they are
  generated, rendered as Markdown.
- **Per-chat tuning** — set a system prompt (persona), creativity (temperature),
  and response length per conversation.
- **On the home screen** — an optional "Ask KimtAI" card gives one-click access,
  and the KimtOS home search bar can send your typed question straight into a new
  chat when the app opens. Turn the card off in Settings ▸ Preferences.
- **Persistent history** — conversations are saved locally; pin, rename, search,
  export to Markdown, or batch-delete with undo.

## What runs where

The model runs in a **Web Worker** (`kimtai.worker.ts`) so token-by-token
streaming never blocks the UI. It loads the model with Transformers.js and
streams tokens back to the app. Nothing else is involved — there is no server
and no second process.

## Privacy model

KimtAI writes only to local browser storage and never uploads your data:

- **Chats** (messages, title, per-chat config) are records in the shared IndexedDB
  (`chats` collection).
- **Model files** are cached by Transformers.js in Cache Storage
  (`transformers-cache`); which models you have downloaded is tracked in a small
  local key/value set (`kimtai:downloaded`).
- **Chat itself makes no network calls.** The one exception is explicit and
  user-triggered: downloading a model's files. That happens once, and the model
  runs offline from then on.
