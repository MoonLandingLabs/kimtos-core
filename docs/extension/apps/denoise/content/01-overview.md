# Overview

**Denoise** removes background noise from a recording and hands you back a clean
version, side by side with the original. Upload or record some audio, click
**Remove noise**, and a moment later you have a crisp WAV with the hiss, hum, and
chatter stripped out. It is part of the kimtos new-tab app suite.

The cleanup is done by **DeepFilterNet3**, a speech-enhancement model that runs
**entirely in your browser**. Your audio is never uploaded — it is decoded,
processed, and re-encoded right on the device.

## Highlights

- **Two ways in** — drag-and-drop or click to upload an audio file, or record
  from your microphone, your system audio, or both, with a live timer.
- **One-click denoise** — press **Remove noise** and watch a progress bar as the
  model works through the clip.
- **A/B player** — the result screen shows a **Cleaned** player and an
  **Original** player so you can compare them back to back.
- **Local history** — every run is saved to a sidebar (original _and_ cleaned
  audio), so you can reopen, replay, or re-download past clips. The most recent
  30 are kept.
- **Download** — save any cleaned clip as a 16-bit WAV.
- **Multi-select cleanup** — drag across clips (or tap **Select**) to delete
  several at once, with one-tap undo.
- **Hand-off to Voice to Text** — if the Voice to Text app is installed, you can
  send a cleaned clip (or the raw input) straight over for transcription.

## Privacy model

Denoise is **fully on-device**. There is no backend, no account, and no upload:

- The **DeepFilterNet3 model** runs locally in your browser via WebAssembly
  (onnxruntime-web). The model file (~16 MB) downloads **once** from
  Hugging Face (`kimtos-labs/denoiser-dfn3`), is cached in the browser's Cache Storage, and
  works **offline** after that.
- Your **audio** is decoded and denoised in memory and never leaves the machine.
- Each run — the original clip, the cleaned WAV, and a little metadata — is
  stored as blobs and records in your browser's **IndexedDB**, and is included
  in the suite's local Export / Import backup.

Because nothing is sent to a server, there are no analytics and no third-party
calls beyond that one-time model download.
