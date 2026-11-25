// Grapheme-to-phoneme frontend for the Kokoro TTS engine: normalise English text
// (numbers, currency, abbreviations, quotes) and convert it to the IPA phoneme string
// Kokoro's tokenizer expects.
//
// THE PHONEMES COME FROM A DICTIONARY, NOT eSpeak-NG. The obvious frontend — the
// `phonemizer` npm package — declares itself Apache-2.0 but is an Emscripten build of
// eSpeak-NG, which is GPL-3.0-or-later. We convey the extension to end users, so
// bundling it is a copyleft conflict, and the owner's decision on #1092 was to replace it
// rather than ship it. What replaced it, in `lib/g2p/`:
//
//   - lexicon.ts  the CMU Pronouncing Dictionary (BSD-2-Clause), 126k words, a packaged
//                 767 KB gzipped asset, decompressed on first use
//   - arpabet.ts  the ARPAbet -> eSpeak-style IPA mapping (pure, unit-tested against
//                 transcriptions captured from eSpeak-NG before it was removed)
//   - lts.ts      letter-to-sound rules, authored here, for words the dictionary lacks
//   - english.ts  numbers, ordinals, symbols, initialisms and unstressed function words
//
// The text NORMALISATION below (quotes, abbreviations, currency, years, clock times) is
// vendored with light TypeScript typing from the Apache-2.0 kokoro-js project
// (hexgrad/kokoro, src/phonemize.js) and kept faithful to the original, so text reaches
// the model in the shape its authors' voices were tuned for; see THIRD-PARTY-NOTICES.md.

import { loadLexicon, type Lexicon } from '../g2p/lexicon.js';
import { arpaToIpa, type Dialect } from '../g2p/arpabet.js';
import { expandSpokenForms, wordPhones } from '../g2p/english.js';

/**
 * Split a string on a regex, but keep the delimiters — the built-in `.split()`
 * drops them, and a capturing group nests badly with the existing groups.
 */
function split(text: string, regex: RegExp): { match: boolean; text: string }[] {
  const result = [];
  let prev = 0;
  for (const match of text.matchAll(regex)) {
    const fullMatch = match[0];
    if (prev < match.index) {
      result.push({ match: false, text: text.slice(prev, match.index) });
    }
    if (fullMatch.length > 0) {
      result.push({ match: true, text: fullMatch });
    }
    prev = match.index + fullMatch.length;
  }
  if (prev < text.length) {
    result.push({ match: false, text: text.slice(prev) });
  }
  return result;
}

/**
 * Helper function to split numbers into phonetic equivalents
 * @param {string} match The matched number
 * @returns {string} The phonetic equivalent
 */
function split_num(match: string): string {
  if (match.includes('.')) {
    return match;
  } else if (match.includes(':')) {
    const [h, m] = match.split(':').map(Number);
    if (m === 0) {
      return `${h} o'clock`;
    } else if (m < 10) {
      return `${h} oh ${m}`;
    }
    return `${h} ${m}`;
  }
  const year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) {
    return match;
  }
  const left = match.slice(0, 2);
  const right = parseInt(match.slice(2, 4), 10);
  const suffix = match.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) {
      return `${left} hundred${suffix}`;
    } else if (right < 10) {
      return `${left} oh ${right}${suffix}`;
    }
  }
  return `${left} ${right}${suffix}`;
}

/**
 * Helper function to format monetary values
 * @param {string} match The matched currency
 * @returns {string} The formatted currency
 */
function flip_money(match: string): string {
  const bill = match[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(match.slice(1)))) {
    return `${match.slice(1)} ${bill}s`;
  } else if (!match.includes('.')) {
    const suffix = match.slice(1) === '1' ? '' : 's';
    return `${match.slice(1)} ${bill}${suffix}`;
  }
  const [b, c] = match.slice(1).split('.');
  const d = parseInt(c.padEnd(2, '0'), 10);
  const coins = match[0] === '$' ? (d === 1 ? 'cent' : 'cents') : d === 1 ? 'penny' : 'pence';
  return `${b} ${bill}${b === '1' ? '' : 's'} and ${d} ${coins}`;
}

/**
 * Helper function to process decimal numbers
 * @param {string} match The matched number
 * @returns {string} The formatted number
 */
function point_num(match: string): string {
  const [a, b] = match.split('.');
  return `${a} point ${b.split('').join(' ')}`;
}

/**
 * Normalize text for phonemization
 * @param {string} text The text to normalize
 * @returns {string} The normalized text
 */
function normalize_text(text: string): string {
  return (
    text
      // 1. Handle quotes and brackets
      .replace(/[‘’]/g, "'")
      .replace(/«/g, '“')
      .replace(/»/g, '”')
      .replace(/[“”]/g, '"')
      .replace(/\(/g, '«')
      .replace(/\)/g, '»')

      // 2. Replace uncommon punctuation marks
      .replace(/、/g, ', ')
      .replace(/。/g, '. ')
      .replace(/！/g, '! ')
      .replace(/，/g, ', ')
      .replace(/：/g, ': ')
      .replace(/；/g, '; ')
      .replace(/？/g, '? ')

      // 3. Whitespace normalization
      .replace(/[^\S \n]/g, ' ')
      .replace(/  +/, ' ')
      .replace(/(?<=\n) +(?=\n)/g, '')

      // 4. Abbreviations
      .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
      .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
      .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
      .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
      .replace(/\betc\.(?! [A-Z])/gi, 'etc')

      // 5. Normalize casual words
      .replace(/\b(y)eah?\b/gi, "$1e'a")

      // 5. Handle numbers and currencies
      .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, split_num)
      .replace(/(?<=\d),(?=\d)/g, '')
      .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flip_money)
      .replace(/\d*\.\d+/g, point_num)
      .replace(/(?<=\d)-(?=\d)/g, ' to ')
      .replace(/(?<=\d)S/g, ' S')

      // 6. Handle possessives
      .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
      .replace(/(?<=X')S\b/g, 's')

      // 7. Handle hyphenated words/letters
      .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
      .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')

      // 8. Strip leading and trailing whitespace
      .trim()
  );
}

/**
 * Escapes regular expression special characters from a string by replacing them with their escaped counterparts.
 *
 * @param {string} string The string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_PATTERN = new RegExp(`(\\s*[${escapeRegExp(PUNCTUATION)}]+\\s*)+`, 'g');

/** A word, keeping its case (the only signal that `US` is two letter names and `us` is a
 *  word) and any internal apostrophe. */
const WORD_PATTERN = /[A-Za-z][A-Za-z']*/g;

/**
 * One run of non-punctuation text as IPA. Pure over the lexicon, so voicePhonemize.test.ts
 * can drive it with a fixture dictionary instead of the 767 KB asset.
 */
function sectionToIpa(text: string, lexicon: Lexicon | null, dialect: Dialect): string {
  const spoken = expandSpokenForms(text);
  const words: string[] = [];
  for (const [token] of spoken.matchAll(WORD_PATTERN)) {
    const ipa = arpaToIpa(wordPhones(token, lexicon), { dialect, spelling: token.toLowerCase() });
    if (ipa) words.push(ipa);
  }
  if (!words.length) return '';
  // Keep the section's own leading/trailing space so `a, b` does not become `a,b`.
  return (/^\s/.test(spoken) ? ' ' : '') + words.join(' ') + (/\s$/.test(spoken) ? ' ' : '');
}

/**
 * Turn text into the IPA string Kokoro's tokenizer expects, with the punctuation left in
 * place (it is what the model renders as phrasing and pauses).
 *
 * Pure — takes the dictionary rather than loading it — so it is testable without I/O.
 * `phonemize` below is the one callers use.
 */
export function phonemizeWith(text: string, lexicon: Lexicon | null, language: 'a' | 'b' = 'a', norm = true): string {
  const dialect: Dialect = language === 'a' ? 'us' : 'gb';
  const sections = split(norm ? normalize_text(text) : text, PUNCTUATION_PATTERN);
  return (
    sections
      .map(({ match, text: part }) => (match ? part : sectionToIpa(part, lexicon, dialect)))
      .join('')
      .replace(/ {2,}/g, ' ')
      // Expanding `9:30` or `$5.50` into words leaves a space in front of the punctuation
      // that followed them, and Kokoro renders `word .` with an audible gap before the stop.
      .replace(/ +(?=[;:,.!?…”»)])/g, '')
      .trim()
  );
}

/**
 * Phonemize text with the shipped pronunciation dictionary.
 *
 * @param text The text to phonemize
 * @param language `a` for American English, `b` for British
 * @param norm Whether to normalize the text first
 */
export async function phonemize(text: string, language: 'a' | 'b' = 'a', norm = true): Promise<string> {
  return phonemizeWith(text, await loadLexicon(), language, norm);
}
