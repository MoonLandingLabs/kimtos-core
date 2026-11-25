---
title: We benchmarked our own AI, and it failed
dek: The model we ship picked the right tool once in six attempts. Here is the number, what it cost us to look, and what we are doing about it.
date: 2026-08-17
author: The KimtOS team
---

Every app in KimtOS declares a set of tools. Tasks can list your tasks and create one. Notes
can search your notes. Clipboard can list what you copied. They are described in the format an
AI assistant expects, and they have been sitting there, unused, since the day we shipped.

The plan was always to switch them on. Before we did, we measured whether the assistant we
ship could actually use them.

## The number

Six ordinary requests. "What tasks do I have today?" "Create a task called review the PR."
"Find my notes about the invoice." A model that can drive the apps should call the right tool,
with the right argument, six times out of six.

The model we ship, SmolLM2-360M, got **one**.

The score is not the interesting part. This is: asked what tasks it had today, it replied

> You have no tasks today.

It had not looked. There was no tool call, no query, nothing — just a fluent sentence about
the contents of a list it never opened. Another run answered _"You can't do anything for the
user today."_ A third invented a tool that does not exist and called it twice.

A model that fails loudly is an inconvenience. A model that confidently reports doing what it
never did is worse than no model at all, because the user has no way to tell the difference.
If that had shipped, the first person to trust it would have been told their task list was
empty when it was not.

## So we left it off, and wrote it down

The tools are still declared in every app. The loop that would run them is off, and our own
engineering notes say why, with the number in them. Public documentation has a bad habit of
describing the version of a product the team hoped to ship, so we have a build check that fails
whenever our own writing describes the assistant as able to act on your data, which it cannot.

## Then we asked whether the tools were the problem

A failed benchmark tells you something is wrong. It does not tell you which half.

So we changed exactly one variable. The same tool definitions, not a line rewritten, served
over the Model Context Protocol and read by a capable hosted model instead of a small local
one.

**Six out of six.** On the five-tool set the local model had failed, and again on the entire
catalogue every app declares. No wrong tools, no invented ones, and not one confident answer
in place of a tool call.

The tools were the sound half all along. What we built into every app was right; the thing we
asked to read it was too small.

## What we are honest about

Two things this does not prove, which we would rather say ourselves.

It is six prompts. Six prompts separate "cannot do this" from "can". They do not tell you how
a model behaves on the hundredth turn, on a chained request, or on a request that should call
no tool at all.

And it does not prove hosting is the only route. A bigger model that still runs on your
machine is the other way to change the same variable, and we have not measured that yet. The
gap we measured is real; the conclusion that it can only be closed off-device is not something
this experiment settles.

## Where that leaves us

We are building a version you reach from any device rather than from one browser's new tab,
with models we host so there is no API key to paste. For anyone who wants the boundary exactly
where it is today, running it yourself will stay an option, and the extension is not going
anywhere.

The lesson we would pass on is smaller than the plan. Measure the thing you are about to
claim, before you claim it, and publish what you find even when it is not the number you
wanted. Ours told us to go and build something else.
