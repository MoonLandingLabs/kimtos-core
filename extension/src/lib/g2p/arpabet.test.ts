// The ARPAbet -> IPA mapping is the crux of the permissive G2P (#1092): Kokoro-82M was
// trained on eSpeak-NG's IPA, and the pronunciations we ship are cmudict's ARPAbet, so a
// wrong character here is a mispronounced word for every user with nothing else to catch
// it.
//
// The expectations below are not invented. Each was captured from eSpeak-NG itself
// (`phonemize(word, 'en-us' | 'en')`) before the GPL dependency was removed, so this file
// is the record of what the model expects to be fed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arpaToIpa, britishPhones, flapped, flapsAt, isVowel, linkingR, splitPhone } from './arpabet.js';

describe('splitPhone', () => {
  test('separates a vowel from its stress digit', () => {
    assert.deepEqual(splitPhone('AY1'), { base: 'AY', stress: 1 });
    assert.deepEqual(splitPhone('AH0'), { base: 'AH', stress: 0 });
    assert.deepEqual(splitPhone('AE2'), { base: 'AE', stress: 2 });
  });

  test('a consonant has no stress', () => {
    assert.deepEqual(splitPhone('T'), { base: 'T', stress: null });
    assert.deepEqual(splitPhone('NG'), { base: 'NG', stress: null });
  });

  test('isVowel is true only for vowels', () => {
    assert.equal(isVowel('IY0'), true);
    assert.equal(isVowel('ER1'), true);
    assert.equal(isVowel('R'), false);
    assert.equal(isVowel('ZH'), false);
  });
});

describe('arpaToIpa: the symbols Kokoro was trained on', () => {
  // Kokoro's tokenizer vocabulary has NO ASCII `g`. If this ever regresses, every hard g
  // in every voice is silently dropped, which is the kind of failure that sounds like a
  // bad model rather than a bad character.
  test('a voiced velar stop is U+0261 SCRIPT G, never ASCII g', () => {
    const go = arpaToIpa(['G', 'OW1']);
    assert.equal(go, 'ɡˈoʊ');
    assert.equal(go.includes('g'), false);
    assert.equal(go.codePointAt(0), 0x261);
  });

  test('affricates are the two-character sequences eSpeak emits', () => {
    assert.equal(arpaToIpa(['CH', 'ER1', 'CH']), 'tʃˈɜːtʃ');
    assert.equal(arpaToIpa(['JH', 'AH1', 'JH']), 'dʒˈʌdʒ');
  });

  test('the stress mark goes immediately before the vowel, not the syllable', () => {
    assert.equal(arpaToIpa(['B', 'R', 'AW1', 'N']), 'bɹˈaʊn');
    assert.equal(arpaToIpa(['F', 'R', 'AH1', 'M']), 'fɹˈʌm');
  });

  test('secondary stress uses its own mark', () => {
    // riverbank: R IH1 V ER0 B AE2 NG K
    assert.equal(arpaToIpa(['R', 'IH1', 'V', 'ER0', 'B', 'AE2', 'NG', 'K']), 'ɹˈɪvɚbˌæŋk');
  });

  test('unstressed AH, ER and IY take their reduced forms', () => {
    assert.equal(arpaToIpa(['DH', 'AH0']), 'ðə');
    assert.equal(arpaToIpa(['L', 'EH1', 'T', 'ER0']), 'lˈɛɾɚ');
    assert.equal(arpaToIpa(['HH', 'AE1', 'P', 'IY0']), 'hˈæpi');
  });

  test('an unknown phone is dropped rather than passed through to the tokenizer', () => {
    assert.equal(arpaToIpa(['B', 'XX', 'IY1']), 'bˈiː');
  });
});

describe('American flapping', () => {
  test('a /t/ flaps between a vowel and an unstressed vowel', () => {
    // water: W AO1 T ER0
    assert.equal(arpaToIpa(['W', 'AO1', 'T', 'ER0']), 'wˈɔːɾɚ');
    // little: L IH1 T AH0 L
    assert.equal(arpaToIpa(['L', 'IH1', 'T', 'AH0', 'L']), 'lˈɪɾəl');
  });

  test('it flaps after an /r/ too', () => {
    // party: P AA1 R T IY0
    assert.equal(arpaToIpa(['P', 'AA1', 'R', 'T', 'IY0']), 'pˈɑːɹɾi');
  });

  test('it does not flap before a stressed vowel, before a consonant, or word-initially', () => {
    // attack: AH0 T AE1 K — the following vowel is stressed.
    assert.equal(arpaToIpa(['AH0', 'T', 'AE1', 'K']), 'ətˈæk');
    // twenty: T W EH1 N T IY0 — the /t/ follows a nasal, not a vowel.
    assert.equal(arpaToIpa(['T', 'W', 'EH1', 'N', 'T', 'IY0']), 'twˈɛnti');
    assert.equal(flapsAt(['T', 'AH0'], 0), false);
  });

  test('flapped rewrites only the flappable /t/s', () => {
    assert.deepEqual(flapped(['W', 'AO1', 'T', 'ER0']), ['W', 'AO1', 'DX', 'ER0']);
    assert.deepEqual(flapped(['S', 'T', 'AA1', 'P']), ['S', 'T', 'AA1', 'P']);
  });
});

describe('linkingR', () => {
  test('an /r/ is sounded between ER and a following vowel', () => {
    // natural: N AE1 CH ER0 AH0 L -> nˈætʃɚɹəl, which is what eSpeak emits.
    assert.equal(arpaToIpa(['N', 'AE1', 'CH', 'ER0', 'AH0', 'L']), 'nˈætʃɚɹəl');
    assert.deepEqual(linkingR(['ER0', 'AH0']), ['ER0', 'R', 'AH0']);
  });

  test('nothing is inserted before a consonant or at the end', () => {
    assert.deepEqual(linkingR(['ER0', 'D']), ['ER0', 'D']);
    assert.deepEqual(linkingR(['ER1']), ['ER1']);
  });
});

describe('the British transform', () => {
  test('is non-rhotic: an /r/ survives only before a vowel', () => {
    // party -> pˈɑːti, for -> fˈɔː
    assert.equal(arpaToIpa(['P', 'AA1', 'R', 'T', 'IY0'], { dialect: 'gb', spelling: 'party' }), 'pˈɑːti');
    assert.equal(arpaToIpa(['F', 'AO1', 'R'], { dialect: 'gb', spelling: 'for' }), 'fˈɔː');
    assert.deepEqual(britishPhones(['V', 'EH1', 'R', 'IY0']), ['V', 'EH1', 'R', 'IY0']);
  });

  test('a dropped /r/ after IH, UH or EH leaves a centring diphthong', () => {
    assert.equal(arpaToIpa(['N', 'IH1', 'R'], { dialect: 'gb', spelling: 'near' }), 'nˈiə');
    assert.equal(arpaToIpa(['P', 'Y', 'UH1', 'R'], { dialect: 'gb', spelling: 'pure' }), 'pjˈʊə');
  });

  test('GOAT, TRAP and unstressed -er are the British vowels', () => {
    assert.equal(arpaToIpa(['G', 'OW1'], { dialect: 'gb', spelling: 'go' }), 'ɡˈəʊ');
    assert.equal(arpaToIpa(['DH', 'AE1', 'T'], { dialect: 'gb', spelling: 'that' }), 'ðˈat');
    assert.equal(arpaToIpa(['L', 'EH1', 'T', 'ER0'], { dialect: 'gb', spelling: 'letter' }), 'lˈɛtə');
  });

  test('the LOT vowel is decided by the spelling, which is the only place cmudict keeps it', () => {
    assert.equal(arpaToIpa(['D', 'AO1', 'G'], { dialect: 'gb', spelling: 'dog' }), 'dˈɒɡ');
    assert.equal(arpaToIpa(['F', 'AA1', 'K', 'S'], { dialect: 'gb', spelling: 'fox' }), 'fˈɒks');
    // `dawn` and `father` are spelled with an `a`, so they keep their long vowel...
    assert.equal(arpaToIpa(['D', 'AO1', 'N'], { dialect: 'gb', spelling: 'dawn' }), 'dˈɔːn');
    assert.equal(arpaToIpa(['F', 'AA1', 'DH', 'ER0'], { dialect: 'gb', spelling: 'father' }), 'fˈɑːðə');
    // ...and so does `more`, where the /r/ is what rules the LOT vowel out.
    assert.equal(arpaToIpa(['M', 'AO1', 'R'], { dialect: 'gb', spelling: 'more' }), 'mˈɔː');
  });

  test('the yod comes back where the spelling says it belongs', () => {
    assert.equal(arpaToIpa(['N', 'UW1'], { dialect: 'gb', spelling: 'new' }), 'njˈuː');
    assert.equal(arpaToIpa(['T', 'UW1', 'N'], { dialect: 'gb', spelling: 'tune' }), 'tjˈuːn');
    // `two`, `do` and `noon` are the same consonant and vowel with no yod, ever.
    assert.equal(arpaToIpa(['T', 'UW1'], { dialect: 'gb', spelling: 'two' }), 'tˈuː');
    assert.equal(arpaToIpa(['N', 'UW1', 'N'], { dialect: 'gb', spelling: 'noon' }), 'nˈuːn');
  });

  test('British English does not flap', () => {
    assert.equal(arpaToIpa(['W', 'AO1', 'T', 'ER0'], { dialect: 'gb', spelling: 'water' }), 'wˈɔːtə');
  });
});
