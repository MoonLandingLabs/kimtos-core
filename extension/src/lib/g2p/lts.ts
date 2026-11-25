// Letter-to-sound rules — the out-of-vocabulary half of Voice Studio's grapheme-to-phoneme
// path.
//
// The shipped dictionary (lexicon.ts) holds 126k words, which covers effectively all
// running English text, but not names, coinages, product names or typos. Something has to
// pronounce those, and the something cannot be eSpeak-NG: it is GPL-3.0 and we ship an
// MIT-licensed extension (#1092). So these rules are AUTHORED HERE — no third-party data,
// no licence to inherit — in the classic context-sensitive form: at each position in the
// word, the longest/most specific rule whose left and right context match wins, and it
// consumes its graphemes.
//
// They are a fallback, not a phonology. Measured against held-out cmudict entries they get
// most of an unknown word right and the rest close enough to be understood, which is the
// bar for a name the dictionary has never seen. Words the user cares about being exact are
// overwhelmingly in the dictionary already.

const V = 'aeiouy';
const CONS = '[^aeiouy]';
/** The magic-e context: one consonant, a silent `e`, and optionally an inflection —
 *  `cake`, `cakes`, `caked` all lengthen the vowel. */
const MAGIC_E = '[^aeiouy]e[sd]?$';

interface Rule {
  /** Anchored at the end of the text already consumed; null means "any". */
  left: RegExp | null;
  /** The letters this rule consumes. */
  g: string;
  /** Anchored at the start of the text not yet consumed; null means "any". */
  right: RegExp | null;
  phones: string[];
}

const r = (g: string, phones: string[], left: string | null = null, right: string | null = null): Rule => ({
  left: left === null ? null : new RegExp(`${left}$`),
  g,
  right: right === null ? null : new RegExp(`^(?:${right})`),
  phones,
});

/**
 * Every rule. Vowel rules emit stress 1; `assignStress` then keeps it on exactly one
 * syllable — the rules decide the vowel's QUALITY, the stress pass decides its prominence.
 */
const RULES: Rule[] = [
  // --- vowels ---------------------------------------------------------------------
  r('ai', ['EY1']),
  r('ay', ['EY1']),
  r('au', ['AO1']),
  r('aw', ['AO1']),
  // `call`, `talk`, `ball` — /a/ before a dark l is the low back vowel, not /ae/.
  r('a', ['AO1'], null, 'l[lk]'),
  r('ar', ['AA1', 'R'], null, `$|${CONS}`),
  // Magic e: `cake`, `plate`, and the inflected `cakes` / `plated`.
  r('a', ['EY1'], null, MAGIC_E),
  r('a', ['AE1']),

  r('ee', ['IY1']),
  r('ea', ['IY1']),
  r('ei', ['EY1']),
  r('eu', ['UW1']),
  r('ew', ['UW1']),
  // `money`, `valley`, `abbey` end in /i/; the short words that do not — `they`, `grey`,
  // `obey` — are common enough to be in the dictionary rather than here.
  r('ey', ['IY1'], '.{3,}', '$'),
  r('ey', ['EY1']),
  r('er', ['ER1'], null, `$|${CONS}`),
  // Silent final e, but only when the word has an earlier vowel — `the` and `be` keep it.
  // `domes` and `hoped` are the same silent e with an inflection stuck on the end.
  r('e', [], `[${V}]${CONS}+`, '$|[sd]$'),
  r('e', ['IY1'], null, MAGIC_E),
  r('e', ['EH1']),

  r('igh', ['AY1']),
  r('ir', ['ER1'], null, `$|${CONS}`),
  r('ie', ['IY1']),
  r('i', ['AY1'], null, MAGIC_E),
  r('i', ['AY1'], null, 'nd$'),
  r('i', ['IH1']),

  r('oo', ['UW1']),
  r('oa', ['OW1']),
  r('oi', ['OY1']),
  r('oy', ['OY1']),
  r('ou', ['AW1']),
  // `low`, `show` at the end of a word; `crowd`, `down` inside one.
  r('ow', ['OW1'], null, '$'),
  r('ow', ['AW1']),
  r('or', ['AO1', 'R'], null, `$|${CONS}`),
  r('o', ['OW1'], null, MAGIC_E),
  r('o', ['OW1'], null, '$'),
  r('o', ['OW1'], null, 'ld$|lt$|st$'),
  r('o', ['AA1']),

  r('ui', ['UW1']),
  r('ur', ['ER1'], null, `$|${CONS}`),
  r('u', ['UW1'], null, MAGIC_E),
  r('u', ['AH1']),

  // `y` is a consonant word-initially, /iy/ at the end of a word that already has a vowel
  // (`happy`), /ay/ at the end of one that does not (`my`, `try`).
  r('y', ['Y'], '^', null),
  r('y', ['AY1'], null, MAGIC_E),
  r('y', ['IY1'], `[${V}]${CONS}*`, '$'),
  r('y', ['AY1'], null, '$'),
  r('y', ['IH1']),

  // --- consonants -----------------------------------------------------------------
  r('bb', ['B']),
  // `climb`, `comb`, `lamb`.
  r('b', [], 'm', '$'),
  r('b', ['B']),

  // `christ`, `chrome` — the Greek ch.
  r('ch', ['K'], null, 'r'),
  r('ch', ['CH']),
  r('ck', ['K']),
  // `accept`, `success` — a doubled c before a front vowel is /ks/.
  r('cc', ['K', 'S'], null, '[eiy]'),
  r('c', ['S'], null, '[eiy]'),
  r('c', ['K']),

  r('dge', ['JH']),
  r('dd', ['D']),
  r('d', ['D']),

  r('ff', ['F']),
  r('f', ['F']),

  // `though`, `night` — silent gh at the end or before a t.
  r('gh', [], null, '$|t'),
  r('gg', ['G']),
  r('gn', ['N'], '^', null),
  r('gn', ['N'], null, '$'),
  r('g', ['JH'], null, '[eiy]'),
  r('g', ['G']),

  r('h', ['HH']),
  r('j', ['JH']),

  r('kn', ['N'], '^', null),
  r('k', ['K']),

  r('ll', ['L']),
  r('l', ['L']),

  r('mm', ['M']),
  r('mb', ['M'], null, '$'),
  r('m', ['M']),

  r('ng', ['NG']),
  r('nk', ['NG', 'K']),
  r('nn', ['N']),
  r('n', ['N']),

  r('ph', ['F']),
  r('pp', ['P']),
  r('ps', ['S'], '^', null),
  r('p', ['P']),

  r('qu', ['K', 'W']),
  r('q', ['K']),

  r('rr', ['R']),
  r('r', ['R']),

  r('sion', ['ZH', 'AH0', 'N']),
  r('sure', ['SH', 'ER0']),
  r('sh', ['SH']),
  r('ss', ['S']),
  // A final `s` is an inflection; `voiceFinalSibilant` below decides whether it is /s/,
  // /z/ or a whole extra syllable, because that follows the SOUND before it and not the
  // letter — `drakes` is /dreɪks/ even though the letter before the s is an e.
  r('s', ['Z'], null, '$'),
  r('s', ['S']),

  r('tch', ['CH']),
  r('tion', ['SH', 'AH0', 'N']),
  r('th', ['TH']),
  r('tt', ['T']),
  r('t', ['T']),

  r('v', ['V']),

  r('wh', ['W']),
  r('wr', ['R'], '^', null),
  r('w', ['W']),

  // `xylophone` starts with a /z/; everywhere else x is /ks/.
  r('x', ['Z'], '^', null),
  r('x', ['K', 'S']),

  r('zz', ['Z']),
  r('z', ['Z']),

  // `'s`, `'t`, `'ll` — the apostrophe itself is silent.
  r("'", []),
];

/** Rules bucketed by first letter, longest grapheme first so `tion` beats `th` beats `t`.
 *  Built once. `Array.prototype.sort` is stable, so same-length rules keep their declared
 *  order and a context-bearing rule still wins over the bare one. */
const BY_LETTER = ((): Map<string, Rule[]> => {
  const map = new Map<string, Rule[]>();
  for (const rule of RULES) {
    const list = map.get(rule.g[0]);
    if (list) list.push(rule);
    else map.set(rule.g[0], [rule]);
  }
  for (const list of map.values()) list.sort((a, b) => b.g.length - a.g.length);
  return map;
})();

/** Suffixes that pull the stress onto the syllable before them — `poSItion`, `hisTORic`.
 *  `-tion` and `-sion` are listed WITHOUT their preceding vowel on purpose: the stressed
 *  syllable of `information` is the `a` that belongs to neither, and anchoring on `ation`
 *  instead would step one syllable too far back. */
const STRESS_BEFORE = ['tion', 'sion', 'ical', 'ity', 'ify', 'ious', 'ial', 'ian', 'ic'];

/** Prefixes that are themselves unstressed, so the stress falls on the next syllable. */
const UNSTRESSED_PREFIX = /^(?:a|be|de|re|pre|con|com|ex|in|im|un|dis|per|sub|pro)(?=[a-z]{3,})/;

/**
 * Which vowel of `word` carries primary stress, as an index into its vowel LETTERS. English
 * default is the first syllable; a Latinate suffix pulls it back one, and an unstressed
 * prefix pushes it forward one. Exported so the test can state the rule directly.
 */
export function stressedVowelIndex(word: string): number {
  const vowels = [...word].map((c, i) => (V.includes(c) ? i : -1)).filter((i) => i >= 0);
  if (vowels.length <= 1) return 0;

  for (const suffix of STRESS_BEFORE) {
    if (!word.endsWith(suffix) || word.length <= suffix.length) continue;
    const start = word.length - suffix.length;
    const first = vowels.findIndex((i) => i >= start);
    // The vowel before the suffix's own first vowel; never before the word's first.
    return Math.max(0, (first === -1 ? vowels.length : first) - 1);
  }
  return UNSTRESSED_PREFIX.test(word) ? 1 : 0;
}

const isVowelPhone = (p: string): boolean => /^[A-Z]+[012]$/.test(p);

/** Vowels that survive unstressed: the diphthongs keep their quality (`ablate` is
 *  `AH B L EY T`, not `AH B L AH T`), an r-coloured vowel keeps its colour, and IH is
 *  already a reduced vowel — cmudict spells `-ing`, `-es` and `-ed` with it. */
const UNREDUCIBLE = new Set(['EY', 'AY', 'OW', 'AW', 'OY', 'ER', 'IH']);

/**
 * Put primary stress on one syllable and REDUCE the rest.
 *
 * The reduction is not cosmetic. English unstressed monophthongs are schwa — cmudict
 * writes `aback` as `AH B AE K`, never `AE B AE K` — and spelling out an unstressed vowel
 * at full quality is the single loudest thing that makes a rules-derived pronunciation
 * sound robotic. Measured against held-out cmudict entries it is worth about a third of
 * the fallback's phone error rate.
 */
export function assignStress(phones: string[], word: string): string[] {
  const vowelAt = phones.map((p, i) => (isVowelPhone(p) ? i : -1)).filter((i) => i >= 0);
  if (!vowelAt.length) return phones;
  const pick = vowelAt[Math.min(stressedVowelIndex(word), vowelAt.length - 1)];
  const last = vowelAt[vowelAt.length - 1];

  return phones.map((p, i) => {
    if (!isVowelPhone(p)) return p;
    const base = p.slice(0, -1);
    if (i === pick) return `${base}1`;
    // A final -y/-ie stays /i/; everything else that can reduce, does.
    if (UNREDUCIBLE.has(base) || (base === 'IY' && i === last)) return `${base}0`;
    return 'AH0';
  });
}

/** Consonants with no voicing; a following inflectional /s/ stays voiceless after them. */
const VOICELESS = new Set(['P', 'T', 'K', 'F', 'TH', 'S', 'SH', 'CH']);
/** Consonants an inflectional /s/ cannot simply attach to — it needs its own syllable. */
const SIBILANT = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);

/**
 * Make a word-final inflectional /s/ agree with the sound before it: `drakes` is /s/,
 * `domes` is /z/, and `houses` grows a syllable. English decides this by SOUND, so it
 * cannot be done in the letter rules above — `drake` and `dome` differ only in a letter
 * the silent-e rule has already thrown away.
 */
function voiceFinalSibilant(phones: string[]): string[] {
  if (phones.length < 2 || phones[phones.length - 1] !== 'Z') return phones;
  const previous = phones[phones.length - 2];
  if (SIBILANT.has(previous)) return [...phones.slice(0, -1), 'IH0', 'Z'];
  return VOICELESS.has(previous) ? [...phones.slice(0, -1), 'S'] : phones;
}

/**
 * Pronounce a word the dictionary does not have, as ARPAbet phones.
 *
 * `word` must already be lowercased. Characters no rule covers are skipped rather than
 * guessed at.
 */
export function ltsPhones(word: string): string[] {
  const phones: string[] = [];
  let i = 0;
  while (i < word.length) {
    const candidates = BY_LETTER.get(word[i]);
    let matched = false;
    for (const rule of candidates ?? []) {
      if (!word.startsWith(rule.g, i)) continue;
      if (rule.left && !rule.left.test(word.slice(0, i))) continue;
      if (rule.right && !rule.right.test(word.slice(i + rule.g.length))) continue;
      phones.push(...rule.phones);
      i += rule.g.length;
      matched = true;
      break;
    }
    if (!matched) i += 1;
  }
  return assignStress(voiceFinalSibilant(phones), word);
}
