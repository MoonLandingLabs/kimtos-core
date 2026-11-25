# Getting Started

Open Video Recorder from the dock. It opens straight into the **studio** — a live
preview with an **action bar** docked underneath it. Until a camera or screen is on,
the preview shows a placeholder telling you what to turn on.

Once a camera or screen is live, a status pill in the top-left corner of the preview
says what is going on: `READY`, `REC` or `PAUSED`, the elapsed time once you start,
and which sources are being captured (for example `REC · 1:23 · Camera + Mic`).

## Choosing your sources

The left of the action bar holds your three sources — **Camera**, **Mic** and
**Screen** — as the buttons you reach for most. Your choices are remembered for next
time.

- **Camera** — turns on your webcam. The first time, the browser asks for camera
  permission. The camera fills the frame when it is the only video source.
- **Screen** — starts screen or tab sharing. The browser asks which screen, window,
  or tab to share. When both screen and camera are on, the camera shrinks into a
  **bubble** over the screen.
- **Mic** — adds your microphone. Toggling the mic is an instant mute/unmute, so it
  never interrupts an in-progress recording.

If you stop a share from the browser's own sharing bar, the screen simply drops and
the recording keeps going with whatever else is on.

## Toggling sources mid-recording

You can flip any source on or off **while recording** — add your screen partway
through, drop the camera, mute the mic — and the clip never breaks. Nothing in the
action bar is hidden behind a menu, so every control stays one click away for the
whole take. (The one exception is **Reduce noise**, which is locked once recording
starts, and says so.)

## Mirror and system audio

Each source button carries the small controls that only make sense with it, joined
onto the same pill. They apply live, with no interruption:

- **Mirror** sits on the **Camera** button. On by default, showing your camera as a
  natural self-view; turn it off so text or a whiteboard in front of the camera
  reads correctly. It is dimmed while the camera is off, and hovering it says why.
- **System audio** sits on the **Screen** button. It includes the sound of the
  screen or tab you are sharing, connecting or disconnecting that audio instantly
  without touching the share itself. It is dimmed while the screen is off.

## Shaping the camera bubble

The action bar has a **Camera bubble** strip of its own, controlling the bubble your
camera is drawn in when you share a screen. Its four controls are live like
everything else in the studio — including while you are recording — and your choice
is remembered for next time:

- **Show** — the first button shows or hides the bubble. Hiding it leaves the camera
  running and available; it just stops being drawn over the screen. That is
  different from turning **Camera** off, which drops the camera entirely.
- **Corner** — steps the bubble round the four corners. The button is labelled with
  the corner it is currently in.
- **Shape** — a rounded **Square** that keeps your camera's own proportions, or a
  **Circle**. A circular bubble is a true circle: the picture is cropped to the
  centre rather than squashed.
- **Size** — **Small**, **Medium** or **Large** (16%, 24% or 32% of the frame
  width). Medium is the default.

The three look controls are inactive while the bubble is hidden, and the whole strip
dims and reads _Needs Camera and Screen together_ unless both are on — so it says
why rather than leaving you to find out by clicking.

## Quality, noise, countdown, and bubble position

These live in **Settings → Apps → Video Recorder**:

| Setting                        | What it does                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recording quality**          | `720p` (smoother, lighter) or `1080p` (sharper, better for screen text). Frame rate is 30 fps.                                                                                                                    |
| **Reduce noise**               | Cleans background noise from the audio after recording, using the on-device denoise model (~16 MB on first use). It re-encodes the clip, taking roughly as long as the recording. Choose it **before** recording. |
| **Camera bubble position**     | Which corner the camera bubble sits in for screen + camera recordings. Changing it applies to the studio you already have open, mid-recording included — the same as tapping **Corner** in the bar.               |
| **Countdown before recording** | Off, 3 seconds, or 5 seconds — a 3-2-1 overlay after you press Record.                                                                                                                                            |

Reduce noise also has its own **Before recording** strip along the bottom of the
action bar, so you can flip it without opening Settings. Because it can only be
applied to a whole clip, it greys out the moment you press Record and the strip
changes to read _Locked while recording_ — you never have to click a dead control
to find that out.

## Recording

1. Turn on at least one video source (camera or screen).
2. Press **Record** — it sits on its own, to the right of the sources, so it is
   never mistaken for a toggle. If a countdown is set, a 3-2-1 overlay plays first;
   pressing Record again during the countdown cancels it.
3. While recording, the status pill turns red and reads `REC` with a live timer, and
   a **Pause** button appears next to Record. Pausing turns the pill amber, reads
   `PAUSED`, and excludes that time from the timer and the saved clip.
4. Press **Stop** to finish. If Reduce noise is on, a short "Cleaning audio…"
   progress step runs, then the recording is saved.

While it runs, the recording also appears as a row in **KimtManager**, so you can
see it and stop it from anywhere in the app — and stopping it there finishes and
saves the clip, exactly like pressing Stop. Anything that tears the studio down
mid-recording — closing the window, opening another recording — saves what has
been captured rather than discarding it.

## History sidebar and the player

The left sidebar lists your recordings, newest first (up to 20 are kept). Click one
to open it in the **custom video player** — your own controls, not the browser's
native ones. From the result screen you can:

- **Download** the clip as a `.webm` file.
- **Record another** to jump back to the studio.

Each row also has a menu with **Open** and **Download**.

## Multi-select delete

To remove several recordings at once, click **Select** in the sidebar (or drag
across the rows), tick the ones you want, and choose **Delete (N)**. A toast lets
you undo for a few seconds. Deleting a recording also removes its stored video data.
