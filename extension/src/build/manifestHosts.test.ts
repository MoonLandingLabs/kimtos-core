// Least-privilege assert for the manifest (#678), and the regression it guards:
//
// `extension/manifest.json`'s `host_permissions` is what the user is asked to approve at
// install time. `scripts/network-hosts.mjs` is where every host the extension can reach is
// declared. Both are hand-maintained, and until now nothing compared them — so #664 shipped
// three required hosts (huggingface.co, *.huggingface.co, cdn.jsdelivr.net) that no production
// path contacted at the time, and the install prompt over-asked for months before #677 removed them.
//
// Both directions fail silently, so both are checked:
//
//   - A MISSING grant blocks a real fetch at runtime. The feature just stops working.
//   - An UNUSED grant is a common Chrome Web Store rejection reason, and it contradicts the
//     "your data never leaves your browser" positioning while nothing visibly breaks.
//
// The OWNER DECISION this file now enforces, last in the file: Kimtos makes no network request
// except the AI model downloads the user starts, from Hugging Face. So `host_permissions` and
// the CSP `connect-src` may name Hugging Face and nothing else, and `img-src` may name no host at
// all. `optional_host_permissions` is the all-sites grant the user approves per-feature at
// runtime (#637/#648) so that content scripts can run on the pages they browse; it lets the
// extension READ those pages, it is not a route to any outside host, and it is pinned below.
//
// The declared list is now complete for config-derived hosts too: check-network-hosts.mjs
// resolves the @kimtos/config DEFAULTS URLs and requires each one the extension uses to be
// declared (#733). A green run
// here means the manifest matches the declared fetch hosts; whether that list is exhaustive is
// the checker's job, not this test's.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isHostGranted } from './manifestHost.js';
import { NETWORK_HOSTS, prodFetchHosts, prodGrantHosts } from '../../../scripts/network-hosts.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')) as {
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_security_policy?: { extension_pages?: string };
};

const grants = manifest.host_permissions ?? [];
const prodFetch = prodFetchHosts();
// Hosts that need a grant: those that do not answer with `access-control-allow-origin: *`.
const prodGrant = prodGrantHosts();

describe('manifest host_permissions match the declared fetch hosts (#678)', () => {
  test('the fixtures are non-empty — a silently empty list would pass everything below', () => {
    // Both assertions below are "for each ...", so an empty array makes them vacuously true.
    // That is exactly how a least-privilege check rots into a no-op.
    assert.ok(grants.length > 0, 'manifest.json declares no host_permissions');
    assert.ok(prodFetch.length > 0, 'no prod fetch hosts are declared in scripts/network-hosts.mjs');
  });

  test('every host the extension fetches in PROD is granted', () => {
    // A host declared `kind: 'fetch'` and neither dormant nor dev-only is contacted by the
    // shipped extension. Without a grant, MV3 blocks the request.
    const ungranted = prodGrant.filter((host) => !isHostGranted(grants, `https://${host}`));
    assert.deepEqual(
      ungranted,
      [],
      `these declared PROD fetch hosts have no host_permissions grant, so the fetch is blocked ` +
        `at runtime: ${ungranted.join(', ')}. Add a match pattern to extension/manifest.json.`,
    );
  });

  test('every granted host is one we actually fetch — no over-asking', () => {
    // The #664 direction. A pattern that covers no declared PROD fetch host is asking the user
    // for access we never use.
    const unused = grants.filter((pattern) => !prodGrant.some((host) => isHostGranted([pattern], `https://${host}`)));
    assert.deepEqual(
      unused,
      [],
      `these host_permissions cover no declared PROD fetch host, so the install prompt ` +
        `over-asks: ${unused.join(', ')}. Remove them, or declare the host in ` +
        `scripts/network-hosts.mjs if a prod path really does fetch it.`,
    );
  });

  test('navigation-only and text-only hosts get no grant of their OWN', () => {
    // A `navigation` host is reached by the BROWSER when the user hits enter, and a `text` host
    // is a placeholder string. Neither is a fetch, so neither needs a permission of its own.
    //
    // But a wildcard a real fetch REQUIRES can cover one incidentally. That coverage is not an
    // over-ask — the grant cannot be dropped without breaking a fetch. So a nav/text host is
    // wrongly granted only when a grant that NO prod fetch host needs still covers it (a
    // dedicated over-ask, the #664 regression). Check against exactly those dedicated grants.
    const shouldNotBeGranted = NETWORK_HOSTS.filter((h) => h.kind === 'navigation' || h.kind === 'text').map(
      (h) => h.host,
    );
    const dedicatedGrants = grants.filter(
      (pattern) => !prodGrant.some((host) => isHostGranted([pattern], `https://${host}`)),
    );

    const wronglyGranted = shouldNotBeGranted.filter((host) => isHostGranted(dedicatedGrants, `https://${host}`));
    assert.deepEqual(
      wronglyGranted,
      [],
      `these hosts are declared as navigation/text — the extension never fetches them — but the ` +
        `manifest grants them access through a pattern no fetch host needs: ${wronglyGranted.join(', ')}.`,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The lockdown. These do not read NETWORK_HOSTS on purpose: a regression that adds a host to the
// manifest AND to the declared list would sail through the cross-checks above, and this is the
// test that must fail then.
// ---------------------------------------------------------------------------------------------

const HUGGING_FACE_GRANTS = ['https://huggingface.co/*', 'https://*.hf.co/*'];
const HUGGING_FACE_ORIGINS = ['https://huggingface.co', 'https://*.hf.co'];

/** The sources of one CSP directive, e.g. `connect-src`. Empty when the directive is absent. */
function directive(csp: string, name: string): string[] {
  const part = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return part ? part.split(/\s+/).slice(1) : [];
}

describe('Kimtos contacts no host but Hugging Face (owner decision)', () => {
  const csp = manifest.content_security_policy?.extension_pages ?? '';

  test('host_permissions is exactly the two Hugging Face patterns', () => {
    assert.deepEqual([...grants].sort(), [...HUGGING_FACE_GRANTS].sort());
  });

  test('optional_host_permissions is absent, or only the all-sites grant content scripts need', () => {
    // Grammit, Clipboard and FakeForm run content scripts on the pages the user is browsing; Chrome
    // only registers those with a host grant. Nothing here lets the extension itself fetch an
    // outside host: the CSP connect-src below is what stops that.
    assert.deepEqual(manifest.optional_host_permissions ?? [], ['https://*/*']);
  });

  test('connect-src is self, blob:, data: and the Hugging Face hosts only', () => {
    const sources = directive(csp, 'connect-src');
    assert.ok(sources.length > 0, 'the CSP declares no connect-src, so connections are unrestricted');
    assert.deepEqual([...sources].sort(), ["'self'", 'blob:', 'data:', ...HUGGING_FACE_ORIGINS].sort());
  });

  test('img-src, media-src and frame-src name no host at all', () => {
    assert.deepEqual([...directive(csp, 'img-src')].sort(), ["'self'", 'blob:', 'data:']);
    assert.deepEqual([...directive(csp, 'media-src')].sort(), ["'self'", 'blob:']);
    assert.deepEqual([...directive(csp, 'frame-src')].sort(), ["'self'", 'blob:']);
  });

  test('no bare scheme or wildcard source, and no origin but Hugging Face, anywhere in the CSP', () => {
    const origins = csp.split(/[\s;]+/).filter((t) => /^(https?:|wss?:|\*)/.test(t));
    assert.deepEqual(origins.sort(), [...HUGGING_FACE_ORIGINS].sort(), `unexpected CSP sources: ${origins.join(' ')}`);
  });
});
