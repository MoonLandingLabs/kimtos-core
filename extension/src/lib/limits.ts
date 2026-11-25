// The user-visible limits the extension enforces — declared ONCE, here.
//
// Each of these used to be a private `const` next to the code that enforced it, and the
// number was then re-typed everywhere it had to be said: in the error message the user
// reads, in the app's own UI, in the app handbooks, and in the troubleshooting guide. The
// note-page cap managed to be declared twice inside the extension alone (notes.local.ts and
// notes/index.ts each had their own `MAX_CHARS = 50000`), so the product could disagree with
// itself before the docs even got involved. Raise a cap and every one of those copies is
// silently wrong, with nothing failing (#1043).
//
// So: the value lives here, the enforcing code imports it, the message is FORMATTED from it,
// and the docs read this file at build time (www-docs/scripts/build-content.mjs bundles it and
// exposes `{{pdfMaxSize}}` / `{{wallpaperMaxSize}}` / `{{noteMaxChars}}` to the Markdown, the
// same way it already reads the KimtAI model catalog). `scripts/check-doc-limits.mjs` fails the
// build if a docs page types one of these numbers by hand again.
//
// This module is DATA ONLY and must stay import-free: the docs build bundles it outside the
// browser, so a `chrome.*` or DOM import here would break the docs build rather than this file.

/** The largest PDF that PDF Library will import or upload. */
export const PDF_MAX_BYTES = 50 * 1024 * 1024;

/** The largest custom wallpaper image the background picker accepts. */
export const WALLPAPER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The longest a single Notes page may be, so rendering and highlighting stay fast.
 * The editor shows a counter as you approach it.
 */
export const NOTE_MAX_CHARS = 50_000;

/**
 * A byte count as the megabytes people actually say — `52428800` becomes `"50 MB"`.
 *
 * Whole megabytes lose the decimal (`50 MB`, not `50.0 MB`); anything else keeps one
 * (`12.5 MB`), so a limit that stops being a round number still reads correctly rather
 * than rounding away the difference between what we say and what we enforce.
 *
 * Deliberately not `toLocaleString`: this string is baked into the docs at build time, and
 * the published page must not depend on the locale of whichever machine ran the build.
 */
export const megabytes = (bytes: number): string => `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;

/**
 * A count with thousands separators — `50000` becomes `"50,000"`.
 *
 * Same reason as `megabytes` for not using `toLocaleString` here: the docs build must
 * produce the same text everywhere. In-app counters that face the user are free to
 * localize; a published page is not.
 */
export const grouped = (n: number): string => n.toString().replace(/\B(?=(\d{3})+$)/g, ',');
