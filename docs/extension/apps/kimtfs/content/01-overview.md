# Overview

**KimtFS** is a private, on-device file system for your browser. It gives you a
familiar folder tree: create **folders**, write **text files**, and **upload**
files of any type — and everything is stored locally. It is part of the kimtos
new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no
network: every folder, file, and uploaded blob lives in your browser's storage
and never leaves the machine.

## Highlights

- **Folders & files, fully on-device** — a **column list** or an icon **grid**
  with Name, Size, Kind and Modified. Click a heading to sort by it; folders stay
  above files either way.
- **Find things** — a **search** that looks through the folder you are in and
  everything under it, and full **keyboard navigation** (arrows, Enter, Backspace,
  Delete).
- **Drag and drop** — drag items onto a folder to move them, or drop files in from
  your desktop.
- **Text files** — create a text file, or open an uploaded one, and edit it inline in
  the main pane; edits **autosave** a moment after you stop typing.
- **Uploads of any type** — upload one or many files; each keeps its original
  bytes, size, and MIME type. **Every type renders**: images, audio, video, PDFs,
  pretty-printed JSON, rendered Markdown and syntax-coloured code — and a hex dump for
  anything else. All of it can be **downloaded** back out.
- **Archives** — compress any file or folder to a `.zip`, or open one to see inside it and
  extract it. Done by the browser's own compressor, in the tab, with no library and no upload.
- **Nothing leaves your browser** — no servers, no analytics, no third-party
  calls.
- **Delete with undo** — deleting a file or a whole folder (and everything in it)
  is reversible for 6 seconds through an undo toast.
- **AnubisDB integration** — because all data is stored under the app's id
  prefix, KimtFS content is automatically listed and attributed in the suite's
  AnubisDB storage console.
- **Agent tools (declared, not active)** — KimtFS declares tools to list, create,
  read, update, rename, and delete folders and files, for a future on-device
  assistant. No shipped model can run them, so nothing touches your files today.

## Privacy model

KimtFS writes only to local browser storage:

- **Folders and files** are records in the shared IndexedDB, linked into a tree
  by a `parentId` (an empty `parentId` means the item lives at the root).
- **Text files** keep their content inline with the file record.
- **Uploaded files** keep their bytes as a separate **blob** in the same local
  database, referenced by the file's id.

Nothing is uploaded, and there are no analytics or third-party calls. Your files
travel with the browser profile and are included in the suite's local backup.
