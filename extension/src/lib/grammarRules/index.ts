// Deterministic, on-device grammar & spelling checks — no ML model needed. These
// cover the high-confidence fixes a writing assistant should always get right:
// misspellings, missing apostrophes (contractions), the pronoun "I", sentence
// capitalization, a/an, repeated words and basic punctuation spacing.
//
// Each rule yields an issue { start, end, original, suggestion, label } with
// character offsets into the input. The exported `ruleIssues(text)` merges every
// rule's output into one sorted, non-overlapping list (earlier/longer wins) so it
// can drive the same underline backdrop the model path uses.
//
// Structure: dictionaries.js (data) → helpers.js (case/tokenize/conjugate +
// derived regexes) → rules.js (the individual rules) → this merger.

import type { GrammarIssue } from './helpers.js';
import { sentenceStarts, protectedSpans, overlapsSpan } from '../words.js';
import {
  wordRules,
  contextualWordRules,
  articleRules,
  capitalizationRules,
  repeatRules,
  spacingRules,
  introCommaRules,
  phraseRules,
  agreementRules,
  thanRules,
  doubleNegativeRules,
  modalRules,
  homophoneRules,
} from './rules.js';

export function ruleIssues(text: string): GrammarIssue[] {
  if (!text) return [];
  const starts = sentenceStarts(text);
  // Addresses, links and code are identifiers, not English — never "correct" inside one.
  // Filtered once here, at the single point every rule's output passes through, rather
  // than in each of the thirteen rules (#941).
  const guarded = protectedSpans(text);
  const all: GrammarIssue[] = [];
  const push = (iss: GrammarIssue): number => all.push(iss);
  wordRules(text, push);
  contextualWordRules(text, push);
  articleRules(text, push);
  phraseRules(text, push);
  agreementRules(text, push);
  homophoneRules(text, push);
  thanRules(text, push);
  doubleNegativeRules(text, push);
  modalRules(text, push);
  capitalizationRules(text, starts, push);
  repeatRules(text, push);
  spacingRules(text, push);
  introCommaRules(text, push);

  // Sort by position, then prefer the longer span; drop anything overlapping a
  // span we've already kept (the backdrop can't paint overlapping marks).
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: GrammarIssue[] = [];
  let lastEnd = -1;
  for (const iss of all) {
    if (iss.start < lastEnd) continue;
    if (iss.suggestion === iss.original) continue;
    if (overlapsSpan(guarded, iss.start, iss.end)) continue;
    out.push(iss);
    lastEnd = iss.end;
  }
  // A spelling/contraction fix that lands at a sentence start must also be
  // capitalized (e.g. "teh cat" → "The cat", not "the cat").
  for (const iss of out) {
    if (starts.has(iss.start) && /^[a-z]/.test(iss.suggestion))
      iss.suggestion = iss.suggestion[0].toUpperCase() + iss.suggestion.slice(1);
  }
  return out;
}
