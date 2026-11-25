// The page's app windows, reachable from anywhere that needs them (#1172).
//
// `appsController` owns the windows, but it is created inside the boot and handed to nobody. The
// switcher gets it by argument; an APP cannot — `render(body, ctx)` gives an app `close` and
// `openApp`, and widening that ctx so one app can drive every other app's window would put a
// general-purpose remote control in front of all 22 of them.
//
// So the controller publishes itself here, once, and the two surfaces that legitimately manage
// windows read it: KimtManager (the task manager) and the switcher. Same shape as
// `lib/installManager.ts` — a module-scoped singleton for the one live page — rather than a new
// pattern.
//
// It is deliberately TINY. Anything richer belongs in the controller behind a named function, not
// in a growing bag of capabilities that every app can reach.

export interface AppControl {
  /** Every app with a window right now, and whether it is only minimized. */
  windows: () => { id: string; minimized: boolean }[];
  /** Close an app's window, running its teardown — what actually stops a clip or frees a mic. */
  stopApp: (id: string) => void;
  /** Bring an app up, un-minimizing it. */
  focusApp: (id: string) => void;
}

let control: AppControl | null = null;

/** Called once by `appsController`, as it is created. */
export function setAppControl(next: AppControl): void {
  control = next;
}

/**
 * The live controller, or null before the boot has reached it.
 *
 * Null is a real state, not a defensive shrug: an app window cannot exist before the controller
 * that creates windows does, so a caller that finds null has nothing to show rather than a problem
 * to report.
 */
export const appControl = (): AppControl | null => control;
