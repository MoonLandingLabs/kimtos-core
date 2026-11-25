// The letter-to-sound fallback. It only runs for words the 126k-word dictionary does not
// have — names, coinages, typos — so these tests pin the RULES rather than a vocabulary:
// the digraphs, the silent letters, the magic e, where the stress lands and, most
// audibly, that unstressed vowels reduce to schwa instead of being spelled out.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assignStress, ltsPhones, stressedVowelIndex } from './lts.js';
import { arpaToIpa } from './arpabet.js';

const say = (word: string): string => arpaToIpa(ltsPhones(word));

describe('ltsPhones: digraphs and silent letters', () => {
  test('reads the common consonant digraphs', () => {
    assert.deepEqual(ltsPhones('phog'), ['F', 'AA1', 'G']);
    assert.deepEqual(ltsPhones('shan'), ['SH', 'AE1', 'N']);
    assert.deepEqual(ltsPhones('thap'), ['TH', 'AE1', 'P']);
    assert.deepEqual(ltsPhones('chap'), ['CH', 'AE1', 'P']);
    assert.deepEqual(ltsPhones('quan'), ['K', 'W', 'AE1', 'N']);
  });

  test('drops the silent letters English keeps writing', () => {
    // knap, wrast, plimb, thight — the kn-, wr-, -mb and -ght of knee, wrist, limb, night.
    assert.deepEqual(ltsPhones('knap'), ['N', 'AE1', 'P']);
    assert.deepEqual(ltsPhones('wrast'), ['R', 'AE1', 'S', 'T']);
    assert.deepEqual(ltsPhones('plimb'), ['P', 'L', 'IH1', 'M']);
    assert.deepEqual(ltsPhones('thight'), ['TH', 'AY1', 'T']);
  });

  test('a soft c and g go before a front vowel', () => {
    assert.deepEqual(ltsPhones('cint'), ['S', 'IH1', 'N', 'T']);
    assert.deepEqual(ltsPhones('cant'), ['K', 'AE1', 'N', 'T']);
    assert.deepEqual(ltsPhones('ginto'), ['JH', 'IH1', 'N', 'T', 'OW0']);
  });

  test('the magic e lengthens the vowel, inflected or not', () => {
    assert.deepEqual(ltsPhones('drake'), ['D', 'R', 'EY1', 'K']);
    assert.deepEqual(ltsPhones('drakes'), ['D', 'R', 'EY1', 'K', 'S']);
    assert.deepEqual(ltsPhones('vomes'), ['V', 'OW1', 'M', 'Z']);
    assert.deepEqual(ltsPhones('grases'), ['G', 'R', 'EY1', 'S', 'IH0', 'Z']);
    assert.deepEqual(ltsPhones('vome'), ['V', 'OW1', 'M']);
    assert.deepEqual(ltsPhones('vomed'), ['V', 'OW1', 'M', 'D']);
  });

  test('a final -tion and -sion are one syllable', () => {
    assert.deepEqual(ltsPhones('blaction'), ['B', 'L', 'AE1', 'K', 'SH', 'AH0', 'N']);
  });
});

describe('stress', () => {
  test('defaults to the first syllable', () => {
    assert.equal(stressedVowelIndex('flombat'), 0);
  });

  test('a Latinate suffix pulls it back one', () => {
    // `flomBAtion`, `voMAtic` — the syllable in front of the suffix, not the first one.
    assert.equal(stressedVowelIndex('flombation'), 1);
    assert.equal(stressedVowelIndex('vomatic'), 1);
    // A one-syllable stem keeps the stress it already had: `BLACtion`.
    assert.equal(stressedVowelIndex('blaction'), 0);
  });

  test('an unstressed prefix pushes it forward one', () => {
    assert.equal(stressedVowelIndex('remoke'), 1);
  });

  // This is the loudest single difference between a rules-derived pronunciation that
  // sounds like speech and one that sounds like a robot spelling a word out.
  test('every unstressed monophthong reduces to schwa', () => {
    assert.deepEqual(assignStress(['AE1', 'B', 'AE1', 'K'], 'aback'), ['AH0', 'B', 'AE1', 'K']);
  });

  test('but a diphthong, an r-coloured vowel and a final -y keep their quality', () => {
    assert.deepEqual(assignStress(['AE1', 'B', 'L', 'EY1', 'T'], 'ablate'), ['AH0', 'B', 'L', 'EY1', 'T']);
    assert.deepEqual(assignStress(['B', 'AE1', 'K', 'ER1'], 'backer'), ['B', 'AE1', 'K', 'ER0']);
    assert.deepEqual(assignStress(['B', 'AE1', 'K', 'IY1'], 'backy'), ['B', 'AE1', 'K', 'IY0']);
  });
});

describe('what the fallback actually says', () => {
  test('an invented word comes out as pronounceable IPA, not silence', () => {
    for (const word of ['zorbly', 'kimtos', 'flanquist', 'brelvinger']) {
      const ipa = say(word);
      assert.equal(ipa.length > 0, true, word);
      // A stress mark and no ASCII `g` (Kokoro's vocabulary has only U+0261).
      assert.equal(ipa.includes('ˈ'), true, word);
      assert.equal(ipa.includes('g'), false, word);
    }
  });

  test('a word of only unreadable characters yields nothing rather than garbage', () => {
    assert.deepEqual(ltsPhones(''), []);
  });
});
