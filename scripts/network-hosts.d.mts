// Types for network-hosts.mjs, so the manifest cross-check
// (extension/src/build/manifestHosts.test.ts) can consume it under `allowJs: false`.
//
// The data stays plain .mjs on purpose: the Conventions CI job runs the checkers with bare
// `node` and no `npm ci`, so it cannot load TypeScript. This declaration is the seam between
// that constraint and a typechecked consumer.

/** How the host is reached. Only `fetch` is a request the extension itself makes, and only
 *  `fetch` therefore needs a manifest `host_permissions` grant. */
export type HostKind = 'fetch' | 'navigation' | 'text';

/** What of the user's the request carries. `user-content` is the level a web search would sit
 *  at, and the level that requires an opt-in and a subprocessor row (#886). */
export type HostSends = 'nothing' | 'metadata' | 'user-content';

/** The explicit, off-by-default setting that gates a request carrying user content. Checked
 *  against the app's real `settings` schema, so it cannot be claimed here and missing there. */
export interface HostOptIn {
  /** The app id whose `settings` schema declares the switch, e.g. `kimtai`. */
  app: string;
  /** The setting key within that schema. */
  key: string;
  /** The value that means OFF, and which the schema's `default` must equal. */
  off: string | boolean;
}

export interface DeclaredHost {
  host: string;
  kind: HostKind;
  /** Why the extension contacts it — shown in the checker's output. */
  why: string;
  /** What of the user's this request carries. See the contract in network-hosts.mjs. */
  sends: HostSends;
  /** Where the user is told: `privacy.vue`, or `n/a (<reason>)`. Never "NOT TOLD". */
  told: string;
  /** The words on www/pages/privacy.vue that disclose it. Required when `told` is
   *  'privacy.vue', and matched against the real page. */
  saidAs?: string;
  /** The off-by-default gate. Required for `sends: 'user-content'` and for any host reachable
   *  from a file that declares assistant tools. */
  optIn?: HostOptIn;
  /** The name in www/data/legal.ts SUBPROCESSORS. Required for `sends: 'user-content'`. */
  subprocessor?: string;
  /** Only the dev build reaches it; the shipped extension never does. */
  devOnly?: boolean;
  /** The code path exists but cannot currently run. */
  dormant?: boolean;
  /** The host answers with `access-control-allow-origin: *`, so a fetch needs no manifest grant. */
  corsOpen?: boolean;
}

export const NETWORK_HOSTS: readonly DeclaredHost[];

/** The hosts the shipped extension actually fetches — `kind: 'fetch'` minus dev-only and
 *  dormant. Exactly the set that needs a required `host_permissions` grant. */
export function prodFetchHosts(): string[];

/** `prodFetchHosts` minus the `corsOpen` hosts: exactly the set that needs a required grant. */
export function prodGrantHosts(): string[];
