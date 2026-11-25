// The whole frontend, end to end, over the SHIPPED dictionary: text in, the IPA Kokoro's
// tokenizer sees out.
//
// The expectations are eSpeak-NG's own output for the same text, captured before the
// GPL-3.0 dependency was removed (#1092). They are the record that swapping the phonemizer
// did not change what the model is asked to say — which is the only thing that decides
// whether the voices still sound like themselves.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phonemizeWith } from './voicePhonemize.js';
import { parseLexicon } from '../g2p/lexicon.js';

const ASSET = join(dirname(fileURLToPath(import.meta.url)), '../../../public/voice/lexicon.txt.gz');
const lexicon = parseLexicon(gunzipSync(readFileSync(ASSET)).toString('utf8'));

const us = (text: string): string => phonemizeWith(text, lexicon, 'a');
const gb = (text: string): string => phonemizeWith(text, lexicon, 'b');

describe('phonemizeWith', () => {
  test('a plain sentence', () => {
    assert.equal(
      us('The quick brown fox jumps over the lazy dog.'),
      'ðə kwˈɪk bɹˈaʊn fˈɑːks dʒˈʌmps ˈoʊvɚ ðə lˈeɪzi dˈɔːɡ.',
    );
  });

  test('keeps the punctuation, which is what the model renders as phrasing', () => {
    const ipa = us('Wait, really? Yes!');
    assert.match(ipa, /,/);
    assert.match(ipa, /\?/);
    assert.match(ipa, /!$/);
  });

  // eSpeak read numbers, dates and money itself. A dictionary cannot, and an unread digit
  // is silence in the middle of a sentence.
  test('reads numbers, money, ordinals and clock times aloud', () => {
    const ipa = us('Dr. Chen paid $5.50 on the 21st of March 1985 at 9:30.');
    for (const fragment of [
      'dˈɑːktɚ', // Doctor
      'fˈaɪv', // five
      'sˈɛnts', // cents
      'twˈɛnti fˈɜːst', // twenty first
      'nˈaɪntˈiːn', // nineteen
    ]) {
      assert.match(ipa, new RegExp(fragment), `${fragment} missing from ${ipa}`);
    }
    assert.equal(/\d/.test(ipa), false, 'a digit reached the model');
  });

  test('never leaves a digit for the tokenizer', () => {
    for (const text of ['100% of 3 users', 'v2.1 released', 'call 555-0134', 'ID: XJ7']) {
      assert.equal(/[0-9]/.test(us(text)), false, text);
    }
  });

  test('an unknown word still gets said, not dropped', () => {
    const ipa = us('Kimtos ships Zorbly today.');
    assert.equal(ipa.split(' ').length >= 4, true, ipa);
  });

  test('British English is non-rhotic and uses its own vowels', () => {
    const ipa = gb('The quick brown fox jumps over the lazy dog.');
    assert.match(ipa, /fˈɒks/);
    assert.match(ipa, /ˈəʊvə/);
    assert.equal(ipa.includes('ɚ'), false, 'an American r-coloured vowel reached a British voice');
  });

  test('empty input is empty output, not an exception', () => {
    assert.equal(us(''), '');
    assert.equal(us('   '), '');
  });

  test('with no dictionary the letter rules still produce speech', () => {
    assert.equal(phonemizeWith('hello there', null, 'a').length > 0, true);
  });

  // The strongest guarantee this file can make. Kokoro's tokenizer maps characters, and
  // silently drops anything outside its 115-symbol vocabulary — most notoriously ASCII
  // `g`, which is NOT in it (U+0261 SCRIPT G is), so a single wrong character makes every
  // hard g in the clip vanish with no error anywhere. The set below is the `model.vocab`
  // of onnx-community/Kokoro-82M-v1.0-ONNX's tokenizer.json.
  test('every character it emits is in the model vocabulary', () => {
    const VOCAB = new Set([
      ...'$;:,.!?—…"()“” \u0303ʣʥʦʨᵝꭧAIOQSTW Yᵊ',
      ...'abcdefhijklmnopqrstuvwxyz',
      ...'ɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪʝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔ',
      ...'ˈˌːʰʲ↓→↗↘ᵻ',
    ]);
    const ipa = us('The eight geese догоняли a big garage in Glasgow, 40% of them.');
    const strays = [...ipa].filter((c) => !VOCAB.has(c));
    assert.deepEqual(strays, [], `characters Kokoro would drop: ${strays.join('')}`);
    assert.equal(ipa.includes('g'), false, 'ASCII g reached the tokenizer');
  });
});
