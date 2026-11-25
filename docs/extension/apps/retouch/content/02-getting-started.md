# Getting started

Retouch is free and needs no account. Install it from the App Store, then open it from the
dock. There is no download and no first-run setup — it is ready immediately.

## Open an image

The empty state is a dropzone. Three ways in:

- **Click** it to browse for a file.
- **Drag and drop** an image anywhere onto the window.
- **Paste** with `⌘/Ctrl`+`V` — handy straight after a screenshot.

PNG, JPG, WEBP and GIF are accepted. The image is decoded onto a canvas at its
natural size; the checkerboard behind it shows transparent regions.

## The toolbar

| Control                                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rotate left** / **Rotate right**                    | Turns the image 90° counter-clockwise or clockwise.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Flip horizontal** / **Flip vertical**               | Mirrors the image.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Crop**                                              | Opens the crop editor with the whole image selected. Drag any of the eight handles to resize, drag inside the box to move it, or drag on an empty part of the image to draw a fresh selection. Pick an aspect preset (**1:1**, **4:5**, **16:9**, **9:16**, **3:2**) to lock the ratio, or type exact **W/H/X/Y** in pixels. Arrow keys nudge the box (**Shift** for larger steps); **Enter** applies, **Esc** cancels. **Apply crop** confirms, **Cancel** backs out. |
| **Resize**                                            | Asks for a new width and height in pixels.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Adjustments**                                       | Opens the colour panel (below).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Undo** / **Redo**                                   | Steps back and forth through your edits.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Reset to original**                                 | Throws away every edit and returns to the image as opened.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Zoom out** / **percentage** / **Zoom in** / **Fit** | Changes how large the image is drawn. The percentage is a button — click it for 100%. `Ctrl`/`⌘` + scroll over the image does the same. **Fit** scales the image to the pane; any other zoom lets the canvas area scroll.                                                                                                                                                                                                                                              |
| **Save**                                              | Keeps the image (and its pending adjustments) in the sidebar. Saving again updates the same entry rather than making a copy.                                                                                                                                                                                                                                                                                                                                           |
| **Open another image**                                | Starts over with a new file.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Download PNG** / **Copy to clipboard**              | Exports the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Adjustments

The **Adjustments** panel has seven sliders: **brightness**, **contrast**,
**saturation**, **blur**, **grayscale**, **sepia** and **invert**.

They preview **live** on the canvas without touching the underlying pixels, so
you can push a slider around and change your mind for free. Two ways out:

- **Apply** — bakes the current settings into the pixels, and becomes a single
  undo step.
- **Reset** — drops the adjustments and returns the sliders to their defaults.

Adjustments are also flattened automatically if you rotate, flip, crop or resize
while they are pending, so a transform never silently discards them.

## Exporting

- **Download PNG** — lossless, keeps transparency.
- **JPEG** — smaller, written at quality `0.92`. JPEG has no alpha channel, so
  transparent areas will come out solid.
- **Copy to clipboard** — copies the image as a PNG, ready to paste into another
  app (or into the Clipboard app's history).

The download filename is derived from the file you opened, with the extension
swapped.

## Your saved images

The sidebar on the left is your image library. **Save** puts the image you are
working on into it, with the adjustment sliders exactly as you left them; open it
again later and both come back.

- **Click a row** to open it. **+** starts a new image.
- **Right-click a row** for **Open**, **Rename**, **Download PNG** and
  **Delete**. A delete is confirmed once and can be undone from the toast.
- **Select** (or press and drag across the rows with the mouse) turns on
  checkboxes, so several images can be deleted in one go — one confirm, one undo
  that restores them all.
- The library keeps your **24 most recent** images; older ones fall off the end.

Everything lives in the local database on your device. It appears in **AnubisDB**
under Retouch, travels in a local backup, and uninstalling Retouch offers to
erase it.

## Two things worth knowing

**Undo is bounded to the last 12 steps.** The undo stack keeps twelve full-image
snapshots; older ones fall off the end. It is a live editing stack, not part of
what is saved — reopening a saved image starts a fresh one. For a longer path
back, **Reset to original** always works.

**Saving is explicit.** There is no autosave: an image you never pressed Save on
is gone when the window closes. Retouch asks before discarding unsaved changes
when you open another image or start a new one, but closing the window does not
prompt — **save or export before you close it.**
