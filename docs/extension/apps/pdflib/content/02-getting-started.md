# Getting Started

Open PDF Library from the dock. You land on your **reading list** — empty at
first, with a form at the top for adding your first book.

## Adding books

There are two ways to add a PDF, both from the top of the list:

- **Import by URL** — paste a link to a PDF into the _"Paste a PDF URL to
  import"_ field and click **Import**. The file is downloaded and stored locally.
- **Upload a file** — click **Upload a PDF from your computer** and pick a file.

A **Title** field above both is optional. If you leave it blank, the title is
taken from the file name (or the last part of the URL). Either way, as soon as
the book is added it opens straight into the reader. Files are capped at **{{pdfMaxSize}}**,
and non-PDF files are rejected.

## Managing the list

- **Filters** — the **All / Unread / Read** tabs narrow the list. In **All**,
  unread books come first and a _"Read"_ divider marks where the read ones begin.
- **Mark read / unread** — tick the checkbox on a book's row. The dock badge
  (the unread count) updates accordingly.
- **Open** — click a book to open it in the reader. Each row shows its source
  (the host for URL imports, or _"Uploaded PDF"_) and, if you have read past the
  first page, the page you left off on.
- **Download** — the download arrow on a row saves that book's PDF back to your
  computer. It is the file you imported or uploaded, byte for byte; the book stays
  in your library, along with its highlights and reading progress. The file is
  named after the book's title.
- **Remove one** — the trash button on a row deletes that book (with a confirm,
  then a few seconds to **undo**).
- **Remove several** — tap **Select** (or drag across rows), tick the books, and
  delete them in one batch.

## Reading

The reader is a continuous, scrolling view: all pages are stacked top to bottom,
and each one renders as it nears the screen. The toolbar gives you everything
else.

- **Scroll & page indicator** — just scroll to move through the book. A live
  **page / total** counter in the toolbar tracks where you are.
- **Zoom** — use the **−** and **+** buttons; the current percentage shows
  between them. Pages open at their natural size (shrunk to fit only if wider
  than the view) and your zoom level is remembered per book.
- **Remember last page** — the reader reopens at the page (and zoom) you left
  off on.
- **Download** — the download arrow in the toolbar saves the book you are reading
  back to your computer, without leaving the reader.
- **Back** — the back arrow (top-left) returns to the reading list.

## Searching

Type into the **Search in book…** field and press `Enter`. Every match across
the whole book is highlighted, and the reader jumps to the first one. A counter
shows _match / total_; the **‹** and **›** buttons step between matches (pressing
`Enter` again advances to the next). Search ignores whitespace, so a phrase is
found even when the PDF splits it across separate text chunks.

## Highlights, notes & annotations

- **Create a highlight** — select some text in a page. A small popup appears with
  four colors (**yellow, green, blue, pink**); click one to highlight the
  selection.
- **Add a note** — in that same popup, click **Note** to highlight and
  immediately open a comment box. Type your note and click **Save**.
- **Edit later** — click an existing highlight to reopen the popup, where you can
  change its color, edit its comment, or delete it.
- **Annotations sidebar** — the **Notes** button (toolbar) opens a side panel
  listing every highlight and comment in order, with a color dot and page number.
  Click an entry to scroll to it (it flashes briefly); use the trash icon to
  delete it.
