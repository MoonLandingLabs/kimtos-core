// Ticking a checkbox in the Notes preview, resolved back to an exact range of the
// Markdown source.
//
// The mapping has to be exact: the caller only knows WHICH box was clicked (its index
// among the preview's inputs), and this has to name the `[ ]` that produced it. Get it
// wrong by one and a click rewrites a different line of the user's note.
//
// Why not just walk `marked`'s token tree? Because a nested list's `raw` comes back
// DE-INDENTED — `- [ ] nested`, not `  - [ ] nested` — so child offsets do not line up
// with the source and accumulating them silently drifts. Top-level token raws do
// concatenate back to the source exactly, so the lexer is used for the one thing it is
// reliable for here (finding the code blocks), and the boxes themselves are found by
// scanning source lines, which are their own offsets.
//
// Measured against `marked` rather than assumed, since only the renderer decides what is
// a box (all four verified in the tests):
//
//   - [ ] a          -> a box
//     - [ ] nested   -> a box, and it follows its parent in both source and DOM order
//   > - [ ] quoted   -> a box; the marker is right there in the line, so it toggles
//   ```
//   - [ ] fenced     -> NOT a box, even inside a list
//   ```
//       - [ ] indented   -> NOT a box (indented code)

import type { Token } from 'marked';
import { marked } from '../../lib/markdown.js';

/** A replacement to apply to the source: `text` takes the place of `[start, end)`. */
export interface TaskEdit {
  start: number;
  end: number;
  text: string;
}

/** A list item that renders a checkbox: optional quote markers, a bullet or an ordered
 *  marker, the box, then CONTENT. The content is required because `- [ ]` with nothing
 *  after it renders as the literal text `[ ]`, not as an input. */
const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[[ xX]\][ \t]+\S/;
/** A fence opens or closes on ``` or ~~~, at any indent (a fence inside a list is
 *  indented) and behind any blockquote markers (`> ```` inside a quoted example). */
const FENCE = /^\s*(?:>\s*)*(?:`{3,}|~{3,})/;

/**
 * The markup `marked` gives a task item's checkbox: an input opening its `<li>`, or
 * opening the `<p>` that opens its `<li>` (a LOOSE list — one blank line anywhere in a
 * list makes every item loose — wraps each item's content in a paragraph).
 *
 * This exact shape is also `TASK_BOX_SELECTOR` below, deliberately. The two have to
 * enumerate the same set of boxes or an index into one is not an index into the
 * other, and every attempt to keep them in step with *different* rules drifted: first
 * counting every `<input`, which swept up a checkbox pasted as raw HTML; then excluding
 * raw HTML by token type, which missed the same tag written inline in a paragraph. Anchor
 * both to the one thing that actually distinguishes a task box — that it opens a list
 * item — and there is nothing left to keep in step.
 *
 * The shape is not FORGERY-proof, and cannot be: `<li>` is a tag anyone can paste, the
 * editor is a plain textarea, and nothing sanitises what goes into it. What makes that
 * harmless is `blockTaskOffsets` below, which refuses any block it cannot map — so a
 * forgery costs its own block and nothing else (#1294).
 *
 * The capture is the input's attributes, which is where `checked` lives.
 */
const RENDERED_BOX = /<li>\s*(?:<p>)?\s*<input([^>]*)>/g;

/** Whether each box `marked` renders for this HTML is ticked, in document order. The
 *  renderer is the only authority worth having here — every attempt to predict it from the
 *  source text alone lost to some construct (raw HTML, a fence, a setext underline, a
 *  quoted sample). */
function boxStates(html: string): boolean[] {
  return [...html.matchAll(RENDERED_BOX)].map((m) => /\bchecked\b/.test(m[1]));
}

/** Task-marker offsets inside one token's raw text, relative to `base`. */
function scanBlock(raw: string, base: number): number[] {
  const offsets: number[] = [];
  let fenced = false;
  let lineStart = base;
  for (const line of raw.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
    } else if (!fenced) {
      const m = TASK_LINE.exec(line);
      // Group 1 is everything before the box. Its length IS the box's column — counting
      // back from the match end would be wrong, because the run of spaces between the box
      // and the content is variable-width.
      if (m) offsets.push(lineStart + m[1].length);
    }
    lineStart += line.length + 1; // + the '\n' that split() removed
  }
  return offsets;
}

/**
 * Where one top-level block's task markers are, or `null` when this block's boxes cannot
 * be trusted to line up with them.
 *
 * This is THE verdict on a block, and the app's renderer asks the same question of the
 * same function before it turns any of that block's boxes into a live control — so the
 * clickable set and the marker set are not two rules that have to agree, they are one
 * answer used twice.
 *
 * Each block is rendered and its boxes counted, because "is this line really a checkbox"
 * has no cheap textual answer:
 *
 *   - **Renders none** — no boxes, no markers, `[]`. This is what makes a raw `<div>`, a
 *     fenced sample or a quoted code block harmless: a `- [ ] x` inside one is literal
 *     text, and a block with no boxes cannot shift anyone's index.
 *   - **Renders some, and the scan agrees** — the offsets, in document order, ONCE the
 *     boxes have been shown to belong to those markers (see below).
 *   - **Renders some, and the scan disagrees** — `null`. Something rendered a box with no
 *     marker behind it (pasted HTML that opens a list item) or a marker that rendered no
 *     box (a setext underline turning the item into a heading). Either way this block
 *     cannot be mapped, so it takes no part: no offsets, and no enhanced boxes.
 *
 * Equal COUNTS are not enough, which is the trap the first version fell into: one forged
 * box and one marker that renders no box cancel out, and the forgery is then mapped onto
 * a real line. `<li><input type="checkbox"> forged</li>` followed on the NEXT line by
 * `- [x] done` is one raw-HTML block that does exactly that — 1 box, 1 marker, and
 * clicking the fake rewrote `done`. So a block containing raw HTML has to prove the
 * correspondence, not just count it.
 *
 * `source` and `base` say where this block is meant to be, and the first thing done with
 * them is checking that it IS there. `token.raw` is normally the exact source text of the
 * block — that is what makes scanning it for offsets legitimate — but `marked` does not
 * always hand it back verbatim: a blockquote followed by a lazily-continued raw HTML line
 * comes back with a newline inserted, and one case in this corpus came back reflowed
 * ("> - - [ ] quoted"). Every offset derived from that raw is then a character or more out,
 * so a click does not refuse, it rewrites the middle of a marker and corrupts the line. A
 * block that is not where it says it is cannot be mapped at all.
 */
function blockTaskOffsets(token: Token, source: string, base: number): number[] | null {
  if (!source.startsWith(token.raw, base)) return null;
  const states = boxStates(marked.parser([token]) as string);
  if (states.length === 0) return [];
  const found = scanBlock(token.raw, base);
  if (found.length !== states.length) return null;
  // Nothing that could OPEN a tag means no raw HTML reached the output, so every box in
  // this block is one `marked` built from a marker. Worth checking first: it is true of
  // essentially every real checklist, and it skips the second render below. `- [ ] 5 < 6`
  // is prose, not markup, so it takes this path too.
  if (!/<[a-zA-Z!/?]/.test(token.raw)) return found;
  return boxesFollowMarkers(token.raw, states) ? found : null;
}

/**
 * Whether every rendered box in this block actually belongs to one of its markers.
 *
 * Flip every marker and render the block again: a box `marked` built from a marker follows
 * it, and a box the user pasted as raw HTML cannot — it is the same literal text either
 * way. So if all the boxes moved, and there are as many as there are markers, the k-th box
 * IS the k-th marker and the mapping is safe. Any box that stayed put is not ours.
 *
 * This is the only test here that a forgery cannot pass by construction. Counting can be
 * fooled by coincidence; comparing tick states can be fooled by a forgery that copies
 * them; responding to an edit of the source cannot be faked by text that is not connected
 * to the source.
 */
function boxesFollowMarkers(raw: string, states: boolean[]): boolean {
  // Code units, not code points: `scanBlock` returns string offsets, and a note may hold
  // astral characters that `[...raw]` would re-index.
  const chars = raw.split('');
  for (const at of scanBlock(raw, 0)) chars[at + 1] = chars[at + 1] === ' ' ? 'x' : ' ';
  const flipped = marked.parser(marked.lexer(chars.join('')) as Token[]) as string;
  const after = boxStates(flipped);
  return after.length === states.length && states.every((was, i) => after[i] !== was);
}

/**
 * `RENDERED_BOX` as a selector — the same shape, matched against the DOM instead of the
 * HTML string. Used by `enhanceTaskBoxes` below, and exported so the test that pins it
 * against what `marked` actually emits is pinning the real one.
 */
export const TASK_BOX_SELECTOR =
  'li > input[type="checkbox"][disabled]:first-child, li > p:first-child > input[type="checkbox"][disabled]:first-child';

/**
 * Turn one block's rendered boxes into live controls — if this block's boxes can be mapped.
 *
 * `marked` renders every task box `disabled`, which is right for a preview of someone
 * else's Markdown and wrong in Notes, where the document IS behind the preview.
 *
 * The other half of the mapping lives here rather than in the app's render closure so that
 * the clickable set and the marker set cannot be two rules that drift apart: this asks
 * `blockTaskOffsets` the same question `boxOffsets` asks, about the same token, and both
 * take the same answer. A block it cannot map contributes no offsets AND gets no live
 * boxes, so a pasted `<li><input>` costs its own block and leaves the rest of the note
 * working (#1294).
 *
 * `nodes` are the top-level nodes that one token rendered to. A box always sits inside its
 * list, so querying each node's subtree reaches every one: the node is a `<ul>`, an `<ol>`,
 * or — for a raw-HTML block — the `<li>`, never the input itself.
 *
 * `source` and `base` are the document and this block's offset in it, and they must be the
 * ones the token was lexed from: the verdict includes checking the block is really there,
 * and the two sides have to reach the same answer or their indices are not the same index.
 */
export function enhanceTaskBoxes(nodes: Iterable<ChildNode>, token: Token, source: string, base: number): void {
  if (!blockTaskOffsets(token, source, base)) return;
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
    for (const box of node.querySelectorAll<HTMLInputElement>(TASK_BOX_SELECTOR)) {
      box.disabled = false;
      box.classList.add('doc-task');
      box.setAttribute('aria-label', 'Toggle this task');
    }
  }
}

/**
 * Absolute source offset of every `[ ]` / `[x]` that `marked` actually renders as a box,
 * in document order — which is the order `querySelectorAll` returns the inputs in.
 *
 * An untrustworthy block is SKIPPED, and skipping is safe only because the renderer skips
 * the very same block: it leaves those boxes `disabled`, so they are not in the clickable
 * set either and no index shifts. This used to refuse the whole document instead, on the
 * reasoning that dropping a block's boxes would shift every index after it — true while
 * the renderer went on enhancing them, and the reason one pasted `<li><input>` switched
 * off every real checkbox in the note (#1294).
 */
function boxOffsets(source: string): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const token of marked.lexer(source) as Token[]) {
    const own = blockTaskOffsets(token, source, at);
    if (own) offsets.push(...own);
    at += token.raw.length;
  }
  return offsets;
}

/**
 * Where the `index`-th checkbox of the rendered preview lives in `source`, and what it
 * should become.
 *
 * Returns `null` when the index does not resolve — a click that lands after the source has
 * changed underneath it does nothing, rather than flipping a `[ ]` somewhere else.
 */
export function toggleTaskAt(source: string, index: number): TaskEdit | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const start = boxOffsets(source)[index];
  if (start == null) return null;
  const checked = source[start + 1] !== ' ';
  return { start, end: start + 3, text: checked ? '[ ]' : '[x]' };
}
