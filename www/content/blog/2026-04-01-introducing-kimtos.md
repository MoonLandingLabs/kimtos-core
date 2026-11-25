---
title: A new tab that belongs to you
dek: KimtOS turns the emptiest page in your browser into a workspace that runs entirely on your machine.
date: 2026-04-01
author: The KimtOS team
---

Open a new tab and look at what you get. A search box, some thumbnails of sites you have
already been to, and an advertisement for something the browser would like you to try. It is
the page you see more often than any other, and almost nothing about it is yours.

KimtOS replaces it. Today it becomes a workspace: a clock, a wallpaper, and a dock of small
tools that open in a window over it — notes, tasks, a PDF library, a whiteboard, a clipboard
history, voice-to-text, a calculator, a file browser. The things you actually reach for
between one task and the next.

## The rule everything else follows

**Your data stays on your machine.** Not "encrypted in transit", not "we take privacy
seriously" — it does not leave. Notes, PDFs, clips, recordings and boards are written to
your browser's own storage. There is no account to create before you can use any of it,
because there is nowhere for it to go.

The AI works the same way. Speech-to-text, grammar checking, image-to-text and the assistant
all run models that are downloaded to your machine and executed there. A transcription of
a recording is a computation your laptop performs, not a file you upload. It works on a
plane.

That constraint is not a feature we added. It is the thing every other decision had to fit
around, and it is why the app is built the way it is.

## What is honest about the AI

The models that run in a browser tab are small, and small models are limited in ways worth
being plain about.

Speech-to-text is genuinely good. Grammar checking is three layers — a rules engine, a
frequency-ranked dictionary, and an optional deeper model you can turn on — and the first two
need no download at all. Image-to-text is solid on clean text.

The assistant is more modest. It answers questions and rewrites text. Each app also declares
a set of tools that an assistant could one day use to act on your behalf — to add a task, to
find a note — but that loop is switched off, because no model small enough to run on your
machine has yet proved reliable enough for us to trust it with your data. When one does, it
will be a setting rather than a rewrite.

We would rather ship the version of that sentence that is true.

## Free

Every KimtOS app is free, for everyone, and the project is open source. No account is needed;
signing in is optional and only lets us count how many people use KimtOS.

## Where it goes next

The list of apps will grow, and so will the number of places you can reach them from. What
will not change is the rule at the top: whatever we add has to work without asking you to
hand over the thing you were working on.

[Install KimtOS](https://chromewebstore.google.com/detail/kimtos/cmjagcogohpnfkladbfhgijofbcmedip)
and open a new tab.
