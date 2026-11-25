// Numbers, ordinals, symbols, initialisms and function words — the cases eSpeak-NG used
// to handle implicitly and that a dictionary lookup does not. They are not cosmetic: a
// digit the dictionary cannot find and the letter rules cannot read is SILENCE in the
// middle of a sentence, which is exactly the failure the Voice Studio acceptance bar
// (#60) is written against.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { digitsToWords, expandSpokenForms, ordinalWords, wordPhones } from './english.js';
import { parseLexicon, type Lexicon } from './lexicon.js';

// A hand-written fixture rather than the shipped 767 KB asset, so these tests state what
// the code does and not what cmudict happens to contain. The encoding is the asset's own:
// one character per phone, `0x21 + index into the header's code list`.
const ALPHABET = ['AH0', 'AE1', 'IY1', 'T', 'D', 'G', 'K', 'B', 'Z'];
const encode = (phones: string[]): string =>
  phones.map((p) => String.fromCharCode(0x21 + ALPHABET.indexOf(p))).join('');
const lexicon: Lexicon = parseLexicon(
  [
    `# codes\t${ALPHABET.join(' ')}`,
    `to\t${encode(['T', 'AH0'])}`,
    `cat\t${encode(['K', 'AE1', 'T'])}`,
    `dog\t${encode(['D', 'AH0', 'G'])}`,
    `a.\t${encode(['AE1'])}`,
    `b.\t${encode(['B', 'IY1'])}`,
  ].join('\n'),
);

describe('digitsToWords', () => {
  test('reads a quantity as a quantity', () => {
    assert.equal(digitsToWords('0'), 'zero');
    assert.equal(digitsToWords('7'), 'seven');
    assert.equal(digitsToWords('42'), 'forty two');
    assert.equal(digitsToWords('118'), 'one hundred eighteen');
    assert.equal(digitsToWords('2500'), 'two thousand five hundred');
    assert.equal(digitsToWords('1000000'), 'one million');
  });

  test('reads an identifier digit by digit', () => {
    // A leading zero is never a quantity.
    assert.equal(digitsToWords('007'), 'zero zero seven');
    assert.equal(
      digitsToWords('5551234567890123456789'),
      'five five five one two three four five six seven eight nine zero one two three four five six seven eight nine',
    );
  });
});

describe('ordinalWords', () => {
  test('handles the irregular stems and the regular ones', () => {
    assert.equal(ordinalWords('1'), 'first');
    assert.equal(ordinalWords('2'), 'second');
    assert.equal(ordinalWords('3'), 'third');
    assert.equal(ordinalWords('4'), 'fourth');
    assert.equal(ordinalWords('12'), 'twelfth');
    assert.equal(ordinalWords('21'), 'twenty first');
    assert.equal(ordinalWords('40'), 'fortieth');
  });
});

describe('expandSpokenForms', () => {
  test('turns digits and ordinals into words', () => {
    assert.match(expandSpokenForms('It is 42 today'), /forty two/);
    assert.match(expandSpokenForms('the 3rd of May'), /third/);
  });

  test('speaks the symbols a reader speaks', () => {
    assert.match(expandSpokenForms('90% done'), /ninety percent/);
    assert.match(expandSpokenForms('tea & coffee'), /tea and coffee/);
    assert.match(expandSpokenForms('2 + 2 = 4'), /two plus two equals four/);
  });

  test('leaves ordinary words alone', () => {
    assert.equal(expandSpokenForms('hello world'), 'hello world');
  });
});

describe('wordPhones', () => {
  test('prefers the dictionary', () => {
    assert.deepEqual(wordPhones('cat', lexicon), ['K', 'AE1', 'T']);
  });

  test('is case-insensitive for the lookup', () => {
    assert.deepEqual(wordPhones('CAT', lexicon), wordPhones('cat', lexicon));
  });

  test('reduces a function word instead of using its citation form', () => {
    // `to` is one of the few whose reduced vowel is a different vowel.
    assert.deepEqual(wordPhones('to', lexicon), ['T', 'AH0']);
  });

  test('spells an initialism the dictionary does not have, letter by letter', () => {
    assert.deepEqual(wordPhones('AB', lexicon), ['AE1', 'B', 'IY1']);
    // Lowercase is a word, not an initialism, so it falls through to the rules.
    assert.notDeepEqual(wordPhones('ab', lexicon), ['AE1', 'B', 'IY1']);
  });

  test('falls back to the letter rules for a word nothing knows', () => {
    const phones = wordPhones('Zorbly', lexicon);
    assert.equal(phones.length > 0, true);
    assert.equal(phones[0], 'Z');
  });

  test('works with no dictionary at all', () => {
    assert.equal(wordPhones('cat', null).length > 0, true);
  });

  test('an empty token is silent, not an error', () => {
    assert.deepEqual(wordPhones('', lexicon), []);
  });
});
