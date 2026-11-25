// Match-pattern helper for the manifest's `host_permissions`.
//
// Not runtime code: the manifest cross-check test (manifestHosts.test.ts) uses it to ask
// whether a declared host is covered by a grant. It lives under src/ so it is typechecked and
// covered by the test runner; nothing in the extension's entry graph imports it.
//
// (It used to hold `grantCdnHost` too, which added a configurable CDN host to the manifest at
// build time. The models now load from fixed public hosts, so there is nothing to configure.)

/** Does a Chrome match pattern's host part already cover `host`? `*.hf.co` covers
 *  `hf.co` and every subdomain of it; anything else must match exactly. */
const hostCovers = (patternHost: string, host: string): boolean => {
  if (patternHost === '*') return true;
  if (patternHost.startsWith('*.')) {
    const base = patternHost.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return patternHost === host;
};

/** Is `origin` already reachable under one of these match patterns? */
export const isHostGranted = (patterns: readonly string[], origin: string): boolean => {
  const { protocol, hostname } = new URL(origin);
  return patterns.some((p) => {
    const m = /^(\*|https?):\/\/([^/]+)\//.exec(p);
    if (!m) return false;
    const [, scheme, patternHost] = m;
    if (scheme !== '*' && `${scheme}:` !== protocol) return false;
    return hostCovers(patternHost, hostname);
  });
};
