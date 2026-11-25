// Who we are, legally — the one place it is written down. The Privacy and Terms
// pages both read from here, so the operator and the contact route can never
// drift apart across the two documents.
//
// Kimtos v1 is free and open source (MIT). It has no accounts, no backend and no servers:
// the extension runs entirely in the user's browser and the sites are static pages. The
// operator is a person, not a registered company, and nothing is sold — so there is no
// incorporation record or governing-law clause here. The `published` flag below, NOT the
// presence of values, puts these pages in force: flipping it to true is the deliberate
// step that makes them binding (ideally after a lawyer's read).

import { THEME_KEY } from '~/composables/useTheme'
import { ISSUES_URL, LICENSE_NAME, REPO_URL } from '~/data/site'

export interface LegalIdentity {
  /** Who publishes the software — an individual (sole proprietor) or a company. */
  entity: string
  /** Contact location shown on the pages (city + country, or a registered address). */
  address: string
  /** Where questions and requests go. There is no mailbox or support desk: the public
   *  GitHub issue tracker is the channel. */
  contactUrl: string
  /** The public source repository. */
  repoUrl: string
  /** The licence the software is released under, by SPDX name. */
  license: string
  /** Shown as "Last updated" on every legal page. ISO date. */
  effectiveDate: string
  /** Publish gate. While false, every legal page shows a "draft — not in force"
   *  banner. Filling the values above does NOT publish — flipping this to true is a
   *  separate, conscious decision that the pages are ready to be binding. */
  published: boolean
}

export const LEGAL: LegalIdentity = {
  entity: 'Mahmoud Emad',
  address: 'Cairo, Egypt',
  contactUrl: ISSUES_URL,
  repoUrl: REPO_URL,
  license: LICENSE_NAME,
  // The Privacy page's Changes section promises the date moves when the policy does —
  // adding a key we set to a visitor's device, or a third party that sees data, moves it.
  // Bumped 2026-11-22: v1 has no accounts, no backend and no servers; open source under MIT.
  effectiveDate: '2026-11-22',
  // Put in force by the owner on 2026-07-17 for the production launch (#63). The text was
  // rewritten for the account-free, open-source v1; set false to pull the pages back to draft
  // until it has been reviewed.
  published: true,
}

/** True while the legal pages are not yet published (in force). */
export const LEGAL_DRAFT = !LEGAL.published

/**
 * The third parties your browser may contact, and the only thing each one sees. Kimtos itself
 * runs no server and receives nothing: these are public hosts that the extension talks to
 * DIRECTLY from your browser, and only for the one feature that needs it (the model downloads you start). The list is checked against
 * the extension's declared hosts by scripts/check-network-hosts.mjs.
 */
export const SUBPROCESSORS: { name: string; purpose: string; sees: string }[] = [
  {
    name: 'Hugging Face',
    purpose:
      'Downloading the on-device AI model files, once, when you start the download (huggingface.co, and its download hosts under hf.co)',
    sees: 'Your IP address and which model file you asked for, like any file download. No account, no content.',
  },
]

/** One browser-storage key our sites set on a visitor's device. */
export interface ClientStorageItem {
  /** The exact name, as it appears in the browser's own storage inspector. */
  name: string
  /** What kind of storage, and which site sets it. */
  kind: string
  /** Why it exists, in the visitor's terms. */
  purpose: string
  /** How long it lives. */
  lifetime: string
}

/**
 * Everything the marketing site and the docs site set on a visitor's device — the privacy policy's
 * "Local storage" table. It is a single theme preference per site: no cookies, no analytics,
 * no advertising and no tracking, and the policy says so in prose next to this table.
 *
 * The www name is imported from the code that sets it (never retyped here), so a renamed key
 * shows up in the policy instead of drifting past it. The one exception is the docs site's theme
 * key, which belongs to VitePress itself — `APPEARANCE_KEY` in vitepress/dist/client/shared.js —
 * and is asserted against the installed package by www-docs/scripts/storage-disclosure.test.mjs.
 */
export const CLIENT_STORAGE: ClientStorageItem[] = [
  {
    name: THEME_KEY,
    kind: 'Browser storage (localStorage) on the marketing site',
    purpose: 'Remembers your light/dark theme choice.',
    lifetime: 'Until you clear your browser data',
  },
  {
    // VitePress's own constant — see the doc comment above for why this one is typed here.
    name: 'vitepress-theme-appearance',
    kind: 'Browser storage (localStorage) on the docs site',
    purpose: 'Remembers your light/dark theme choice on the docs site.',
    lifetime: 'Until you clear your browser data',
  },
]

/** Formatted for display: 12 July 2026. */
export const lastUpdated = (iso: string = LEGAL.effectiveDate) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
