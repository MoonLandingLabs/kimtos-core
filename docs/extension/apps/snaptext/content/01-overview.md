# Overview

**Image to Text** pulls the words out of an image. Upload, drop, or paste a
screenshot, photo, or scan and it runs optical character recognition (OCR) to
give you back selectable, copyable text. It is part of the kimtos new-tab app
suite.

Everything is **fully on-device**. There is no backend, no account, and no
upload: the OCR engine runs inside your browser, and the image never leaves the
machine.

## Highlights

- **Flexible input** — choose a file, drag-and-drop an image onto the dropzone,
  or paste one straight from the clipboard (`⌘/Ctrl`+`V`). Supports PNG, JPG,
  WEBP, GIF, and more.
- **Live preview** — the picked image shows in a framed preview before and after
  extraction, with a one-click **view full size** lightbox.
- **In-browser OCR** — text is recognized by Tesseract.js (WebAssembly), with a
  progress bar that tracks the loading and recognizing steps.
- **Readable result** — the extracted text appears first, with a word count, and
  the source image sits just below it.
- **Copy & download** — copy the text to the clipboard or save it as a
  `snaptext.txt` file.
- **History sidebar** — every extraction is saved locally as a _scan_. Revisit a
  past run, re-copy its text, or batch-delete several at once with one-tap undo.
- **English only** — the engine and the English language data are built into the
  extension. There is no language setting, because another language would have to
  be downloaded from a public CDN, and Kimtos makes no network request except the
  model downloads you start.
- **Layout choice** — the page is analysed automatically, so headings, columns
  and sidebars are all picked up; settings let you force a different reading if a
  particular image needs it.

## Privacy model

Image to Text never sends your image anywhere:

- **OCR runs in the browser** via a self-hosted Tesseract.js WebAssembly worker.
  The picture is read on the device and is not uploaded.
- **The engine and the English language data are bundled** with the extension, so
  OCR works fully offline. It makes no network request at all.
- **History** (the extracted text plus the original image) is stored only in
  your browser, and is included in the suite's local backup. Uninstalling the app
  can erase it.

The model compiles once and is then cached, so later runs are fast and continue
to work offline.
