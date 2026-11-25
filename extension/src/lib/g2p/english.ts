// Turning ordinary English text into the words the dictionary can look up, and each of
// those words into ARPAbet phones.
//
// eSpeak-NG did all of this implicitly — it read `42`, `3rd` and `NASA` and said something
// sensible. Replacing it with a dictionary (#1092) means we own those cases now, and they
// are not optional: a lexicon lookup for `42` fails, the letter-to-sound rules have no rule
// for a digit, and the number would come out as SILENCE in the middle of a sentence.
//
// Everything here is authored or derived from the shipped BSD-2-Clause dictionary — the
// number words, the letter names (cmudict spells them `a.`, `b.`, ...) and the reduced
// function words all resolve through the same lexicon, so there is no second pronunciation
// table to keep honest.

import { type Lexicon } from './lexicon.js';
import { ltsPhones } from './lts.js';

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];

/** 0-999 as words. */
function under1000(n: number): string {
  if (n >= 100) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${under1000(rest)}` : ''}`;
  }
  if (n >= 20) {
    const rest = n % 10;
    return TENS[Math.floor(n / 10)] + (rest ? ` ${ONES[rest]}` : '');
  }
  return ONES[n];
}

/**
 * A run of digits as words. Long numbers a reader would not say as a quantity (a phone
 * number, an id) are read digit by digit instead — `one two three four five six seven` is
 * closer to what a person does with `1234567` than "one million two hundred...", and it is
 * what happens past the scale table regardless.
 */
export function digitsToWords(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (/^0+$/.test(digits)) return 'zero';
  // A leading zero means it is an identifier, not a quantity (`007`).
  if (digits.length !== trimmed.length || trimmed.length > SCALES.length * 3) {
    return [...digits].map((d) => ONES[Number(d)]).join(' ');
  }

  const groups: number[] = [];
  for (let i = trimmed.length; i > 0; i -= 3) groups.push(Number(trimmed.slice(Math.max(0, i - 3), i)));
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (!groups[i]) continue;
    parts.push(under1000(groups[i]) + (SCALES[i] ? ` ${SCALES[i]}` : ''));
  }
  return parts.join(' ');
}

/** The irregular cardinal -> ordinal stems; everything else just takes `th`. */
const ORDINAL: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

/** `3` -> `third`, `21` -> `twenty first`, `40` -> `fortieth`. */
export function ordinalWords(digits: string): string {
  const words = digitsToWords(digits).split(' ');
  const last = words[words.length - 1];
  words[words.length - 1] = ORDINAL[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.join(' ');
}

/** Symbols a reader says out loud. Anything not listed stays punctuation and is spoken as
 *  a pause by the caller's punctuation handling. The pattern below is DERIVED from these
 *  keys rather than typed twice — a symbol added here and forgotten there would be dropped
 *  from the sentence in silence. */
const SYMBOLS: Record<string, string> = {
  '%': ' percent ',
  '&': ' and ',
  '+': ' plus ',
  '=': ' equals ',
  '@': ' at ',
  '€': ' euros ',
  '°': ' degrees ',
  '×': ' times ',
  '÷': ' divided by ',
  '#': ' number ',
};

const SYMBOL_PATTERN = new RegExp(
  `[${Object.keys(SYMBOLS)
    .join('')
    .replace(/[\\\]^-]/g, '\\$&')}]`,
  'g',
);

/**
 * Expand what the dictionary cannot look up — digits, ordinals and spoken symbols — into
 * words it can. Runs AFTER the Kokoro text normalisation (which has already turned years,
 * clock times, money and decimals into their spoken shapes), so what reaches here is
 * plain digit runs.
 */
export function expandSpokenForms(text: string): string {
  return text
    .replace(/(\d+)(?:st|nd|rd|th)\b/gi, (_, d: string) => ` ${ordinalWords(d)} `)
    .replace(/\d+/g, (d) => ` ${digitsToWords(d)} `)
    .replace(SYMBOL_PATTERN, (s) => SYMBOLS[s])
    .replace(/ {2,}/g, ' ');
}

/**
 * Function words a reader never stresses. cmudict gives every word its citation form, so
 * `of` comes back as a stressed /ʌv/ and a sentence of them reads like a list. Rather than
 * hand-writing pronunciations, the dictionary's own phones are kept and the stress digits
 * dropped — the vowel quality stays right and the prosody stops shouting.
 */
const UNSTRESSED = new Set([
  'a',
  'am',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'him',
  'his',
  'if',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'she',
  'than',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'us',
  'was',
  'we',
  'were',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

/** The few whose reduced form is a DIFFERENT vowel, not just an unstressed one — cmudict's
 *  citation `to` is /tuː/ and its `was` is /wɑːz/, neither of which is what a reader says
 *  in running text. */
const REDUCED: Record<string, string[]> = {
  to: ['T', 'AH0'],
  you: ['Y', 'UW0'],
  was: ['W', 'AH0', 'Z'],
  your: ['Y', 'UH0', 'R'],
  of: ['AH0', 'V'],
};

const destress = (phones: string[]): string[] => phones.map((p) => p.replace(/[12]$/, '0'));

/** Is this token an initialism the dictionary has no entry for — `MV3`, `CSS`, `NDA`? */
const isInitialism = (token: string): boolean => /^[A-Z]{2,6}$/.test(token);

/**
 * The ARPAbet phones for one token of text, in the order they are spoken.
 *
 * `token` keeps its original case, because case is the only signal that `US` is two letter
 * names and `us` is a word. Lookup order: the reduced-function-word overrides, the
 * dictionary, the dictionary again without a trailing possessive, letter-by-letter for an
 * unknown initialism, and finally the letter-to-sound rules.
 */
export function wordPhones(token: string, lexicon: Lexicon | null): string[] {
  const word = token.toLowerCase();
  if (!word) return [];

  const reduced = REDUCED[word];
  if (reduced) return reduced;

  const direct = lexicon?.lookup(word) ?? null;
  if (direct) return UNSTRESSED.has(word) ? destress(direct) : direct;

  // `Kokoro's` -> `kokoro` + the possessive, which cmudict spells on the stem it knows.
  const possessive = /^(.+)'s$/.exec(word);
  if (possessive) {
    const stem = wordPhones(possessive[1], lexicon);
    if (stem.length) {
      const last = stem[stem.length - 1];
      const sibilant = ['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].includes(last);
      return [...stem, ...(sibilant ? ['IH0', 'Z'] : [['P', 'T', 'K', 'F', 'TH'].includes(last) ? 'S' : 'Z'])];
    }
  }

  if (isInitialism(token)) {
    // cmudict spells the letter names as `a.`, `b.`, ... so the shipped dictionary already
    // has them; no second table to maintain.
    const spelled = [...word].flatMap((c) => lexicon?.lookup(`${c}.`) ?? []);
    if (spelled.length) return spelled;
  }

  return ltsPhones(word.replace(/[^a-z']/g, ''));
}
