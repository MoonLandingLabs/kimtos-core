# Changelog

## 1.3.0 — 2026-08-17

- Mic and System audio are two independent switches now, not one either/or choice: record either, or both at once.
- System audio on its own never asks for your microphone, so a call playing in another window can be transcribed even when your mic is blocked or missing.
- A microphone the browser or your operating system is blocking now says so, and names the setting to change, instead of the recording quietly failing.
- Either source can be muted and unmuted during a recording without ending it.

## 1.2.1 — 2026-07-23

- Transcripts no longer contain sentences that were never spoken: the quiet parts of a recording are found first and never sent to the model, which is what it was inventing from
- A phrase repeated over and over is recognised as the model getting stuck and collapsed to one, instead of filling the transcript
- A recording that holds no speech now says "No speech detected" rather than returning made-up text

## 1.2.0 — 2026-07-22

- Transcripts now come out in paragraphs — a pause in the speech starts a new one — instead of one unbroken line, so the downloaded text file is readable too

## 1.1.1 — 2026-07-22

- Recording now stops with a clear message when the microphone or screen share ends, instead of quietly saving a file with no sound
- Silent audio reports "No speech detected" instead of a made-up transcript
- Switching panes or closing the window releases the microphone

## 1.1.0 — 2026-07-21

- Serve every model from our HF org via the CDN — no third-party runtime fetch

## 1.0.0 — 2026-07-06

- Initial release.
