// Thoth — grounding check (#913). A pure, verifiable guard over the generated answer.
//
// The small on-device model WILL sometimes invent details even with the correct
// passage in its context: measured on this exact pipeline it turned a server
// address into a different made-up one, moved "September 14" to "September 29",
// and changed "45,000 EUR" into "40,080 EUR" — all confidently cited. No prompt
// wording fixes that at this model size, so we check the result instead of
// trusting it — the same shape as `checkRephrase` (Rewordit, #644) and
// `trustworthy()` (Grammit).
//
// Only drift we can PROVE is reported: a number or time the answer asserts that
// appears nowhere in the retrieved passages (or the question) is hard evidence of
// invention, because a grounded answer can only copy such facts from its context.
// Softer drift (a wrong name, a hedged claim) has no reliable local test and is
// left to the reader — which is why the passages themselves are always shown.

import { numericFacts, numericMentions } from '../../lib/rephraseCheck.js';

export interface GroundingCheck {
  /** True when nothing proves the answer invented a detail. */
  ok: boolean;
  /** Numbers/times the answer asserts that appear nowhere in the sources. */
  invented: string[];
}

// Inline citation markers like [1] are references into the source list, and an
// ordered list's enumerators ("1. Bring…") are formatting — neither is a fact the
// answer asserts, so both are stripped before scanning. Enumerators are only
// recognised at the start of a line or after a colon, so a real figure ending a
// sentence mid-line ("…on September 29. As for…") is still checked.
export const stripMarkers = (answer: string): string =>
  answer.replace(/\[\d{1,2}\]/g, ' ').replace(/(^|\n|:)\s*\d{1,2}[.)]\s+/g, '$1 ');

/**
 * Compare a generated answer against the texts it was meant to be written from
 * (retrieved passages, their titles, and the user's question). `ok` is false only
 * when the answer asserts a number or time that none of the sources mention — a
 * caller must not present such an answer as grounded.
 */
export function checkGrounding(answer: string, sources: string[]): GroundingCheck {
  const facts = numericFacts(stripMarkers(answer ?? ''));
  if (!facts.size) return { ok: true, invented: [] };
  const known = numericMentions(sources.join('\n'));
  const invented = [...facts].filter((f) => !known.has(f));
  return { ok: !invented.length, invented };
}

/** One plain sentence naming the invented details, for the warning banner. */
export function describeInvented(invented: string[]): string {
  const shown = invented.slice(0, 4).join(', ') + (invented.length > 4 ? ', …' : '');
  return `This summary mentions ${invented.length === 1 ? 'a detail' : 'details'} not found in your notes (${shown}).`;
}
