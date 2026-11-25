// @kimtos/config — the single source of truth for configuration shared across
// the extension, the marketing site (www) and the docs site (www-docs).
//
// Everything here is ISOMORPHIC: pure constants and functions with no `process`/`fs`
// access, so it is safe to import anywhere — the browser extension, the Nuxt client
// and the Node build scripts alike.

/** How long a freshly published app carries its "New" badge, counted from its first release. */
export const NEW_APP_DAYS = 30;

/**
 * Is an app new enough to still carry the "New" badge?
 *
 * `firstReleased` is the date of the OLDEST entry in the app's own CHANGELOG.md — the one
 * place its first release is written down (`unitFirstReleased` in @kimtos/releaser, and the
 * generated `appFirstReleased` in the extension). There is deliberately no `released` field
 * on `AppMeta`: that is exactly how `version` drifted before it was deleted from meta.ts
 * (#132), and a hand-declared date would need a human to remember to remove it 30 days later.
 *
 * The rule lives HERE because all three surfaces render the badge — the extension's App Store,
 * the marketing site's app grid and the docs site's app cards. Three copies of "30 days" is
 * three places for them to disagree about what "new" means.
 *
 * `now` is a parameter, not `Date.now()` inside: every caller passes its own clock, so the
 * badge can be tested at an exact boundary instead of against the wall clock (this repo has
 * already had to fix two tests that raced real time, #1059 and #1075). It is also what lets
 * the prerendered sites re-check on the client and drop a badge that has since expired.
 *
 * An absent or unparseable date is NOT new. The badge is a claim about the product, and we
 * do not make it from data we could not read.
 */
export function isNewApp(firstReleased: string | null | undefined, now: Date = new Date()): boolean {
  if (!firstReleased) return false;
  const released = Date.parse(firstReleased);
  const at = now.getTime();
  if (Number.isNaN(released) || Number.isNaN(at)) return false;
  const age = at - released;
  // A future date is not new either — it is a typo, and treating it as new would pin the
  // badge on until the date arrives.
  if (age < 0) return false;
  return age < NEW_APP_DAYS * 24 * 60 * 60 * 1000;
}

/** Non-secret constants shared by every surface — the single source of truth for these
 *  values. There is one environment (development) and no per-build override. Kimtos runs no
 *  site or server of its own, so nothing here is a Kimtos-operated host. Never put secrets here. */
export const DEFAULTS = {
  /** The documentation, as Markdown in the public repository. The extension's Settings
   *  "Documentation" link and the app changelog links read it. */
  docsUrl: 'https://github.com/MoonLandingLabs/kimtos-core/tree/main/docs',
  /** The extension's Chrome Web Store listing — the ONE place this URL lives. The
   *  marketing hero's install button, the footer, and the extension's own rate-us
   *  affordances (which append `/reviews`) all read it from here, so the link can
   *  never drift per-surface. */
  chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/kimtos/cmjagcogohpnfkladbfhgijofbcmedip',
} as const;
