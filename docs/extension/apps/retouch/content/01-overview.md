# Overview

**Retouch** is an image editor that runs entirely inside the browser tab. Open a
photo or screenshot, crop and straighten it, adjust the colour, and export the
result — without it ever leaving your machine. It is part of the kimtos new-tab
app suite.

Everything is **fully on-device**. Retouch is built on the HTML5 Canvas and the
browser's own image pipeline: there is no backend, no account, no network call,
and — unlike the other media apps — **no model or WASM download**. It opens
instantly the first time.

## Highlights

- **Open anything** — pick a file, drag and drop it onto the window, or paste an
  image straight from the clipboard (`⌘/Ctrl`+`V`).
- **Transform** — rotate ±90°, flip horizontally or vertically, **crop** with a
  full editor (eight handles, drag-to-move, aspect presets, a rule-of-thirds grid
  and exact pixel dimensions), and resize to exact dimensions.
- **Adjust** — brightness, contrast, saturation, blur, grayscale, sepia and
  invert, with a **live preview**. "Apply" bakes the adjustments into the pixels;
  "Reset" drops them.
- **Undo / redo** — step back and forth through your edits, or reset all the way
  to the original image.
- **Save your images** — press **Save** and the image is kept in the sidebar,
  together with its pending adjustment sliders, so reopening it puts you back
  exactly where you left off. Right-click a saved image to **Open**, **Rename**,
  **Download PNG** or **Delete** it; **Select** (or drag across the rows) deletes
  several at once, with one confirm and one undo.
- **Zoom** — zoom in and out with the toolbar controls or `Ctrl`/`⌘` + scroll,
  and **Fit** to snap back to the window. A zoomed image scrolls inside the
  canvas area instead of being squeezed to fit.
- **Export** — download as **PNG** or **JPEG**, or **copy to the clipboard** —
  which pairs neatly with the Clipboard app.
- **Floating window** — pop Retouch out into an always-on-top window and edit
  while you work in other tabs.
- **Transparency-aware** — a checkerboard backdrop, so transparent regions read
  clearly instead of blending into the page.

## Privacy model

Retouch is the simplest privacy story in the suite: **the image never goes
anywhere.**

- It is decoded into a canvas in the tab, edited in memory, and written back out
  when you export.
- **Nothing is uploaded**, and there are no analytics or third-party calls.
- **Saved images stay on the device.** They go into the same local IndexedDB
  every other app uses (`history:retouch`), never to a server. They show up in
  AnubisDB under Retouch, they are included in a local backup, and uninstalling
  the app offers to erase them.

The one thing to know before you start: **an image you have not saved is not
kept.** The Save button is explicit, not automatic — so press Save (or export)
before you close the window. Retouch does warn you before discarding unsaved
changes when you open another image or start a new one.
