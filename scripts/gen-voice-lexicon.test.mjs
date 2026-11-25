// The derivation rules behind extension/public/voice/lexicon.txt.gz (#1092).
//
// The shipped asset is asserted by extension/src/lib/g2p/lexicon.test.ts; these tests
// cover the pure functions that PRODUCE it, which that test cannot reach — the parse, the
// filtering, and the self-describing encoding. The script runs once in a blue moon and
// these run on every PR, so they are what makes the next regeneration behave like this one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { codeOf, encodeLexicon, isShippableWord, parseCmudict, phoneAlphabet } from './gen-voice-lexicon.mjs';

describe('parseCmudict', () => {
  test('reads word and phones, dropping the trailing comment', () => {
    assert.deepEqual(parseCmudict('aalborg AO1 L B AO0 R G # place, danish'), [
      ['aalborg', ['AO1', 'L', 'B', 'AO0', 'R', 'G']],
    ]);
  });

  test('keeps the first pronunciation and drops the alternates', () => {
    const entries = parseCmudict(['read R IY1 D', 'read(2) R EH1 D'].join('\n'));
    assert.deepEqual(entries, [['read', ['R', 'IY1', 'D']]]);
  });

  test('skips blank lines and entries with no phones', () => {
    assert.deepEqual(parseCmudict('\n\n   \nhi HH AY1\n'), [['hi', ['HH', 'AY1']]]);
  });
});

describe('isShippableWord', () => {
  test('takes the words and abbreviations a reader can type', () => {
    for (const word of ['cat', "cat's", 'a.', 'well-known', 'pronunciation']) {
      assert.equal(isShippableWord(word), true, word);
    }
  });

  // cmudict is a speech-RECOGNITION lexicon; these cost bytes in the crx and can never be
  // looked up, because the frontend's tokenizer cannot produce them.
  test('drops what the frontend can never look up', () => {
    for (const word of ['!exclamation-point', '3d', '', 'a'.repeat(40)]) {
      assert.equal(isShippableWord(word), false, JSON.stringify(word));
    }
  });
});

describe('encodeLexicon', () => {
  test('the alphabet covers every cmudict phone, stress digits included', () => {
    const alphabet = phoneAlphabet();
    assert.equal(alphabet.length, 15 * 3 + 24);
    for (const phone of ['AA0', 'AA1', 'AA2', 'ZH', 'NG', 'HH']) assert.equal(alphabet.includes(phone), true, phone);
  });

  test('codes are printable ASCII, so the file stays text', () => {
    for (let i = 0; i < phoneAlphabet().length; i += 1) {
      const c = codeOf(i);
      assert.equal(c >= '!' && c <= '~', true, `code ${i} is ${JSON.stringify(c)}`);
    }
  });

  // A runtime table and a generator table that had to agree by hand would be one more
  // thing to drift; the header IS the agreement.
  test('the header carries the alphabet the decoder needs', () => {
    const text = encodeLexicon([['hi', ['HH', 'AY1']]], { commit: 'deadbeef' });
    const codes = text.split('\n').find((l) => l.startsWith('# codes\t'));
    assert.equal(codes?.slice('# codes\t'.length), phoneAlphabet().join(' '));
    assert.match(text, /# commit\tdeadbeef/);
    assert.match(text, /BSD-2-Clause/);
    assert.match(text, /THIRD-PARTY-NOTICES/);
  });

  test('an entry round-trips through the encoding', () => {
    const alphabet = phoneAlphabet();
    const text = encodeLexicon([['hi', ['HH', 'AY1']]]);
    const encoded =
      text
        .split('\n')
        .find((l) => l.startsWith('hi\t'))
        ?.slice(3) ?? '';
    const decoded = [...encoded].map((c) => alphabet[c.charCodeAt(0) - 0x21]);
    assert.deepEqual(decoded, ['HH', 'AY1']);
  });

  // Encoding an unknown phone as something else would mispronounce a word silently.
  test('refuses a phone the alphabet does not cover', () => {
    assert.throws(() => encodeLexicon([['x', ['QQ']]]), /unknown ARPAbet phone/);
  });
});
