// Token substitution for the HAND-WRITTEN docs pages — the authored site pages
// (www-docs/authored/) and the app handbook chapters (docs/extension/apps/*/content/).
//
// The generated pages (the app pages' scaffolding) read their facts from the source
// directly, so they cannot drift. The hand-written pages were copied verbatim, so every
// fact they stated by hand was a second copy waiting to go stale — and it did: the install
// guide still told readers KimtOS was not on the Chrome Web Store months after the listing
// went live (#1009), because nothing failed when the fact flipped, and the handbooks restated
// the size caps the apps enforce (#1043).
//
// So a hand-written page states such a fact ONCE, as a named token, and this pass fills it in
// from the single source at build time.
//
//   Open the [KimtOS listing]({{chromeWebStoreUrl}}) on the Chrome Web Store.
//
// Rules:
//   - The token name must be in the map the caller passes. An UNKNOWN token fails the build —
//     a silent pass-through would publish `{{chromeWebStoreUrl}}` to readers, which is worse
//     than the stale value it replaced.
//   - The syntax is deliberately tight: `{{name}}`, no spaces. VitePress renders Markdown
//     through Vue, so `{{ expr }}` (with spaces) is Vue's own interpolation and is left
//     completely alone — the two syntaxes cannot collide.
//
// This is the mechanism #878 asked for, and every authored fact with a single source now
// goes through it: the site and support facts from @kimtos/config, and the default/opt-in app
// sets from the app metas.

/** `{{name}}` — no spaces, so Vue's own `{{ expr }}` is never touched. */
const TOKEN = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

/**
 * Replace every `{{token}}` in `text` with `values[token]`.
 *
 * @param {string} text   the Markdown source
 * @param {Record<string, string|number>} values  the allowed tokens and their values
 * @param {string} [where]  a label for the error message (the file the text came from)
 * @returns {string}
 * @throws if the text contains a token that is not in `values`
 */
export function interpolate(text, values, where = 'a docs page') {
  const unknown = new Set();
  const out = text.replace(TOKEN, (match, name) => {
    if (!Object.hasOwn(values, name)) {
      unknown.add(name);
      return match;
    }
    return String(values[name]);
  });
  if (unknown.size) {
    throw new Error(
      `Unknown docs token(s) in ${where}: ${[...unknown].map((n) => `{{${n}}}`).join(', ')}.\n` +
        `  Known tokens: ${Object.keys(values).join(', ') || '(none)'}.\n` +
        `  Add the fact to the token map in www-docs/scripts/build-content.mjs (sourced from ` +
        `@kimtos/config), or fix the spelling — an unfilled token would publish as literal text.`,
    );
  }
  return out;
}

/**
 * The token names `text` uses. Lets the caller assert the reverse of `interpolate`: a
 * declared token no page uses means either the map has a dead entry or a page silently
 * dropped the fact it was substituting — which is how the install guide's store link
 * would quietly disappear again.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function tokensIn(text) {
  return new Set(Array.from(text.matchAll(TOKEN), (m) => m[1]));
}

/**
 * Join names the way a sentence does — `A`, `A and B`, `A, B and C`. A token whose value is
 * a LIST (the default apps, the opt-in apps) is read as prose in the middle of a sentence, so it
 * has to render like prose; `A,B,C` would be visibly generated.
 *
 * @param {string[]} names
 * @returns {string}
 */
export function proseList(names) {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
