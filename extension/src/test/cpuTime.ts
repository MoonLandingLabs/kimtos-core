// How a performance test in this repo measures cost: CPU time burned, never wall-clock
// time elapsed.
//
// A ceiling on `performance.now()` measures the machine's load as much as the code's
// speed. The identical computation takes the same CPU either way, but when other
// processes own the cores it waits far longer in wall time — so a fixed wall-clock
// ceiling cannot be made generous enough to be safe. Measured on this repo's own
// speller: ~340 ms elapsed and ~310 ms of CPU on an idle machine, versus over 6000 ms
// elapsed and still ~310 ms of CPU under load. The wall-clock ceiling failed; the code
// had not changed (#1075, the same class as #1059).
//
// CPU time is also the RIGHT measurement, not merely the stable one: the regressions
// these tests guard are pathological amounts of work — a candidate sweep instead of a
// lookup, a quadratic rescan of a long token — which burn CPU. That is exactly what
// this counts, and it is why swapping the clock costs the tests nothing they proved.
//
// `process.cpuUsage()` is process-wide (it counts every thread, V8's background GC
// included), so measure ONE synchronous computation at a time and do not run concurrent
// work in the same process while a measurement is open.

/**
 * CPU time, in milliseconds, burned by `work` — user plus system.
 *
 * System time is included so that a regression into synchronous syscalls (say, reading
 * a file per word) counts against the budget too, rather than hiding outside `user`.
 */
export function cpuMs(work: () => void): number {
  const started = process.cpuUsage();
  work();
  const { user, system } = process.cpuUsage(started);
  return (user + system) / 1000;
}
