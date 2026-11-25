// Markdown list continuation for the Notes editor: what Enter should do when the caret
// sits on a list item.
//
// Pure and DOM-free on purpose — the caller owns the textarea and the undo-preserving
// write; this only decides what text should replace which range. That makes every rule
// below a table-driven unit test instead of a browser session.
//
// The behaviour is GitHub's, because that is the one every user has already learned:
// Enter continues the list, and Enter on an item you have not typed into ENDS it. The
// second half is the one that gets forgotten, and without it a list is a trap — every
// Enter adds another marker and there is no way out but the mouse.

/** A replacement to apply to the source: `text` takes the place of `[start, end)`. */
export interface Continuation {
  start: number;
  end: number;
  text: string;
}

/** `- item`, `* item`, `+ item`, optionally a task box. */
const BULLET = /^(\s*)([-*+])([ \t]+)(\[([ xX])\][ \t]+)?(.*)$/;
/** `1. item`, `2) item`, optionally a task box. */
const ORDERED = /^(\s*)(\d{1,9})([.)])([ \t]+)(\[([ xX])\][ \t]+)?(.*)$/;

/**
 * What Enter should insert (or remove) for the line the caret is on.
 *
 * Returns `null` when the line is not a list item, so Enter keeps its native behaviour —
 * the default has to stay untouched, since this runs on every Enter in the editor.
 *
 * A continued task box is always UNCHECKED. Carrying `[x]` forward would tick a task the
 * user has not done, which is worse than not continuing at all.
 */
export function continueList(value: string, caret: number): Continuation | null {
  const pos = Math.max(0, Math.min(caret, value.length));
  const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
  const nlAt = value.indexOf('\n', pos);
  const lineEnd = nlAt === -1 ? value.length : nlAt;
  // A trailing CR would defeat both patterns below — `.` never matches a line terminator,
  // so every line of a CRLF document would fall through and the feature would be silently
  // off. A textarea's `value` normalises CRLF to LF, so the app never hits this; the
  // function is exported and pure, though, and its contract does not carve out CRLF.
  const line = value.slice(lineStart, lineEnd).replace(/\r$/, '');

  const bullet = BULLET.exec(line);
  const ordered = bullet ? null : ORDERED.exec(line);
  if (!bullet && !ordered) return null;

  const indent = (bullet ?? ordered!)[1];
  const isTask = Boolean(bullet ? bullet[4] : ordered![5]);
  const content = bullet ? bullet[6] : ordered![7];
  // Everything up to and including the marker (and its task box, if any).
  const prefix = bullet
    ? `${bullet[1]}${bullet[2]}${bullet[3]}${bullet[4] ?? ''}`
    : `${ordered![1]}${ordered![2]}${ordered![3]}${ordered![4]}${ordered![5] ?? ''}`;

  // The caret has to be PAST the marker for any of this to be a decision about the list.
  // With the caret at the start of `- `, Enter means "open a line above me", and inserting
  // a marker there would be a surprise the user cannot undo in one step.
  if (pos < lineStart + prefix.length) return null;

  // An item with nothing typed into it ends the list: the marker goes, the blank line
  // stays. This is the half that makes the feature usable — without it every Enter adds
  // another marker and there is no way out of the list but the mouse.
  if (!content.trim()) return { start: lineStart, end: lineEnd, text: '' };

  let marker: string;
  if (bullet) {
    marker = `${bullet[2]}${bullet[3]}`;
  } else {
    // Increment the number, keeping `.` or `)`. The rest of the list is deliberately not
    // renumbered — GitHub does not either, and Markdown renders a run of `1.` correctly.
    const next = Number(ordered![2]) + 1;
    marker = `${next}${ordered![3]}${ordered![4]}`;
  }

  return { start: pos, end: pos, text: `\n${indent}${marker}${isTask ? '[ ] ' : ''}` };
}
