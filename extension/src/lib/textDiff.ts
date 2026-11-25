// Word-level diff between an original string and its corrected version. Returns
// "issues" — the spans of the original that changed — as { start, end, original,
// suggestion } with character offsets into `original`. Used to underline the
// words/phrases a grammar model wants to fix (Grammarly-style).

const WORD = /\S+/g;
// Normalize a token for *resemblance* checks: lowercase, strip edge punctuation.
const norm = (t: string): string => t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

type Pair = [number, number];

interface OToken {
  t: string;
  s: number;
  e: number;
}

export interface GrammarIssue {
  start: number;
  end: number;
  original: string;
  suggestion: string;
}

// Longest-common-subsequence alignment → the matched (anchor) index pairs.
function lcsPairs(a: string[], b: string[]): Pair[] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

// Character-level LCS ratio (0..1) — used to sanity-check very short edits.
function charLcsRatio(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  let prev = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i += 1) {
    const cur = new Uint16Array(m + 1);
    for (let j = 1; j <= m; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[m] / Math.max(n, m);
}

// A correction is only trustworthy if it RESEMBLES the original — a real grammar
// fix keeps most of the words/characters and a similar length. Generic models
// sometimes "answer" the text instead of correcting it (e.g. "who are uou" →
// "i am a snoopy man"); those share almost nothing with the input, so we reject
// them rather than show a nonsense suggestion.
// `normPairs` is the LCS over case/punctuation-normalized tokens, so a real fix
// (which just recapitalizes or repunctuates) still counts as "resembling".
function trustworthy(original: string, O: OToken[], C: string[], normPairs: Pair[]): boolean {
  if (C.length > O.length * 2 + 1 || C.length < O.length * 0.4) return false; // length blew up/collapsed
  if (O.length >= 3) return normPairs.length / Math.max(O.length, C.length) >= 0.5; // keeps half its words
  return charLcsRatio(norm(original), norm(C.join(' '))) >= 0.5; // short input → char similarity
}

export function grammarIssues(original: string, corrected: string): GrammarIssue[] {
  const corr = (corrected || '').trim();
  if (!corr || original.trim() === corr) return [];

  const O: OToken[] = [...original.matchAll(WORD)].map((m) => ({
    t: m[0],
    s: m.index ?? 0,
    e: (m.index ?? 0) + m[0].length,
  }));
  const C = corr.split(/\s+/).filter(Boolean);
  if (!O.length) return [];

  // Exact anchor pairs split the sequences into changed blocks between matches.
  const pairs = lcsPairs(
    O.map((o) => o.t),
    C,
  );
  // A separate lenient (normalized) alignment judges overall resemblance.
  const normPairs = lcsPairs(
    O.map((o) => norm(o.t)),
    C.map(norm),
  );
  if (!trustworthy(original, O, C, normPairs)) return []; // looks like a rewrite/hallucination — ignore
  // Sentinels so the loop also covers the head and tail blocks.
  const anchors: Pair[] = [[-1, -1], ...pairs, [O.length, C.length]];

  const issues: GrammarIssue[] = [];
  for (let k = 0; k < anchors.length - 1; k += 1) {
    const [oa, ca] = anchors[k];
    const [ob, cb] = anchors[k + 1];
    const oToks = O.slice(oa + 1, ob); // original tokens strictly between anchors
    const cToks = C.slice(ca + 1, cb); // corrected tokens strictly between anchors
    if (!oToks.length && !cToks.length) continue;

    if (oToks.length) {
      // Replace/delete: underline the original span, suggest the corrected words.
      issues.push({
        start: oToks[0].s,
        end: oToks[oToks.length - 1].e,
        original: original.slice(oToks[0].s, oToks[oToks.length - 1].e),
        suggestion: cToks.join(' '),
      });
    } else {
      // Pure insertion (a missing word): anchor the underline to a neighbouring
      // word so there's something to mark, and fold the insertion into it.
      const ins = cToks.join(' ');
      const next = O[ob];
      const prev = O[oa];
      if (next) {
        issues.push({ start: next.s, end: next.e, original: next.t, suggestion: `${ins} ${next.t}` });
      } else if (prev) {
        issues.push({ start: prev.s, end: prev.e, original: prev.t, suggestion: `${prev.t} ${ins}` });
      }
    }
  }
  // Sorted, non-overlapping by construction.
  return issues;
}
