# Overview

**Voice to Text** turns spoken audio into text. Record a voice note from your
microphone or import an existing audio file, and the app transcribes it and hands
you back a copy-ready transcript. It is part of the kimtos new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no upload:
the speech-recognition model runs inside your browser, and both your audio and the
resulting transcripts stay on the machine.

## Highlights

- **Record or import** — capture a voice note from your microphone, or drop in an
  audio file (mp3, m4a, wav, ogg, opus, and more).
- **On-device transcription** — speech is recognized locally with a Whisper model
  running on WebAssembly; nothing is sent to a server.
- **Transcript card** — the finished text in a labelled card with a word count,
  **Copy**, **Download .txt**, and **Start over**.
- **History sidebar** — every transcript is saved with its original recording, so
  you can reopen it, replay the audio, and copy the text later.
- **Multi-select delete** — switch the sidebar into select mode (or drag across
  rows) to remove several transcripts at once, with one-tap undo.
- **Model & language settings** — choose **Tiny** (fast, smaller download) or
  **Base** (more accurate), and optionally pin a language or leave it on
  auto-detect.
- **Hand off to Denoise** — if the Denoise app is installed, send a recording
  there to clean it up before or after transcribing.

## Privacy model

Voice to Text never uploads your audio:

- **Transcription runs in your browser** via WebAssembly — the recording is decoded
  and recognized entirely on-device.
- **The model downloads once.** The first run fetches the model files (about 145 MB
  for Tiny, 280 MB for Base). After that they are cached, so later runs work
  **offline** with no further download.
- **Your data stays local.** Transcripts and their recordings live in your browser's
  local storage; there are no servers, accounts, or third-party calls.

## Accuracy

Whisper supports many languages, but **English is the most accurate**. Leaving the
language blank lets the model auto-detect; if you know the language, setting it
explicitly (e.g. `en`, `ar`) can help. The **Base** model is more accurate than
**Tiny** at the cost of a larger download and more memory while transcribing.
