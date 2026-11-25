// On-device spell checker — the missing pillar that makes Grammit catch *any*
// misspelling, not just a curated typo list (pre-AI Grammarly was, at its core, a
// dictionary speller + edit-distance suggestions). The dictionary is a compact,
// frequency-ordered English word list (top ~60k words); suggestions are generated
// Norvig-style (all words within edit distance 1–2) and ranked by frequency.
//
// The word list is a PACKAGED ASSET (public/words.txt), fetched at runtime — not a
// module. It used to be `import ... from './data/words.txt?raw'`, which compiled 505 KB
// of data into JavaScript. That is fine on an extension page (it code-splits), but a
// content script is built as a single IIFE with `codeSplitting: false`, so it cannot
// split it out: importing this module from the in-page checker inflated writer.js from
// 24 kB to 543 kB — shipped into every page the user visits. Hence the dictionary is now
// data, loaded on demand, exactly as Image-to-Text ships its Tesseract language data
// (public/ocr/eng.traineddata.gz).
//
// Call `loadSpeller()` and await it once; `spellIssues` is synchronous thereafter.
//
// The list is DERIVED, not authored — regenerate it with `node scripts/gen-words.mjs`,
// never by editing the file. It is the 60k most frequent words that SCOWL (the curated
// dictionary behind hunspell's en_US) also contains; membership comes from SCOWL and the
// ordering from Norvig's frequency counts. Deriving membership from a web scrape instead
// put 29 common misspellings in it — `langauge`, `accomodate`, `enviroment`, `untill`,
// `wich` — which this module then treated as real words: never flagged, and offered as
// corrections for a near miss (#961). spellcheck.dictionary.test.ts is the guard.

import { words, isLatinWord, sentenceStarts, protectedSpans, overlapsSpan } from './words.js';

// word -> frequency rank (0 = most common). Membership = RANK.has(word).
// Empty until loadSpeller() resolves.
const RANK = new Map<string, number>();

/** The packaged word list. `chrome.runtime` in the extension; the plain path under
 *  `vite dev`, which serves public/ from the root. */
function wordsUrl(): string {
  const rt = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome?.runtime;
  return rt?.getURL?.('words.txt') ?? '/words.txt';
}

let loading: Promise<(text: string) => SpellIssue[]> | null = null;

/** Load the dictionary once (memoized) and hand back the checker. In the service
 *  worker this means ONE index shared by every tab, rather than one per tab. */
export function loadSpeller(): Promise<(text: string) => SpellIssue[]> {
  loading ??= fetch(wordsUrl())
    .then((r) => r.text())
    .then((raw) => {
      raw.split('\n').forEach((w, i) => {
        if (w) RANK.set(w, i);
      });
      return spellIssues;
    });
  return loading;
}

// Common tech/informal tokens that aren't in a standard word list but aren't
// misspellings either — never flag (or "correct") these.
const ALLOW = new Set([
  'json',
  'html',
  'css',
  'http',
  'https',
  'url',
  'urls',
  'api',
  'apis',
  'sql',
  'php',
  'js',
  'ok',
  'okay',
  'yeah',
  'yep',
  'nope',
  'hmm',
  'lol',
  'wifi',
  'app',
  'apps',
  'blog',
  'login',
  'email',
  'emails',
  'online',
  'website',
  'username',
  'config',
  'admin',
  'src',
  'png',
  'jpg',
  'gif',
  'pdf',
  'csv',
  'npm',
  'cli',
  'sdk',
  'ios',
  'macos',
  'github',
  'google',
]);

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const known = (word: string): boolean => RANK.has(word);

// All strings one edit (delete / transpose / replace / insert) from `word`.
function edits1(word: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= word.length; i += 1) {
    const L = word.slice(0, i);
    const R = word.slice(i);
    if (R) out.add(L + R.slice(1)); // delete
    if (R.length > 1) out.add(L + R[1] + R[0] + R.slice(2)); // transpose
    for (const c of ALPHA) {
      if (R) out.add(L + c + R.slice(1)); // replace
      out.add(L + c + R); // insert
    }
  }
  return out;
}

// --- distance 2: look the dictionary up, never generate the candidates ---
//
// Distance 2 used to be `edits1()` of every string in `edits1(word)` — about
// (54 x len)^2 candidate strings for ONE word, all allocated and hashed. On a document
// full of names, jargon and typos the suggestion cache misses on nearly every word, and
// the sweep never finds a hit to break out on, so it runs to completion every time: 200
// unknown 8-10 character words measured 77 s of unbroken synchronous work on the 60k
// dictionary, which freezes the app window and kills the service worker the in-page
// checker runs in (#939).
//
// Generating candidates is the wrong direction: there are ~500 x 500 strings two edits
// from a word, and only 60k words in the dictionary. So walk the dictionary instead —
// filtered to the lengths that can possibly match, rejected in one machine word by a
// letter-set prefilter, and only then measured. Same candidate set as the old sweep, and
// a strictly better one than what it actually returned (it stopped after 20 arbitrary
// hits, so the best-ranked word could be missed).

/** The longest word we run a distance-2 scan for; also the scratch-row size below. */
const MAX_SCAN_LEN = 48;

/** A 26-bit set of the ASCII letters present in `word`. */
function letterMask(word: string): number {
  let mask = 0;
  for (let i = 0; i < word.length; i += 1) {
    const bit = word.charCodeAt(i) - 97; // 'a'
    if (bit >= 0 && bit < 26) mask |= 1 << bit;
  }
  return mask;
}

function bitCount(n: number): number {
  let x = n - ((n >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

// The dictionary bucketed by word length, each bucket carrying its words' letter masks
// in a typed array. Built once, lazily — a user whose text has no unknown word never
// pays for it. RANK is insertion-ordered by frequency, so every bucket is too.
let byLength: Map<number, { list: string[]; masks: Int32Array }> | null = null;
function lengthIndex(): Map<number, { list: string[]; masks: Int32Array }> {
  if (byLength) return byLength;
  const grouped = new Map<number, string[]>();
  for (const w of RANK.keys()) {
    const list = grouped.get(w.length);
    if (list) list.push(w);
    else grouped.set(w.length, [w]);
  }
  byLength = new Map();
  for (const [len, list] of grouped) {
    const masks = new Int32Array(list.length);
    for (let i = 0; i < list.length; i += 1) masks[i] = letterMask(list[i]);
    byLength.set(len, { list, masks });
  }
  return byLength;
}

// Three reusable DP rows — the scan measures thousands of candidates per miss, and
// allocating rows per candidate costs more than the distance itself. Sound only because
// every caller is synchronous and single-threaded, which the whole module already is.
const row0 = new Int32Array(MAX_SCAN_LEN + 1);
const row1 = new Int32Array(MAX_SCAN_LEN + 1);
const row2 = new Int32Array(MAX_SCAN_LEN + 1);

/** Is `b` within `max` edits of `a`? Optimal string alignment — delete, insert, replace
 *  and transpose, exactly the four operations `edits1` enumerates. Abandons the moment
 *  every cell of a row exceeds `max`. */
function withinDistance(a: string, b: string, max: number): boolean {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return false;
  // Load-bearing, not defensive: a write past a typed array's end is silently dropped
  // and a read past it is `undefined`, so an over-long word would score wrong rather
  // than throw. `suggest` already keeps `a` within the bound; `b` comes from a length
  // bucket up to `max` longer.
  if (n > MAX_SCAN_LEN || m > MAX_SCAN_LEN) return false;
  let two = row0; // row i-2
  let one = row1; // row i-1
  let cur = row2; // row i
  for (let j = 0; j <= m; j += 1) one[j] = j;
  for (let i = 1; i <= n; i += 1) {
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(one[j] + 1, cur[j - 1] + 1, one[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, two[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return false;
    const spare = two;
    two = one;
    one = cur;
    cur = spare;
  }
  return one[m] <= max;
}

/** Every dictionary word within two edits of `word`. */
function near2(word: string): string[] {
  const index = lengthIndex();
  const mask = letterMask(word);
  const out: string[] = [];
  for (let len = word.length - 2; len <= word.length + 2; len += 1) {
    const bucket = index.get(len);
    if (!bucket) continue;
    const { list, masks } = bucket;
    for (let i = 0; i < list.length; i += 1) {
      // One edit flips at most one bit on and one off in the letter set, so a word two
      // edits away differs in at most four bits. An admissible filter that rejects most
      // of the bucket for an xor and a popcount, before any distance is computed.
      if (bitCount(masks[i] ^ mask) > 4) continue;
      if (withinDistance(word, list[i], 2)) out.push(list[i]);
    }
  }
  return out;
}

// A single check pass may run at most this many distance-2 scans. The scan is ~1000x
// cheaper than the sweep it replaces, but it is still the expensive path, and a pasted
// document can hold thousands of unknown words; the budget is what makes one pass cost a
// bounded amount of work no matter how long the text is. Misses past the budget fall
// back to distance 1 and are NOT cached, so the next pass — by then holding the earlier
// words in the cache — spends its budget on them instead. Suggestions fill in over a
// couple of passes rather than freezing the first one.
const D2_BUDGET_PER_PASS = 200;
let d2Budget = 0;

// Bounded so a long editing session in the (long-lived) service worker cannot grow it
// without limit; the working set of one document is far below the cap.
const SUGGEST_CACHE_MAX = 5000;
const SUGGEST_CACHE = new Map<string, string[]>();

const rank = (cand: Set<string>, limit: number): string[] =>
  [...cand].sort((a, b) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0)).slice(0, limit);

// Up to `limit` dictionary suggestions for a misspelling, best (most frequent)
// first. Tries edit distance 1, then 2 (only when nothing closer is found).
// Memoized: the same misspelling is re-typed across checks, and distance-2 is costly.
function suggest(word: string, limit = 3): string[] {
  const cached = SUGGEST_CACHE.get(word);
  if (cached) return cached;
  const cand = new Set<string>();
  for (const e of edits1(word)) if (known(e)) cand.add(e);
  if (!cand.size && word.length >= 5 && word.length <= MAX_SCAN_LEN) {
    if (d2Budget <= 0) return []; // out of budget, and `cand` is empty — retried next pass, so not cached
    d2Budget -= 1;
    for (const w of near2(word)) cand.add(w);
  }
  const result = rank(cand, limit);
  if (SUGGEST_CACHE.size >= SUGGEST_CACHE_MAX) SUGGEST_CACHE.clear();
  SUGGEST_CACHE.set(word, result);
  return result;
}

const applyCase = (original: string, replacement: string): string =>
  /^[A-Z]/.test(original) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;

export interface SpellIssue {
  start: number;
  end: number;
  original: string;
  suggestion: string;
  suggestions: string[];
  label: string;
}

// Misspellings in `text` as { start, end, original, suggestion, suggestions, label }.
// Call `loadSpeller()` first — without the dictionary every word is "unknown", so this
// bails rather than flagging the entire text as misspelled.
export function spellIssues(text: string): SpellIssue[] {
  if (!RANK.size) return [];
  d2Budget = D2_BUDGET_PER_PASS; // one pass, one bounded allowance of distance-2 scans
  const issues: SpellIssue[] = [];
  // Sentence starts: a capitalized word there might be an ordinary word, so we
  // still check it (lowercased); elsewhere a capital implies a proper noun → skip.
  const starts = sentenceStarts(text);
  // Addresses, links and code are identifiers, not English — never "correct" inside one.
  const guarded = protectedSpans(text);

  for (const { word, start } of words(text)) {
    if (overlapsSpan(guarded, start, start + word.length)) continue;
    // A word with any non-ASCII letter is skipped WHOLE. Tokenizing on [A-Za-z] instead
    // split it, and "coöperation" was flagged as the fragment "peration" → "operation",
    // underlined mid-word and corrupting on accept (#642).
    if (!isLatinWord(word)) continue;
    if (word.includes("'")) continue; // contractions are handled by the rule engine
    if (word.length < 4) continue; // too short to spell-correct safely
    const lower = word.toLowerCase();
    if (known(lower) || ALLOW.has(lower)) continue; // a real word
    if (word === word.toUpperCase()) continue; // acronym (NASA, HTML)
    if (/^[A-Z]/.test(word) && !starts.has(start)) continue; // proper noun

    const suggestions = suggest(lower).map((s) => applyCase(word, s));
    if (!suggestions.length) continue; // no near word → likely a name/jargon, leave it

    issues.push({
      start,
      end: start + word.length,
      original: word,
      suggestion: suggestions[0],
      suggestions,
      label: 'Spelling',
    });
  }
  return issues;
}
