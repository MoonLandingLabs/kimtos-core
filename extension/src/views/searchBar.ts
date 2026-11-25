// The new-tab search bar. It does NOT choose a search engine, and it must not start doing so
// again: an extension that overrides the new tab page AND routes searches to a provider of its
// own choosing is a single-purpose violation, and the Chrome Web Store rejected 0.5.0 for it
// (#885). Submitting goes through `chrome.search.query`, which hands the query to whichever
// provider the USER selected in their browser.
//
// #177 was this same bug one level down — our bar ignoring the engine the user picked in OUR
// settings. This was our bar ignoring the engine they picked in their BROWSER. So there is
// deliberately no engine map, no default and no picker here: the fix is the absence.

// Only an EXPLICIT http/https scheme navigates. Everything else is a search.
//
// The tempting version of this also treats a bare dotted token as a host, so `github.com`
// navigates. Do not: nothing distinguishes a host from a filename or a version without a
// public-suffix list, so `tsconfig.json`, `package.json`, `vue.js`, `README.md` and `1.2.3`
// all become dead-host navigations — plausible queries, answered with a DNS error. Chrome's
// omnibox gets those right because it checks the candidate TLD against the public suffix
// list; a 6-line regex cannot, and guessing wrong is strictly worse than searching, which is
// what this bar did before #885 anyway.
//
// A pasted URL virtually always carries its scheme (it came from an address bar), so the
// scheme-only rule covers the real case and has no false positives. `localhost:3000` and
// `münchen.de` search rather than navigate; type the scheme to go there.
const HAS_SCHEME = /^https?:\/\/\S+$/i;

export function isUrlLike(input: string): boolean {
  return HAS_SCHEME.test(input.trim());
}

/** The address to navigate to. Only ever called for input that already carries a scheme. */
export function toUrl(input: string): string {
  return input.trim();
}

export function renderSearch(
  el: HTMLElement,
  { layout = 'web', onSubmit }: { layout?: string; onSubmit?: (q: string) => void } = {},
): void {
  const form = document.createElement('form');
  form.className = 'search-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search-input';
  input.placeholder = layout === 'kimtai' ? 'Ask KimtAI anything…' : 'Search the web or paste a URL';
  input.autocomplete = 'off';
  input.spellcheck = false;

  form.append(input);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) onSubmit?.(q);
  });

  el.replaceChildren(form);
  requestAnimationFrame(() => input.focus());
}
