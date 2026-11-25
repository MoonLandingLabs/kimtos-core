# Overview

**Tasks** gives you a fresh to-do list for every day. Instead of one
ever-growing pile, each date has its own list — you pick a day in the sidebar,
jot what needs doing, and check things off as you go. It is part of the kimtos
new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no
network: every task lives in your browser's IndexedDB and never leaves the
machine.

## Highlights

- **A list per day** — a sidebar of dates, each opening its own task list.
  Today and Yesterday are labelled by name; other days show their weekday and
  date.
- **Quick capture** — a compact composer adds a task by title; expand it to
  add an optional description.
- **Edit in place** — rename a task or change its description without leaving
  the list.
- **Check things off** — a done checkbox on every task; the header shows how
  many are still left.
- **Multi-select delete** — tap **Select** (or drag across rows) to remove
  several tasks at once, with one undo that restores them all.
- **Dock badge** — the dock icon shows the total number of open tasks across
  every day.
- **Home widget** — a card on your home screen lists today's open tasks plus
  anything still unfinished from earlier days, so nothing silently vanishes
  when the date rolls over.

## Privacy model

Tasks writes only to local browser storage:

- **Tasks** (date, title, description, done flag) are records in IndexedDB.
- Nothing is uploaded, and there are no analytics or third-party calls.

Because each task is plain serializable data, your lists are portable — they
travel with the browser profile and are included in the suite's local
**Export / Import** backup.
