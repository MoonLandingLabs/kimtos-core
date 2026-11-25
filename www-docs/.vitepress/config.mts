// Kimtos documentation — VitePress site config.
//
// Content is generated into ../content by scripts/build-content.mjs (a pre-build
// hook), sourced from the repo's /docs Markdown — so this config only wires the
// shell: nav, sidebar, theme and search. The Apps sidebar is derived from the
// same booklet.toml manifests the extension uses, so a new app appears here with
// no edit.

import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import { readApps } from '../scripts/build-content.mjs';

const apps = readApps();

// Kimtos v1 is free and open source (MIT). The repository is also where bugs are reported.
const REPO_URL = 'https://github.com/MoonLandingLabs/kimtos-core';
const ISSUES_URL = `${REPO_URL}/issues`;

export default withMermaid(
  defineConfig({
    lang: 'en-US',
    title: 'Kimtos',
    // Pages read "<Page> — Kimtos Documentation"; the home page overrides this to
    // "Kimtos — Documentation" in its own frontmatter (content/index.md).
    titleTemplate: ':title — Kimtos Documentation',
    description: 'Kimtos documentation — a local-first, on-device app suite for your new tab.',

    srcDir: './content',
    outDir: './dist',
    cleanUrls: true,

    // VitePress's own client theme ships a >500 kB chunk; raise the limit so the
    // build log stays clean (this is the framework bundle, not our content).
    vite: {
      build: { chunkSizeWarningLimit: 2000 },
      // The theme runs in the BROWSER, so it cannot read process.env — bake the resolved
      // values in here instead. `define` is the only seam VitePress gives us for this.
      define: {
        __REPO_URL__: JSON.stringify(REPO_URL),
        __ISSUES_URL__: JSON.stringify(ISSUES_URL),
      },
    },
    // /docs is written for the repo, so it links to source files and sibling docs
    // that don't exist on the site — don't fail the build on those.
    ignoreDeadLinks: true,

    // Open LIGHT for a reader who has chosen nothing, whatever their OS says — the same
    // default www uses, so the two public sites agree (#1217). The toggle in the footer still
    // works and a stored choice still wins.
    //
    // It has to be the OBJECT form, and that is the whole subtlety. VitePress resolves
    // appearance TWICE, and a plain string `'light'` only satisfies one of them:
    //
    //   server (`resolveSiteDataHead`): a string is interpolated into the pre-paint script;
    //   client (`app/data.js` -> `initData`):
    //       useDark({ storageKey: APPEARANCE_KEY,
    //                 initialValue: () => (appearance === 'dark' ? 'dark' : 'auto'),
    //                 ...(typeof appearance === 'object' ? appearance : {}) })
    //
    // On the client ANY string that is not exactly 'dark' collapses to 'auto' — so
    // `appearance: 'light'` painted light and then hydration put it straight back to the
    // reader's OS. The object is SPREAD last, so `initialValue` here overrides that, and the
    // server reads `appearance.initialValue ?? 'auto'` from the same object. One value, both
    // halves. (Caught in a browser; the built page alone looked correct.)
    //
    // The pre-paint script VitePress emits from it:
    //
    //   const preference = localStorage.getItem(APPEARANCE_KEY) || '<appearance>'
    //   const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    //   if (!preference || preference === 'auto' ? prefersDark : preference === 'dark')
    //     document.documentElement.classList.add('dark')
    //
    // With 'light' as the fallback, an unset preference is not 'auto', so the test collapses to
    // `preference === 'dark'` — false. Light, the OS never consulted, and nothing written to
    // storage until the reader actually toggles. That last part is why this is preferred over
    // seeding APPEARANCE_KEY ourselves: the privacy policy discloses that key as the record of
    // a choice the reader made (#1045), and writing it for someone who chose nothing would
    // make the policy untrue.
    //
    // The cast is the whole reason this needs a comment. VitePress types `initialValue` as
    // 'dark' only — it assumes light is reached through 'auto' plus a light OS — while both
    // runtimes take the value as given. `scripts/check-appearance.mjs` fails the build if the
    // emitted script stops defaulting to light, and `scripts/appearance.test.mjs` pins the
    // client-side contract above, because that half failed SILENTLY: the page still built
    // correctly and only a browser showed the theme flipping back after hydration.
    appearance: { initialValue: 'light' as 'dark' },

    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      ['link', { rel: 'alternate icon', href: '/favicon.ico' }],
      ['meta', { name: 'theme-color', content: '#3b82f6' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: 'Kimtos Documentation' }],
      ['meta', { property: 'og:site_name', content: 'Kimtos' }],
    ],

    themeConfig: {
      logo: '/favicon.svg',

      nav: [
        { text: 'Guides', link: '/guides/install', activeMatch: '/guides/' },
        { text: 'Apps', link: '/apps/', activeMatch: '/apps/' },
        // Kimtos v1 is open source (MIT). The nav renders on every page, so the source and the
        // issue tracker are reachable wherever a reader gets stuck.
        { text: 'GitHub', link: REPO_URL },
      ],

      sidebar: [
        {
          // Hand-authored user guides (www-docs/authored/guides/), copied verbatim by
          // build-content.mjs. Ordered as a first-time reader meets them, not
          // alphabetically. Developer docs are deliberately NOT published here — the
          // public site is user-facing only (#33).
          text: 'Guides',
          collapsed: false,
          items: [
            { text: 'Install Kimtos', link: '/guides/install' },
            { text: 'The new tab', link: '/guides/the-new-tab' },
            { text: 'Your data', link: '/guides/your-data' },
            { text: 'Privacy', link: '/guides/privacy' },
            { text: 'Troubleshooting', link: '/guides/troubleshooting' },
          ],
        },
        {
          text: 'Apps',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/apps/' },
            ...apps.map((a) => ({ text: a.title || a.id, link: `/apps/${a.id}` })),
          ],
        },
      ],

      search: { provider: 'local' },

      outline: { level: [2, 3], label: 'On this page' },

      // No `docFooter` override: prev/next links show by default with the correct
      // "Previous page" / "Next page" labels. Setting `{ prev: true, next: true }` was a
      // misread of the API — that field is a string LABEL (or `false` to hide), and the
      // default theme renders `docFooter.prev || 'Previous page'`, so a truthy `true` printed
      // the literal word "true" under every page (#746). Only `false` would change behaviour.

      editLink: undefined,
    },
  }),
);
