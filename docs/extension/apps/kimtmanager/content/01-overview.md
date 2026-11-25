# Overview

KimtManager is the task manager for Kimtos. It answers one question that used to be
surprisingly hard to answer: **is anything still running?**

Plenty happens that you never see. An AI model downloads for several minutes, and closing the
App Store does not stop it. A noise-removal run keeps going after you have moved on. An app sits
minimized, still holding your microphone. All of that was already working correctly — there was
just nowhere to look at it.

KimtManager is that place.

## What it shows

| It lists            | Which means                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| **Downloads**       | A model being fetched, with live progress. The slowest, most invisible work. |
| **Background jobs** | Work that carried on after the tab that started it went away.                |
| **Open apps**       | Anything on screen right now.                                                |
| **Minimized apps**  | Still running, just not showing — including anything still making sound.     |

Each row says what the app is doing, not merely that it exists. A download shows how far along it
is. Work with no measurable progress says so plainly rather than showing a bar that does not mean
anything.

## What you can do

- **Click a row** to bring that app up.
- **Stop** it. What that means depends on what it is: a download is cancelled, a background job is
  ended, an open app is closed. Each is stopped properly rather than merely hidden — so a clip you
  can hear actually goes quiet, and a microphone is actually released.
- Cancelling a download asks first, since you may have been waiting a while for it.
- **Retry** or **Dismiss** anything that failed. A failure stays in the list until you deal with it,
  because it is the one outcome that will not resolve itself — so it offers the two things you might
  want, rather than a Stop for work that already stopped.

## Why it cannot be uninstalled

KimtManager ships with Kimtos and cannot be removed, for the same reason AnubisDB cannot.
Uninstalling it would not stop a single background job — it would only take away the one place you
can watch them and stop them. That is the opposite of what removing it should do.

## Privacy

KimtManager reads state that already exists on your device and shows it to you. It sends nothing
anywhere, and it stores nothing of its own.
