# Getting Started

Open AnubisDB from the dock. It scans the local database and shows a
toolbar with running totals, a list of apps on the left, and the selected app's
data on the right. If nothing has been stored yet, it says so — use any app and
your data will show up here.

## The toolbar

The top bar shows the **total size**, **item count**, and **number of apps**
stored on this device, plus four actions:

- **Refresh** — re-scan the database by hand (it also auto-refreshes; see below).
- **Import** — restore a kimtos or AnubisDB JSON file you previously exported.
- **Export all** — download a full backup as `kimtos-backup.json`.
- **Clear all** — erase every app's stored data (with an Undo).

When the database is empty, everything except **Refresh** is disabled.

## Browsing an app's data

The left column lists each app that has stored something, with its item count and
size. Click one to inspect it on the right. The detail pane shows the app, its
totals, per-app **Export** and **Clear** actions, and its data grouped into
**partitions**.

Each partition is a collapsible row tagged by kind:

- **records** — a collection of structured records.
- **files** — stored media blobs.
- **settings** — the app's key/value settings and caches, collapsed into one row.

Click a partition header to expand it and load its items.

## Inspecting a record

Inside a **records** or **settings** partition, expand an item to see its value.
It opens in the **Formatted view** by default — a readable field-by-field layout
that:

- shows a **Title Case** label for each field,
- formats likely timestamps as real dates (with a relative "3d ago"),
- turns URLs into links and `data:` image values into thumbnails,
- renders booleans as Yes/No chips and clamps very long text behind a **show
  all**,
- lets you collapse nested objects and arrays.

Use the **Raw JSON** toggle above the value to switch to the exact stored JSON,
and the copy button to copy it. Long settings values are truncated in the raw
view for readability.

## Downloading a file

Inside a **files** partition, each row shows the blob's key, type, and size, with
a **download** button to save that single file to disk.

## Exporting and importing

- **Export all** downloads the entire database as `kimtos-backup.json`.
- **Export** (in an app's detail header) downloads just that app as `<id>.json`,
  a self-contained dump with its media inlined.
- **Import** accepts either kind of file — a full `kimtos` backup or a per-app
  AnubisDB dump — and merges it back in. A file that is neither is rejected with
  a message.

## Clearing data (with undo)

- **Clear** (in an app's header) deletes that one app's data after a confirm that
  spells out how many items and how much space it frees.
- **Clear all** erases everything across every app after a confirm.

Either way, a toast appears with an **Undo** action that restores exactly what
was removed — so a mistaken clear is recoverable for a few seconds. Export a
backup first if you are unsure.

## Auto-refresh

AnubisDB keeps itself current. It re-scans (debounced) whenever any app writes to
the database, and again when the tab regains focus — which also catches changes
made in other tabs. Re-renders only happen when something material actually
changed, so your selection and scroll position are preserved and the view does
not flicker.

## Working with the assistant

AnubisDB declares read-only tools for a future assistant: summarise everything
stored (`db_summary`), list one app's partitions (`list_app_data`), and fetch a
single record as JSON (`get_record`). **None of them run today** — no shipped
on-device model is reliable enough to call tools. Destructive actions were never
exposed in the first place: even once the tools run, the assistant would be able
to inspect your storage but never erase it.
