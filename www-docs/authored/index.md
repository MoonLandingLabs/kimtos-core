---
layout: home
title: KimtOS
titleTemplate: ':title — Documentation'

hero:
  name: KimtOS
  text: Documentation
  tagline: A local-first, on-device app suite that lives in your new tab. Your data never leaves the machine. Free and open source (MIT).
  image:
    src: /favicon.svg
    alt: KimtOS
  actions:
    - theme: brand
      text: Browse the apps
      link: /apps/
    - theme: alt
      text: Source on GitHub
      link: '{{repoUrl}}'

features:
  - icon: { src: /feature-icons/local.svg, width: 36, height: 36 }
    title: Local-first, private
    details: Notes, todos, PDFs, recordings and AI chats live in your browser's own storage and never touch a server. There are no accounts and no backend. Every app is free, and KimtOS v1 is open source under the MIT licence.
  - icon: { src: /feature-icons/suite.svg, width: 36, height: 36 }
    title: An app suite, not a page
    details: Each app is a self-contained folder that's auto-discovered — a few declarative lines gets you a window, first-run tip, batch-delete, agent tools and a data console entry.
  - icon: { src: /feature-icons/ai.svg, width: 36, height: 36 }
    title: On-device AI
    details: Whisper, FLAN-T5, embeddings and small chat LLMs run in the browser via Transformers.js. No API keys, no round-trips — the models download once and run offline.
  - icon: { src: /feature-icons/vault.svg, width: 36, height: 36 }
    title: One data vault
    details: Everything an app stores flows through a single IndexedDB, browsable, exportable and clearable from AnubisDB — the on-device data console.
---
