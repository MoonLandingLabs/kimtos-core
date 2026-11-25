# Changelog

## 1.2.0 — 2026-07-27

- Give the extension a session model, and run the apps in one tab
- Fetch several voices at once, load the model once, and use the shared spinner
- Say a voice must be downloaded, show the progress, and stop swallowing preview failures

## 1.1.2 — 2026-07-25

- Several voices can be fetched at once: asking for a second no longer cancels the first, each card shows its own progress, and cancelling one leaves the others running
- A cold start now downloads the speech model once however many voices you ask for — two overlapping requests each used to start their own copy of it
- The download control uses the same spinner as the App Store's, instead of one this app drew for itself

## 1.1.1 — 2026-07-25

- A voice you have not heard yet now says so on its card and offers a download, with a progress bar while it fetches — instead of a play button that appeared to do nothing while the speech model came down in silence
- The picker states the cost up front: the one-time ~90 MB speech model, then about 0.5 MB per new voice, kept for offline use
- A voice sample that will not play now says so, with a button to play it, instead of failing silently — and a failed preview no longer leaves the button stuck, so clicking it again really does try again

## 1.1.0 — 2026-07-25

- The studio is built around your text again: a compact voice bar names the voice, and the voices themselves moved into a picker you open on demand — a grid of cards with search, accent and gender filters, and a top-picks shortlist
- Playing a sample no longer changes which voice is selected, and no longer freezes the app while it renders — Speak stays available, and another sample cancels the one playing
- Each voice's sample is kept after the first play, so hearing that voice again is instant and works offline
- Your voice, speaking speed and a new "save every clip" option are real settings now: they persist between sessions and are editable from the settings control in the window's title bar or from Settings, Apps

## 1.0.0 — 2026-07-24

- Initial release.
