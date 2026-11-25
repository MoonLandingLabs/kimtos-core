// KimtManager — the one registry for background work (#1172).
//
// THE RULE: anything that keeps running after the user has looked away registers here. A model
// download, a transcription, an export, a long import. If it is not registered it is invisible —
// and invisible work is the whole complaint this exists to answer: a clip still playing, a
// microphone still held, a download that looks like nothing is happening.
//
// Before this there was no registry at all. Downloads lived in `installManager`, compute lived in
// `jobStore`, windows lived in the apps controller, and the only way to know what was running was
// to ask all three and hope nobody had added a fourth. That is a hand-maintained list wearing a
// different hat, and this codebase has paid for those repeatedly. So: one registry, and a view
// model built from it.
//
// WHAT IS AND IS NOT HERE. The registry knows about LIVE work in this page. Two things it cannot
// know on its own are folded in by `tasks()`:
//   - orphaned work — a job whose page died mid-run. Only `lib/jobStore.ts` survives that, because
//     it writes the record to disk BEFORE the work starts (#314). A live registry cannot remember
//     something that happened in a page that no longer exists.
//   - open windows — not background work at all, but the user is looking for "what is running",
//     and an app sitting minimized holding a microphone is exactly that.
//
// For the app that renders this, see `apps/kimtmanager`. The switcher renders the same `tasks()`.
import { endJob, pendingJob } from './jobStore.js';
import { appControl } from './appControl.js';

export type JobStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/**
 * How many jobs may run at once, PER LANE.
 *
 * Two, because work of the same sort contends for the same resource: model downloads competing for
 * one connection finish later in total than the same downloads run in sequence, and on-device
 * inference competing for the same cores does the same. A queue the user can see beats a stampede
 * they cannot.
 *
 * Lanes matter as much as the number. A single global limit would put a transcription the user
 * just asked for behind a background model download — they clicked Run and nothing would happen,
 * which is precisely the "is it doing anything?" confusion this whole feature exists to end.
 * Downloads contend for bandwidth, compute contends for cores, and the two do not contend with
 * each other, so they queue separately.
 */
const MAX_PER_LANE = 2;

type Lane = 'network' | 'compute';
const laneOf = (kind: JobKind): Lane => (kind === 'download' || kind === 'uninstall' ? 'network' : 'compute');

/** What sort of work it is. Drives ordering and the wording the user sees. */
export type JobKind = 'download' | 'uninstall' | 'compute' | 'export' | 'other';

/** Handed to a job's `run` so it can report on itself. */
export interface JobContext {
  /** 0..1, or null when the work genuinely cannot be measured. Do not invent a number. */
  progress: (ratio: number | null) => void;
  /** Replace the user-facing line, e.g. 'Transcribing meeting.webm'. */
  note: (text: string) => void;
  /** Aborted when the job is cancelled. Honour it. */
  signal: AbortSignal;
}

export interface JobSpec {
  /** The app this belongs to — it is how the row gets its name and icon. */
  appId: string;
  /** What the user sees while it runs. Write it for them, not for a log. */
  title: string;
  kind?: JobKind;
  /** False for work that cannot be interrupted safely; the row then offers no Stop (#1172). */
  cancellable?: boolean;
  /**
   * True when stopping this work KEEPS what it has produced so far — a recording is finished and
   * written to its history, not thrown away.
   *
   * Declared rather than assumed, because "stop" costs different things to different work and a
   * prompt that guesses gets it wrong for most of them: a download restarts from nothing, a
   * transcription loses the run, a recording keeps every second it captured. `stopAllPrompt` already
   * states each of its costs only when it applies (#1213); this is the same rule for the surfaces
   * that ask before ending live work, and without it a stop-all confirm would tell the user their
   * recording was about to be lost immediately after we made sure it would not be (#1244).
   */
  savesOnStop?: boolean;
  /**
   * Work that is ALREADY under way and cannot be scheduled — a live capture: a recording, a held
   * microphone. It starts the moment it is run, and it does not occupy a lane slot.
   *
   * Both halves matter, and both are about telling the truth (#1244). A queued row is a claim that
   * the work has not started yet; on a recording the camera is already rolling, so the row would be
   * wrong AND its Stop would be worse than wrong — cancelling a queued job just drops the record,
   * so the row would vanish while the recording carried on. And letting a recording that may last
   * twenty minutes hold a compute slot would stall a transcription the user asked for afterwards,
   * to throttle work that was never throttleable in the first place.
   *
   * Ordinary background work — a download, a transcription, an export — is NOT this. It is
   * schedulable, and the queue is what keeps two of them from fighting over one connection.
   */
  immediate?: boolean;
  run: (ctx: JobContext) => Promise<void>;
}

export interface Job {
  readonly id: string;
  readonly appId: string;
  readonly title: string;
  readonly kind: JobKind;
  readonly cancellable: boolean;
  /** Stopping this keeps what it has produced so far — see `JobSpec.savesOnStop`. */
  readonly savesOnStop: boolean;
  /** Start it. Resolves when the work settles; never rejects — read `status()`/`error()`. */
  run: () => Promise<void>;
  cancel: () => void;
  status: () => JobStatus;
  /** 0..1, or null when unmeasurable. */
  progress: () => number | null;
  /** The current user-facing line. */
  label: () => string;
  error: () => string | null;
}

interface JobRecord {
  id: string;
  spec: Required<Pick<JobSpec, 'appId' | 'title' | 'kind' | 'cancellable' | 'savesOnStop' | 'immediate'>> & {
    run: JobSpec['run'];
  };
  status: JobStatus;
  ratio: number | null;
  note: string;
  err: string | null;
  controller: AbortController;
  /** Resolves when the job settles. One per record, so several `run()` calls share one outcome. */
  settled?: Promise<void>;
  finish?: () => void;
}

const records = new Map<string, JobRecord>();
const listeners = new Set<() => void>();
let seq = 0;

const notify = (): void => listeners.forEach((fn) => fn());

const runningRecords = (): JobRecord[] => [...records.values()].filter((r) => r.status === 'running');
/** One job per app at a time. Two downloads for the same app would race over the same cache. */
const appBusy = (appId: string): boolean => runningRecords().some((r) => r.spec.appId === appId);
/** How full a lane is. `immediate` work does not count — it was never scheduled, so throttling
 *  around it would only delay the work that CAN be scheduled (see `JobSpec.immediate`). */
const laneLoad = (lane: Lane): number =>
  runningRecords().filter((r) => !r.spec.immediate && laneOf(r.spec.kind) === lane).length;

const handleFor = (rec: JobRecord): Job => ({
  id: rec.id,
  appId: rec.spec.appId,
  title: rec.spec.title,
  kind: rec.spec.kind,
  cancellable: rec.spec.cancellable,
  savesOnStop: rec.spec.savesOnStop,
  run: () => enqueue(rec),
  cancel: () => cancelRecord(rec),
  status: () => rec.status,
  progress: () => rec.ratio,
  label: () => rec.note,
  error: () => rec.err,
});

/**
 * Queue a job and settle when it eventually finishes.
 *
 * `run()` is idempotent: calling it twice joins the same outcome rather than starting the work
 * twice. That matters because the App Store, the manager and an app's own button can all reach the
 * same job, and "download it again on top of itself" is never what any of them meant.
 */
function enqueue(rec: JobRecord): Promise<void> {
  // A FAILED job may be run again — that is what a retry is. Everything else joins the outcome it
  // already has, so two surfaces reaching the same live job cannot start the work twice.
  if (rec.status === 'failed') {
    rec.settled = undefined;
    rec.finish = undefined;
    rec.controller = new AbortController(); // the old one is aborted or spent
    // And the error goes with it. `execute` clears it, but only once a slot frees — so a retried
    // job sat QUEUED still carrying the failure: styled as failed, sorted to the top of the list,
    // and excluded from a batch stop, all while it was on its way to running again (#1216).
    rec.err = null;
  }
  if (rec.settled) return rec.settled;
  rec.settled = new Promise<void>((resolve) => {
    rec.finish = resolve;
  });
  rec.status = 'queued';
  rec.note = rec.spec.title;
  notify();
  // Live work skips the scheduler entirely — it is already happening, so there is nothing to
  // schedule and nothing honest to say while it waits (see `immediate`).
  if (rec.spec.immediate) void execute(rec);
  else pump();
  return rec.settled;
}

/**
 * Start whatever may start now — the scheduler.
 *
 * Runs in registration order so the queue is first-come-first-served, which is the only ordering a
 * user can predict. A job whose app is already busy is skipped rather than blocking the ones behind
 * it, so one slow app cannot stall everything else.
 */
function pump(): void {
  for (const rec of records.values()) {
    if (rec.status !== 'queued' || rec.spec.immediate || appBusy(rec.spec.appId)) continue;
    if (laneLoad(laneOf(rec.spec.kind)) >= MAX_PER_LANE) continue;
    void execute(rec);
  }
}

async function execute(rec: JobRecord): Promise<void> {
  if (rec.status !== 'queued') return;
  rec.status = 'running';
  rec.err = null;
  notify();
  try {
    await rec.spec.run({
      progress: (ratio) => {
        rec.ratio = ratio;
        notify();
      },
      note: (text) => {
        rec.note = text;
        notify();
      },
      signal: rec.controller.signal,
    });
    // A job that finished AFTER being cancelled is still cancelled — some work cannot abort its own
    // network, and reporting it as done would contradict what the user was just told.
    rec.status = rec.controller.signal.aborted ? 'cancelled' : 'done';
  } catch (e) {
    const aborted = rec.controller.signal.aborted || (e instanceof Error && e.name === 'AbortError');
    rec.status = aborted ? 'cancelled' : 'failed';
    if (!aborted) rec.err = e instanceof Error ? e.message : String(e);
  } finally {
    // Work that finished or was cancelled leaves the registry — it is not "what is running", and
    // keeping it would turn the manager into a log.
    //
    // A FAILURE stays. It is the one outcome that will not resolve itself and the one the user has
    // to be told about: a model download that died needs to be seen and retried, and dropping the
    // record the instant it failed would make the row vanish as if the work had simply completed.
    // It is cleared by `clearFailed`, which is what a retry or a dismissal calls.
    if (rec.status !== 'failed') records.delete(rec.id);
    rec.finish?.();
    notify();
    pump(); // this slot is free — let the queue move
  }
}

function cancelRecord(rec: JobRecord): void {
  // A QUEUED job can be cancelled too — it has not started, so it simply never will.
  if (!rec.spec.cancellable || (rec.status !== 'running' && rec.status !== 'queued')) return;
  rec.controller.abort();
  rec.status = 'cancelled';
  // Dropped at once rather than waiting for work that may not be able to abort its own fetch: the
  // user asked for it to stop, and a row that lingers reads as "it ignored me". `execute`'s finally
  // is a no-op afterwards — deleting an id twice is harmless — so the slot is released either way.
  records.delete(rec.id);
  rec.finish?.();
  notify();
  pump();
}

/** Register background work WITHOUT starting it. Call `job.run()` when ready. */
export function register(spec: JobSpec): Job {
  // A new attempt supersedes the old failure. Without this, an app that failed once stayed marked
  // failed for the life of the page — a later successful retry created a fresh record that
  // completed and vanished, while the stale failed one kept being what `tasks()` reported. The
  // user saw "failed" forever on work that had actually succeeded, and every failure leaked a
  // record that nothing could collect.
  clearFailed({ appId: spec.appId });
  const rec: JobRecord = {
    id: `${spec.appId}:${++seq}`,
    spec: {
      appId: spec.appId,
      title: spec.title,
      kind: spec.kind ?? 'other',
      cancellable: spec.cancellable ?? true,
      savesOnStop: spec.savesOnStop ?? false,
      immediate: spec.immediate ?? false,
      run: spec.run,
    },
    status: 'idle',
    ratio: null,
    note: spec.title,
    err: null,
    controller: new AbortController(),
  };
  records.set(rec.id, rec);
  notify();
  return handleFor(rec);
}

/** Register and queue in one call — what almost every caller wants. */
export function start(spec: JobSpec): Job {
  const job = register(spec);
  void job.run();
  return job;
}

/** Everything waiting for a slot. Shown so a queue never looks like a hang. */
export const queued = (): Job[] => list().filter((j) => j.status() === 'queued');

const recordOf = (job: Job | string): JobRecord | undefined => records.get(typeof job === 'string' ? job : job.id);

export function cancel(job: Job | string): void {
  const rec = recordOf(job);
  if (rec) cancelRecord(rec);
}

/** 'done' for anything the registry no longer holds: it is not running, and that is what was asked. */
export function statusOf(job: Job | string): JobStatus {
  return recordOf(job)?.status ?? 'done';
}

export const get = (id: string): Job | null => {
  const rec = records.get(id);
  return rec ? handleFor(rec) : null;
};

/** Every registered job, running or not yet started. */
export const list = (): Job[] => [...records.values()].map(handleFor);

/** Only what is actually working right now. */
export const running = (): Job[] => list().filter((j) => j.status() === 'running');

/** Working OR waiting for a slot — what "is this app busy?" means to a user. A queued download has
 *  not stalled; it just has not started, and a surface that reported it as idle would be lying. */
export const active = (): Job[] => list().filter((j) => j.status() === 'running' || j.status() === 'queued');

/** The first active job for an app, if any. */
export const jobFor = (appId: string): Job | null => active().find((j) => j.appId === appId) ?? null;

/**
 * What is keeping `job` waiting — the running job of the same app, or null when nothing is.
 *
 * A queued job is not a stalled one, but a surface that cannot say WHY it is waiting has no way
 * to tell the difference, and neither has the user: a run queued behind its own model download
 * showed an indeterminate bar labelled "Preparing…" under a heading that claimed the work was
 * under way, for the length of a 280 MB transfer (#1306). The scheduler already knows the
 * answer — one job per app, so the job in front is that app's — and this is it as a FACT.
 * Wording belongs to whoever is doing the telling.
 */
export const blockerFor = (job: Job): Job | null =>
  job.status() === 'queued' ? (running().find((j) => j.appId === job.appId) ?? null) : null;

/** A failure this app has not had cleared yet. */
export const failedFor = (appId: string): Job | null =>
  list().find((j) => j.appId === appId && j.status() === 'failed') ?? null;

/**
 * Forget failures — what a retry or a dismissal calls.
 *
 * SCOPE IT. With no filter this clears every failure in the registry, and the App Store used to
 * call it that way on open: a Denoise failure the user had not seen yet was wiped as a side effect
 * of opening an unrelated dialog. Pass an app id, or a lane, or both.
 */
export function clearFailed({ appId, lane }: { appId?: string; lane?: Lane } = {}): void {
  let dropped = false;
  for (const [id, rec] of records)
    if (rec.status === 'failed' && (!appId || rec.spec.appId === appId) && (!lane || laneOf(rec.spec.kind) === lane)) {
      records.delete(id);
      dropped = true;
    }
  if (dropped) notify();
}

/** Called whenever anything about the registry changes. Returns an unsubscribe. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam: drop every record. Never call this from app code. */
export function __reset(): void {
  records.clear();
  seq = 0;
}

// ---------------------------------------------------------------------------
// The view model — what KimtManager and the switcher both render.
// ---------------------------------------------------------------------------

export type TaskKind = JobKind | 'window';

export interface RunningTask {
  appId: string;
  name: string;
  accent?: string;
  kind: TaskKind;
  label: string;
  ratio: number | null;
  minimized: boolean;
  /** False when the work cannot be interrupted — the row then offers no Stop rather than a button
   *  that does nothing, which is what an uninstall's Stop used to be. */
  cancellable: boolean;
  error?: string;
  /** Set for a registered job, so a surface can stop exactly this one. */
  jobId?: string;
}

export interface TaskSources {
  /** Apps a task can be attributed to — for the name and icon. */
  known: { id: string; name: string; accent?: string }[];
  /** Apps with a window right now, and whether each is only minimized. */
  windows: { id: string; minimized: boolean }[];
}

const ORDER: Record<TaskKind, number> = {
  download: 0,
  uninstall: 1,
  compute: 2,
  export: 3,
  other: 4,
  window: 5,
};

/**
 * Everything running, most urgent first, ONE row per app.
 *
 * An app downloading a model AND holding a window open is one thing to the user; two rows would
 * make the machine read as busier than it is. Where an app is doing more than one thing the more
 * urgent wins — a failure, then a download, then other work, then merely being open.
 */
export async function tasks({ known, windows }: TaskSources): Promise<RunningTask[]> {
  const byId = new Map(known.map((a) => [a.id, a]));
  const openById = new Map(windows.map((w) => [w.id, w.minimized]));

  // Every app that could contribute a row: anything known, plus any app with a window or a live job
  // that is NOT in `known`. That last case is real — uninstalling an app does not close its window —
  // and dropping it would make this list quietly miss something the switcher still shows.
  const ids = new Set<string>([...byId.keys(), ...openById.keys(), ...active().map((j) => j.appId)]);
  const nameOf = (id: string): string => byId.get(id)?.name ?? id;

  const rows = await Promise.all(
    [...ids].map(async (id): Promise<RunningTask | null> => {
      const minimized = openById.get(id) ?? false;
      const base = { appId: id, name: nameOf(id), accent: byId.get(id)?.accent, minimized };

      const job = jobFor(id) ?? failedFor(id);
      if (job)
        return {
          ...base,
          kind: job.kind,
          label: job.label(),
          ratio: job.progress(),
          cancellable: job.cancellable,
          error: job.error() ?? undefined,
          jobId: job.id,
        };

      // Not running here — but a record on disk means a page died mid-run and the work is
      // recoverable. Only jobStore can know that; the registry cannot remember a dead page.
      let orphan = null;
      try {
        orphan = await pendingJob(id);
      } catch {
        /* a record we cannot read is one we cannot report; the window state below still shows */
      }
      if (orphan)
        return {
          ...base,
          kind: 'compute',
          label: orphan.name ? `Unfinished: ${orphan.name}` : 'Unfinished work',
          ratio: null,
          cancellable: true,
        };

      if (openById.has(id))
        return { ...base, kind: 'window', label: minimized ? 'Minimized' : 'Open', ratio: null, cancellable: true };
      return null;
    }),
  );

  return rows
    .filter((t): t is RunningTask => t !== null)
    .sort((a, b) => Number(Boolean(b.error)) - Number(Boolean(a.error)) || ORDER[a.kind] - ORDER[b.kind]);
}

/** Is this row background work, as opposed to a window that merely exists? */
export const isBackgroundWork = (t: RunningTask): boolean => t.kind !== 'window';

/** Read the tasks using the page's own window controller — what both surfaces call. */
export async function currentTasks(known: TaskSources['known']): Promise<RunningTask[]> {
  return tasks({ known, windows: appControl()?.windows() ?? [] });
}

/**
 * Stop one task, by what it actually is.
 *
 * Three owners, three ways of letting go: a REGISTERED job is cancelled through the orchestrator
 * (which aborts its signal and frees its slot), an ORPHANED record — work whose page died — is
 * ended so it stops offering to resume, and a WINDOW is closed, which runs the app's own teardown.
 *
 * Routing all three through one stop that only closed the window would leave a download running
 * while telling the user it had stopped, which is worse than having no button. A task that cannot
 * be interrupted is never offered one in the first place (see `cancellable`).
 *
 * It lives HERE, beside the model, and not in the view that first needed it. The KimtManager
 * window owned it privately, so the switcher could not call it and grew its own stop that only
 * closed the window — the exact failure the paragraph above warns about, shipped (#1212). Two
 * views, one truth applies to the stop as much as to the list.
 */
export async function stopTask(task: RunningTask): Promise<void> {
  if (task.jobId) {
    cancel(task.jobId);
    return;
  }
  if (task.kind !== 'window') {
    await endJob(task.appId);
    return;
  }
  appControl()?.stopApp(task.appId);
}

/**
 * Run a failed job again. Returns whether there was anything left to run.
 *
 * `run()` is deliberately re-runnable after a failure (see `enqueue`), and the record is still in
 * the registry precisely because nobody has dismissed or retried it yet.
 *
 * THE RETURN VALUE IS THE POINT, and false is genuinely reachable — a row is rendered from a
 * snapshot, and the record behind it can be cleared before the user clicks. Opening the App Store
 * calls `clearInstallErrors`, which drops EVERY network failure for every app; the App Store's own
 * Install button clears this app's failure and registers a fresh job with a new id. Either way the
 * `jobId` on the rendered row no longer resolves.
 *
 * Swallowing that would rebuild the exact defect this function exists to remove: a button that
 * looks live and does nothing when pressed (#1216). So the caller is told, and repaints — the row
 * disappears, which is the truth, instead of sitting there absorbing clicks.
 *
 * A row with no `jobId` at all is orphaned work; it resumes from the input `jobStore` saved,
 * through the app's own resume banner, and is likewise reported as nothing-to-do here.
 */
export async function retryTask(task: RunningTask): Promise<boolean> {
  const job = task.jobId ? get(task.jobId) : null;
  if (!job) return false;
  await job.run();
  return true;
}

/**
 * Drop a failed row.
 *
 * This discards a NOTICE, not work: the job already stopped, and its record is kept only so the
 * user finds out it failed. Nothing is lost by clearing it, which is why neither surface asks
 * before doing it — a confirm here would be ceremony over an undo-able nothing.
 */
export function dismissTask(task: RunningTask): void {
  clearFailed({ appId: task.appId });
}

/** What a batch stop did, so the caller can report it without re-deriving the rule. */
export interface StopAllResult {
  stopped: RunningTask[];
  /** Left running because it declares `cancellable: false`. */
  skipped: RunningTask[];
}

/**
 * Stop everything that can be stopped, and say what could not (#1213).
 *
 * `cancellable: false` work is never touched — not attempted and quietly failing, but excluded,
 * so a caller can name it. That flag exists precisely because pretending to stop such work is a
 * lie, and a batch is the easiest place to tell that lie at scale.
 *
 * Stops are issued together rather than in sequence: they are independent, and one that rejects
 * must not strand the rest. A failure is swallowed per task for the same reason — the user asked
 * for everything to stop, so one uncooperative task should not abort the other nine.
 */
export async function stopAll(list: readonly RunningTask[]): Promise<StopAllResult> {
  const stopped = list.filter((t) => t.cancellable && !isFailed(t));
  const skipped = list.filter((t) => !t.cancellable && !isFailed(t));
  await Promise.all(stopped.map((t) => stopTask(t).catch(() => {})));
  return { stopped, skipped };
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Work whose page died: no live job to cancel, so `stopTask` ends the RECORD — and `endJob`
 *  deletes the input it saved. That is the one branch of the batch that destroys a file. */
const isOrphaned = (t: RunningTask): boolean => !t.jobId && isBackgroundWork(t);

/**
 * A job that already FAILED. It is still listed — the user has not dismissed or retried it — but
 * it is not running, and `cancelRecord` no-ops on anything that is not running or queued.
 *
 * So it must be excluded from the batch, in both directions: counting it would promise to stop
 * something that has already stopped (and, for a failed download, promise a restart that will not
 * happen), and reporting it as `stopped` would be a lie about what the batch did. It is not
 * `skipped` either — that line says "will keep running", and this is not running. Clearing a
 * failed row is `clearFailed`, a different action from stopping live work.
 *
 * EXPORTED because the views need the same answer. Both rendered a Stop for a failed row and it did
 * nothing when pressed (#1216) — and the fix is only safe while "failed" means one thing here and
 * in both views. A second `task.error` test written in a view is how the two drift.
 */
export const isFailed = (t: RunningTask): boolean => Boolean(t.error);

/**
 * What to ask before stopping everything, or '' when there is nothing to stop.
 *
 * A pure string so both surfaces say the SAME thing — the copy is the part most likely to drift
 * between two views, and this batch destroys different things depending on what is in it, so being
 * vague is how a user loses something they did not expect to lose.
 *
 * EACH COST IS STATED ONLY WHEN IT APPLIES, and this is the part the first draft got wrong: it
 * told every batch containing any background job that "anything downloading starts again from the
 * beginning", which is false for a transcription and worse than vague for unfinished work. The
 * three are genuinely different:
 *
 *   - a DOWNLOAD restarts from the beginning — bytes, refetchable, the per-row confirm's wording;
 *   - UNFINISHED work has its saved input deleted by `endJob`, and for a recording that file is
 *     often the only copy. It does not restart; it is gone;
 *   - a WINDOW runs the app's teardown and discards what it had open (the session rule).
 *
 * Work that CANNOT be stopped is named and left running. That is information, not a gate: the
 * bulk-delete convention holds Confirm behind an acknowledgement when a batch would destroy a
 * protected item, and here the opposite is true — this work is excluded from the batch, so nothing
 * it owns is at risk and there is nothing to consent to. Saying nothing would be the only wrong
 * option, because the button says "all".
 */
export function stopAllPrompt(list: readonly RunningTask[]): string {
  const jobs = list.filter((t) => t.cancellable && !isFailed(t) && isBackgroundWork(t));
  const windows = list.filter((t) => t.cancellable && !isFailed(t) && !isBackgroundWork(t));
  const skipped = list.filter((t) => !t.cancellable && !isFailed(t));
  if (!jobs.length && !windows.length) return '';

  const doing = [
    jobs.length ? `stop ${plural(jobs.length, 'background job')}` : '',
    windows.length ? `close ${plural(windows.length, 'window')}` : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const costs = [
    jobs.some((t) => t.kind === 'download') ? 'A download starts again from the beginning.' : '',
    jobs.some(isOrphaned) ? 'Unfinished work is discarded, including the file it saved.' : '',
    windows.length ? 'Closing a window discards what that app had open.' : '',
  ].filter(Boolean);
  const left = skipped.length
    ? `${skipped.map((t) => t.name).join(', ')} cannot be stopped and will keep running.`
    : '';

  return [`This will ${doing}.`, ...costs, left].filter(Boolean).join(' ');
}

/** The button's tooltip — composed the same way as the prompt, so it cannot promise more than the
 *  batch will do (a job-only batch must not offer to close windows). */
export function stopAllLabel(list: readonly RunningTask[]): string {
  const jobs = list.filter((t) => t.cancellable && !isFailed(t) && isBackgroundWork(t)).length;
  const windows = list.filter((t) => t.cancellable && !isFailed(t) && !isBackgroundWork(t)).length;
  return [jobs ? 'Stop every job' : '', windows ? `${jobs ? 'close' : 'Close'} every window` : '']
    .filter(Boolean)
    .join(' and ');
}

/** The public object form the app conventions refer to: `kimtManager.register(job)` etc. */
export const kimtManager = {
  register,
  start,
  cancel,
  statusOf,
  get,
  list,
  running,
  queued,
  active,
  jobFor,
  blockerFor,
  failedFor,
  clearFailed,
  subscribe,
  tasks,
  currentTasks,
  stopTask,
  retryTask,
  dismissTask,
  isFailed,
  stopAll,
  stopAllPrompt,
  stopAllLabel,
};
