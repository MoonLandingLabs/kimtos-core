# Changelog

What shipped, in each version, written for the people using Kimtos.

This file is the **source of truth** for the in-app _Release notes_ dialog: it is
compiled into the extension at build time (`extension/src/data/changelog.ts`), so the
notes for a version ship **with** that version. Nothing is fetched at runtime.

`make release-prepare VERSION=x.y.z` writes a new section here automatically, from the
pull requests merged since the last version — so the PR title is the changelog entry.
Write PR titles for users.

<!-- releases below; newest first -->

## v1.0.2 — 2026-11-25

Kimtos is now free and open source (MIT), with no account, no backend and no servers.

### New

- Kimtos is open source, with the full code on GitHub under the MIT license
- Every app is free, with no account, plan or payment of any kind

### Improved

- The product name is now simply Kimtos
- Update marked, highlight.js, pdfjs, onnxruntime-web and other dependencies

### Fixed

- Video Recorder opens on your camera instead of asking to share your screen, and a refused screen-share prompt no longer shows an error
- Video Recorder keeps the cleaned-up audio in sync with the video on recordings longer than 25 minutes

## v1.0.1 — 2026-07-27

### New

- Give the extension a session model, and run the apps in one tab
- Open Kimtos directly when the toolbar popup would be empty

### Improved

- Drop the 0.5.x beta history from the user-facing release notes
- Stop running CI on draft pull requests

### Fixed

- Scroll a wide Markdown table inside its own block
- Make the in-page surfaces follow the Appearance setting
- Unblock every open PR — admin path filter, the Semgrep rule, and a real audit gate
- Keep the side panel and popup following the Appearance setting
- Tell the browser which palette to draw its own controls in
- Give Notes' book view a measure, wrap long text, and stop parsing page names as Markdown
- Match Ctrl-K on the physical key and focus the search box of the window you are in
- Stop the fixed side rails from covering the footer
- Renew the access token on a 401 instead of running on an expired one
- Fetch several voices at once, load the model once, and use the shared spinner
- Say a voice must be downloaded, show the progress, and stop swallowing preview failures
- Quiet transformers.js library warnings from the model engines

## v1.0.0 — 2026-07-25

Kimtos's first stable release. It is the work of over 1,360 commits since the
project's first commit on 2026-06-06, more than 570 merged pull requests and over
520 closed issues, organized through the 0.6.0 and 0.7.0 development milestones.

### New

- Voice Studio — on-device TTS voice workstation (Kokoro-82M)
- Add FakeForm — one-keypress fake-data form filler
- Extract archives from the right-click menu, and beyond zip
- Retouch saves your images, and gains zoom
- Rebuild Voice to Text transcripts into paragraphs from Whisper's chunk timestamps
- Give the toolbar icon a page-actions popup
- A "New" badge for freshly published apps
- Chrome Web Store rating prompt and once-a-day review reminder
- Ask departing users why on an uninstall exit survey, stored and browsable
- Add the shared cookie consent manager (bottom dialog + consent gate)
- Email the user when they cancel or resume Pro
- Detect two live Dodo subscriptions from one signup (#876)
- Welcome offer dialog for logged-out visitors after ~2 minutes
- Replace the desktop-app roadmap item with Kimtos Browser, add a Vision page
- Use the Kimtos logo for the Kimtos Browser mark

### Improved

- Rebuild the Voice Studio UI, cache voice previews, and give every app a settings control (#1148)
- Notes stays responsive while typing a large page
- Check Rewordit's rewrite against your text and flag meaning drift
- Disclose every cookie and storage key in the privacy policy
- The install guide links the live Chrome Web Store listing

### Fixed

- Preview KimtFS video in the themed player, not the raw browser controls (#1143)
- Snaptext no longer eager-loads the OCR engine before you use it (#1147)
- The support widget reconnects after your session token expires instead of spinning forever (#1140)
- Don't offer 'Compress to ZIP' on an already-compressed file
- Make zoom continuous and cursor-anchored, add drag-to-pan (#1124)
- Play KimtFS audio in the themed waveform player, and make the audio player colour-customizable
- Constrain app windows to the window body in every state, not only maximized
- Stop Voice to Text hallucinating on silence and non-speech
- Contain network failures in the entitlement fetch
- Stop Grammit's phrase table rewriting valid English
- Stop Grammit's rule engine rewriting real words on sight
- Look the dictionary up instead of generating candidates, so a large paste no longer freezes Grammit
- Tokenize words Unicode-aware so Grammit never underlines a fragment
- Never correct inside an email address, a URL, a path or a code span
- Let the Grammit editor honour its viewport cap at high zoom
- Derive Grammit's dictionary from a curated source so misspellings are flagged
- Recover small text that OCR silently drops on mixed-size pages
- Analyse the page layout in Image to Text instead of assuming one block
- Make the Image to Text preview flex with the window
- Make KimtAI's Stop work while the model is still loading
- Add a working Cancel control to KimtAI model downloads
- Bind a KimtAI reply to the conversation it was asked in
- Route KimtAI generations by run id so a stopped run cannot report into the next one
- Thoth shows the retrieved passages and flags an ungrounded AI summary
- Harden DevTools Base64 — legible errors, no crash on large input
- Classify all CSS Color 4 forms as colours in Clipboard
- Batch delete no longer removes favorite clips without an explicit acknowledgement
- Single-row delete gets the same confirm and undo as the batch delete
- A failed Notes delete now throws instead of reporting success
- Notes fits the window it is in, and the sidebar is always reachable
- Make Notes' preview reachable in a narrow window and add New page to its right-click menus
- Repaint from truth when a bulk delete commits, so closed tabs stay closed
- Every app window fills a maximized window, and KimtFS gains editing, highlighting and an honest storage line
- Stop recording when the audio source dies, and never transcribe silence
- Sync rotated tokens across extension contexts and detect refresh-token reuse
- Signing out on the website also signs out the extension on that device
- Extension connect handoff runs by default; www gets an Add to Chrome button
- Drop the broken "Connect the extension" link from the account page
- Declare a toolbar action so the pinned icon renders in colour
- Keep the release pill from stretching over the search box on narrow windows
- Cap the dialog min-height to the viewport
- Stop the confirm dialog pre-arming the destructive button
- Make the marketing and docs sites responsive on mobile
