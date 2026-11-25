import { CRAWLABLE } from './data/crawlable.mjs'
import { DEFAULT_THEME, THEME_COLORS, THEME_KEY, THEME_MODES } from './composables/useTheme'

// The site is hosted anywhere (GitHub Pages, any static host), so it hard-codes no origin: the
// social image is a site-relative path, and there is no canonical URL, og:url or sitemap.
const OG_IMAGE = '/assets/screenshot-newtab.png'
const DESC =
  'Kimtos turns every new browser tab into a private workspace — notes, PDFs, a whiteboard, ' +
  'voice-to-text, on-device AI and more. Everything runs in your browser; nothing is uploaded. ' +
  'Free and open source (MIT), with no accounts and no servers.'

// kimtos marketing site. Fully STATIC (`nuxt generate`): no runtime server, no backend and no
// accounts. Kimtos v1 is free and open source (MIT); every page is prerendered.
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  devServer: { port: 8799 },
  css: ['~/assets/css/main.css'],
  // Every page is static and crawlable (the Chrome Web Store needs a public privacy-policy URL):
  // derived from data/crawlable.mjs. Add a public page THERE, not here (#366).
  routeRules: Object.fromEntries(CRAWLABLE.map((p) => [p, { prerender: true }])),
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      bodyAttrs: { id: 'top' },
      title: 'Kimtos — the private new-tab workspace',
      titleTemplate: '%s',
      meta: [
        { charset: 'UTF-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        { name: 'description', content: DESC },
        {
          name: 'keywords',
          content:
            'new tab, browser extension, private browser tools, on-device AI, notes, PDF reader, voice to text, whiteboard, Chrome extension, productivity, privacy',
        },
        { name: 'author', content: 'Kimtos' },
        {
          name: 'robots',
          content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
        },
        // The browser-chrome tint. It followed `prefers-color-scheme`, which the site itself
        // stopped doing (#1217) — so a visitor on a dark OS got a light page with a dark
        // address bar. It now states the DEFAULT theme's colour, and `useTheme` rewrites it
        // when the reader toggles, so the chrome tracks the page rather than the machine.
        { name: 'theme-color', content: THEME_COLORS[DEFAULT_THEME] },
        // Open Graph (Facebook, LinkedIn, Slack, iMessage, …)
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Kimtos' },
        { property: 'og:title', content: 'Kimtos — the private new-tab workspace' },
        { property: 'og:description', content: DESC },
        // No og:url: the site has no fixed origin. Title/description/image are site-wide defaults.
        { property: 'og:image', content: OG_IMAGE },
        { property: 'og:image:width', content: '1440' },
        { property: 'og:image:height', content: '900' },
        {
          property: 'og:image:alt',
          content: 'A Kimtos new tab — a clock, a search bar, and a dock of on-device tools.',
        },
        // Twitter / X large-image card
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: 'Kimtos — the private new-tab workspace' },
        { name: 'twitter:description', content: DESC },
        { name: 'twitter:image', content: OG_IMAGE },
      ],
      link: [
        // Favicons. A real /favicon.ico at the root (Google's default probe) plus
        // an SVG for crisp modern browsers and a 48px PNG (Google prefers a square
        // multiple of 48). apple-touch-icon for iOS home-screen.
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/assets/icon48.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/assets/icon16.png' },
        { rel: 'apple-touch-icon', href: '/assets/icon128.png' },
      ],
      script: [
        {
          // Apply the saved theme before first paint so there's no light/dark flash. Built
          // from the SAME constants the composable uses (#1217) — this runs before hydration,
          // so a default written here by hand and changed there is a visible jump from one
          // theme to the other, which is the very thing this script exists to prevent. It
          // mirrors `initTheme`: a stored value is honoured only if it is a real mode,
          // otherwise the default. The OS is not consulted, deliberately.
          innerHTML:
            `try{var s=localStorage.getItem('${THEME_KEY}');` +
            `document.documentElement.setAttribute('data-theme',` +
            `${JSON.stringify(THEME_MODES)}.indexOf(s)>=0?s:'${DEFAULT_THEME}')}catch(e){}`,
          tagPosition: 'head',
        },
      ],
    },
  },
  nitro: { prerender: { routes: ['/'] } },
})
