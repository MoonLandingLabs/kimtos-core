# Getting Started

Open Image to Text from the dock. The left sidebar holds your past scans; the
main pane starts on a fresh input screen, ready for an image.

## Provide an image

There are three ways to load a picture:

- **Upload** — click the dropzone (_Drop or paste an image, or click to browse_)
  to pick a file. PNG, JPG, WEBP, GIF, and similar formats are accepted.
- **Drag-and-drop** — drag an image file from your desktop onto the dropzone.
- **Paste** — copy an image anywhere, then press `⌘/Ctrl`+`V` while the app is
  open.

Once loaded, the dropzone is replaced by a **preview** showing the image, its
filename, and size. Hover the preview and click the zoom button to open it
**full size** in a lightbox (click outside or press `Esc` to close). Click
**Remove** to clear it and start again.

## Extract the text

Click **Extract text**. A progress bar shows the engine's steps — loading the
bundled engine, then _Recognizing text_ — under the heading
**Reading the image…**. The first run compiles the OCR engine; afterwards it is
much faster.

## View the result

When recognition finishes, the result pane shows:

- The **extracted text** first, in a labelled, read-only box with a word count.
- The **original image** preview just below it (again with the full-size zoom
  lightbox).

If no text is found, the box reads _(no text found)_.

## Copy and download

From the result actions you can:

- **Copy** — copy the extracted text to the clipboard.
- **Download .txt** — save the text as `snaptext.txt`.
- **Start over** — return to the input screen for another image.

## History

Each successful extraction is saved to the **history sidebar** as a _scan_ (the
text plus the source image), newest first.

- **Open** a scan to view its text and image again.
- **Right-click** a scan for quick actions — Open, Copy text, Download .txt.
- **Delete several** — click **Select**, tick the scans (or drag across them),
  then **Delete (N)**. A toast lets you undo for a few seconds.

## Language

Image to Text recognizes **English**. The engine and the English data are built
into Kimtos, so it works offline. Other languages are not offered: they would
have to be downloaded from a public CDN, and Kimtos makes no network request
except the model downloads you start.

## Layout settings

Before reading an image, the OCR engine has to decide how the page is laid out.
Image to Text analyses it **automatically**, which is what you want for almost
every image: titles, columns, sidebars and body text are all found, and they are
returned in reading order.

The settings **Layout** field lets you override that when a particular image
reads better another way:

| Layout             | Use it for                                                                |
| ------------------ | ------------------------------------------------------------------------- |
| **Automatic**      | The default. Anything with a mix of headings, columns, or page furniture. |
| **Single column**  | One column of text at varying sizes, with nothing beside it.              |
| **Single block**   | A crop containing exactly one uniform block of text and nothing else.     |
| **Scattered text** | Signs, labels, diagrams — text dotted around with no page structure.      |
