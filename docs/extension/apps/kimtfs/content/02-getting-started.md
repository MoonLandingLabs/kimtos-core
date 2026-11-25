# Getting Started

Open KimtFS from the dock. The window has two parts: a **path bar** across the top,
and the **explorer** below it — which shows either a **listing** of the folder you are
in (as columns or as a grid of icons), or a file you have opened.

## Where am I, and where will my next file go?

The path bar answers both. It shows the trail from the root — `KimtFS › Documents ›
Music` — and every segment is clickable, so you can jump back up at any point. Next
to it, in plain words, is where a new file, folder or upload will land: **New items
go to Music**.

That target follows your **selection**: select a folder and new items go inside it;
select a file and they land beside it, in the same folder; click **KimtFS** in the path
bar and they go to the top level.

## The column list

The main pane lists the folder you are in, with four columns:

| Column       | What it shows                                                                       |
| ------------ | ----------------------------------------------------------------------------------- |
| **Name**     | The item's name, with a folder or file icon                                         |
| **Size**     | The file's size on disk (folders show a dash)                                       |
| **Kind**     | What the file actually is — Image, PDF document, JSON, Markdown, Code, Audio, Video |
| **Modified** | A time for anything changed today, otherwise a date                                 |

**Click a column heading to sort by it**; click the same heading again to reverse it.
Folders always stay above files, in every column and both directions.

- **Single-click** a row to select it.
- **Double-click** a folder to go into it, or a file to open it.
- **The back arrow** in the toolbar goes up one level.

### The keyboard

Click the list once and you can drive it entirely from the keyboard:

| Key           | Does                                                           |
| ------------- | -------------------------------------------------------------- |
| **Up / Down** | Move through the rows                                          |
| **Enter**     | Open a file, or go into a folder                               |
| **Backspace** | Go up one level                                                |
| **Delete**    | Delete the row (with the same confirmation as everywhere else) |

### Search

The search box in the toolbar looks through the folder you are in **and every folder
underneath it** — not just the rows on screen. Because a name on its own is ambiguous
when three files are called `report.txt`, each result also shows the folder it lives
in.

## Working with items

- **New file or folder** — the **＋** button in the toolbar.
- **Upload** — the upload button takes one or more files from disk.
- **Go into a folder** — double-click it. A single click _selects_ it, so the next new
  file lands inside without moving you.
- **Go back up** — click any segment of the path bar, or the back button.
- **Select several at once** — the **Select** button turns on tick-boxes. Tick a few (or
  drag across them) and delete them in one go, with a single undo.

Right-click anything for its menu: **Get Info**, **Rename**, **Delete**, plus **New
file / New folder / Upload here** on a folder, and **Open / Download** on a file.

**Get Info** shows the kind, the size (or the number of items in a folder), where it
lives, when it was last modified, and the file's type.

## Drag and drop

- **Drag a file or folder onto a folder** to move it into it. Dropping onto a _file_
  means "into the folder that file is in".
- **Drag it onto the path bar** to move it back _out_ — drop it on any segment and it
  lands in that folder, including **KimtFS** for the top level.
- **Drag files in from your desktop** and drop them on a folder or on the listing. The
  bytes go straight into this browser's storage.
  Nothing is uploaded anywhere, because there is nowhere to upload to.

## Selecting several at once

Press **Select** above the listing to enter selection mode: tick the items you want
(or press and drag across them), then **Delete (N)** removes them all with one
confirmation and one undo. It works in the grid as well as the list.

## Opening a file

KimtFS renders whatever you saved:

- **Images**, **audio** and **video** display or play inline.
- **PDFs** are rendered page by page, in the app.
- **JSON** is pretty-printed — and an _invalid_ `.json` shows you the parse error,
  which is usually why you opened it.
- **Markdown** is rendered, and **code** is shown with **syntax colouring** — the same
  highlighter the suite uses for code inside a note, so a file looks the same wherever
  you read it.
- **Anything else** gets a **hex dump** of its first bytes, so you can at least see
  what it really is.

Any file whose content is text opens in an editor that **autosaves** shortly after you
stop typing (a **Saving… / Saved** status appears next to it) — and that includes files
you **uploaded**, not just files you created here. If the file is JSON, Markdown or
code, a **Preview** button switches between editing it and reading it formatted. Text is
capped at **200,000 characters**; a bigger file opens read-only.

Uploaded files can be **downloaded** back to disk from the toolbar or the right-click
menu.

## Archives

Right-click any file or folder and choose **Compress to ZIP**. The archive is saved beside it
as an ordinary file, so you can preview it, download it, or move it like anything else. A
folder is compressed with everything inside it, keeping its structure.

Open a `.zip` and KimtFS shows you **what is in it** — every entry and its size — before you
commit to unpacking it. Press **Extract** and the contents land in a new folder next to the
archive.

It is all done in this tab, by the browser's own compressor, on bytes that are already on your
device. Nothing is uploaded to be zipped, and nothing is downloaded to be unzipped. Every entry
is checked against its **checksum** on the way out: a damaged archive fails and says so, rather
than quietly writing corruption into your files.

## Deleting, with a confirmation and an undo

Deleting asks first, and says exactly what will go — including how many items are
inside a folder you are about to remove. After you confirm, an **undo toast** stays
for about six seconds, so a mistaken "yes" is still recoverable. If you do not undo,
the delete is committed and any uploaded bytes are freed.

## The status bar

The bar along the bottom shows how many items you are looking at, and how much of the
storage the browser has given this device is in use.
