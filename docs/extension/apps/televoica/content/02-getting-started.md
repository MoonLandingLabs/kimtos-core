# Getting Started

Open **Voice to Text** from the dock. You start on the input screen, ready to
record or import a voice note.

## Provide audio

There are two ways to give the app something to transcribe:

- **Record** — click the microphone to start capturing, with a live timer; click
  again to stop. The clip appears in a small player so you can preview it. Two
  independent switches beside the button choose what is captured, **Mic** and
  **System** — either, or both. System audio alone never asks for your microphone,
  so a call playing in another window can be transcribed with the mic blocked or
  missing; during a recording the switches mute and unmute each source instead.
- **Import** — click the dropzone to pick an audio file, or drag and drop one onto
  it. Common formats are supported (mp3, m4a, wav, ogg, opus, flac, and more).

If the audio source goes away while you are recording — you end the screen share,
or another app takes the microphone — the recording stops there and tells you why,
keeping everything captured up to that point. It never keeps running against a
source that is no longer sending anything.

When a clip is ready, click **Extract text** to transcribe it.

## Progress steps

Transcription shows a progress bar that moves through a few phases:

1. **Downloading model** — only on the first run (or after changing the model). A
   progress bar tracks the download; once cached, this step is skipped.
2. **Decoding audio** — your clip is decoded to the format the model expects.
3. **Transcribing** — the model recognizes the speech and produces text.

## The transcript card

When it finishes, you get a transcript card showing the recognized text and a word
count, plus:

- **Copy** — copy the full transcript to the clipboard.
- **Download .txt** — save the text as `transcript.txt`.
- **Start over** — return to the input screen for a new recording.

The original recording sits above the transcript with a player, so you can replay
it while reading. A recording with no sound in it is never handed to the model —
the card shows `No speech detected` rather than a transcript of silence.

## History sidebar

Every successful transcript is saved to the **history sidebar** on the left, newest
first, with a short snippet of the text. From here you can:

- **Open** a past transcript to view its text and replay its audio.
- **Copy text** or **Download .txt** from the row's menu.
- **Delete several at once** — click **Select** (or just drag across rows), tick the
  transcripts you want, then **Delete (N)**. A toast lets you undo for a few seconds.

History keeps the most recent transcripts (older ones are trimmed automatically).

## Settings

Open the app's settings (Settings ▸ Apps) to adjust:

- **Model** — **Tiny** (fast, ~145 MB), **Base** (more accurate, ~280 MB) or **Small** (most accurate, ~250 MB). Larger
  is more accurate but means a bigger download and more memory.
- **Language** — leave blank to auto-detect, or set a code like `en` or `ar`.
- **Record my microphone** and **Record system audio** — two independent
  switches; any combination is valid. You also set them each time you record.
  On macOS Chrome can capture a tab's audio but not another application's.

## First-run model download

The very first transcription (or the first after switching models) downloads the
model once. The suite's onboarding can **warm this up** ahead of time by prefetching
the model in the background, so your first real transcription is instant. Either
way, once the files are cached the app works offline and only uses memory while it
is actively transcribing.
