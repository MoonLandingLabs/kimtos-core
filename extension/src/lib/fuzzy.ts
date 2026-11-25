// Subsequence fuzzy matching, shared by every "type to filter a list" surface.
//
// Lifted out of the Tabs app, which had the only implementation in the suite. It is
// here so the next surface that needs a filter (DevTools' tool rail was the second)
// reuses this one instead of growing a second, subtly different matcher.

/** Score `text` against query `q`. `-1` when `q` is not a subsequence of `text`.
 *  Rewards contiguous runs and word-start hits, so "gh iss" ranks "GitHub issues"
 *  above a text that merely contains those letters scattered about. */
export function fuzzyScore(q: string, text: string): number {
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q.toLowerCase()) {
    const idx = t.indexOf(ch, ti);
    if (idx < 0) return -1;
    streak = idx === ti ? streak + 1 : 0;
    const boundary = idx === 0 || /[\s/._\-?#=]/.test(t[idx - 1] ?? '');
    score += 1 + streak * 2 + (boundary ? 3 : 0);
    ti = idx + 1;
  }
  // Prefer the shorter of two equally-good matches.
  return score - t.length * 0.01;
}

/** Best score across several fields (a name, a category, each keyword…), or `-1`.
 *
 *  Score the fields SEPARATELY — never concatenate them and match the result. A
 *  subsequence will happily span unrelated words: joined, "HTML entities … xss"
 *  matches "hex" (h·e·x), so searching for a colour returned the HTML escaper.
 *  Per-field, "hex" matches Color's `hex` keyword and nothing in HTML entities. */
export function fuzzyBest(q: string, fields: string[]): number {
  let best = -1;
  for (const f of fields) {
    const s = fuzzyScore(q, f);
    if (s > best) best = s;
  }
  return best;
}
