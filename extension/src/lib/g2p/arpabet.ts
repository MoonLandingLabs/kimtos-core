// ARPAbet -> IPA. The crux of Voice Studio's permissive grapheme-to-phoneme path.
//
// Kokoro-82M is trained on eSpeak-NG's IPA for English, and eSpeak-NG is GPL-3.0, so we
// cannot ship it in an MIT-licensed extension (#1092). The pronunciations we ship instead
// come from the CMU Pronouncing Dictionary (BSD-2-Clause), which is written in ARPAbet.
// This module is the bridge: it renders an ARPAbet phone sequence as the exact IPA
// eSpeak-NG's `en-us` voice would have produced, so the model is fed the symbols it was
// trained on rather than a different transcription convention.
//
// It is deliberately a PURE function over an array of phones — no I/O, no state — because
// it is the one place where a wrong character becomes a mispronounced word for every user,
// and arpabet.test.ts pins it against transcriptions captured from eSpeak-NG itself.
//
// Two conventions matter and are easy to get wrong:
//   - Kokoro's tokenizer vocabulary has NO plain ASCII `g`. Voiced velar stops must be
//     U+0261 LATIN SMALL LETTER SCRIPT G, or every hard g is silently dropped.
//   - eSpeak puts the stress mark immediately before the stressed VOWEL, not at the
//     syllable boundary: `bɹˈaʊn`, not `ˈbɹaʊn`. cmudict marks stress on vowels too, so
//     the two line up exactly and no syllabifier is needed.

/** Every ARPAbet vowel, without its stress digit, plus the three pseudo-vowels the
 *  non-rhotic rewrite introduces (`IHR` for the `near` vowel, and so on — see
 *  `britishPhones`). They are vowels for every purpose here: they take a stress mark and
 *  they count as a vowel for the flapping rule. */
const VOWELS = new Set([
  'AA',
  'AE',
  'AH',
  'AO',
  'AW',
  'AY',
  'EH',
  'ER',
  'EY',
  'IH',
  'IY',
  'OW',
  'OY',
  'UH',
  'UW',
  'IHR',
  'UHR',
  'EHR',
]);

/** `AY1` -> `{ base: 'AY', stress: 1 }`; `T` -> `{ base: 'T', stress: null }`. */
export function splitPhone(phone: string): { base: string; stress: number | null } {
  const m = /^([A-Z]+)([012])$/.exec(phone);
  if (m && VOWELS.has(m[1])) return { base: m[1], stress: Number(m[2]) };
  return { base: phone, stress: null };
}

/** Is this phone a vowel (with or without its stress digit)? */
export const isVowel = (phone: string): boolean => VOWELS.has(splitPhone(phone).base);

/**
 * The consonants, one entry each. `DX` is not a cmudict phone — it is the alveolar flap
 * this module introduces for American /t/ (see `flapped`).
 */
const CONSONANT_IPA: Record<string, string> = {
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  DX: 'ɾ',
  F: 'f',
  // U+0261, not ASCII `g` — see the header.
  G: 'ɡ',
  HH: 'h',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

/**
 * The vowels. A few differ between their stressed and unstressed realisations in the
 * transcription eSpeak produces, which is the difference between `letter` sounding like
 * `lˈɛɾɚ` and like `lˈɛɾɜː`; `reduced` is that unstressed form.
 */
const VOWEL_IPA: Record<string, { full: string; reduced?: string }> = {
  AA: { full: 'ɑː' },
  AE: { full: 'æ' },
  AH: { full: 'ʌ', reduced: 'ə' },
  AO: { full: 'ɔː' },
  AW: { full: 'aʊ' },
  AY: { full: 'aɪ' },
  EH: { full: 'ɛ' },
  ER: { full: 'ɜː', reduced: 'ɚ' },
  EY: { full: 'eɪ' },
  IH: { full: 'ɪ' },
  IY: { full: 'iː', reduced: 'i' },
  OW: { full: 'oʊ' },
  OY: { full: 'ɔɪ' },
  UH: { full: 'ʊ' },
  UW: { full: 'uː' },
  // The non-rhotic centring diphthongs: `near`, `pure`, `hair`.
  IHR: { full: 'iə' },
  UHR: { full: 'ʊə' },
  EHR: { full: 'ɛː' },
};

const STRESS_MARK: Record<number, string> = { 0: '', 1: 'ˈ', 2: 'ˌ' };

/**
 * Does the /t/ at `i` become an alveolar flap? American English flaps /t/ between a
 * preceding vowel (or /r/) and a FOLLOWING UNSTRESSED vowel — `water`, `letter`, `photo`,
 * `party`, `little` — and eSpeak transcribes it that way, so Kokoro was trained on it.
 * A word-initial /t/, or one before a stressed vowel (`attack`) or a consonant (`twenty`),
 * never flaps.
 *
 * Exported so the test can state the rule in its own terms rather than through whole words.
 */
export function flapsAt(phones: string[], i: number): boolean {
  if (phones[i] !== 'T' || i === 0) return false;
  const before = splitPhone(phones[i - 1]);
  const after = phones[i + 1] ? splitPhone(phones[i + 1]) : null;
  const afterVowelish = VOWELS.has(before.base) || before.base === 'R';
  return afterVowelish && after !== null && VOWELS.has(after.base) && after.stress === 0;
}

/** The same phones with every flappable /t/ replaced by the flap `DX`. */
export function flapped(phones: string[]): string[] {
  return phones.map((p, i) => (flapsAt(phones, i) ? 'DX' : p));
}

/** Which of eSpeak's two English voices we are imitating. */
export type Dialect = 'us' | 'gb';

/**
 * The British vowels that differ, and the diphthong an r-drop leaves behind.
 *
 * cmudict is an American lexicon, so a British rendering is a TRANSFORM of American
 * phones, not a British transcription — and the transform can only carry the distinctions
 * cmudict encodes. It carries the ones that dominate: non-rhoticity (`party` -> `pɑːti`),
 * the GOAT and TRAP vowels (`go` -> `ɡəʊ`, `that` -> `ðat`), the LOT vowel, the yod
 * (`tune` -> `tjuːn`) and no flapping (`letter` -> `lɛtə`). It cannot carry a distinction
 * cmudict does not make — `bath` comes out with the TRAP vowel rather than `bɑːθ` — but
 * neither does eSpeak's own en-GB, which is what Kokoro's British voices were trained on.
 */
const BRITISH_VOWEL: Record<string, { full: string; reduced?: string }> = {
  OW: { full: 'əʊ' },
  // eSpeak's en-GB writes the TRAP vowel as a plain `a`, not `æ` — `that` is `ðat`.
  AE: { full: 'a' },
  // Non-rhotic: the NURSE vowel keeps its length but loses its r-colouring, and unstressed
  // `-er` is a plain schwa — `letter` is `lɛtə`, never `lɛtɚ`.
  ER: { full: 'ɜː', reduced: 'ə' },
};

/** The vowels that leave a centring diphthong when the /r/ after them is dropped. */
const CENTRING_BEFORE_R = new Set(['IH', 'UH', 'EH']);

/** In a non-rhotic accent an /r/ survives only before a vowel. */
const dropsR = (phones: string[], i: number): boolean =>
  phones[i] === 'R' && (i + 1 >= phones.length || !isVowel(phones[i + 1]));

/**
 * ARPAbet's ER already carries its r-colouring, but English still sounds an /r/ between it
 * and a following vowel — `natural` is `nætʃɚɹəl`, not `nætʃɚəl`, in both accents. Insert
 * it, so the British r-drop below has something to keep and the American form matches
 * eSpeak's.
 */
export function linkingR(phones: string[]): string[] {
  const out: string[] = [];
  phones.forEach((phone, i) => {
    out.push(phone);
    if (splitPhone(phone).base === 'ER' && phones[i + 1] && isVowel(phones[i + 1])) out.push('R');
  });
  return out;
}

/** The consonants after which British English keeps the historical yod: `tune`, `duke`,
 *  `new` — but not `true` or `June`, where the /r/ or the affricate intervenes. */
const YOD_AFTER = new Set(['T', 'D', 'N']);

/**
 * The non-rhotic rewrite: drop every /r/ that is not before a vowel, folding the ones that
 * leave a centring diphthong into a single pseudo-vowel (`IH1 R` -> `IHR1`) so the stress
 * mark still lands in front of the whole vowel.
 *
 * It also restores the yod cmudict's American pronunciations have dropped. Which words
 * take it is a fact about their SPELLING, not their phones: `new`, `tune` and `studio`
 * have it because they are spelled with a u-ish vowel, while `two`, `do` and `noon` — the
 * same /t d n/ + /uː/ — never had one.
 */
export function britishPhones(phones: string[], spelling = ''): string[] {
  const yod = /u|ew|eu/.test(spelling);
  const out: string[] = [];
  for (let i = 0; i < phones.length; i += 1) {
    const { base, stress } = splitPhone(phones[i]);
    if (CENTRING_BEFORE_R.has(base) && dropsR(phones, i + 1)) {
      out.push(`${base}R${stress ?? 0}`);
      i += 1;
      continue;
    }
    if (dropsR(phones, i)) continue;
    if (yod && base === 'UW' && stress === 1 && i > 0 && YOD_AFTER.has(splitPhone(phones[i - 1]).base)) out.push('Y');
    out.push(phones[i]);
  }
  return out;
}

/**
 * Render an ARPAbet phone sequence as eSpeak-style English IPA.
 *
 * `spelling` is the word the phones came from, used only for the one British distinction
 * cmudict loses: its single low-back vowel AA is the LOT vowel `ɒ` in a word spelled with
 * an `o` (`lot`, `fox`, `dog`) and the PALM vowel `ɑː` otherwise (`father`, `car`). Right
 * far more often than not, and it is the difference between a British voice sounding
 * British and sounding mid-Atlantic.
 *
 * Unknown phones are dropped rather than passed through: a stray token would reach
 * Kokoro's tokenizer as an out-of-vocabulary character, and a silently-dropped phone is a
 * slightly-wrong word, where a passed-through one can derail a whole chunk.
 */
export function arpaToIpa(phones: string[], opts: { dialect?: Dialect; spelling?: string } = {}): string {
  const gb = opts.dialect === 'gb';
  const spelling = opts.spelling ?? '';
  const linked = linkingR(phones);
  // Flapping is American; RP keeps the /t/.
  const seq = gb ? britishPhones(linked, spelling) : flapped(linked);
  // The LOT vowel is spelled with an `o` and nothing else vowel-like: `lot`, `dog`, `long`
  // and `wrong` are `ɒ`, while `father`, `car` and `dawn` keep their long vowel. An `r`
  // AFTER the `o` rules it out — `for`, `more` and `north` are the THOUGHT vowel — but an
  // `r` before it does not, which is why this looks at where the letters are and not just
  // which ones are present.
  const lot = gb && spelling.includes('o') && !spelling.includes('a') && !/o[^aeiouy]*r/.test(spelling);
  let out = '';

  for (const phone of seq) {
    const { base, stress } = splitPhone(phone);
    const vowel = (gb ? BRITISH_VOWEL[base] : undefined) ?? VOWEL_IPA[base];
    if (vowel) {
      // `happy` and `thirty` end in the short unstressed /i/, whatever stress digit
      // cmudict gave them — only a primary-stressed IY is the long FLEECE vowel.
      const weak = base === 'IY' ? stress !== 1 : stress === 0;
      const isLot = lot && (base === 'AA' || base === 'AO');
      const quality = isLot ? 'ɒ' : weak && vowel.reduced ? vowel.reduced : vowel.full;
      out += STRESS_MARK[stress ?? 0] + quality;
      continue;
    }
    out += CONSONANT_IPA[base] ?? '';
  }
  return out;
}
