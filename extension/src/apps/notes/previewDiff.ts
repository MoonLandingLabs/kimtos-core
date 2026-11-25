// The pure half of Notes' incremental preview (#838): given the previous and next
// lists of top-level markdown blocks (by their raw source), find the smallest run
// [lo, prevEnd) that must be replaced by next[lo, nextEnd). Everything before `lo`
// and everything after the common suffix is untouched, so a one-paragraph edit
// re-renders one block instead of the whole page.

export interface BlockDiff {
  /** First index that differs (also: length of the common prefix). */
  lo: number;
  /** End (exclusive) of the run to remove from `prev`. */
  prevEnd: number;
  /** End (exclusive) of the run to insert from `next`. */
  nextEnd: number;
  /** True when nothing changed at all. */
  same: boolean;
}

export function diffBlocks(prev: readonly string[], next: readonly string[]): BlockDiff {
  let lo = 0;
  while (lo < prev.length && lo < next.length && prev[lo] === next[lo]) lo += 1;
  let prevEnd = prev.length;
  let nextEnd = next.length;
  while (prevEnd > lo && nextEnd > lo && prev[prevEnd - 1] === next[nextEnd - 1]) {
    prevEnd -= 1;
    nextEnd -= 1;
  }
  return { lo, prevEnd, nextEnd, same: lo === prevEnd && lo === nextEnd };
}

// Reference-style link definitions ([id]: url "title") live OUTSIDE the block that
// uses them, so per-block HTML cached under the block's raw text goes stale when
// the definition table changes. This key fingerprints the table; when it changes,
// the whole cache is dropped.
export const linksKey = (links: Record<string, { href: string | null; title: string | null }> | undefined): string =>
  Object.entries(links || {})
    // JSON per entry, not string concatenation: an id may itself contain spaces,
    // so joined fields would be ambiguous ("a b"+"c" reads the same as "a"+"b c").
    .map(([id, def]) => JSON.stringify([id, def.href ?? '', def.title ?? '']))
    .sort()
    .join('\n');
