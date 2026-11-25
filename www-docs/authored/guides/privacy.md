---
title: Privacy
---

# Privacy

The short version: **everything you create in Kimtos stays on your device.** Notes, tasks,
PDFs, clipboard, recordings, whiteboards and AI conversations live in your browser's own
storage. We have no copy, and could not read them if we wanted to.

The AI runs on your machine too. Speech-to-text, OCR, denoising, grammar and chat all
execute inside the browser tab using WebAssembly and WebGPU. Your audio, images and text
are never uploaded for processing — there is no server doing it.

There are no accounts and no backend: Kimtos v1 collects nothing, because there is no server to
collect it. It is free and open source (MIT), so you can check this in the
[source code]({{repoUrl}}).

## The full policy

The complete, authoritative privacy policy is the Privacy page of the Kimtos marketing site; its
source is [`www/pages/privacy.vue`]({{repoUrl}}/blob/main/www/pages/privacy.vue) in the repository.

It is deliberately specific rather than boilerplate: it lists every third party involved, and **every** case where Kimtos touches the network. There is one:
**Kimtos makes no network request except the model downloads you start, from Hugging Face.**

We keep one copy of that policy, so there is no chance of two versions
drifting apart and one of them being wrong.

## Cookies

Neither this docs site nor the marketing site sets any cookies, analytics, advertising or
tracking. The only thing stored on your device is your light/dark theme choice, in your
browser's local storage. The full table, with the exact name, purpose and lifetime, is in the
policy's Cookies and local storage section.

Questions or problems: [open an issue]({{issuesUrl}}).

## Related

- [Your data](./your-data) — how to export, import, inspect and erase everything Kimtos
  has stored.
