// Where a word — and a sentence — begins and ends. The ONE text segmentation the writing
// checks share, and therefore the source of truth for every offset Grammit underlines.
//
// It has no dependencies on purpose: the rule engine and the speller both need it, and the
// speller cannot import the rules (grammarRules pulls in the ~600-line dictionaries, and the
// in-page checker is a single IIFE that cannot code-split — see spellcheck.ts's header).
// Without a neutral home these facts get copied, and a copied offset rule is a misplaced
// underline waiting to happen.
//
// It has to be Unicode-aware even though every dictionary behind it is English-only,
// because an ASCII-only `[A-Za-z]+` does not SKIP a word it cannot judge, it SPLITS it.
// `coöperation` tokenized as `co` + `peration`, so the speller underlined `peration`
// at offset 7 — an underline sitting in the middle of a word — and offered `operation`,
// which on accept corrupts it. The same cut made the capitalization rule underline `cr`
// in `crème` and suggest `Cr` (#642).
//
// So: match a whole word in ANY script, then let each caller decide with `isLatinWord`
// whether its data covers that word. A word we cannot check is skipped whole, never
// half-flagged. Offsets stay UTF-16 indices into the same string the textarea holds,
// which is what every other layer (setSelectionRange, slice, the backdrop) speaks.

// Letters plus their combining marks, with at most one internal ASCII apostrophe, so
// `i'm` stays one token. Curly apostrophes are deliberately excluded: they are not what
// the contraction rules match, and swallowing one would hide the `i’m` → `I’m` fix.
const WORD_SOURCE = String.raw`[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)?`;

/** Every word in `text`, with its UTF-16 start offset. */
export function* words(text: string): Generator<{ word: string; start: number }> {
  const re = new RegExp(WORD_SOURCE, 'gu'); // fresh per call: no shared `lastIndex` to leak
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) yield { word: m[0], start: m.index };
}

/** The word starting exactly at `index`, or null. Sticky, so it never slices the tail. */
export function wordAt(text: string, index: number): string | null {
  const re = /[\p{L}\p{M}']+/uy;
  re.lastIndex = index;
  return re.exec(text)?.[0] ?? null;
}

/** A plain A–Z word (optionally one apostrophe) — the only shape our English data covers. */
export const isLatinWord = (word: string): boolean => /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(word);

// --- spans that are not prose ---
//
// An email address, a URL, a file path and a code span are identifiers, not English. A
// "correction" inside one is never right: the string still looks like an address
// afterwards, it just no longer resolves. Grammit offered to turn a domain into a
// different one and `sara.mahmoud@exampl.com` into `...@example.com`, and Fix all applied it
// without asking (#941).
//
// So the checks get one shared list of spans to leave alone, computed here next to the
// tokenizer that produces the offsets it is compared against. One list, so the rule engine
// and the speller cannot disagree about what counts as prose.

/** A half-open `[start, end)` range of UTF-16 indices. */
export interface Span {
  start: number;
  end: number;
}

// Every alternative that opens with a greedy character class starts with a lookbehind
// pinning it to the beginning of a token. That is not tidiness, it is the cost bound: an
// unpinned `[A-Za-z0-9._%+-]+@` restarts at every index of a long unbroken token and
// scans to its end each time, which is quadratic — 5000 characters without a space (a
// pasted base64 blob, minified JS) measured 137 ms for this one regex. Pinned, a failure
// at the token's first character rejects every later index in constant time: 0.6 ms.
const TOKEN_START = '(?<![A-Za-z0-9._%+@-])';
const LINE_START = '(?<![^\\s("\\[])'; // start of text, whitespace, or an opening bracket

// One pass, alternatives in priority order — the first that matches at a position wins, so
// the widest reading of an address comes first and its parts are never matched separately.
const PROTECTED_SOURCE = [
  '`[^`\\n]*`', // a code span
  `${TOKEN_START}[A-Za-z][A-Za-z0-9+.-]*://\\S+`, // a URL with a scheme
  `${TOKEN_START}mailto:\\S+`,
  `${TOKEN_START}[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}`, // an email address
  // A bare host, optionally with a path: every label lowercase and the last one two or
  // more letters. That last condition is what keeps ordinary prose out — `e.g` and `3.14`
  // end in a one-character or non-alphabetic label, and a missing space after a full stop
  // ("done.Next") ends in a capitalised one, which the spacing rule must stay free to flag.
  `${TOKEN_START}[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}(?::\\d+)?(?:/\\S*)?`,
  '@[A-Za-z0-9_-]{2,}', // an @handle
  // A path, but only where one can begin — so "and/or" is prose, "./src/index.ts" is not.
  `${LINE_START}(?:~|\\.{1,2})?/\\S+`,
  `${LINE_START}[A-Za-z]:\\\\\\S+`, // a Windows path
].join('|');

/** The spans of `text` that are identifiers rather than prose, sorted and disjoint. */
export function protectedSpans(text: string): Span[] {
  const re = new RegExp(PROTECTED_SOURCE, 'gu'); // fresh per call: no shared `lastIndex` to leak
  const out: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** Does `[start, end)` touch any of `spans`? `spans` must be sorted and disjoint, as
 *  `protectedSpans` returns them. */
export function overlapsSpan(spans: readonly Span[], start: number, end: number): boolean {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    // The first span that has not already ended before `start`.
    const mid = (lo + hi) >> 1;
    if (spans[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  return lo < spans.length && spans[lo].start < end;
}

/** Indices where a sentence begins (start of text, or after . ! ? + space). */
export function sentenceStarts(text: string): Set<number> {
  const set = new Set<number>();
  const re = /(^|[.!?]["')\]]?\s+)(\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) set.add(m.index + m[1].length);
  return set;
}
