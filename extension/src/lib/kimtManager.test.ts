// KimtManager is the orchestrator: every piece of background work is registered with it, and it
// decides when the work runs (#1172). Two things are worth pinning hard.
//
// The SCHEDULING, because a queue is invisible when it works and indistinguishable from a hang when
// it does not — a job that silently never starts is worse than one that never finishes.
//
// The ROW LIST, because two surfaces render it (the app and the switcher) and they must not
// disagree: one row per app, the most urgent thing winning, and nothing running that the list
// forgets to mention.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

let env: DomEnv;
let fake: FakeChrome;
let km: typeof import('./kimtManager.js');
let beginJob: typeof import('./jobStore.js').beginJob;
let endJob: typeof import('./jobStore.js').endJob;

const KNOWN = [
  { id: 'denoise', name: 'Denoise', accent: '#111111' },
  { id: 'notes', name: 'Notes', accent: '#222222' },
  { id: 'tasks', name: 'Tasks', accent: '#333333' },
];

/** A job whose completion the test controls. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  env = installDom();
  fake = installChrome();
  km = await import('./kimtManager.js');
  ({ beginJob, endJob } = await import('./jobStore.js'));
  km.__reset();
});

afterEach(async () => {
  for (const a of KNOWN) await endJob(a.id);
  km.__reset();
  fake.cleanup();
  env.cleanup();
});

describe('running work through the orchestrator', () => {
  test('a started job runs, reports progress, and settles', async () => {
    const gate = deferred();
    const job = km.start({
      appId: 'denoise',
      title: 'Cleaning clip.webm',
      kind: 'compute',
      run: async (ctx) => {
        ctx.progress(0.5);
        ctx.note('Halfway');
        await gate.promise;
      },
    });
    await settle(0);

    assert.equal(job.status(), 'running');
    assert.equal(job.progress(), 0.5);
    assert.equal(job.label(), 'Halfway');

    gate.resolve();
    await settle(5);
    assert.equal(job.status(), 'done');
    assert.deepEqual(km.running(), [], 'finished work is not "what is running"');
  });

  test('run() twice joins one outcome rather than doing the work twice', async () => {
    let runs = 0;
    const gate = deferred();
    const job = km.register({
      appId: 'denoise',
      title: 'Downloading',
      run: async () => {
        runs++;
        await gate.promise;
      },
    });

    const a = job.run();
    const b = job.run();
    await settle(0);
    gate.resolve();
    await Promise.all([a, b]);

    assert.equal(runs, 1, 'the App Store, the manager and the app can all reach the same job');
  });

  test('a failure is kept and reported, not silently dropped', async () => {
    const job = km.start({
      appId: 'denoise',
      title: 'Downloading',
      run: async () => {
        throw new Error('the network went away');
      },
    });
    await settle(5);

    assert.equal(job.status(), 'failed');
    assert.equal(job.error(), 'the network went away');
    assert.equal(km.failedFor('denoise')?.error(), 'the network went away', 'the user has to be told');

    km.clearFailed({ appId: 'denoise' });
    assert.equal(km.failedFor('denoise'), null);
  });

  test('cancelling aborts the signal and drops the row at once', async () => {
    let sawAbort = false;
    const gate = deferred();
    const job = km.start({
      appId: 'denoise',
      title: 'Downloading',
      run: async (ctx) => {
        ctx.signal.addEventListener('abort', () => {
          sawAbort = true;
        });
        await gate.promise;
      },
    });
    await settle(0);

    job.cancel();
    assert.equal(sawAbort, true, 'the work is told to stop');
    assert.equal(km.jobFor('denoise'), null, 'and the row goes at once, not when the fetch unwinds');

    gate.resolve();
    await settle(5);
    assert.equal(job.status(), 'cancelled');
  });

  // Work that cannot abort its own network finishes anyway. Reporting that as success would
  // contradict what the user was just told.
  test('work that completes after being cancelled is still cancelled', async () => {
    const gate = deferred();
    const job = km.start({ appId: 'denoise', title: 'Downloading', run: async () => gate.promise });
    await settle(0);
    job.cancel();
    gate.resolve();
    await settle(5);

    assert.equal(job.status(), 'cancelled');
  });

  test('a job declared uncancellable refuses to be cancelled', async () => {
    const gate = deferred();
    const job = km.start({
      appId: 'denoise',
      title: 'Removing',
      kind: 'uninstall',
      cancellable: false,
      run: async () => gate.promise,
    });
    await settle(0);

    job.cancel();
    assert.equal(job.status(), 'running', 'so a surface must not offer a Stop for it');
    gate.resolve();
    await settle(5);
  });
});

// A failure that outlived its own retry was reported forever: the retry created a fresh record
// which completed and vanished, while the stale failed one kept being what `tasks()` found.
test('registering new work for an app supersedes its old failure', async () => {
  km.start({
    appId: 'denoise',
    title: 'Downloading',
    run: async () => {
      throw new Error('offline');
    },
  });
  await settle(5);
  assert.ok(km.failedFor('denoise'), 'precondition: the failure is retained');

  const gate = deferred();
  km.start({ appId: 'denoise', title: 'Retrying', run: async () => gate.promise });
  await settle(0);

  assert.equal(km.failedFor('denoise'), null, 'the retry supersedes it');
  const [row] = await km.tasks({ known: KNOWN, windows: [] });
  assert.equal(row.error, undefined, 'and the row stops claiming the app failed');

  gate.resolve();
  await settle(5);
});

// clearFailed() with no filter wiped every app's failure. The App Store calls it on open, so a
// Denoise failure the user had not seen vanished as a side effect of an unrelated dialog.
test('clearing failures can be scoped, and does not touch other apps or lanes', async () => {
  km.start({
    appId: 'denoise',
    title: 'Cleaning',
    kind: 'compute',
    run: async () => {
      throw new Error('compute failed');
    },
  });
  km.start({
    appId: 'notes',
    title: 'Downloading',
    kind: 'download',
    run: async () => {
      throw new Error('download failed');
    },
  });
  await settle(5);

  km.clearFailed({ lane: 'network' }); // what the App Store does on open

  assert.equal(km.failedFor('notes'), null, 'the install failure is cleared');
  assert.ok(km.failedFor('denoise'), "another app's compute failure is none of its business");
});

test('a failed job can be run again, rather than joining its old outcome forever', async () => {
  let attempts = 0;
  const job = km.register({
    appId: 'denoise',
    title: 'Downloading',
    run: async () => {
      attempts++;
      if (attempts === 1) throw new Error('offline');
    },
  });

  await job.run();
  assert.equal(job.status(), 'failed');

  await job.run(); // the retry
  assert.equal(attempts, 2, 'run() on a failed job must actually re-run it');
  assert.equal(job.status(), 'done');
});

// A failed row is the one state with no live job behind it, so every control it offers has to be a
// control that works. It used to offer a Stop that called a cancel which returned immediately
// (#1216) — the defect this file names as its own bar, in the file that names it.
describe('acting on a failed job', () => {
  const failing = (appId: string, fail: () => boolean): Parameters<typeof km.start>[0] => ({
    appId,
    title: 'Downloading',
    kind: 'download',
    run: async () => {
      if (fail()) throw new Error('offline');
    },
  });

  test('retryTask runs it again', async () => {
    let attempts = 0;
    km.start(failing('denoise', () => ++attempts === 1));
    await settle(5);

    const [row] = await km.tasks({ known: KNOWN, windows: [] });
    assert.equal(row.error, 'offline', 'precondition: it failed and is still listed');

    await km.retryTask(row);
    await settle(5);

    assert.equal(attempts, 2, 'the work actually ran a second time');
    assert.deepEqual(await km.tasks({ known: KNOWN, windows: [] }), [], 'and it succeeded, so it is gone');
  });

  // The bug found while reading the retry path: `execute` clears the error, but only once a slot
  // frees. A retry that had to queue kept the old error — styled as failed, sorted to the top, and
  // excluded from a batch stop, while it was on its way to running again.
  test('a retried job stops reading as failed the moment it is queued', async () => {
    // Fail it FIRST, while the lane is free — a job that never got a slot never failed.
    km.start(failing('denoise', () => true));
    await settle(5);
    const [failed] = (await km.tasks({ known: KNOWN, windows: [] })).filter((t) => t.appId === 'denoise');
    assert.equal(failed.error, 'offline', 'precondition: it failed');

    // Now fill the network lane, so the retry below has to wait for a slot rather than starting at
    // once — which is the only state in which the stale error was visible.
    const gate = deferred();
    km.start({ appId: 'notes', title: 'A', kind: 'download', run: async () => gate.promise });
    km.start({ appId: 'tasks', title: 'B', kind: 'download', run: async () => gate.promise });
    await settle(0);

    void km.retryTask(failed);
    await settle(0);

    const requeued = (await km.tasks({ known: KNOWN, windows: [] })).find((t) => t.appId === 'denoise');
    assert.ok(requeued, 'still listed — it is queued, not gone');
    assert.equal(requeued.error, undefined, 'a job on its way to running again is not a failure');
    assert.equal(km.isFailed(requeued), false);

    gate.resolve();
    await settle(5);
  });

  // A row is rendered from a snapshot, and the record behind it can be cleared before the click:
  // opening the App Store calls clearInstallErrors, which drops EVERY network failure. Swallowing
  // that would rebuild the exact defect this work removes — a button that looks live and does
  // nothing — one level down, so the caller is told and repaints.
  test('retryTask reports when the record vanished between paint and click', async () => {
    km.start(failing('denoise', () => true));
    await settle(5);
    const [row] = await km.tasks({ known: KNOWN, windows: [] });
    assert.equal(row.error, 'offline');

    km.clearFailed({ lane: 'network' }); // what opening the App Store does

    assert.equal(await km.retryTask(row), false, 'the caller has to know it did nothing');
  });

  test('retryTask reports true when it really did run it again', async () => {
    let attempts = 0;
    km.start(failing('denoise', () => ++attempts === 1));
    await settle(5);
    const [row] = await km.tasks({ known: KNOWN, windows: [] });

    assert.equal(await km.retryTask(row), true);
    await settle(5);
    assert.equal(attempts, 2);
  });

  test('retryTask on a row with no job is a no-op, not a throw', async () => {
    const ran = await km.retryTask({
      appId: 'denoise',
      name: 'Denoise',
      kind: 'compute',
      label: 'Unfinished',
      ratio: null,
      minimized: false,
      cancellable: true,
    });
    assert.equal(ran, false, 'orphaned work resumes through the app, not from here');
  });

  test('dismissTask drops the row and nothing else', async () => {
    km.start(failing('denoise', () => true));
    km.start(failing('notes', () => true));
    await settle(5);

    const [row] = (await km.tasks({ known: KNOWN, windows: [] })).filter((t) => t.appId === 'denoise');
    km.dismissTask(row);

    const left = await km.tasks({ known: KNOWN, windows: [] });
    assert.deepEqual(
      left.map((t) => t.appId),
      ['notes'],
      "another app's failure is not this one's to clear",
    );
  });

  // The views and the batch must agree on what "failed" means, or a row can be offered a Retry by
  // one rule and counted as stoppable by another.
  test('isFailed is the same predicate the batch excludes on', async () => {
    km.start(failing('denoise', () => true));
    await settle(5);
    const rows = await km.tasks({ known: KNOWN, windows: [{ id: 'notes', minimized: false }] });
    const failed = rows.find((t) => t.appId === 'denoise');
    const window = rows.find((t) => t.appId === 'notes');
    assert.ok(failed && window);

    assert.equal(km.isFailed(failed), true);
    assert.equal(km.isFailed(window), false);
    // The batch excludes it on this same predicate, so the two cannot disagree about a row.
    assert.doesNotMatch(km.stopAllPrompt(rows), /Denoise/, 'a failed row is not part of a batch stop');
  });
});

describe('the scheduler', () => {
  test('runs at most two jobs at once and queues the rest', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const jobs = KNOWN.map((a, i) => km.start({ appId: a.id, title: `Job ${i}`, run: async () => gates[i].promise }));
    await settle(0);

    assert.deepEqual(
      jobs.map((j) => j.status()),
      ['running', 'running', 'queued'],
      'the third waits its turn rather than competing for the same bandwidth',
    );

    gates[0].resolve();
    await settle(5);
    assert.equal(jobs[2].status(), 'running', 'and starts as soon as a slot frees');

    gates[1].resolve();
    gates[2].resolve();
    await settle(5);
  });

  // Live work — a recording, a held microphone — is already happening by the time it is registered.
  // Queueing it would be a lie in both directions: the row would claim it had not started while the
  // camera was rolling, and its Stop would only drop the record and leave the recording going
  // (#1244).
  test('live work starts at once, even with the lane full', async () => {
    const gates = [deferred(), deferred(), deferred()];
    km.start({ appId: 'notes', title: 'One', run: async () => gates[0].promise });
    km.start({ appId: 'tasks', title: 'Two', run: async () => gates[1].promise });
    await settle(0);

    const live = km.start({ appId: 'denoise', title: 'Recording', immediate: true, run: async () => gates[2].promise });
    await settle(0);
    assert.equal(live.status(), 'running', 'a recording cannot be told to wait its turn');

    gates.forEach((g) => g.resolve());
    await settle(5);
  });

  test('live work does not hold a lane slot against work that CAN be scheduled', async () => {
    // The other half: a recording may run for twenty minutes, and stalling a transcription behind
    // it would be throttling around work that was never throttleable in the first place.
    const gates = [deferred(), deferred(), deferred()];
    km.start({ appId: 'denoise', title: 'Recording', immediate: true, run: async () => gates[0].promise });
    const a = km.start({ appId: 'notes', title: 'One', run: async () => gates[1].promise });
    const b = km.start({ appId: 'tasks', title: 'Two', run: async () => gates[2].promise });
    await settle(0);

    assert.equal(a.status(), 'running');
    assert.equal(b.status(), 'running', 'both scheduled jobs still get their slots');

    gates.forEach((g) => g.resolve());
    await settle(5);
  });

  test('one job per app: a second for the same app waits', async () => {
    const gates = [deferred(), deferred()];
    const first = km.start({ appId: 'denoise', title: 'First', run: async () => gates[0].promise });
    const second = km.start({ appId: 'denoise', title: 'Second', run: async () => gates[1].promise });
    await settle(0);

    assert.equal(first.status(), 'running');
    assert.equal(second.status(), 'queued', 'two downloads for one app would race over the same cache');

    gates[0].resolve();
    await settle(5);
    assert.equal(second.status(), 'running');
    gates[1].resolve();
    await settle(5);
  });

  test('a queued job can say what it is waiting for', async () => {
    // Without this a wait is indistinguishable from a hang: the run screen showed an
    // indeterminate bar for the length of a 280 MB model download and never said why (#1306).
    const gates = [deferred(), deferred()];
    const download = km.start({
      appId: 'denoise',
      title: 'Downloading Denoise',
      kind: 'download',
      run: async (ctx) => {
        ctx.progress(0.25);
        return gates[0].promise;
      },
    });
    const compute = km.start({
      appId: 'denoise',
      title: 'Working',
      kind: 'compute',
      run: async () => gates[1].promise,
    });
    await settle(0);

    const blocker = km.blockerFor(compute);
    assert.equal(blocker?.title, 'Downloading Denoise', 'the run names the job in front of it');
    assert.equal(blocker?.kind, 'download');
    assert.equal(blocker?.progress(), 0.25, 'and can borrow its progress, so the bar is not indeterminate');
    assert.equal(km.blockerFor(download), null, 'a job that is running is not waiting for anything');

    gates[0].resolve();
    await settle(5);
    assert.equal(km.blockerFor(compute), null, 'and once it starts, there is nothing to report');
    gates[1].resolve();
    await settle(5);
  });

  test('a job waiting only for a lane slot reports no blocker of its own app', async () => {
    // `blockerFor` answers "which job of MY app is in front of me". A job queued behind a
    // different app's work has no such answer, and must not borrow a stranger's progress.
    const gates = KNOWN.map(() => deferred());
    const jobs = KNOWN.map((a, i) => km.start({ appId: a.id, title: `Job ${i}`, run: async () => gates[i].promise }));
    await settle(0);
    assert.equal(jobs[2].status(), 'queued', 'the lane is full');
    assert.equal(km.blockerFor(jobs[2]), null);
    gates.forEach((g) => g.resolve());
    await settle(5);
  });

  test('a queued job can be cancelled before it ever starts', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const jobs = KNOWN.map((a, i) => km.start({ appId: a.id, title: `Job ${i}`, run: async () => gates[i].promise }));
    await settle(0);
    assert.equal(jobs[2].status(), 'queued');

    jobs[2].cancel();
    assert.equal(km.jobFor(KNOWN[2].id), null);

    gates[0].resolve();
    gates[1].resolve();
    await settle(5);
  });

  // A busy app must not block the queue behind it, or one slow download stalls everything.
  test('a job whose app is busy is skipped, not left blocking the queue', async () => {
    const gates = [deferred(), deferred(), deferred()];
    km.start({ appId: 'denoise', title: 'A', run: async () => gates[0].promise });
    km.start({ appId: 'denoise', title: 'B', run: async () => gates[1].promise }); // same app — must wait
    const other = km.start({ appId: 'notes', title: 'C', run: async () => gates[2].promise });
    await settle(0);

    assert.equal(other.status(), 'running', 'it took the free slot rather than queueing behind B');
    gates[0].resolve();
    gates[1].resolve();
    gates[2].resolve();
    await settle(5);
  });
});

describe('the row list both surfaces render', () => {
  test('nothing running is an empty list, not a list of idle apps', async () => {
    assert.deepEqual(await km.tasks({ known: KNOWN, windows: [] }), []);
  });

  test('an open window and a minimized one both appear, and say which', async () => {
    const rows = await km.tasks({
      known: KNOWN,
      windows: [
        { id: 'denoise', minimized: true },
        { id: 'notes', minimized: false },
      ],
    });

    assert.deepEqual(
      rows.map((r) => [r.appId, r.label]),
      [
        ['denoise', 'Minimized'],
        ['notes', 'Open'],
      ],
    );
  });

  test('a registered job appears with its progress and can be stopped by id', async () => {
    const gate = deferred();
    const job = km.start({
      appId: 'denoise',
      title: 'Downloading Whisper',
      kind: 'download',
      run: async (ctx) => {
        ctx.progress(0.25);
        await gate.promise;
      },
    });
    await settle(0);

    const [row] = await km.tasks({ known: KNOWN, windows: [] });
    assert.equal(row.kind, 'download');
    assert.equal(row.ratio, 0.25);
    assert.equal(row.jobId, job.id, 'so a surface can stop exactly this one');

    gate.resolve();
    await settle(5);
  });

  // The case a live registry cannot know on its own: the page that started the work died.
  test('work orphaned by a dead page is still listed', async () => {
    await beginJob('denoise', { kind: 'denoise', name: 'meeting.webm' }, new Blob(['x']));

    const rows = await km.tasks({ known: KNOWN, windows: [] });

    assert.deepEqual(
      rows.map((r) => [r.appId, r.label]),
      [['denoise', 'Unfinished: meeting.webm']],
    );
  });

  test('an app doing two things is ONE row, and the more urgent wins', async () => {
    const gate = deferred();
    km.start({ appId: 'denoise', title: 'Downloading', kind: 'download', run: async () => gate.promise });
    await settle(0);

    const rows = await km.tasks({ known: KNOWN, windows: [{ id: 'denoise', minimized: false }] });

    assert.equal(rows.length, 1, 'two rows would make the machine read as busier than it is');
    assert.equal(rows[0].kind, 'download');
    assert.equal(rows[0].minimized, false, 'and the window state is still carried');

    gate.resolve();
    await settle(5);
  });

  // An uninstall does not close the app's window. Walking only the installed list dropped that
  // window entirely, so the manager silently showed less than the switcher did.
  test('a window for an app that is no longer installed is still listed', async () => {
    const rows = await km.tasks({ known: [], windows: [{ id: 'denoise', minimized: false }] });

    assert.deepEqual(
      rows.map((r) => r.appId),
      ['denoise'],
      'a window nobody claims is exactly what the user is hunting for',
    );
  });

  test('a failure sorts above everything else', async () => {
    km.start({
      appId: 'denoise',
      title: 'Downloading',
      run: async () => {
        throw new Error('offline');
      },
    });
    await settle(5);

    const rows = await km.tasks({ known: KNOWN, windows: [{ id: 'notes', minimized: false }] });

    assert.equal(rows[0].appId, 'denoise');
    assert.equal(rows[0].error, 'offline');
  });

  test('an uncancellable job is reported as such, so no Stop is offered', async () => {
    const gate = deferred();
    km.start({
      appId: 'denoise',
      title: 'Removing',
      kind: 'uninstall',
      cancellable: false,
      run: async () => gate.promise,
    });
    await settle(0);

    const [row] = await km.tasks({ known: KNOWN, windows: [] });
    assert.equal(row.cancellable, false);

    gate.resolve();
    await settle(5);
  });

  test('background work is distinguished from merely being open', async () => {
    const gate = deferred();
    km.start({ appId: 'denoise', title: 'Working', kind: 'compute', run: async () => gate.promise });
    await settle(0);

    const rows = await km.tasks({ known: KNOWN, windows: [{ id: 'notes', minimized: false }] });
    const byId = Object.fromEntries(rows.map((r) => [r.appId, r]));

    assert.equal(km.isBackgroundWork(byId.denoise), true);
    assert.equal(km.isBackgroundWork(byId.notes), false);

    gate.resolve();
    await settle(5);
  });
});

// Stop all (#1213). The batch is where the `cancellable` promise is easiest to break at scale:
// one button, N tasks, and work that declares it cannot be interrupted must come out the other
// side untouched — and be NAMED, because the button says "all".
describe('stopping everything at once', () => {
  /** A task list of the shape `tasks()` produces, without needing live jobs for the pure parts. */
  const task = (over: Partial<import('./kimtManager.js').RunningTask> = {}) =>
    ({
      appId: 'denoise',
      name: 'Denoise',
      kind: 'compute',
      label: 'Working',
      ratio: null,
      cancellable: true,
      ...over,
    }) as import('./kimtManager.js').RunningTask;

  test('stops what it can and reports what it cannot', async () => {
    const list = [
      task({ appId: 'a', name: 'A' }),
      task({ appId: 'b', name: 'B', cancellable: false }),
      task({ appId: 'c', name: 'C', kind: 'window' }),
    ];
    const { stopped, skipped } = await km.stopAll(list);

    assert.deepEqual(
      stopped.map((t) => t.appId),
      ['a', 'c'],
    );
    assert.deepEqual(
      skipped.map((t) => t.appId),
      ['b'],
      'work that cannot be interrupted is excluded, not attempted and quietly failed',
    );
  });

  test('an empty list is a no-op, not a crash', async () => {
    assert.deepEqual(await km.stopAll([]), { stopped: [], skipped: [] });
  });

  test('one task that throws does not strand the rest', async () => {
    // A window stop that throws must not abort the batch — the user asked for everything to stop,
    // so one uncooperative task cannot keep the other nine running. The controller has to be
    // installed and made to throw: with none installed, `appControl()?.stopApp` short-circuits and
    // this proved nothing (the first version of this test passed with the `.catch` removed).
    const { setAppControl } = await import('./appControl.js');
    setAppControl({
      windows: () => [{ id: 'notes', minimized: false }],
      stopApp: () => {
        throw new Error('window refused to close');
      },
      focusApp: () => {},
    } as unknown as Parameters<typeof setAppControl>[0]);

    const gate = deferred();
    const job = km.start({ appId: 'denoise', title: 'Working', kind: 'compute', run: async () => gate.promise });
    await settle(0);
    const rows = await km.tasks({ known: KNOWN, windows: [{ id: 'notes', minimized: false }] });
    assert.ok(
      rows.some((r) => r.kind === 'window'),
      'the fixture must actually contain a window, or the throwing path is never taken',
    );

    await km.stopAll(rows); // must not reject
    assert.equal(job.status(), 'cancelled', 'the job stopped even though the window stop threw');

    gate.resolve();
    await settle(5);
  });

  describe('what it asks before doing it', () => {
    test('names both costs when there are jobs and windows', () => {
      // A DOWNLOAD, so the restart line applies — the first draft used a compute job here and
      // asserted the download wording against it, which is how the bug passed its own test.
      const msg = km.stopAllPrompt([
        task({ appId: 'a', kind: 'download', jobId: 'j1' }),
        task({ appId: 'c', kind: 'window' }),
      ]);
      assert.match(msg, /stop 1 background job and close 1 window/);
      assert.match(msg, /A download starts again from the beginning\./);
      assert.match(msg, /discards what that app had open/);
    });

    test('mentions only the cost that applies', () => {
      const jobsOnly = km.stopAllPrompt([task({ appId: 'a', jobId: 'j1' }), task({ appId: 'b', jobId: 'j2' })]);
      assert.match(jobsOnly, /stop 2 background jobs\./);
      assert.doesNotMatch(jobsOnly, /window/i, 'no windows are closing, so do not warn about windows');
    });

    test('names the work it will leave running — the button says "all"', () => {
      const msg = km.stopAllPrompt([
        task({ appId: 'a' }),
        task({ appId: 'b', name: 'Uninstalling', cancellable: false }),
      ]);
      assert.match(msg, /Uninstalling cannot be stopped and will keep running\./);
    });

    test('is empty when nothing can be stopped, so the button is never shown inert', () => {
      assert.equal(km.stopAllPrompt([]), '');
      assert.equal(
        km.stopAllPrompt([task({ cancellable: false })]),
        '',
        'a list of only uninterruptible work offers nothing to do',
      );
    });
  });
});

// The confirm text again, after the self-review found it told every batch containing any
// background job that "anything downloading starts again from the beginning". False for a
// transcription, and badly wrong for unfinished work, whose saved input `endJob` deletes.
describe('the confirm names only the costs that actually apply', () => {
  const t = (over: Partial<import('./kimtManager.js').RunningTask>) =>
    ({
      appId: 'x',
      name: 'X',
      kind: 'compute',
      label: 'Working',
      ratio: null,
      cancellable: true,
      ...over,
    }) as import('./kimtManager.js').RunningTask;

  test('a compute job is not described as a download', () => {
    const msg = km.stopAllPrompt([t({ kind: 'compute', jobId: 'j1' })]);
    assert.doesNotMatch(msg, /download/i, 'nothing here is downloading');
    assert.match(msg, /stop 1 background job\./);
  });

  test('a download says it restarts', () => {
    assert.match(
      km.stopAllPrompt([t({ kind: 'download', jobId: 'j1' })]),
      /A download starts again from the beginning\./,
    );
  });

  test('unfinished work says its file is discarded, because endJob deletes it', () => {
    // No jobId and not a window: an orphaned record, which `stopTask` ends rather than cancels.
    const msg = km.stopAllPrompt([t({ kind: 'compute' })]);
    assert.match(msg, /Unfinished work is discarded, including the file it saved\./);
    assert.doesNotMatch(msg, /starts again from the beginning/, 'it does not restart — it is gone');
  });

  test('a live job is not confused with an orphaned one', () => {
    assert.doesNotMatch(km.stopAllPrompt([t({ kind: 'compute', jobId: 'j1' })]), /Unfinished work is discarded/);
  });

  test('the tooltip promises only what the batch will do', () => {
    assert.equal(km.stopAllLabel([t({ jobId: 'j1' })]), 'Stop every job');
    assert.equal(km.stopAllLabel([t({ kind: 'window' })]), 'Close every window');
    assert.equal(km.stopAllLabel([t({ jobId: 'j1' }), t({ kind: 'window' })]), 'Stop every job and close every window');
  });
});

// A job that already FAILED is listed but is not running, and `cancelRecord` no-ops on it. The
// batch counted it as work to stop and reported it as stopped — a lie in both directions, and for
// a failed download it also promised a restart that would never happen.
describe('a failed job is not something the batch can stop', () => {
  const failed = (over: Partial<import('./kimtManager.js').RunningTask> = {}) =>
    ({
      appId: 'x',
      name: 'X',
      kind: 'download',
      label: 'Failed',
      ratio: null,
      cancellable: true,
      jobId: 'j1',
      error: 'network',
      ...over,
    }) as import('./kimtManager.js').RunningTask;

  test('it is not counted, and not reported as stopped', async () => {
    const { stopped, skipped } = await km.stopAll([failed()]);
    assert.deepEqual(stopped, [], 'nothing was stopped, so nothing may be reported as stopped');
    assert.deepEqual(skipped, [], 'and it is not "will keep running" either — it is not running');
  });

  test('a list of only failed work offers no Stop all', () => {
    assert.equal(km.stopAllPrompt([failed()]), '', 'there is nothing to stop');
    assert.equal(km.stopAllLabel([failed()]), '');
  });

  test('a failed uninstall is not described as "will keep running" — it is not running', () => {
    // `cancellable: false` AND failed. It reaches neither bucket: not stoppable, but not still
    // going either. The first fix for the failed case missed this line, and the commit message
    // claimed otherwise.
    const dead = failed({ appId: 'z', name: 'Uninstalling', kind: 'uninstall', cancellable: false });
    const live = { ...failed(), error: undefined, appId: 'y', name: 'Y' } as import('./kimtManager.js').RunningTask;
    const msg = km.stopAllPrompt([dead, live]);
    assert.doesNotMatch(msg, /Uninstalling cannot be stopped and will keep running/);
    assert.match(msg, /stop 1 background job\./, 'the live one is still counted');
  });

  test('it does not inflate the count beside real work', () => {
    const live = { ...failed(), error: undefined, appId: 'y', name: 'Y' } as import('./kimtManager.js').RunningTask;
    const msg = km.stopAllPrompt([failed(), live]);
    assert.match(msg, /stop 1 background job\./, 'one live job, not two');
  });
});
