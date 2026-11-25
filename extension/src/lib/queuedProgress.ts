// What a progress bar should say while its job has NOT started yet.
//
// KimtManager runs one job per app (two would race the same model cache), so pressing an app's
// run button while that app is downloading its model queues the run behind the download. Every
// app that does this put its working screen up anyway — an indeterminate bar labelled
// "Preparing…" under a heading claiming the work was under way — and left it there for the
// length of a 280 MB transfer. That is indistinguishable from a hang, and the natural response
// to a hang is to close the window, which is the one thing that makes it worse (#1306).
//
// It lives here rather than in `progressBar` (which is a dumb component and must not know about
// the orchestrator) or in `kimtManager` (which reports facts and must not own wording). Three
// apps need the identical five lines, and a copy in each is how the last convention rotted until
// only one app still had it.

import { kimtManager, type Job } from './kimtManager.js';
import { type ProgressInfo } from '../components/progressBar.js';

/** The bar's half of the contract — anything that can be told what to display. */
interface ProgressTarget {
  update(p: ProgressInfo): void;
}

/** How a wait is described, by what is being waited for. */
export function queuedLabel(blocker: { kind: string } | null): string {
  if (!blocker) return 'Waiting to start…';
  if (blocker.kind === 'download') return 'Waiting for the model download to finish';
  if (blocker.kind === 'uninstall') return 'Waiting for the app to finish uninstalling';
  return "Waiting for this app's current job to finish";
}

/**
 * Report `task`'s WAIT on `bar` until it starts, and return an unsubscribe.
 *
 * Only while queued: the moment the engine reports anything, that is the truth and this stops
 * writing over it. The blocking job's own ratio is borrowed so the bar moves — a download at 43%
 * reads as progress, where the same wait with an indeterminate sweep reads as a hang.
 *
 * Call the returned function when the run settles, so a screen that has moved on leaves no
 * listener behind.
 */
export function followQueue(task: Job, bar: ProgressTarget): () => void {
  const paint = (): void => {
    if (task.status() !== 'queued') return;
    const blocker = kimtManager.blockerFor(task);
    bar.update({ phase: 'run', label: queuedLabel(blocker), ratio: blocker?.progress() ?? null });
  };
  const off = kimtManager.subscribe(paint);
  paint(); // the wait may already be on before the first notification
  return off;
}
