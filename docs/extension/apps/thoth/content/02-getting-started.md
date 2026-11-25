# Getting Started

Open Thoth from the dock. Using it is a two-step rhythm: **build the index**
once (and again whenever your content changes), then **ask** as many questions
as you like.

## Build the index

At the top of the app a status line shows what's indexed so far — `No index
yet` on first run, or something like `128 passages · 34 documents indexed` once
you've built it.

1. Click **Rebuild index**.
2. The first build downloads the on-device search model (~23 MB) — you'll see a
   `Downloading search model…` progress message. This happens only once; the
   model is cached for next time.
3. Thoth then reads your Notes, Tasks, PDF highlights and boards, splitting each
   into passages and embedding them. Progress shows as `Indexing 3/34: <title>`.
4. When it finishes you'll see a summary, e.g. `Indexed 128 passages from 34
documents.`

If you have no content to index yet, Thoth tells you so — add some notes, tasks,
PDF highlights or boards first, then rebuild.

**Rebuilding is incremental.** After the first full build, later rebuilds only
re-embed documents that are new or have changed since last time, and remove ones
you've deleted. So it's cheap to click **Rebuild index** again after you've
edited a note or highlighted a new PDF passage, to bring your answers up to date.

## Ask a question

Once the index has content, type a question into the ask box — for example
_"What did I decide about the pricing model?"_ — and click **Ask** (or press
`⌘/Ctrl+Enter`).

Behind the scenes Thoth:

1. Embeds your question and finds the most relevant passages in your index (the
   retrieval step), and shows them **immediately** under _From your notes_ —
   verbatim text from your own content, before the AI has said anything.
2. Loads the on-device chat model the first time you ask (`Downloading AI
model…`, then `Thinking…`).
3. Streams back an **AI summary** of those passages, token by token.

If nothing in your index is relevant, Thoth says so rather than inventing an
answer — and if the index is empty, it reminds you to build it first.

## The passages are the answer; the summary is checked

The retrieved passages are exact quotes from your notes, so they are always
right. The summary above them comes from a **small on-device model**, which can
occasionally misstate a detail even with the passage in front of it — that is
why it is labelled _AI summary — check it against the passages below_. Thoth
also verifies the summary for you: any **number, time or figure it asserts that
appears nowhere in the retrieved passages** is flagged with a warning naming the
invented detail, so a misquoted date or amount never passes silently.

## Read the citations

The summary cites its sources inline as `[1]`, `[2]`, and so on. Below it, the
_From your notes_ list shows each citation with its passage text — click the
passage to expand it, or click its header chip like `[1] Notes · Roadmap` to
**open that item in its own app** (Notes, Tasks, PDF or NotaBoard), so you can
jump straight to the original context.

## Agent tool (not active yet)

Thoth declares a **`search_knowledge`** tool, which would pull cited passages from
your private index while the assistant answers. **It does not run today:** no
shipped on-device model is reliable enough to call tools, so searching your
knowledge base means opening Thoth.
