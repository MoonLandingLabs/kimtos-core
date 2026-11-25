# Overview

**AnubisDB** is the on-device data vault and explorer for the kimtos app
suite. Every other app stashes its data in one shared browser database — the
`kimtos` IndexedDB — and AnubisDB is the single console over it: browse what each
app has saved on this device, back it up, or clear it. It is part of the kimtos
new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no
network. AnubisDB reads the same local database the other apps write to, and
nothing it shows you ever leaves the machine. Exports are files you download;
imports are files you pick.

## Highlights

- **Browse every app's local data** — a left-hand list of the apps that have
  stored anything, each showing its item count and size. Pick one to see its
  data grouped into partitions.
- **Three kinds of storage** — each app's data is grouped as **records**
  (collections), **files** (media blobs), and **settings** (key/value caches),
  named and coloured after the owning app.
- **Readable record inspector** — expand a record to read it in a **Formatted
  view** (typed values, smart timestamps, links, image thumbnails, collapsible
  nesting) or flip to **Raw JSON** with one click; copy either.
- **Download individual files** — each stored media blob can be downloaded on its
  own from its row.
- **Per-app and full backups** — export one app as `<id>.json`, or the whole
  database as `kimtos-backup.json`, then import either back.
- **Clear with undo** — delete one app's data or wipe everything; a brief toast
  offers **Undo** that restores exactly what was removed.
- **Live auto-refresh** — the view re-scans when any app changes the database (or
  when the tab regains focus), so what you see stays current without flicker.

## What it shows

AnubisDB attributes data to apps automatically from the storage naming
convention, so a new app's data appears — named and grouped — with no changes to
AnubisDB. Alongside the dock apps you may see a few system owners:

- **Settings & caches** (`system`) — key/value data that belongs to no single
  dock app.
- **Wallpapers** — stored background images.
- **Unmapped data** — anything whose storage name does not follow the
  convention; this is the signal that a partition was named unexpectedly.

## Privacy model

AnubisDB only ever reads and writes local browser storage:

- It reads the three fixed stores of the one `kimtos` IndexedDB — `records`,
  `blobs`, and `kv` — directly, and never opens any other database.
- Exports are plain JSON files you download; imports are JSON files you choose.
- Nothing is uploaded, and there are no analytics or third-party calls.

Because a backup is a faithful, self-contained dump (media files are inlined as
data URLs), your data is portable and a restore reproduces exactly what was
exported.
