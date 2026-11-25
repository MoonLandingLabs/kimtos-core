// Typos that are also real words (#1031). The rule engine's flat table rewrote eleven
// ordinary English words on sight, so "He wolfs down his dinner" came back as "He wolves
// down his dinner" — a confident wrong correction from the layer that wins over both the
// speller and the model on overlap, which is worse than no check at all.
//
// As with the intro-comma rule, the NEGATIVE cases are the point: every sentence in the
// first block is valid English and must produce nothing. The positive cases are here so
// the fix is not "delete the entries" — the genuine misspelling is still caught wherever
// a neighbouring word rules the legitimate reading out.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ruleIssues } from './index.js';
import { MISSPELLINGS, CONTEXTUAL_MISSPELLINGS } from './dictionaries.js';

const spelling = (t: string) => ruleIssues(t).filter((i) => i.label === 'Spelling');

/** The one fix this text yields, as "original=>suggestion", or null when it is clean. */
const only = (t: string): string | null => {
  const found = spelling(t);
  assert.ok(found.length <= 1, `${t} → ${found.map((i) => `${i.original}=>${i.suggestion}`).join(', ')}`);
  return found.length ? `${found[0].original}=>${found[0].suggestion}` : null;
};

describe('real words the rule engine used to rewrite', () => {
  // The five sentences the issue was filed with, plus the other six keys it names.
  test('leaves an ordinary sentence alone', () => {
    for (const text of [
      'He wolfs down his dinner every night.',
      'She leafs through the magazine.',
      'The waiter foots the bill.',
      'He knifes the box open.',
      'The cat mouses in the barn.',
      'He mans the desk on Fridays.',
      'The mill uses a calender to press the cloth.',
      'They payed out the rope slowly.',
      'The shepherd sold a wether at market.',
      'It is alright with me.',
      'NAD is a coenzyme.',
    ]) {
      assert.equal(only(text), null, text);
    }
  });

  // The Toronto Maple Leafs are not a spelling mistake, and "the wolfs den" wants an
  // apostrophe, not "wolves" — which is why a/an/the are not plural quantifiers.
  test('leaves a proper noun and a possessive typo alone', () => {
    assert.equal(only('The Maple Leafs are playing tonight.'), null);
    assert.equal(only('We found the wolfs den.'), null);
  });

  // A neighbour on the far side of punctuation is not context.
  test('does not read context across a sentence boundary', () => {
    assert.equal(only('I payed. For the record, it went fine.'), null);
  });
});

describe('the same words when they really are misspelled', () => {
  test('an irregular plural after a plural quantifier is still fixed', () => {
    for (const [text, want] of [
      ['Two knifes were missing.', 'knifes=>knives'],
      ['These leafs are dry.', 'leafs=>leaves'],
      ['The pack had several wolfs.', 'wolfs=>wolves'],
      ['There were three mans in the room.', 'mans=>men'],
      ['We ordered two mouses for the office.', 'mouses=>mice'],
      ['The statue is six foots tall.', 'foots=>feet'],
    ] as const) {
      assert.equal(only(text), want, text);
    }
  });

  test('wether is fixed where the conjunction is introduced', () => {
    assert.equal(only('I do not know wether to go.'), 'wether=>whether');
    assert.equal(only('It depends on wether we win.'), 'wether=>whether');
  });

  test('payed is fixed in ordinary prose but not in the nautical sense', () => {
    assert.equal(only('I payed for the tickets.'), 'payed=>paid');
    assert.equal(only('She payed him twice.'), 'payed=>paid');
    assert.equal(only('The crew payed out more line.'), null);
  });

  test('carries the original capitalization over', () => {
    assert.equal(only('Two Knifes were missing.'), 'Knifes=>Knives');
  });

  // The gated table is an addition, not a replacement: the unconditional one still fires.
  test('the unconditional table is untouched', () => {
    const found = spelling('I recieved teh package.');
    assert.deepEqual(
      found.map((i) => `${i.original}=>${i.suggestion}`),
      ['recieved=>received', 'teh=>the'],
    );
    assert.equal(only('We must accomodate them.'), 'accomodate=>accommodate');
  });
});

describe('the two tables stay well formed', () => {
  test('every gated entry names a neighbour set that is not empty', () => {
    for (const [typo, entry] of Object.entries(CONTEXTUAL_MISSPELLINGS)) {
      assert.ok(entry.context.size > 0, `${typo} has an empty gate, so it can never fire`);
      assert.notEqual(entry.fix, typo, `${typo} rewrites to itself`);
      assert.ok(!entry.context.has(typo), `${typo} gates on itself`);
    }
  });

  test('the eleven words from the issue are gone from the unconditional table', () => {
    for (const word of [
      'calender',
      'payed',
      'wether',
      'alright',
      'mans',
      'mouses',
      'foots',
      'knifes',
      'leafs',
      'wolfs',
      'nad',
    ]) {
      assert.ok(!(word in MISSPELLINGS), `${word} is rewritten on sight again`);
    }
  });
});
