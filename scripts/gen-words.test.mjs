// The derivation rules behind extension/public/words.txt (#961).
//
// The shipped list is asserted by extension/src/lib/spellcheck.dictionary.test.ts; these
// tests cover the pure functions that PRODUCE it, which that test cannot reach — the file
// selection, the case and accent folding, and the frequency ordering. They are the reason
// the next regeneration behaves the same as this one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCuratedFile, curatedSet, isCurated, rankedWords, pickWords, parseFixture, MAX_SIZE } from './gen-words.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('isCuratedFile', () => {
  test('takes every dialect and category up to the trusted size', () => {
    for (const name of [
      'english-words.10',
      'american-words.70',
      'british_variant_1-words.55',
      'english-proper-names.50',
      'english-abbreviations.35',
      'australian-contractions.35',
      'american-upper.60',
    ]) {
      assert.equal(isCuratedFile(name), true, name);
    }
  });

  test('drops the sizes that reintroduce misspellings', () => {
    assert.equal(MAX_SIZE, 70);
    assert.equal(isCuratedFile('english-words.80'), false);
    assert.equal(isCuratedFile('english-words.95'), false);
  });

  // The bare `variant_2-words.50` spelling is the one an anchor-on-underscore regex misses,
  // which quietly pulled 2,300 seldom-used and questionable spellings into the curated set.
  test('drops seldom-used and questionable variants, dialect-prefixed or not', () => {
    for (const name of [
      'variant_2-words.50',
      'variant_3-words.50',
      'british_variant_2-words.50',
      'australian_variant_3-abbreviations.40',
    ]) {
      assert.equal(isCuratedFile(name), false, name);
    }
    assert.equal(isCuratedFile('variant_1-words.50'), true);
  });

  test('ignores anything that is not a SCOWL final list', () => {
    for (const name of ['README', 'Copyright', 'l.dir', 'english-words'])
      assert.equal(isCuratedFile(name), false, name);
  });
});

describe('curatedSet', () => {
  const set = curatedSet([
    ['english-words.35', 'house\ncafé\nnaïve\n'],
    ['english-proper-names.50', 'January\n'],
    ['english-words.95', 'wich\n'], // untrusted size — must not enter
    ['README', 'teh\n'],
  ]);

  test('keeps only the curated files', () => {
    assert.equal(set.has('wich'), false);
    assert.equal(set.has('teh'), false);
    assert.equal(set.has('house'), true);
  });

  // SCOWL spells these only with their accents, but the shipped list is ASCII: the speller
  // skips any token carrying a non-ASCII letter whole (#642), so it can only ever look up
  // `cafe`. Without the fold it would "correct" one of the commonest loanwords in English.
  test('also admits the ASCII spelling of an accented word', () => {
    assert.equal(set.has('café'), true);
    assert.equal(set.has('cafe'), true);
    assert.equal(set.has('naive'), true);
  });

  test('a lowercase token matches a proper name or an initialism', () => {
    assert.equal(isCurated(set, 'january'), true);
    assert.equal(isCurated(set, 'house'), true);
    assert.equal(isCurated(set, 'langauge'), false);
  });

  // A `\r` welded to every entry is a dictionary that matches nothing, and the list this
  // one replaces came from a CRLF source — so the parser must not assume LF.
  test('survives a CRLF source', () => {
    const crlf = curatedSet([['english-words.35', 'house\r\ncafé\r\n']]);
    assert.equal(crlf.has('house'), true);
    assert.equal(crlf.has('cafe'), true);
  });
});

describe('rankedWords', () => {
  test('keeps the frequency order and only plain a-z words', () => {
    const counts = 'the\t100\nof\t90\nu.s.\t80\n1999\t70\nnaïve\t60\nhouse\t50\n\n';
    assert.deepEqual(rankedWords(counts), ['the', 'of', 'house']);
  });
});

describe('pickWords', () => {
  const curated = new Set(['the', 'house', 'January', 'cafe']);

  test('takes the most frequent curated words, in order, up to the limit', () => {
    const ranked = ['the', 'teh', 'house', 'january', 'cafe'];
    assert.deepEqual(pickWords(ranked, curated, 3), ['the', 'house', 'january']);
  });

  test('never repeats a word', () => {
    assert.deepEqual(pickWords(['the', 'the', 'house'], curated, 10), ['the', 'house']);
  });
});

describe('the known-misspellings fixture', () => {
  const text = readFileSync(join(ROOT, 'extension/src/lib/data/known-misspellings.txt'), 'utf8');

  test('parses to plain lowercase words, comments and blanks dropped', () => {
    const fixture = parseFixture(text);
    assert.ok(fixture.length >= 150);
    assert.deepEqual(
      fixture.filter((w) => !/^[a-z]+$/.test(w)),
      [],
    );
    assert.equal(new Set(fixture).size, fixture.length, 'the fixture repeats a word');
  });

  test('parseFixture ignores comments and blank lines', () => {
    assert.deepEqual(parseFixture('# a comment\n\n  wich  \nteh\n'), ['wich', 'teh']);
  });
});
