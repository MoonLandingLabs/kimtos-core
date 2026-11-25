// App catalog metadata — the single source of truth for each app's identity
// (id, name, accent) and its marketing card content.
//
// Every app ships a dependency-free `apps/<id>/meta.ts` exporting one of these.
// The extension descriptor (`index.ts`) consumes it so name/accent/order aren't
// duplicated, and the marketing site's app grid is GENERATED from every meta.ts
// (see `www/scripts/gen-apps.mjs`) — so adding an app with a `marketing` block
// makes it appear on the site with no www edits.
//
// Keep this file (and every meta.ts) free of runtime/DOM/chrome imports so they
// stay importable outside the browser (the generator runs in Node).

export interface AppMeta {
  /** Canonical app id — the folder name under apps/. */
  id: string;
  /** Display name (dock + marketing). */
  name: string;
  /** Accent colour (hex). */
  accent: string;
  /** Dock position (lower first; default 100), then name as a tiebreaker. */
  order?: number;
  // NO `version` field, deliberately. An app's version is the newest entry in its own
  // CHANGELOG.md, and nowhere else — see `data/appChangelogs.ts` (generated) and #132.
  //
  // It used to live here, and every one of the 19 apps declared `1.0.0` forever, while the
  // App Store showed that number to users and every bug report carried it. A second place
  // to write a version is a place for it to drift, and it did. There is now nowhere to
  // drift to.
  /**
   * Ships uninstalled: the user adds it from the App Store (or onboarding) when they want it.
   * Used for apps that run on every page or download an on-device model, so they stay inert
   * until asked for. An opt-in app is open to everyone.
   */
  optIn?: boolean;
  /**
   * Infrastructure, not an optional tool: always installed, never uninstallable.
   *
   * AnubisDB is the console over the one shared on-device database — the only place a user
   * can browse, export or ERASE what their apps have saved. Uninstalling it does not remove
   * the data; it removes the user's control over it, which is the opposite of the promise
   * the product makes. So it is declared required and the model enforces it (#176).
   *
   * Declare this; never special-case an id. `DEFAULT_APPS`, `isInstalled()`, the App Store
   * row, the app detail page and onboarding all derive from this one flag — a hardcoded
   * `if (id === 'anubisdb')` would be the fourth hand-maintained list this repo has deleted.
   */
  required?: boolean;
  /** Marketing-card content. Omit to keep an app off the website (dock-only). */
  marketing?: {
    /** Short tech label, e.g. "Whisper · WebAssembly". */
    tech: string;
    /** One-sentence pitch. */
    desc: string;
    /** Three flip-card highlights. */
    points: [string, string, string];
    /** Show up-front in the grid (vs. behind the "+N more" card). */
    featured?: boolean;
  };
}

/** Identity helper: types a meta object at its definition site. */
export const defineMeta = (m: AppMeta): AppMeta => m;
