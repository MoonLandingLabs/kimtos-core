// The individual grammar/spelling rules. Each takes the text and a `push` callback
// and emits issues { start, end, original, suggestion, label } with character
// offsets; the merger in index.js sorts and de-overlaps them.

import {
  MISSPELLINGS,
  CONTEXTUAL_MISSPELLINGS,
  CONTRACTIONS,
  A_BEFORE_VOWEL,
  AN_BEFORE_CONSONANT,
  OK_TO_REPEAT,
  INTRO_ADVERBS,
  PHRASES,
  CONTEXTUAL_PHRASES,
  I_NOUN_BEFORE,
  BASE_VERBS,
  AGREEMENT_BLOCKERS,
  COMPARATIVES,
  INDEFINITE_TO_ANY,
  YOURE_AFTER,
  ITS_AFTER,
  THERE_AFTER,
  THEYRE_AFTER,
  TOO_AFTER,
} from './dictionaries.js';
import {
  matchCase,
  isVowel,
  matchCasePhrase,
  thirdPerson,
  prevWord,
  prevWordRaw,
  nextWord,
  SFORM_TO_BASE,
  PHRASE_RE,
  DOUBLE_NEG_RE,
  type GrammarIssue,
} from './helpers.js';
import { words, wordAt, isLatinWord } from '../words.js';

type Push = (iss: GrammarIssue) => void;

// Word-level: spelling, contractions, the pronoun "I". Tokens keep internal
// apostrophes so "i'm" is seen as one word. Tokenizing is Unicode-aware and
// non-English words are skipped WHOLE — see lib/words.ts for why (#642).
export function wordRules(text: string, push: Push): void {
  for (const { word, start } of words(text)) {
    if (!isLatinWord(word)) continue; // our dictionaries cannot judge it; never flag half of it
    const lower = word.toLowerCase();
    const end = start + word.length;

    // Pronoun "I": standalone "i" and lowercase "i'm / i've / i'll / i'd".
    if (word === 'i') {
      push({ start, end, original: word, suggestion: 'I', label: 'Capitalize “I”' });
      continue;
    }
    if (/^i'[a-z]+$/.test(word)) {
      push({ start, end, original: word, suggestion: `I${word.slice(1)}`, label: 'Capitalize “I”' });
      continue;
    }

    const fix = MISSPELLINGS[lower];
    if (fix && fix.toLowerCase() !== lower) {
      const suggestion = matchCase(word, fix);
      if (suggestion !== word)
        push({
          start,
          end,
          original: word,
          suggestion,
          label: CONTRACTIONS.has(lower) ? 'Add apostrophe' : 'Spelling',
        });
    }
  }
}

// Word-level, but gated: typos that are ALSO real words. `wordRules` rewrites its table
// on sight, which is only safe because none of its keys is a word; these are, so each
// fires only when a neighbouring word rules the legitimate reading out. Same shape as
// homophoneRules — an allowlist, so an unrecognised context leaves the token alone
// ("he wolfs down his dinner" used to come back "he wolves down", #1031).
export function contextualWordRules(text: string, push: Push): void {
  for (const { word, start } of words(text)) {
    if (!isLatinWord(word)) continue;
    const entry = CONTEXTUAL_MISSPELLINGS[word.toLowerCase()];
    if (!entry) continue;
    const end = start + word.length;
    const neighbour = entry.gate === 'before' ? prevWord(text, start) : nextWord(text, end);
    if (!neighbour || !entry.context.has(neighbour)) continue;
    const suggestion = matchCase(word, entry.fix);
    if (suggestion !== word) push({ start, end, original: word, suggestion, label: 'Spelling' });
  }
}

// "a"/"an" before the next word, based on its initial sound (with exceptions).
export function articleRules(text: string, push: Push): void {
  const re = /\b(an?)\b[ \t]+([A-Za-z]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const article = m[1];
    const next = m[2];
    const start = m.index;
    const end = start + article.length;
    const lowerA = article.toLowerCase();
    const vowelSound = isVowel(next[0]) ? !A_BEFORE_VOWEL.test(next) : AN_BEFORE_CONSONANT.test(next);
    if (lowerA === 'a' && vowelSound) {
      push({ start, end, original: article, suggestion: matchCase(article, 'an'), label: 'Use “an”' });
    } else if (lowerA === 'an' && !vowelSound) {
      push({ start, end, original: article, suggestion: matchCase(article, 'a'), label: 'Use “a”' });
    }
  }
}

// Capitalize the first word of each sentence when it starts lowercase.
export function capitalizationRules(text: string, starts: Set<number>, push: Push): void {
  for (const idx of starts) {
    const ch = text[idx];
    if (!/[a-z]/.test(ch)) continue; // already capital, or not a letter
    // The WHOLE word, in any script: an ASCII-only match stopped at the first accented
    // letter, so "crème" underlined just "cr" and suggested "Cr" (#642).
    const word = wordAt(text, idx) ?? ch;
    if (word === 'i') continue; // the pronoun rule handles a lone "i"
    push({
      start: idx,
      end: idx + word.length,
      original: word,
      suggestion: word[0].toUpperCase() + word.slice(1),
      label: 'Capitalize',
    });
  }
}

// Repeated word: "the the" → "the" (case-insensitive). A few words can legitimately
// double, so those (OK_TO_REPEAT) are skipped to avoid false positives.
export function repeatRules(text: string, push: Push): void {
  const re = /\b([A-Za-z]+)(\s+)(\1)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (OK_TO_REPEAT.has(m[1].toLowerCase())) continue;
    const dupStart = m.index + m[1].length + m[2].length;
    const dupEnd = dupStart + m[3].length;
    // Underline the (whitespace + second) word and suggest dropping it.
    push({
      start: m.index + m[1].length,
      end: dupEnd,
      original: text.slice(m.index + m[1].length, dupEnd),
      suggestion: '',
      label: 'Repeated word',
    });
  }
}

// Spacing: " ," → ",", and a missing space after .,;:!? before a letter.
export function spacingRules(text: string, push: Push): void {
  let m: RegExpExecArray | null;
  const before = /\s+([,.;:!?])/g;
  while ((m = before.exec(text)) !== null) {
    push({ start: m.index, end: m.index + m[0].length, original: m[0], suggestion: m[1], label: 'Spacing' });
  }
  // Missing space after sentence punctuation (skip decimals like 3.14 and URLs).
  const after = /([a-z]{2,}[,.;:!?])([A-Z][a-z]+)/g;
  while ((m = after.exec(text)) !== null) {
    push({
      start: m.index,
      end: m.index + m[0].length,
      original: m[0],
      suggestion: `${m[1]} ${m[2]}`,
      label: 'Spacing',
    });
  }
}

// A conjunctive adverb opening a sentence takes a comma: "Also it is slow" → "Also, it is
// slow". Fires only at a sentence start (text start, or after . ! ?), only for the curated
// INTRO_ADVERBS, and only when a real clause follows (a lowercase word, or the pronoun "I") —
// so a following proper noun ("Moreover Inc.") or an already-present comma never triggers it.
export function introCommaRules(text: string, push: Push): void {
  const re = /(^|[.!?]["')\]]?\s+)([A-Z][a-z]+)(\s+)([A-Za-z']+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[2];
    const next = m[4];
    if (!INTRO_ADVERBS.has(word.toLowerCase())) continue;
    // A real clause must follow: a lowercase word or the pronoun "I". A capitalised next word
    // (a name/title) is left alone. Skip the "also known as" idiom, which takes no comma.
    if (next !== 'I' && !/^[a-z]/.test(next)) continue;
    if (word.toLowerCase() === 'also' && next.toLowerCase() === 'known') continue;
    const start = m.index + m[1].length;
    const end = start + word.length;
    push({ start, end, original: word, suggestion: `${word},`, label: 'Comma' });
    // Resume scanning just after the adverb, so overlapping sentence boundaries aren't skipped.
    re.lastIndex = end;
  }
}

// A gated phrase's fix, or null when the neighbouring word keeps the gate shut. Same
// contract as contextualWordRules, one level up: 'allow' fires only on a listed
// neighbour, 'block' fires unless the neighbour is listed (or, with blockCapitalized,
// unless the raw neighbour is a Capitalized head word — "World War I is").
function gatedPhraseFix(text: string, key: string, start: number, end: number): string | null {
  const entry = CONTEXTUAL_PHRASES[key];
  if (!entry) return null;
  const neighbour = entry.gate === 'before' ? prevWord(text, start) : nextWord(text, end);
  if (entry.mode === 'allow') return neighbour && entry.words.has(neighbour) ? entry.fix : null;
  if (neighbour && entry.words.has(neighbour)) return null;
  if (entry.blockCapitalized && entry.gate === 'before' && /^[A-Z]/.test(prevWordRaw(text, start) ?? '')) return null;
  return entry.fix;
}

// Fixed multi-word fixes: the unconditional PHRASES table, plus the gated
// CONTEXTUAL_PHRASES entries whose keys can be valid English (#1051).
export function phraseRules(text: string, push: Push): void {
  PHRASE_RE.lastIndex = 0; // module-level regex — reset its cursor each call
  let m: RegExpExecArray | null;
  while ((m = PHRASE_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    // A hyphen fuses the last word into a compound modifier, where the fix no longer
    // applies: "more higher-quality data" and "more better-paying jobs" are valid.
    if (text[end] === '-' || text[start - 1] === '-') continue;
    const key = m[0].toLowerCase().replace(/\s+/g, ' ');
    const right = PHRASES[key] ?? gatedPhraseFix(text, key, start, end);
    if (!right) continue;
    const suggestion = matchCasePhrase(m[0], right);
    if (suggestion !== m[0]) push({ start, end, original: m[0], suggestion, label: 'Grammar' });
  }
}

// Subject–verb agreement, both directions, for pronoun subjects.
export function agreementRules(text: string, push: Push): void {
  let m: RegExpExecArray | null;
  const single = /\b(he|she|it)\s+([a-z]+)\b/gi;
  while ((m = single.exec(text)) !== null) {
    const verb = m[2].toLowerCase();
    if (!BASE_VERBS.has(verb)) continue; // only base forms are wrong here
    if (AGREEMENT_BLOCKERS.has(prevWord(text, m.index) ?? '')) continue;
    const s = m.index + m[0].length - m[2].length;
    push({
      start: s,
      end: s + m[2].length,
      original: m[2],
      suggestion: matchCase(m[2], thirdPerson(verb)),
      label: 'Subject–verb agreement',
    });
  }
  const plural = /\b(i|we|you|they)\s+([a-z]+)\b/gi;
  while ((m = plural.exec(text)) !== null) {
    const base = SFORM_TO_BASE.get(m[2].toLowerCase());
    if (!base) continue; // only an over-conjugated "-s" form is wrong here
    if (AGREEMENT_BLOCKERS.has(prevWord(text, m.index) ?? '')) continue;
    // "I" after a Capitalized head word (or a named-letter noun) is a Roman numeral
    // or the letter, not the pronoun — "Part I has three chapters", "Group I wants
    // more time", "the word I has a long history" — so it conjugates like a noun.
    // The gated 'i is' / 'i are' phrases guard the same blind spot (#1051).
    if (m[1].toLowerCase() === 'i') {
      const before = prevWordRaw(text, m.index);
      if (before && (/^[A-Z]/.test(before) || I_NOUN_BEFORE.has(before.toLowerCase()))) continue;
    }
    const s = m.index + m[0].length - m[2].length;
    push({
      start: s,
      end: s + m[2].length,
      original: m[2],
      suggestion: matchCase(m[2], base),
      label: 'Subject–verb agreement',
    });
  }
}

// "than" vs "then" after a comparative word.
export function thanRules(text: string, push: Push): void {
  const re = /\b([A-Za-z]+)\s+(then)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!COMPARATIVES.has(m[1].toLowerCase())) continue;
    const start = m.index + m[0].length - m[2].length;
    push({ start, end: start + m[2].length, original: m[2], suggestion: matchCase(m[2], 'than'), label: 'Use “than”' });
  }
}

// Double negative → switch the second negative to its "any" form.
export function doubleNegativeRules(text: string, push: Push): void {
  DOUBLE_NEG_RE.lastIndex = 0;
  const re = DOUBLE_NEG_RE;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[1];
    const start = m.index + m[0].length - word.length;
    push({
      start,
      end: start + word.length,
      original: word,
      suggestion: matchCase(word, INDEFINITE_TO_ANY[word.toLowerCase()]),
      label: 'Double negative',
    });
  }
}

// Modal + "of" ("could of" → "could have") and modal + "to" ("must to go" → "must go").
export function modalRules(text: string, push: Push): void {
  let m: RegExpExecArray | null;
  const ofRe = /\b(could|would|should|must|might|may)\s+(of)\b/gi;
  while ((m = ofRe.exec(text)) !== null) {
    const start = m.index + m[0].length - m[2].length;
    push({ start, end: start + m[2].length, original: m[2], suggestion: matchCase(m[2], 'have'), label: 'Grammar' });
  }
  const toRe = /\b(must|can|could|should|would|might|will|shall|may)(\s+to)\b(?=\s+[a-z])/gi;
  while ((m = toRe.exec(text)) !== null) {
    const start = m.index + m[1].length;
    push({ start, end: start + m[2].length, original: m[2], suggestion: '', label: 'Remove “to”' });
  }
}

// Contextual homophones (their/there, your/you're, its/it's, to/too). We only flip
// a word when the FOLLOWING word makes the possessive/infinitive reading impossible.
export function homophoneRules(text: string, push: Push): void {
  const flip = (re: RegExp, decide: (w: string) => string | null): void => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const sug = decide(m[2].toLowerCase());
      if (!sug) continue;
      push({
        start: m.index,
        end: m.index + m[1].length,
        original: m[1],
        suggestion: matchCase(m[1], sug),
        label: 'Confused word',
      });
    }
  };
  flip(/\b(your)\s+([a-z]+)/gi, (w) => (YOURE_AFTER.has(w) ? "you're" : null));
  flip(/\b(its)\s+([a-z]+)/gi, (w) => (ITS_AFTER.has(w) ? "it's" : null));
  flip(/\b(their)\s+([a-z]+)/gi, (w) => (THERE_AFTER.has(w) ? 'there' : THEYRE_AFTER.has(w) ? "they're" : null));
  flip(/\b(there)\s+([a-z]+)/gi, (w) => (w === 'own' ? 'their' : null));
  flip(/\b(to)\s+([a-z]+)/gi, (w) => (TOO_AFTER.has(w) ? 'too' : null));
}
