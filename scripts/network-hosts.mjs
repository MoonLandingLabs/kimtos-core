// The declared list of every external host the extension can talk to — the data behind
// `scripts/check-network-hosts.mjs`, split out so it can be cross-checked without running it.
//
// It lives in its own module because two things now read it, and importing the checker itself
// would walk the source tree and `process.exit(1)` as a side effect of the import:
//
//   1. `scripts/check-network-hosts.mjs` — fails the build when a host appears in the source
//      that nobody has declared here, and keeps www/pages/privacy.vue honest.
//   2. `extension/src/build/manifestHosts.test.ts` — cross-checks this list against the
//      manifest's `host_permissions`, so the install-time permission prompt can neither
//      over-ask (#664) nor miss a host a real fetch needs (#678).
//
// Each entry: the host, why it is contacted, what of the user's it carries, and where the user
// is told — every field cross-checked against the real source and the real privacy page.
//
//   kind: 'fetch'      — the extension makes the request itself. These are the ones the privacy
//                        page's "and only these" list must name, and the ones that need a
//                        manifest grant.
//   kind: 'navigation' — the user presses enter and the BROWSER navigates there. No background
//                        request, but still a host their query reaches, so it is declared. Needs
//                        no host permission: the extension is not the one fetching.
//   kind: 'text'       — the host only appears as literal UI text (a placeholder, an example).
//                        Not a network call at all; declared so the check does not cry wolf.
//
// `dormant` means the code path exists in the bundle but cannot currently run — it still has to
// be declared, because "dormant" is a property of today's config, not of the code. `devOnly`
// means only the dev build reaches it. Neither needs a manifest grant, and both are flags rather
// than prose precisely so an assert can branch on them.
//
// ---------------------------------------------------------------------------------------------
// THE DISCLOSURE CONTRACT (#886)
// ---------------------------------------------------------------------------------------------
//
// Declaring a host used to be the whole obligation. It was not enough: `html.duckduckgo.com` sat
// in this list as the single `told: 'NOT TOLD'` entry — KimtAI's `web_search` tool sending a
// chat-derived query to a third party, disclosed on neither the privacy page nor the README,
// while the store listing promised the user's data never leaves their browser — and the build
// stayed green the whole time, because the checker printed a friendly note about it and exited 0.
// The tool was removed for the 0.5.0 resubmission (#885). What follows is the part that makes
// re-adding it a decision rather than a one-line declaration, and it is ASSERTED, not advisory:
//
//   sends: 'nothing'      — no user data at all: our own docs link, a placeholder string, a
//                           dev-only path the shipped extension never reaches.
//          'metadata'     — the request itself reveals something (which model file, which feed,
//                           a coordinate rounded to ~110m, the extension version) but carries nothing the user authored.
//          'user-content' — text or media the user wrote or chose: a chat-derived search query,
//                           a document, a recording. THIS is what "your data never leaves your
//                           browser" is about, and it is the level web search would sit at.
//
//   saidAs   — the exact words on www/pages/privacy.vue that tell the user about this host.
//              Required whenever `told` is 'privacy.vue', and checked against the real page, so
//              deleting the disclosure fails the build instead of silently making it a lie.
//              `told: 'n/a (…)'` is the only alternative, and the reason is not optional.
//
//   optIn    — { app, key, off }: the explicit, off-by-default setting that gates the request.
//              REQUIRED for `sends: 'user-content'`, and for any host reachable from a file that
//              declares assistant tools. Checked against the app's real `settings` schema — the
//              key must exist AND its declared default must be the off value, so an opt-in
//              cannot be claimed here and missing (or on by default) there.
//
//   subprocessor — the name in www/data/legal.ts SUBPROCESSORS, the privacy page's "who else
//                  sees anything" table. Required for `sends: 'user-content'`: a third party that
//                  sees what the user wrote is a subprocessor, and has to be named as one.
//
// `told: 'NOT TOLD'` is no longer a value. There is no undisclosed host in this list, and that
// invariant is now enforced by scripts/check-network-hosts.mjs rather than asserted in a comment.

// Every on-device AI model — Whisper, Kokoro, the KimtAI chat models, FLAN-T5, MiniLM and
// Denoise's weights — is downloaded from Hugging Face. There is no Kimtos file host: the project
// runs no infrastructure. Hugging Face answers a file URL with a redirect to its CDN
// (`*.cdn.hf.co`), so that host is declared too. The non-English OCR language packs come from
// jsDelivr (the official @tesseract.js-data npm packages). Which model comes from which repo, and
// why, is in docs/extension/models.md.
export const NETWORK_HOSTS = [
  {
    host: 'huggingface.co',
    kind: 'fetch',
    why: 'Every on-device AI model (Whisper, Kokoro, chat, grammar, search, denoise)',
    sends: 'metadata',
    told: 'privacy.vue',
    saidAs: 'huggingface.co',
  },
  {
    host: 'cdn.hf.co',
    kind: 'fetch',
    why: 'Where huggingface.co redirects large model files to (us.aws.cdn.hf.co and its siblings)',
    sends: 'metadata',
    told: 'privacy.vue',
    saidAs: 'Hugging Face',
  },
  // The docs link arrives through @kimtos/config (DEFAULTS.docsUrl), not as a URL literal under
  // extension/src — the literal grep is blind to it, so the check resolves the DEFAULTS the
  // extension uses from the config source and requires each here (#733). It points at the docs
  // folder of the public GitHub repository (github.com, declared below). There is no sign-in,
  // no backend and no exit survey: the extension has no account and talks to no Kimtos server.
  // The "Rate Kimtos" button and the once-a-day review reminder open our OWN Chrome Web Store
  // listing (reviewNudge.ts, DEFAULTS.chromeWebStoreUrl). A user-initiated tab open — the browser
  // navigates, the extension fetches nothing — so no manifest grant. Google is a third party,
  // but the listing is a public page and no Kimtos user data rides along, so it is not a
  // subprocessor and not a "request we make": off the privacy list, like the docs link above.
  {
    host: 'chromewebstore.google.com',
    kind: 'navigation',
    why: 'The Rate / review-reminder links open our public store listing (reviewNudge.ts, DEFAULTS.chromeWebStoreUrl)',
    sends: 'nothing',
    told: 'n/a (our public store page; user-initiated, no user data)',
  },
  // "Report an issue" (Settings, app windows) opens a pre-filled new-issue page on our public
  // GitHub repo in a new tab (reportIssue.ts), and the Documentation / app-changelog links open
  // the repo's docs folder (DEFAULTS.docsUrl). User-initiated navigation: the extension sends
  // nothing, and the user reads and submits (or discards) the text on GitHub themselves.
  {
    host: 'github.com',
    kind: 'navigation',
    why: 'The Report an issue link (reportIssue.ts) and the Documentation links (DEFAULTS.docsUrl) open our public repo',
    sends: 'nothing',
    told: 'n/a (user-initiated tab open; the user reviews the pre-filled text on GitHub before sending)',
  },
  // jsDelivr serves the non-English Tesseract language packs (Tesseract.js's own default,
  // `@tesseract.js-data/<lang>`), fetched by the OCR worker once per language and cached. The dev
  // build also loads the onnxruntime-web wasm from it (denoise.worker; PROD self-hosts that).
  // It answers with `access-control-allow-origin: *`, so the fetch needs no manifest grant
  // (`corsOpen`), unlike Hugging Face, whose redirect response only allows its own origin.
  {
    host: 'cdn.jsdelivr.net',
    kind: 'fetch',
    corsOpen: true,
    why: 'Non-English OCR language packs (Tesseract.js default); also the dev-only ORT wasm fallback',
    sends: 'metadata',
    told: 'privacy.vue',
    saidAs: 'An OCR language other than English',
  },
  // The weather card sends a coordinate, which is the user's location and not nothing — but it is
  // rounded to ~3 decimals (~110m) before it leaves (weather.local.ts), it is a device signal
  // rather than anything the user authored, and the privacy page names it. That is `metadata`.
  {
    host: 'api.open-meteo.com',
    kind: 'fetch',
    why: 'The weather card, if enabled',
    sends: 'metadata',
    told: 'privacy.vue',
    saidAs: 'The weather and trending-article cards',
  },
  {
    host: 'geocoding-api.open-meteo.com',
    kind: 'fetch',
    why: 'Resolving the city for the weather card',
    sends: 'metadata',
    told: 'privacy.vue',
    saidAs: 'The weather and trending-article cards',
  },
  // The three feeds carry nothing of the user's INTO the request — but a request is still a
  // request, and which feeds a browser pulls is a signal about its owner. `metadata`, disclosed.
  {
    host: 'dev.to',
    kind: 'fetch',
    why: 'The trending-articles card, if enabled',
    sends: 'metadata',
    told: 'privacy.vue',
    saidAs: 'DEV, Hacker News, Lobsters',
  },
  // The HN feed is fetched from ALGOLIA, which is HN's own search API but a distinct third party.
  // The privacy page says "Hacker News"; the host is hn.algolia.com. Naming it here is the point.
  {
    host: 'hn.algolia.com',
    kind: 'fetch',
    why: 'The trending-articles card (Hacker News), if enabled',
    sends: 'metadata',
    told: 'privacy.vue',
    saidAs: 'DEV, Hacker News, Lobsters',
  },
  {
    host: 'lobste.rs',
    kind: 'fetch',
    why: 'The trending-articles card, if enabled',
    sends: 'metadata',
    told: 'privacy.vue',
    saidAs: 'DEV, Hacker News, Lobsters',
  },
  {
    host: 'news.ycombinator.com',
    kind: 'text',
    why: 'The link an HN story points at; never fetched',
    sends: 'nothing',
    told: 'n/a (a link target rendered in the card; the extension never requests it)',
  },

  // The new-tab search bar reaches NO named host of ours: it submits through
  // `chrome.search.query`, so the destination is whichever provider the user set in their
  // browser, and we neither choose nor can enumerate it. Google/DuckDuckGo/DevDocs used to
  // be listed here, one per engine in our own picker — that picker is what got 0.5.0
  // rejected from the Chrome Web Store (#885), and it is gone.

  {
    host: 'json.org',
    kind: 'text',
    why: "A placeholder string in DevTools' URL-encoder",
    sends: 'nothing',
    told: 'n/a (a placeholder in an input; the extension never requests it)',
  },
];

// There is no undisclosed host in this list, and check-network-hosts.mjs is what holds that
// invariant now — it used to be this paragraph, and a paragraph does not fail a build.
//
// `html.duckduckgo.com` used to sit here as the one `told: 'NOT TOLD'` entry: KimtAI's
// web_search tool sent a chat-derived query to a third party, disclosed in neither the README
// nor the privacy page, while the store listing promised the user's data never leaves their
// browser. It was unreachable only by accident — supportsNativeTools() gates on Qwen/Llama and
// the shipped catalogue holds only SmolLM2 — so adding a Qwen model would have made it live and
// made the privacy page false in that same commit. The tool was removed for the 0.5.0
// resubmission (#885).
//
// Re-adding web search now means, in ONE commit and none of it optional, because each half is
// asserted: `sends: 'user-content'`, an `optIn` that exists in the app's settings AND defaults
// to off, a `saidAs` phrase that is really on the privacy page, a `subprocessor` row naming who
// sees the query, a manifest host grant (or a runtime optional-permission request following
// lib/hostPermission.ts), and a store-listing description that survives an outbound path
// carrying user text. See #886.

/** The hosts the extension itself fetches on a PROD path — i.e. exactly the ones that need a
 *  required `host_permissions` grant in the manifest. A dormant or dev-only path needs no
 *  install-time grant: dormant cannot run at all, and the dev build is never shipped. */
export const prodFetchHosts = () =>
  NETWORK_HOSTS.filter((h) => h.kind === 'fetch' && !h.devOnly && !h.dormant).map((h) => h.host);

/** The subset of `prodFetchHosts` that needs a manifest grant: hosts that send permissive CORS
 *  headers (`corsOpen`) are readable from an extension page without one, so granting them would
 *  only widen the install prompt. */
export const prodGrantHosts = () =>
  NETWORK_HOSTS.filter((h) => h.kind === 'fetch' && !h.devOnly && !h.dormant && !h.corsOpen).map((h) => h.host);
