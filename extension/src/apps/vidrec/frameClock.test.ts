// The Video Recorder froze — the preview AND the recording — for exactly as long as you were away
// while screen-sharing (#276).
//
// One cause: the compositor's draw loop was `requestAnimationFrame`, and a browser suspends rAF in
// a hidden tab. Sharing your screen means you are looking at something else, so the KimtOS tab is
// hidden. The canvas stopped updating, and the recording is captured FROM that canvas.
//
// So the clock must not be rAF. These tests pin the thing that matters: the tick source is the
// WORKER (whose timers are not throttled), and rAF is only ever the fallback — and when it IS the
// fallback, the clock says so instead of pretending the recording is safe.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameClock, type ClockDeps } from './frameClock.js';

/** A worker that records what it was told, and can be made to fail to construct. */
function fakeDeps(opts: { workerFails?: boolean } = {}) {
  const posted: unknown[] = [];
  const rafCalls: ((now: number) => void)[] = [];
  let terminated = false;
  let onmessage: (() => void) | null = null;

  const worker = {
    set onmessage(fn: () => void) {
      onmessage = fn;
    },
    postMessage: (m: unknown) => posted.push(m),
    terminate: () => (terminated = true),
  } as unknown as Worker;

  const deps: ClockDeps = {
    makeWorker: () => {
      if (opts.workerFails) throw new Error('worker-src blocked');
      return worker;
    },
    requestAnimationFrame: (cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    },
    cancelAnimationFrame: () => {},
    now: () => 0,
  };
  return { deps, posted, rafCalls, tick: () => onmessage?.(), wasTerminated: () => terminated };
}

describe('the clock is a WORKER, so a hidden tab cannot stop the recording (#276)', () => {
  test('it starts the worker at the frame interval — and never touches rAF', () => {
    const f = fakeDeps();
    const clock = createFrameClock(30, () => {}, f.deps);

    assert.equal(clock.resilient, true, 'the worker clock survives a hidden tab');
    assert.deepEqual(f.posted, [{ type: 'start', interval: 1000 / 30 }]);
    assert.equal(f.rafCalls.length, 0, 'rAF is what broke this — it must not be the tick source');
  });

  test('a worker tick draws a frame', () => {
    const f = fakeDeps();
    let frames = 0;
    createFrameClock(30, () => frames++, f.deps);
    f.tick();
    f.tick();
    assert.equal(frames, 2);
  });

  test('stopping terminates the worker — a recorder left ticking is a leak', () => {
    const f = fakeDeps();
    const clock = createFrameClock(30, () => {}, f.deps);
    clock.stop();
    assert.deepEqual(f.posted.at(-1), { type: 'stop' });
    assert.equal(f.wasTerminated(), true);
  });
});

describe('the rAF fallback: degrade to today, and SAY SO', () => {
  test('a worker that cannot be created falls back to rAF rather than to nothing', () => {
    // An older browser, a CSP that refuses, a bundler that did not emit the file. A recorder with
    // no clock at all would show a black preview and record nothing — far worse than the bug.
    const f = fakeDeps({ workerFails: true });
    const clock = createFrameClock(30, () => {}, f.deps);
    assert.equal(f.rafCalls.length, 1, 'the fallback loop starts');
    assert.equal(clock.resilient, false, 'and it does not claim to survive a hidden tab');
  });

  test('the fallback throttles to the frame rate rather than drawing every vsync', () => {
    const f = fakeDeps({ workerFails: true });
    let frames = 0;
    createFrameClock(30, () => frames++, f.deps);

    const interval = 1000 / 30; // 33.3ms
    f.rafCalls.at(-1)!(0); // first frame always draws
    assert.equal(frames, 1);
    f.rafCalls.at(-1)!(10); // too soon — a 120Hz display must not draw 4x the frames
    assert.equal(frames, 1);
    f.rafCalls.at(-1)!(interval + 1); // due
    assert.equal(frames, 2);
  });

  test('`resilient` is the honest signal a caller needs', () => {
    // The difference between "this recording survives a hidden tab" and "it does not" is the whole
    // bug. A fallback that pretends to be the real thing is how it hid for months.
    assert.equal(createFrameClock(30, () => {}, fakeDeps().deps).resilient, true);
    assert.equal(createFrameClock(30, () => {}, fakeDeps({ workerFails: true }).deps).resilient, false);
  });
});
