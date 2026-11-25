# Architecture

KimtManager is the app's face; the work itself lives in the **orchestrator**,
`extension/src/lib/kimtManager.ts`. The app renders what the orchestrator knows and stops what the
user asks it to stop — it holds no job state of its own.

## The orchestrator owns the work

Anything long-running is registered with it and **run by it**:

```ts
const job = kimtManager.start({
  appId,
  title: `Transcribing ${name}`,
  kind: 'compute',
  run: async (ctx) => {
    const out = await engine(input, {
      onProgress: (p) => ctx.progress(p.ratio ?? null),
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) return;
    await save(out);
  },
});
await job.run();
```

It owns the queue, the abort signal, the progress and the failure. That is what makes a download
started in the App Store the same object KimtManager lists and you can stop, rather than a private
promise only one file knows about. `installManager` runs installs and removals through it, and so
do Denoise and the media-to-text apps.

## Scheduling

Two jobs run at once **per lane**, and there are two lanes: `network` (downloads and removals) and
`compute` (everything else). Work of the same sort contends for the same resource — downloads for
one connection, inference for the same cores — and running more at once finishes later in total.

The lanes matter as much as the number. A single global limit would put a transcription you just
asked for behind a background model download: you would press Run and nothing would happen, which
is the confusion this whole feature exists to end.

One job per app at a time, so two downloads for the same app cannot race over the same cache. A job
whose app is busy is skipped rather than left blocking the queue behind it.

## Where the rows come from

`kimtManager.tasks()` builds the list both surfaces render — KimtManager itself and the switcher
(`views/appSwitcher.ts`). It draws on three things:

| Source              | What it contributes                                                            |
| ------------------- | ------------------------------------------------------------------------------ |
| the registry        | every registered job: downloads, transcriptions, exports — live, with progress |
| `lib/jobStore.ts`   | work **orphaned** by a page that died, which an in-memory registry cannot know |
| `lib/appControl.ts` | windows that are open or minimized in this page                                |

`jobStore` is the durable half, not a second live source: it writes the work down _before_ it
starts, so the record outlives the page. The registry cannot remember something that happened in a
page that no longer exists, and `jobStore` cannot report progress on something running now. They
are complementary.

One row per app. Where an app is doing several things the more urgent wins — a failure, then a
download, then other work, then merely being open — so the machine never reads as busier than it is.

A failure stays in the registry until it is cleared. It is the one outcome that will not resolve
itself, and dropping the record the moment it failed would make the row vanish as though the work
had simply completed.

## Stopping

Stopping routes by what the work actually is:

- a **registered job** is cancelled through the orchestrator, which aborts its signal and frees its
  slot — this covers downloads, transcriptions and everything else that registered
- **orphaned** work is ended, so it stops offering to resume
- a **window** is closed, which runs the app's own teardown

Work declared `cancellable: false` — an uninstall, say, which is destructive to interrupt halfway —
is offered no Stop at all, rather than a button that silently does nothing.

A row that has **failed** is the other case with no live job behind it, and it gets **Retry** and
**Dismiss** in place of the Stop. Removing the Stop on its own would have been worse than leaving
it: a failed row has no other control, so the user would be looking at a failure they could not
clear. Both actions live beside the stop in `lib/kimtManager.ts` and both surfaces call them, for
the same reason the stop does — the switcher once grew its own and it was wrong.

## How the app reaches the windows

An app's `render(body, ctx)` gets `close` and `openApp`, and nothing else. Widening that so one app
could drive every other app's window would hand a general-purpose remote control to all of them.

Instead the apps controller publishes a small, fixed interface — list windows, stop one, focus one —
through `lib/appControl.ts`, and only the two surfaces that legitimately manage windows read it.

## Refreshing

The orchestrator notifies on every change, so downloads and jobs update immediately. Windows have no
event of their own, so they are re-read on a slow tick while the app is open. The interval is
cleared by the app's teardown — an app that left a timer behind would go on working after its window
closed, which is exactly the class of problem this app exists to make visible.
