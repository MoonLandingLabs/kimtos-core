// Shared helpers for the grammar rules: case-matching, tokenization helpers, the
// third-person conjugator, and the regexes/maps derived once from the dictionaries.

import { BASE_VERBS, PHRASES, CONTEXTUAL_PHRASES, INDEFINITE_TO_ANY } from './dictionaries.js';

// A grammar/spelling issue: a span of the input to underline, with a replacement.
export interface GrammarIssue {
  start: number;
  end: number;
  original: string;
  suggestion: string;
  label: string;
}

// Reapply the original token's capitalization to a replacement, unless the
// replacement is intentionally capitalized (e.g. the pronoun forms "I'm").
export function matchCase(original: string, replacement: string): string {
  if (/^I('|$)/.test(replacement)) return replacement; // I, I'm, I've… stay as-is
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

export const isVowel = (ch: string): boolean => 'aeiouAEIOU'.includes(ch);

export function matchCasePhrase(original: string, replacement: string): string {
  return matchCase(original.split(/\s+/)[0], replacement); // capitalize like the first word
}

// Third-person singular of a base verb (spelling rules: have→has, -y→-ies, sibilant/-o→-es).
export function thirdPerson(v: string): string {
  if (v === 'have') return 'has';
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh|o)$/.test(v)) return `${v}es`;
  return `${v}s`;
}

// Reverse map (third-person form → base) for the I/we/you/they direction.
export const SFORM_TO_BASE = new Map<string, string>();
for (const v of BASE_VERBS) SFORM_TO_BASE.set(thirdPerson(v), v);

// Word immediately before index `i`, case preserved. Only look back a short window
// (not the whole prefix) so this stays O(1) per call instead of O(n) — the preceding
// word we care about is always a short modal/aux/conjunction. The raw form exists for
// the one gate that reads CASE, not identity: a Capitalized head word before "I" marks
// the Roman-numeral/letter reading ("World War I is", "Part I has").
export const prevWordRaw = (text: string, i: number): string | null =>
  (/([A-Za-z']+)\s+$/.exec(text.slice(Math.max(0, i - 48), i)) || [])[1] || null;

export const prevWord = (text: string, i: number): string | null => prevWordRaw(text, i)?.toLowerCase() || null;

// Word immediately after index `i` — the mirror of prevWord, bounded the same way. Only
// whitespace may separate them, so a neighbour across punctuation ("I payed. For the
// record…") is not context: the regex has no way to skip the full stop.
export const nextWord = (text: string, i: number): string | null =>
  (/^\s+([A-Za-z']+)/.exec(text.slice(i, i + 48)) || [])[1]?.toLowerCase() || null;

// All phrases — flat AND gated — in ONE regex, compiled once. Sorted longest-first so
// the longest matching phrase wins (JS alternation is ordered), and spaces match any
// whitespace run. Far cheaper than recompiling ~40 regexes on every check.
export const PHRASE_RE = new RegExp(
  `\\b(?:${[...Object.keys(PHRASES), ...Object.keys(CONTEXTUAL_PHRASES)]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|')})\\b`,
  'gi',
);

// Double negative: a negation followed (within a couple words) by another negative
// word → switch the second to its "any" form. Compiled once.
export const DOUBLE_NEG_RE = new RegExp(
  "\\b(?:(?:do|does|did|is|are|was|were|have|has|had|ca|wo|would|could|should|ai)(?:n't|nt)|cannot|not)\\b" +
    `(?:\\s+[A-Za-z']+){0,2}\\s+(${Object.keys(INDEFINITE_TO_ANY).join('|')})\\b`,
  'gi',
);
