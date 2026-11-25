# Overview

**PDF Library** is a reading list with a built-in PDF reader. You collect PDFs —
by uploading files from your computer — track which ones you have read, and open
any of them in a smooth, continuous reader where you can search the text and mark
it up with colored highlights and notes. It is part of the kimtos new-tab app
suite.

Everything is **fully on-device**. There is no backend, no account, and no
network round-trips while you read: every book, the PDF file itself, your reading
progress, and your annotations live in your browser's IndexedDB and never leave
the machine.

## Highlights

- **Build a reading list** — upload a PDF from your computer. The file is
  stored locally, so it opens instantly later.
- **Track progress** — a read checkbox per book, plus **All / Unread / Read**
  filters. Unread books sort first; read ones fall below a divider.
- **Dock badge** — the app's dock icon shows how many books are still unread.
- **Continue reading** — a home-screen widget lists the books you read most
  recently, so you can jump straight back in.
- **Continuous reader** — every page stacked in one scroll, rendered on demand,
  with manual zoom and a live page indicator.
- **Remembers where you were** — your last page and zoom level are saved per
  book and restored when you reopen it.
- **Search the whole book** — find a word or phrase across every page, with
  matches fully highlighted even when they break across the PDF's text chunks.
- **Highlights, notes & annotations** — select text to highlight it in one of
  four colors, attach a comment, and browse everything in a notes sidebar.

## Privacy model

PDF Library writes only to local browser storage:

- **Books** (title, source, read state, last page, zoom) are records in
  IndexedDB.
- **The PDF files** themselves are stored as binary blobs, one per book.
- **Annotations** (highlights and comments) are separate records linked to a
  book.

A PDF is copied into your own storage when you upload it and is **rendered in the
browser**. PDF Library makes no network request: it cannot fetch a PDF from a
URL, nothing is uploaded, and there are no analytics or third-party calls.
