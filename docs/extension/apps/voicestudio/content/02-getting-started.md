# Getting Started

Open **Voice Studio** from the dock. You land in the studio: a voice bar at the
top naming the voice you are about to use, the text box under it, and the
saved-clip sidebar on the left.

## Pick a voice

The voice bar shows the current voice with its accent, gender and quality grade,
a **Preview** button to hear it, and **Change voice** to open the picker.

The picker is a grid of voice cards. Each card carries the voice's initial, its
name, its accent and gender, and the model authors' quality grade. Above the grid
are a search box and three sets of filters — accent (**US** / **UK**), voice
(**Female** / **Male**), and **Top picks**, the four strongest voices: **Heart**,
**Michael**, **Emma** and **George**. **Heart** is the default.

Each card does two separate things, on purpose:

- **The card itself** selects that voice and closes the picker.
- **The play button** speaks a short sample line in that voice
  ("Hi, I'm Kore, one of the voices in Voice Studio on Kimt OS. This is a short
  preview, so you can hear how I sound before you press Speak."). Listening is
  **not** choosing: you can audition as many voices as you like without touching
  your selection, and press the button again to stop.

Auditioning never blocks the app — **Speak** stays live, and starting another
sample cancels the one playing.

### A voice has to be downloaded before it can speak

A voice you have never played is not on your machine yet, and the card says so:
it reads **Not downloaded**, and its control is a download button rather than a
play one. Pressing it fetches what is missing and then plays the sample, with a
progress bar the whole way.

What gets fetched, and once only:

- **The speech model, about 90 MB** — shared by every voice, so only the first
  voice you play pays for it. (Installing Voice Studio usually fetches it in the
  background, so in practice it is already there.)
- **That voice's own file, about 0.5 MB** — per voice, the first time you use it.

The picker states this above the grid, so you know before you press anything. The
rendered sample is then kept, so playing that voice again is instant and needs no
network at all.

**Fetch as many as you like at once.** Starting a second voice does not cancel the
first: each card runs its own download and shows its own progress, and pressing a
card that is working cancels just that one. The files are fetched in parallel; the
speech itself is rendered one voice at a time, because the model is a single
on-device engine — a card waiting its turn says **Queued**. When they land, the
voice that plays is the one you asked for last, so several finishing together never
talk over each other.

If your browser refuses to start the audio on its own — some do, when playback
begins seconds after the click that asked for it — the app says so and offers a
**Play** button in the message. Pressing that plays it immediately.

## Settings

Voice Studio has three settings, in the settings control in the window's title
bar (and in **Settings ▸ Apps**):

- **Voice** — the voice the studio starts with. Picking a voice in the app writes
  this too, so your choice survives closing the window.
- **Speaking speed** — the same 0.5x-to-2x value as the studio's slider.
- **Save every clip** — off by default. Turn it on and each finished clip is
  filed in the sidebar automatically, with no **Save to clips** step.

## Speak some text

Type or paste into the text box. A character count sits below it, and **Speak**
lights up as soon as there is something to say.

Press **Speak** and a progress bar appears. On the very first run it shows the
model download (`The voice model downloads once (~90 MB) and is then cached for
offline use.`); after that it goes straight to narrating. Long text reports
progress chunk by chunk, so you can see a big article moving.

**Cancel** appears while a render is running and stops it at the next chunk
boundary — a mistyped article does not have to be waited out.

## Adjust the speed

The **Speed** slider runs from 0.5x to 2x in 0.1x steps, with the current value
shown beside it. It applies to the next render; it does not change a clip you
have already made, and it is remembered for next time. Speed is the one delivery
control the model genuinely exposes, so it is the only one the app offers.

## The result

A finished render appears below the composer with the voice name, the clip size,
and a player. Two buttons sit under it:

- **Download WAV** — saves the clip to your computer as a 24 kHz mono WAV, named
  after the first few words of the text.
- **Save to clips** — files it in the sidebar and opens it there. With **Save
  every clip** turned on the app has already done it, and the result says
  `Saved to clips` instead.

Downloading and saving are independent: a clip you download is not automatically
kept, and a clip you save can be downloaded again later from the sidebar.

## Long-form narration

Voice Studio is built for whole articles, not just phrases. Behind the scenes a
long text is split at sentence boundaries into chunks the model can speak without
truncating, each chunk is synthesised separately, and the pieces are joined with a
short crossfade so the joins are inaudible. You get one clip, not a playlist, and
no sentence is dropped along the way.

There is no hard limit on length, but longer text means a longer render — the
work is real computation happening on your machine, and the progress bar reflects
that.

## Saved clips

The sidebar keeps your saved clips, newest first, labelled with the opening words
of the text. From here you can:

- **Open** a clip to replay it and read the text that produced it.
- **Download WAV** from the row's menu, without opening it.
- **Delete several at once** — click **Select** (or drag across rows), tick the
  clips you want, then **Delete (N)**. A toast lets you undo for a few seconds.

The list keeps the 40 most recent clips; older ones are trimmed automatically as
you add new ones. The sidebar's **New** button returns you to the composer.

## The first-run download

The first render — or the first sample — downloads the speech model once, about
90 MB. Installing the app from the App Store warms this up in the background, so
in practice your first render usually starts straight away.

Each voice also has its own small style file (about 0.5 MB), fetched the first
time you use that voice and cached from then on. Auditioning the whole palette
therefore costs a few megabytes in total, not a download per render — and each
rendered sample is kept locally, so the second play of a voice needs neither.

Once everything is cached the app is fully offline. Uninstalling Voice Studio
offers to delete both the cached model and your saved clips.
