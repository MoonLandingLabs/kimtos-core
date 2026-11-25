// Small timing helpers for event-heavy handlers.

/** Trailing debounce — runs `fn` only after `ms` of quiet. `.cancel()` clears a pending call. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A): void => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = (): void => {
    if (t) clearTimeout(t);
    t = null;
  };
  return wrapped;
}

/** Coalesce rapid calls into one per animation frame — for handlers that read layout
 *  (scroll/resize/pointermove), so they don't force a reflow on every event. */
export function rafThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
): ((...args: A) => void) & { cancel: () => void } {
  let scheduled = false;
  let lastArgs: A | null = null;
  const wrapped = (...args: A): void => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (lastArgs) fn(...lastArgs);
    });
  };
  wrapped.cancel = (): void => {
    scheduled = false;
    lastArgs = null;
  };
  return wrapped;
}
