// Auto-discovers every app: drop a folder `apps/<id>/index.js` whose default
// export is an app descriptor and it shows up in the dock. Optional `order`
// controls position (lower first; default 100), then name as a tiebreaker.

/**
 * What an app's `render` is handed. The apps controller builds exactly one of these, in one place,
 * so a new field cannot reach one call site and miss another.
 *
 * A TYPE, not an interface, on purpose: several apps declare their ctx parameter as
 * `Record<string, unknown>`, and only a type alias carries the implicit index signature that
 * stays assignable to it.
 */
export type AppRenderCtx = {
  /** Close this window — tears the app down AND forgets its session, so the next open is the
   *  app's initial page (#1172). */
  close: () => void;
  /** Open another app, re-rendering it if it is already open — the cross-app handoff. */
  openApp: (id: string) => void;
  /** What this app last saved, or null on a fresh open. Read it to come back where the user was. */
  session: unknown;
  /** Remember where the user is. Call it whenever that changes — writes are debounced, and the
   *  state must be JSON-serialisable. Pushed rather than pulled at unload, because a tab can be
   *  killed without ever running an unload handler. */
  saveSession: (state: unknown) => void;
};

/** An app descriptor (the default export of each `apps/<id>/index.ts`). */
export interface App {
  id: string;
  name: string;
  order?: number;
  accent?: string;
  description?: string;
  widget?: (ctx: unknown) => Promise<HTMLElement | null> | HTMLElement | null;
  /** Label for the Settings ▸ Preferences toggle that shows/hides this app's home card.
   *  Declaring `widget` is what *creates* that toggle — never hand-add one (#83).
   *  Defaults to `Pin <name>` so a card can never ship with no way to turn it off. */
  widgetLabel?: string;
  /** The one-line hint under `widgetLabel`. */
  widgetHint?: string;
  badge?: () => Promise<number> | number;
  tools?: unknown[];
  settings?: { key: string; default: unknown; [k: string]: unknown }[];
  popout?: boolean;
  tip?: string;
  clearData?: () => Promise<void>;
  hasData?: () => Promise<boolean>;
  dataLabel?: string;
  render?: (body: HTMLElement, ctx: AppRenderCtx) => (() => void) | void;
  [key: string]: unknown;
}

const modules = import.meta.glob<{ default?: App }>('./*/index.{js,ts}', { eager: true });

export const apps: App[] = Object.values(modules)
  .map((m) => m.default)
  .filter((a): a is App => Boolean(a))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
