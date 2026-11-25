# Overview

**Thoth** is a private, offline **knowledge base** over your own content. It
builds an on-device search index of the notes, task lists, PDF highlights and
boards you already keep in the suite, then lets you **ask a question in plain
language** and get the matching passages from _your_ material — verbatim, with
a cited AI summary on top. It is part of the kimtos new-tab app suite, and it
is free, with no account needed.

Under the hood it is a **retrieval-augmented generation (RAG)** system, but
everything a RAG pipeline usually sends to a server happens **in your browser
instead**: the embedding model, the vector index and the language model that
writes the answer all run on-device. Nothing is uploaded, there is no account,
and there are no third-party calls.

## Highlights

- **Ask across everything you've written** — one question searches your Notes
  pages, Tasks, PDF highlights and NotaBoard boards at once.
- **Your notes, verbatim** — the retrieved passages are shown in full under
  _From your notes_ the moment retrieval finds them, and a click on a passage's
  header opens that item in its own app.
- **A checked AI summary** — the model writes a cited summary of those passages
  (`[1]`, `[2]`), and Thoth verifies it: a number, time or figure the summary
  asserts that your notes never mention is flagged as invented, and when your
  content doesn't cover the question at all Thoth says so instead of guessing.
- **Incremental indexing** — rebuilding the index only re-embeds documents that
  are new or changed and drops ones you deleted, so repeat builds are fast.
- **Fully offline** — the search model (~23 MB) and the chat model download once,
  are cached by the browser, and then run with no network at all.
- **Declared for a future assistant** — Thoth also declares a `search_knowledge`
  agent tool, which would retrieve cited passages from your private index. No
  shipped model can run it, so it does nothing today.

## What it indexes

Thoth reads only text **you authored** in other suite apps:

| Source app    | What is indexed                                           |
| ------------- | --------------------------------------------------------- |
| **Notes**     | Each page's title and Markdown content.                   |
| **Tasks**     | Each task's title and description.                        |
| **PDF**       | Your PDF highlights and their comments (labeled by page). |
| **NotaBoard** | The text of a board's elements and sticky notes.          |

Each indexed document keeps a link back to the exact record it came from, which
is what makes a citation clickable.

## Privacy model

Thoth adds no new place your data can go — it only reads from, and writes a
derived index into, the same local browser storage the rest of the suite uses:

- The **index** (text passages and their embedding vectors) is stored in your
  browser's IndexedDB, alongside a small set of content hashes used to detect
  changes.
- The **search model** and the **chat model** are downloaded from a model host
  the first time you use them, then cached locally; after that, asking a question
  needs no network.
- Nothing you index, ask, or receive as an answer is ever uploaded, and there are
  no analytics.
