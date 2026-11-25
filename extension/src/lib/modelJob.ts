// Loading a model ON USE, as a job the user can see.
//
// A model download does not only happen from the App Store. Pressing Ask in Thoth, typing in
// Grammit, clicking a voice in Voice Studio — each can start a transfer of hundreds of megabytes
// the first time, and every one of them used to run as a bare promise: no row in KimtManager, no
// progress, no Stop, and nothing to tell it apart from the app having hung (#1307).
//
// Convention 11 says that work goes through the orchestrator. This is the shape of doing it for a
// model load specifically, in one place, because four apps need the identical three moves and a
// hand-copied version in each is how the last one drifted (#1275).
//
// It is deliberately thin: the orchestrator already owns the queue, the signal, the progress and
// the failure. All this adds is the value coming back out — `run` returns void, and a caller
// loading a model wants the model.

import { kimtManager } from './kimtManager.js';

/** The progress shape every engine reports (see `lib/engines/types.ts`). */
interface Progress {
  ratio?: number | null;
  loaded?: number;
  total?: number;
  label?: string;
}

/** Bytes as a reader sees them. */
const mb = (n: number): string => `${Math.round(n / 1e5) / 10} MB`;

/** The user-facing line for a tick: real bytes when the server gave a size, the engine's own
 *  phase otherwise. Never a number we made up — an invented percentage is a lie the user plans
 *  around (`JobContext.progress`). */
export function noteFor(p: Progress | null | undefined): string {
  const e = p ?? {};
  return e.total ? `${mb(e.loaded ?? 0)} of ${mb(e.total)}` : (e.label ?? 'Downloading');
}

export interface ModelJobOptions {
  appId: string;
  /** What the user sees while it runs. Write it for them: "Downloading the search model". */
  title: string;
  /**
   * Whether `load` really stops when its signal is aborted.
   *
   * Defaults to FALSE, which is the honest default: most engines own their own network and take
   * no signal, and a row offering a Stop that returns immediately while the transfer continues is
   * worse than a row with no Stop (#1302). Pass true only once the load honours the signal end to
   * end.
   */
  cancellable?: boolean;
}

/**
 * In-flight loads, so two callers that want the same model share one.
 *
 * Not a job registry — the orchestrator is that, and this holds no state of its own beyond a
 * promise it deletes the moment it settles. It exists because the orchestrator deliberately does
 * NOT dedupe: `register` allocates a fresh record every time, and `appBusy` only stops two jobs
 * RUNNING at once — the second is queued and then runs, loading the same model a second time.
 *
 * Thoth is the case: Rebuild index and Ask both call `ensureEmbedder`, both see it unset, and both
 * load. The second load's value wins the assignment and the first one's Worker is never referenced
 * again, so it is never disposed. Keyed by title as well as app because one app can want two
 * different models — Thoth wants an embedder AND a chat model.
 *
 * Cleared on settle, success or failure: this is dedup, not a cache. The callers keep the model
 * themselves, and a load that failed must be retryable (`asyncOnce.ts`'s `sharedByKey` keeps
 * successes forever, which is right for its callers and wrong here).
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Load a model as a registered download job, and hand back what it loaded.
 *
 * Shares a load already in flight for the same app and title — pressing Ask twice while the model
 * downloads must not start a second transfer of the same bytes.
 */
export function loadAsJob<T>(
  opts: ModelJobOptions,
  load: (onProgress: (p: Progress) => void, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const key = `${opts.appId}\u0000${opts.title}`;
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const started = runJob(opts, load).finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

async function runJob<T>(
  { appId, title, cancellable = false }: ModelJobOptions,
  load: (onProgress: (p: Progress) => void, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let out: T | undefined;
  const job = kimtManager.start({
    appId,
    title,
    kind: 'download',
    cancellable,
    // A stopped download keeps whole files already fetched but restarts the one in flight, so it
    // does not keep what it was doing. Honest until #1301 makes it resumable.
    savesOnStop: false,
    run: async (ctx) => {
      out = await load((p) => {
        ctx.progress(typeof p?.ratio === 'number' ? p.ratio : null);
        ctx.note(noteFor(p));
      }, ctx.signal);
    },
  });
  await job.run();

  const status = job.status();
  if (status === 'cancelled') throw new DOMException('Aborted', 'AbortError');
  if (status === 'failed') throw new Error(job.error() ?? 'The download failed.');
  return out as T;
}
