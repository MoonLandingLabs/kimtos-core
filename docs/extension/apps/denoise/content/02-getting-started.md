# Getting Started

Open Denoise from the dock. It starts on the input screen, ready for a clip. The
sidebar on the left holds your past results — empty until your first run.

## 1. Add some audio

You can either upload or record:

- **Upload** — drag an audio file onto the drop zone, or click to pick one.
  Common formats work (`mp3`, `wav`, `m4a`, `ogg`, `flac`, `opus`, and more).
- **Record** — click the mic button and speak; a live timer shows the length.
  Stop when you're done. Two independent switches sit next to the button, **Mic**
  and **System**: record either, or both at once. System audio alone never asks
  for your microphone, so you can capture a call playing in another window even
  if your mic is blocked or missing. During a recording the switches mute and
  unmute each source instead, so you can drop one without ending the take.
  The same two switches live in **Settings ▸ Apps**.

The chosen clip appears in a small player card so you can check it before
processing.

If the audio source goes away while you are recording — you end the screen share,
or another app takes the microphone — the recording stops there and tells you why,
keeping everything captured up to that point.

## 2. Remove the noise

Click **Remove noise**. On the **first ever run** the model downloads once
(~16 MB) — the progress bar notes this, and it's cached for offline use
afterwards. Then you'll see:

1. **Decoding audio** — the clip is converted to mono 48 kHz.
2. **Removing noise** — DeepFilterNet3 processes the audio frame by frame, in
   your browser.
3. **Finishing** — the clean audio is encoded to a WAV.

When it's done, the result opens automatically and is saved to history.

## 3. Compare with the A/B player

The result screen shows two players:

- **Cleaned** — the denoised audio.
- **Original** — the clip you started with.

Play them back to back to judge the difference.

## 4. Download

Click **Download cleaned WAV** to save the result to your computer. You can also
download any past clip from its sidebar menu (**Download cleaned**).

## 5. The history sidebar

Every run is kept in the left sidebar (newest first, up to 30 clips):

- **Open** — click a clip to reopen its A/B player and download button.
- **Right-click a clip** for a menu: **Open**, **Download cleaned**, and (if
  available) **Extract transcript with Voice to Text**.
- **Delete several** — tap **Select**, tick the clips, then **Delete (N)** — or
  just drag across them. A toast lets you undo for a few seconds.

## Hand-off to Voice to Text

If the **Voice to Text** app is installed, Denoise can pass audio to it:

- **From the result screen or a clip's menu** — **Extract transcript with Voice
  to Text** sends the _cleaned_ clip over for transcription. The button follows
  the job and shows **Transcribing…**, then **Done ✓**.
- **From the input screen** — **Extract transcript with Voice to Text** forwards
  the _current clip as-is_ (without denoising first), in case the recording is
  already clean enough.

Denoise also receives hand-offs: a clip sent from another app (e.g. Voice to
Text) arrives pre-loaded on the input screen, ready for you to denoise.
