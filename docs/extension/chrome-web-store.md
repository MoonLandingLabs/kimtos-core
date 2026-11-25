# Publishing to the Chrome Web Store

Loading the built zip unpacked is **not** a public install path — this repo is
private, so only people with repo access can build or download it. For anyone else to
install Kimtos, it has to be listed on the **Chrome Web Store**.

The workflow is already wired (`.github/workflows/release.yml`). It **skips** the
publish step until the four secrets below exist, so releases keep working in the
meantime. What is left is the part only a human can do.

> **Start this before you need it.** The code is not the long pole — **Google's
> review is**. A first submission commonly takes days and can take weeks, and this
> extension has two properties that draw a **manual** review (see _Why this will get
> a close look_). The review clock, not the build, sets the launch date.

## One-time setup

1. **Register as a Chrome Web Store developer** — a Google account and a **one-time $5
   fee**. Publisher verification comes with the trader declaration below.
2. **Declare trader status.** **This step is done**: the account is declared a
   **trader** under the EU definition (individual / sole proprietor), and Google has
   completed identity verification, so the listing shows the trader statement plus the
   developer's legal name, address, email and phone. Non-trader is for hobby
   extensions; the developer chose the safe, conservative declaration. A misdeclaration risks the listing
   being hidden for EU users — which is the only public install path. The reasoning is
   recorded on #987 and has **not** been confirmed by counsel (#1094). The published
   address is a personal one until #1093 moves it to a business address.
3. **Create the item.** Upload any build once by hand — this is what mints the
   **extension ID**, which the automated publish needs. Everything after this is
   automated. **This step is done**: the item exists and is live, and its ID is the
   one in `DEFAULTS.chromeWebStoreUrl` (`@kimtos/config`) — do not create a second
   listing.
4. **Fill in the listing** (below).
5. **Add the four repository secrets** so releases publish themselves.

## The four secrets

Set these in _Settings → Secrets and variables → Actions_:

| Secret              | What it is                                    |
| ------------------- | --------------------------------------------- |
| `CWS_EXTENSION_ID`  | The item's ID, from the item's dashboard URL. |
| `CWS_CLIENT_ID`     | OAuth client ID (Google Cloud console).       |
| `CWS_CLIENT_SECRET` | OAuth client secret.                          |
| `CWS_REFRESH_TOKEN` | A long-lived refresh token for that client.   |

To mint them: in the **Google Cloud console**, enable the **Chrome Web Store API**,
create an **OAuth client** of type _Desktop app_, then do the one-time OAuth consent
flow with scope `https://www.googleapis.com/auth/chromewebstore` and exchange the
resulting code for a **refresh token**. Store that token — it is what the workflow
uses; the access token it produces is short-lived and is fetched on every run.

If the refresh token is ever revoked (or the OAuth client is deleted), the publish
step fails with a clear error telling you to mint a new one. It will not silently
publish nothing.

## What the workflow does

On a tag push, after the extension zip is built (the workflow creates no GitHub
Release):

1. Exchanges the refresh token for an access token.
2. Uploads `kimtos-vX.Y.Z.zip` to the item as a draft.
3. Submits it for review.

**Submitting is not publishing.** Google reviews first; the update goes live only
after it passes. Nothing in this repo can shorten that.

## The listing

- **Name:** Kimtos
- **Summary (132 max):** the `description` in `extension/manifest.json` — the store
  shows the manifest's description, so they cannot drift. The 132-character cap is a
  hard limit at upload time and is enforced in CI
  (`scripts/check-manifest-summary.mjs`).
- **Category:** Productivity.
- **Privacy policy URL:** `https://github.com/MoonLandingLabs/kimtos-core/blob/main/PRIVACY.md`
  (the repository's `PRIVACY.md`) — **required** by the store. It is the same policy as the site's
  `/privacy` page (`www/pages/privacy.vue`); keep the two in step.
- **Website and support URLs:** set the website to the public repository
  (`https://github.com/MoonLandingLabs/kimtos-core`) and the support URL to its issue tracker
  (`https://github.com/MoonLandingLabs/kimtos-core/issues`). GitHub issues are the only contact
  channel: there is no support mailbox. Google's listing guidance calls these out as trust signals.
- **Screenshots (max 5 per listing).** The store shows at most five 1280x800 (or
  640x400) images, but the repo carries **eight** so the strongest set can be picked per
  campaign (#1065). Seven are REAL light-theme captures — the new tab, Notes, the App
  Store, NotaBoard, KimtFS, two tools tiled, and three tools at once — plus one designed
  "why Kimtos" explainer, all framed gallery-style. Every app is free, so
  no slide shows a locked tile or an upgrade button. Recommended live five: **hero,
  three-app multitasking, App Store, why-Kimtos, and Notes (or the two-tools slide)**.
  Regenerate after a UI change — the two-command recipe and the full slide list are in
  `extension/store-assets/README.md`, which also states what a slide may show.

### Detailed description (canonical copy)

This is the versioned source for the dashboard's description field — edit it here
first, then paste it into the dashboard, so the listing is reviewable like code.
Plain text only; the store renders no markup.

```text
Kimtos turns every new tab into a private workspace. Notes, tasks, PDFs, files and
on-device AI run in your browser and stay there. Nothing you create is uploaded. There
is no account, no analytics, no tracking and no ads.

FREE AND OPEN SOURCE (MIT)
Every app is free. There is no sign-in, no plan and no payment, and no Kimtos server
exists. The full source code is public: https://github.com/MoonLandingLabs/kimtos-core

INCLUDED APPS
- Notes: notes in collections, with live Markdown preview, export and internal links
- Tasks: a fresh to-do list every day, with overdue roll-over
- PDF Library: read and annotate PDFs, with highlights, notes and last-page memory
- Tabs: fuzzy-find any open tab, hibernate idle ones to free memory, save sessions
- KimtFS: a private file system with folders, files and uploads, stored locally
- DevTools: JSON, Base64, JWT, hashing and regex, entirely offline
- Calculator: quick and keyboard-driven
- AnubisDB: one console over everything the apps store on your device: browse, back up, clear

MORE APPS, ADDED FROM THE BUILT-IN APP STORE
- KimtAI: a private AI chat that runs entirely in your tab
- Voice to Text: transcribe voice notes on your device
- Image to Text: extract the text from a screenshot or photo, entirely offline
- Grammit: grammar and spelling checks as you type, with no cloud grammar service
- Clipboard: everything you copy, saved on your device and searchable
- NotaBoard: a whiteboard for sketches and diagrams
- Thoth: a private knowledge base over your notes, PDFs and boards, with cited answers
- Plus tools to record your screen or camera, clean up audio, rewrite text, touch up photos and fill test forms

ON-DEVICE AI
AI models are downloaded once, when you choose to install one, from Hugging Face, and then run
on your machine with WebAssembly. Your text and audio are never sent to a server, and the AI
works offline after the download.

PRIVATE BY DESIGN
Everything you create lives in your browser's own storage and is never transmitted. Kimtos makes
no network request except the model downloads you start, and its permissions allow Hugging Face
and no other host. Privacy policy: see the link on this listing.
```

Keep the app names in step with the catalog (`extension/src/apps/*/meta.ts`)
— the App Store screenshot is a real capture, and a description that contradicts it
reads as a stale listing.

## The badges

The store grants two badges; neither can be bought.

- **Established Publisher** — automatic once the publisher's identity is verified in
  the dashboard and the account has a clean policy record. Verify the publisher;
  there is nothing else to do.
- **Featured** — manually evaluated by the Chrome team against their published best
  practices: Manifest V3 and current platform APIs, respect for user privacy, an
  intuitive experience, and a listing with quality images and a detailed
  description.

Where we stand on Featured:

- The product side is met: MV3, runtime-optional permissions (#637), no analytics,
  local-only data, and the privacy story is the product claim itself.
- The listing side is met too: the screenshots show the actual user experience — real
  captures of the new tab, individual apps, and multiple app windows open at once, plus a
  "why Kimtos" explainer (#1065) — and the summary, promo tiles and detailed description
  follow the published specs.
  Refresh the captures if the UI has changed since (`extension/store-assets/README.md`)
  before nominating.

**Nominating:** Google's One Stop Support page has a "nominate an extension for the
Featured badge" option. Its conditions: you own the item, it is published and
public, it supports English, it has no active policy violations, and the **core
features work without extra credentials or payment**. That last one is why every app
must stay usable with no sign-in and no payment. Keep it that way; gating anything behind
a login would end eligibility (there is no login today, and there should not be one).

## Why this will get a close look

As of #637 the base install NO LONGER requests all-sites access, so the "read and
change all your data on all websites" warning is gone from a fresh install and the
in-depth-review trigger is much reduced. The all-sites grant is now OPTIONAL,
requested at runtime only when the user turns on a feature that needs it. Justify each
item plainly in the listing anyway — a vague justification is what turns days into
weeks.

| Item                                     | Why we need it                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host_permissions` (a NAMED host list)   | Reach Hugging Face (`huggingface.co`, `*.hf.co`), which is where every on-device model file is served from, once, when the user starts a download. Concrete hosts only — no all-sites access.                                                                                       |
| `optional_host_permissions: https://*/*` | Requested at RUNTIME, never at install: when the user enables **Grammit** or **Clipboard** (their content scripts run on the pages they use them on). Released when the last of those apps is uninstalled. It lets the extension read those pages; it makes no request to any host. |
| `scripting`                              | Registers the Grammit/Clipboard content scripts at runtime (once installed AND permitted) instead of declaring them for every site — so the base install requests no page access.                                                                                                   |
| `favicon` (optional)                     | Requested at RUNTIME with the Tabs app's other optional permissions, never at install (it carries an install warning). The Tabs app shows each tab's icon from the browser's own icon cache, so no request goes to the site the tab belongs to.                                     |
| Microphone and camera (no permission)    | Nothing to justify: an extension has no manifest permission for either. The recording apps call `getUserMedia`, so Chrome asks the user at the moment they press Record. Nothing is captured in the background, and no audio or video leaves the device.                            |
| `'wasm-unsafe-eval'` in the CSP          | The on-device AI engines (ONNX Runtime, Tesseract, Transformers.js) are WebAssembly. This is the standard, documented way to run WASM in MV3 — no remote code is involved.                                                                                                          |

**The content scripts** — `writer.js` (Grammit: underlines spelling/grammar as you
type on any site) and `clipboard.js` (Clipboard: captures what you copy so you can
paste it back). They are registered only after the user installs the app AND grants
the all-sites permission, and they do nothing until the user installs the app and grants that permission. **The clipboard one is the sensitive
one** — say plainly what it does and does not: it reads copies **only** while
Clipboard is installed, stores them **in the browser's own
IndexedDB**, and **never transmits them anywhere**. Do not bury this — reviewers find
it anyway, and finding it undisclosed is far worse than reading it in the
justification.

### Remote code — we are clean, but be ready for the question

MV3 forbids remotely hosted code. **We do not ship any**, and it is worth being able
to say why precisely:

- Every engine pins ONNX Runtime's WASM to **self-hosted** files (`/ort/...`), and
  Tesseract's worker and core are self-hosted too (`/ocr/...`). All are copied into
  the build by `extension/vite.config.ts`.
- The extension's own CSP (`script-src 'self'`) would block a remote script anyway.
- The **model weights** downloaded at runtime (from Hugging Face) are **data, not code** — tensors
  fed to a WASM runtime that is already in the package. This is the same shape as any
  app downloading a dictionary.
- The bundled library code still _contains_ CDN URL strings (they are the defaults
  inside `onnxruntime-web` and `tesseract.js`), but they are **overridden at runtime
  and never fetched**. If a reviewer greps the bundle and asks, that is the answer.

## Data disclosures

The dashboard asks what you collect. Answer it truthfully and narrowly — the honest
answer is unusually good here, and it is the whole product claim:

- **Not collected:** everything the user creates — notes, tasks, PDFs, clipboard,
  recordings, images, AI chats. It stays in the browser (IndexedDB) and is never
  transmitted.
- **Collected:** nothing. There is no account, no sign-in and no Kimtos backend; the extension
  sends no identifier, and the only requests are the model-file downloads from Hugging Face that the user
  starts, which carry no user content. Kimtos makes no network request except the model downloads you start, from Hugging Face.
- **No analytics, no tracking, no ads.**

Keep this consistent with the privacy page (`www/pages/privacy.vue`). A mismatch between the
dashboard disclosures and the policy is a rejection.

## After it is live

- The listing's **item ID never changes**, so the secrets are set once.
- Each tag then ships to the store automatically — but every submission is reviewed
  again. Updates are usually much faster than the first.
- The first release is also the first time users see the extension. Get the
  screenshots right.
