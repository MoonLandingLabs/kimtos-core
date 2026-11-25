// Two small concurrency primitives, pure and testable, for code that loads something
// expensive or must not run two of something at once.
//
// They exist because both were hand-rolled wrongly in the voice worker: it cached only a
// FINISHED model load, so two overlapping requests each started their own ~90 MB
// instantiation, and nothing serialised inference on a single-threaded WASM session
// (#1163). Getting either subtly wrong is silent and expensive, so the logic lives here
// with tests rather than inline in an engine.

/**
 * Wrap a loader so concurrent calls for the same key share ONE in-flight promise.
 *
 * The in-flight promise is cached, not just the settled value — that is the whole point.
 * A failure is NOT cached: the entry is dropped so the next call retries, instead of every
 * later caller inheriting one rejection for the life of the page.
 */
export function sharedByKey<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();
  return (key: string): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = load(key).catch((err: unknown) => {
      inFlight.delete(key);
      throw err;
    });
    inFlight.set(key, promise);
    return promise;
  };
}

/**
 * Run tasks one at a time, in the order they were handed over.
 *
 * A rejected task settles its own caller and does not poison the queue — the next task
 * still runs. (A queue that stops on the first failure is a queue that needs a page
 * reload to recover.)
 */
export function createSerialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => {});
    return next;
  };
}
