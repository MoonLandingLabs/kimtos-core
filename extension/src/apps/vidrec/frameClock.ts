// What drives the compositor's draw loop — and the reason a recording no longer freezes when you
// look away.
//
// The mixer used to call `requestAnimationFrame` in a loop. Browsers SUSPEND rAF for a hidden tab,
// and screen-sharing means the KimtOS tab IS hidden — you are looking at whatever you are sharing.
// So the draw loop stalled, the canvas stopped updating, and since the recording is captured FROM
// that canvas, the recorded video froze for exactly as long as you were away. Both symptoms in
// #276 — a frozen preview and a frozen recording — are that one fact.
//
// Window timers do not help: Chrome throttles setInterval to ~1 Hz in a hidden tab, which is a
// slideshow, not a recording. A WORKER's timers are not throttled, so the clock lives in a worker
// and the main thread draws on each tick. (A real worker file, not a blob URL: the extension's CSP
// is `worker-src 'self'`.)
//
// The rAF path stays as a FALLBACK, not as the plan. If the worker cannot start, we degrade to
// exactly today's behaviour — a recording that freezes when hidden — rather than to no preview at
// all. Silently worse is bad; silently nothing is worse still.

export interface FrameClock {
  /** True when the tick source is the worker (i.e. survives a hidden tab). */
  readonly resilient: boolean;
  stop: () => void;
}

export interface ClockDeps {
  /** Build the ticking worker. Throws (or returns null) if it cannot be created. */
  makeWorker: () => Worker | null;
  requestAnimationFrame: (cb: (now: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  now: () => number;
}

const defaultDeps = (): ClockDeps => ({
  makeWorker: () => new Worker(new URL('./ticker.worker.js', import.meta.url), { type: 'module' }),
  requestAnimationFrame: (cb) => requestAnimationFrame(cb),
  cancelAnimationFrame: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
});

/**
 * Call `onFrame` at `fps`, whether or not the tab is visible.
 *
 * The worker is tried first. If it cannot be created — an older browser, a CSP that refuses, a
 * bundler that did not emit the file — we fall back to rAF and SAY SO through `resilient`, so a
 * caller can tell the difference between "the recording will survive a hidden tab" and "it will
 * not". A fallback that pretends to be the real thing is how a bug like this hides for months.
 */
export function createFrameClock(fps: number, onFrame: () => void, deps: ClockDeps = defaultDeps()): FrameClock {
  const interval = 1000 / fps;

  let worker: Worker | null = null;
  try {
    worker = deps.makeWorker();
  } catch {
    worker = null; // fall through to rAF
  }

  if (worker) {
    worker.onmessage = () => onFrame();
    worker.postMessage({ type: 'start', interval });
    return {
      resilient: true,
      stop: () => {
        worker!.postMessage({ type: 'stop' });
        worker!.terminate();
      },
    };
  }

  // ── fallback: rAF, throttled to the frame rate. Freezes when hidden — as it always did. ──
  let raf = 0;
  let last = -Infinity;
  const tick = (now: number): void => {
    raf = deps.requestAnimationFrame(tick);
    if (now - last < interval) return;
    last = now;
    onFrame();
  };
  raf = deps.requestAnimationFrame(tick);
  return {
    resilient: false,
    stop: () => deps.cancelAnimationFrame(raf),
  };
}
