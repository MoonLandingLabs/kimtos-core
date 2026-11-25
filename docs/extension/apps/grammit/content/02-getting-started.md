# Getting Started

Open Grammit from the dock. You get a single editor — a large text area with a
hint above it. Start writing, or paste text in, and Grammit takes care of the
rest.

## Type and see underlines

Just type. A short moment after you stop (about a beat), Grammit checks your text
and draws red wavy underlines beneath anything it wants to fix. The footer shows
the status: a spinner while it checks, then either **No issues found** or a count
like **3 suggestions**.

While you are actively typing, the underlines clear so they never point at the
wrong spot; they reappear once you pause.

## Accept a fix by clicking

Click (or move the caret into) an underlined word to open its suggestion
popover. From there you can:

- **Accept a suggestion** — click one of the suggested replacements. Spelling
  issues may offer a few candidates, ranked best-first; pick whichever fits.
- **Type your own** — use the text field to write a custom correction (for
  example "repos" → "repositories") and click **Apply**.
- **Dismiss** — wave the suggestion off. Grammit remembers it and won't flag that
  same word-and-fix again while the window is open.

You can also right-click an underline to open its popover. Every accepted fix
joins the editor's native undo history, so `⌘/Ctrl`+`Z` reverses it.

## Fix all and copy

The footer has two actions:

- **Fix all** — applies every current suggestion at once, as a single undoable
  edit, then re-checks the rewritten text.
- **Copy** — copies the current text to the clipboard, with a brief "Copied!"
  confirmation.

## Optional: AI deep grammar

By default Grammit uses only its fast, instant rule-based and spell-check passes —
**no download required**. For deeper grammar, you can turn on an on-device AI
model in the app's settings:

- **AI deep grammar** — set this to **On** to also run the AI model. The fast
  rule-based checks always run regardless.
- **AI model** — choose **Base** (more accurate, larger download) or **Small**
  (faster, weaker, smaller download).

The model **downloads once on first use** (you'll see a "Downloading model"
percentage in the footer), is cached in the browser, and then **runs locally** on
later checks. As with everything in Grammit, your text never leaves the browser.
If the model can't be loaded, Grammit keeps showing the rule and spelling results
and notes that the deep check is unavailable.

You can also turn the built-in **Spell check** off in settings if you only want
the deterministic rules.
