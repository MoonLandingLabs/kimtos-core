// The one rule the grammit app window and the in-page checker genuinely share:
// how a rules result and a spelling result are merged.
//
// They do NOT share a single "check this text" function, and cannot. A content script
// is built as one IIFE with `codeSplitting: false` (vite.content.config.ts), so it
// cannot code-split — a lazy import of the 60k-word speller gets INLINED, which measured
// at writer.js 24 kB -> 543 kB on every page the user visits (#42). So the in-page
// checker runs the rules locally and asks the service worker for spelling, while the app
// loads the speller directly. Two compositions, by necessity.
//
// What must not differ is the merge, which is here. (A `checkWriting()` that claimed to
// unify both once lived in this file; nothing ever called it, because it could not be
// called from the content script — see #75. Don't re-add it.)

export interface WritingIssue {
  start: number;
  end: number;
  original: string;
  suggestion: string;
  label?: string;
  suggestions?: string[];
}

// Merge two issue lists into one, sorted by position. The first (higher-priority)
// list wins on any overlapping span, so a rule fix isn't ALSO flagged as a
// misspelling on the same words (rules beat spelling).
export function mergeIssues(primary: WritingIssue[], extra: WritingIssue[]): WritingIssue[] {
  const out: WritingIssue[] = [...primary];
  for (const e of extra) {
    if (!out.some((p) => e.start < p.end && p.start < e.end)) out.push(e);
  }
  return out.sort((a, b) => a.start - b.start);
}
