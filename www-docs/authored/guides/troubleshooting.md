---
title: Troubleshooting
---

# Troubleshooting

## The AI apps download something the first time

The on-device AI apps need a model, and the model is a file that has to arrive once. After
that it is cached and the app works offline, forever.

| App                     | Roughly                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| Denoise, Video Recorder | 16 MB (they share the same one)                                                   |
| Voice to Text           | 145 MB, or 280 MB for the larger model                                            |
| KimtAI                  | 300 MB for the starter model — more if you add others from its Model Library      |
| Grammit                 | Nothing. Only if you turn on **AI deep grammar**, which then fetches about 250 MB |
| Image to Text           | English is built in. Other languages download on demand                           |

**You can close the window.** Downloads keep running in the background — closing the App
Store or Settings mid-download shows _"Download continues in the background."_ with a
**Reopen** button. Nothing is cancelled.

**If a download fails**, the App Store card says so, and you press **Install** again. There
is no resume — it starts over.

**To reclaim the space**, either uninstall the app, or open **AnubisDB ▸ Model storage** and
press **Free** next to the model. In KimtAI you can also remove individual models from its
**Models** library. A freed model downloads again next time you use the app.

## The AI is very slow

Almost certainly your browser has no **WebGPU**, so the models are running on the CPU
instead of the graphics card. Nothing is broken — it is just much slower.

KimtAI tells you when this is happening: _"Your browser has no WebGPU, so models run
slower (CPU)."_ Each reply is also tagged **GPU** or **CPU**.

What helps:

- Use a **smaller model**. In KimtAI, the starter model is the fast one; the larger ones
  are painful without a GPU.
- Update Chrome — WebGPU support has improved a lot.
- On a laptop, make sure Chrome is not being forced onto integrated graphics in
  power-saving mode.

No app _requires_ WebGPU. Everything works without it.

## It asked for a permission

Kimtos asks only when a feature genuinely needs it, and only for that feature.

| Prompt         | Why                                        | If you say no                                                                                          |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Location**   | The weather card                           | It reads _"Location unavailable"_. Nothing else changes.                                               |
| **Your tabs**  | The Tabs app, to search and hibernate them | The app shows **Grant access to my tabs** until you allow it                                           |
| **Screen**     | Video Recorder, to record your screen      | The Screen option switches itself off                                                                  |
| **Camera**     | Video Recorder                             | _"Camera unavailable — check permissions."_                                                            |
| **Microphone** | Video Recorder, Voice to Text, Denoise     | **The Mic option quietly switches off, with no message.** If your recording has no sound, this is why. |

## Limits you can hit

|                   | Limit                                                              |
| ----------------- | ------------------------------------------------------------------ |
| A PDF             | {{pdfMaxSize}}                                                     |
| A wallpaper image | {{wallpaperMaxSize}}                                               |
| One note page     | {{noteMaxChars}} characters (a counter appears as you approach it) |
| Clipboard history | Configurable; very large text and images are skipped               |

Beyond those, Kimtos asks Chrome for unlimited storage, so your library size is bounded by
your disk, not by us.

## Odd things that are not bugs

**The tab reloaded by itself.** After Kimtos updates, an open new tab refreshes once to
pick up the new version.

**A home card I turned on is not showing.** Cards hide themselves when they have nothing
to show. Add a note and the Notes card appears.

**The Clipboard side panel says it is not installed.** Install Clipboard from the App
Store on the Kimtos new tab, then reopen the panel.

**My wallpaper changed.** Wallpapers follow your light/dark theme unless you **★
Favorite** one to pin it.

## Something is actually wrong

**Export your data first** — **Settings ▸ Data ▸ Export my data**. Then:

- **Settings ▸ About ▸ Report an issue**, which opens a pre-filled issue on the public
  [GitHub issue tracker]({{issuesUrl}}) for you to review and send. There is no support desk or
  chat: Kimtos v1 is free, open-source software with no servers.

If an app is misbehaving, uninstalling and reinstalling it from the App Store is safe:
your data is kept unless you explicitly tick the box to erase it. See
[Your data](./your-data).
