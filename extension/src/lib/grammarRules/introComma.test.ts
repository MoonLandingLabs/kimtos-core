// The intro-comma rule (#286): a conjunctive adverb opening a sentence takes a comma.
// The whole point is NO false positives, so the negative cases matter more than the positive.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ruleIssues } from './index.js';

const commas = (t: string) => ruleIssues(t).filter((i) => i.label === 'Comma');

describe('intro-comma rule', () => {
  test('flags a conjunctive adverb that opens a sentence', () => {
    for (const [text, word] of [
      ['Also it is slow.', 'Also'],
      ['Additionally the cost is high.', 'Additionally'],
      ['Meanwhile back home things changed.', 'Meanwhile'],
      ['Nevertheless we shipped it.', 'Nevertheless'],
    ] as const) {
      const found = commas(text);
      assert.equal(found.length, 1, `expected one comma issue in "${text}"`);
      assert.equal(found[0].original, word);
      assert.equal(found[0].suggestion, `${word},`);
    }
  });

  test('fires after a sentence boundary, not just at the very start', () => {
    const found = commas('I use it. Therefore it works.');
    assert.equal(found.length, 1);
    assert.equal(found[0].original, 'Therefore');
    // Offsets must point at "Therefore", so applying the fix yields "Therefore, it works".
    const { start, end } = found[0];
    assert.equal('I use it. Therefore it works.'.slice(start, end), 'Therefore');
  });

  test('fires when the pronoun "I" begins the following clause', () => {
    const found = commas('Moreover I agree with that.');
    assert.equal(found.length, 1);
    assert.equal(found[0].original, 'Moreover');
  });

  // --- the false positives the rule must NOT produce ---
  test('does not flag "however" — it is also a manner adverb', () => {
    assert.equal(commas('However you slice it, the answer is the same.').length, 0);
  });

  test('does not double a comma that is already there', () => {
    assert.equal(commas('Also, it is slow.').length, 0);
    assert.equal(commas('Therefore, we shipped it.').length, 0);
  });

  test('does not flag the adverb mid-sentence', () => {
    assert.equal(commas('I think therefore I am.').length, 0);
    assert.equal(commas('The also-ran finished last.').length, 0);
  });

  test('leaves the "also known as" idiom alone', () => {
    assert.equal(commas('Also known as the greatest of all time.').length, 0);
  });

  test('does not fire before a proper noun / title', () => {
    assert.equal(commas('Moreover Inc. shipped it on time.').length, 0);
  });

  test('does not fire when no clause follows', () => {
    assert.equal(commas('Therefore.').length, 0);
    assert.equal(commas('Meanwhile').length, 0);
  });

  test('plain prose stays clean', () => {
    assert.equal(commas('The quick brown fox jumps over the lazy dog.').length, 0);
    assert.equal(commas('She also runs every morning before work.').length, 0);
  });
});
