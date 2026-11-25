# Overview

**Video Recorder** captures your camera, your screen, and your microphone — alone
or together — as a single video, all in the browser. It works like a tiny studio:
the preview is always live, an action bar sits under it with the sources on one
side and Record on the other, and you can flip any source on or off at any time,
even while you are recording. It is part of the kimtos new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no upload:
capture, compositing, encoding, and storage all happen in your browser, and every
recording lives in IndexedDB.

## Highlights

- **Three sources** — camera, screen (via screen/tab sharing), and microphone.
  Use any combination.
- **Live studio preview** — the compositing canvas _is_ the preview, so what you
  see is exactly what gets recorded.
- **Toggle anything mid-recording** — turn the camera, screen, or mic on or off
  without stopping or breaking the clip.
- **Camera bubble** — when you record screen + camera, the camera is overlaid as a
  small bubble, with its own strip in the action bar. Move it between corners,
  switch it between a rounded square and a circle, size it small, medium or large,
  or hide it altogether while the camera keeps running — all of it live,
  mid-recording included.
- **Mirror** — attached to the Camera button; the camera is shown as a natural
  mirrored self-view by default, so turn mirror off when on-camera text and
  whiteboards need to read the right way round.
- **System audio** — attached to the Screen button; optionally mixes in the shared
  screen's or tab's sound.
- **A status pill that says what is happening** — ready, recording or paused, the
  elapsed time, and exactly which sources are being captured.
- **Quality presets** — 720p (smoother) or 1080p (sharper), at 30 fps.
- **Reduce noise** — an optional, on-device pass that cleans background noise from
  the audio after recording. Chosen before you record.
- **Countdown** — an optional 3-2-1 (or 5-second) overlay before recording starts.
- **Pause and resume** — paused time is excluded from both the timer and the saved
  clip, which stays gapless.
- **History sidebar** — every recording is saved locally and played back with a
  custom video player. Download as `.webm`, or multi-select and batch-delete.

## Privacy model

Video Recorder never sends anything anywhere. Every stage runs on your machine:

- **Capture** uses the browser's camera, screen, and microphone APIs directly.
- **Compositing and encoding** happen in the page — frames are drawn to a canvas
  and encoded with the browser's own codecs (WebCodecs, or MediaRecorder as a
  fallback). The WebM muxer is pure JavaScript that runs locally.
- **Reduce noise** runs an on-device model in the browser (it downloads once,
  about 16 MB, then works offline).
- **Storage** writes each recording as a binary blob in IndexedDB.

Nothing is uploaded, and there are no analytics or third-party calls.
