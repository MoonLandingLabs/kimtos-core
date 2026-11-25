---
title: Your data
---

# Your data

Everything you create in Kimtos is stored in **your browser, on your machine**. Notes,
tasks, PDFs and their annotations, clipboard history, whiteboards, recordings, AI
conversations — none of it is uploaded, and we have no copy.

That is the point of the product. It also means **the backups are your job**, and this
page is how you do them.

## Back up: Settings ▸ Data

Open **Settings** (click your avatar, top right) and choose **Data**.

**Export my data** downloads a single file — `kimtos-backup-2026-07-12.json` — containing
everything: every record, every file, every setting. Keep it somewhere safe.

**Import a backup** takes that file and restores it, then reloads the page.

::: warning Import merges, it does not replace
Importing adds and overwrites what is in the file. It does **not** wipe what is already
there — anything not mentioned in the backup is left alone.

So importing an old backup on top of a workspace you have been using does not roll you
back to that snapshot. It merges the two. If you want a clean restore, clear the data
first (see AnubisDB below), then import.
:::

Two more things the backup does **not** contain:

- **The AI models.** They are large, and they re-download by themselves when needed.

## Moving to a new computer

1. On the old machine: **Settings ▸ Data ▸ Export my data**.
2. Install Kimtos on the new machine (there is no account; the workspace starts empty).
3. **Settings ▸ Data ▸ Import a backup** and choose the file.

This is the **only** way to move your work. There is no account or sync, so nothing follows you
to a new machine by itself.

## AnubisDB: see everything Kimtos has stored

AnubisDB is a free app, installed by default. It is a window onto the database itself:
every app, what it has stored, and how much space it takes.

From the toolbar:

| Button         | What it does                                        |
| -------------- | --------------------------------------------------- |
| **Refresh**    | Re-reads the database                               |
| **Import**     | Restores a backup file                              |
| **Export all** | The same full backup as Settings ▸ Data             |
| **Clear all**  | Erases everything, with an **Undo** in the snackbar |

Click any app to see just its data, and to **Export** or **Clear** that one app on its
own. Deleting an app's data asks you to confirm first, and offers an **Undo** afterwards.

::: warning Undo is only good for a few seconds
The **Undo** on a clear lives in memory, in that snackbar. Once it disappears, the data is
gone for good. Export before you clear anything you might want back.
:::

AnubisDB also has a **Model storage** section listing the downloaded AI models, with a
**Free** button for each. Freeing one reclaims the space; the model downloads again next
time you use that app.

## Removing an app keeps its data

Uninstalling an app from the App Store **does not delete what you made with it**. The
dialog says so, and offers a checkbox — _"Also erase my notes & collections — this can't
be undone"_ — which is **unticked** by default.

Leave it unticked and your notes wait for you, exactly as they were, if you ever install
Notes again. Tick it only if you really mean it.

If the app had downloaded an AI model, that model **is** freed to reclaim the space
(unless another installed app is using the same one).

## The one thing that really does delete everything

::: danger Removing Kimtos from Chrome deletes all of it
If you uninstall the Kimtos extension itself, Chrome deletes its storage — every note,
task, PDF, board and recording, gone. That is Chrome's behaviour and we cannot prevent it.

**Export first.** Always.
:::

The same applies if you clear your browsing data and include site data for extensions.

## Where it actually lives

For the curious: an IndexedDB database called `kimtos` inside your browser profile, plus
Chrome's extension storage for your settings. The AI models sit in the browser's cache
storage, separately, which is why they are not in your backup and can be freed without
touching your work.
