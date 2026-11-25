// Phrases that are also valid English (#1051). The flat PHRASES table rewrote its keys
// on sight, and several had a legitimate reading, so textbook-correct sentences came
// back wrong: "If I were you" became "If I was you" (breaking the subjunctive), "Does
// he have a car?" became "Does he has a car?", and "married with two kids" became
// "married to two kids" — from the layer that wins over both the speller and the model.
//
// The fix follows realWords.test.ts one level up, and this file is the guard that keeps
// it fixed. The fixture data/phrase-readings.txt is the review the table used to take
// on trust: every flat key must be declared `never:` (no valid English reading), every
// gated key must appear in a fixture sentence that stays clean (its gate, proven), and
// every fixture sentence must come back untouched. A bad new entry fails here instead
// of shipping.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ruleIssues } from './index.js';
import { PHRASES, CONTEXTUAL_PHRASES } from './dictionaries.js';

const raw = readFileSync(new URL('./data/phrase-readings.txt', import.meta.url), 'utf8');
const lines = raw
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const NEVER = new Set(lines.filter((l) => l.startsWith('never:')).map((l) => l.slice('never:'.length).trim()));
const SENTENCES = lines.filter((l) => !l.startsWith('never:'));

/** Word-boundary matcher for a phrase key, spaces matching any whitespace run. */
const keyRe = (key: string): RegExp =>
  new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'i');

/** Every fix this text yields, as "original=>suggestion". */
const fixes = (t: string): string[] => ruleIssues(t).map((i) => `${i.original}=>${i.suggestion}`);

describe('the fixture of valid English', () => {
  test('every sentence comes back completely clean', () => {
    for (const sentence of SENTENCES) {
      assert.deepEqual(fixes(sentence), [], sentence);
    }
  });

  // A fixture this guard trusts is worth nothing if it quietly shrinks.
  test('is not trivially small', () => {
    assert.ok(SENTENCES.length >= 35, `only ${SENTENCES.length} sentences`);
    assert.ok(NEVER.size >= 25, `only ${NEVER.size} never-valid declarations`);
  });

  test('covers the sentences the issue was filed with', () => {
    for (const sentence of [
      'If I were you, I would go.',
      'I wish I were taller.',
      'If it were up to me, we would ship.',
      'He is married with two kids.',
    ]) {
      assert.ok(SENTENCES.includes(sentence), `${sentence} is missing from the fixture`);
    }
  });
});

describe('the review contract', () => {
  test('every unconditional phrase is declared never-valid in the fixture', () => {
    const undeclared = Object.keys(PHRASES).filter((key) => !NEVER.has(key));
    assert.deepEqual(undeclared, [], 'declare each in phrase-readings.txt, gate it, or leave it out');
  });

  test('every never-valid declaration matches a live entry', () => {
    const stale = [...NEVER].filter((key) => !(key in PHRASES));
    assert.deepEqual(stale, [], 'these declarations no longer match a PHRASES key');
  });

  test('every gated phrase has a fixture sentence proving its valid reading', () => {
    const unproven = Object.keys(CONTEXTUAL_PHRASES).filter((key) => !SENTENCES.some((s) => keyRe(key).test(s)));
    assert.deepEqual(unproven, [], 'add a clean sentence containing each — that is the only reason to gate');
  });

  test('the two tables are disjoint, and a gated key is never declared never-valid', () => {
    const both = Object.keys(CONTEXTUAL_PHRASES).filter((key) => key in PHRASES || NEVER.has(key));
    assert.deepEqual(both, [], 'the unconditional entry would win and the gate would never run');
  });

  test('every gated entry is well formed', () => {
    for (const [key, entry] of Object.entries(CONTEXTUAL_PHRASES)) {
      assert.ok(entry.words.size > 0, `${key} has an empty gate`);
      assert.notEqual(entry.fix.toLowerCase(), key, `${key} rewrites to itself`);
      if (entry.blockCapitalized) {
        assert.equal(entry.mode, 'block', `${key}: blockCapitalized widens a gate, so it is block-mode only`);
        assert.equal(entry.gate, 'before', `${key}: only the preceding word can be a Capitalized head`);
      }
    }
  });
});

describe('the mistakes are still caught', () => {
  test('flat agreement and comparative fixes are untouched', () => {
    for (const [text, want] of [
      ['They is coming tomorrow.', 'They is=>They are'],
      ['We was there last night.', 'We was=>We were'],
      ['You was right.', 'You was=>You were'],
      ['He dont care.', "He dont=>He doesn't"],
      ['This is more better than before.', 'more better than=>better than'],
    ] as const) {
      assert.deepEqual(fixes(text), [want], text);
    }
  });

  test('the I-agreement errors survive the numeral guard', () => {
    for (const [text, want] of [
      ['I is happy.', 'I is=>I am'],
      ['I are ready.', 'I are=>I am'],
      ['I has a car.', 'has=>have'],
      ['I does it every day.', 'does=>do'],
    ] as const) {
      assert.deepEqual(fixes(text), [want], text);
    }
  });

  // A coordinated subject conjugates as a plural, so "and I are" is correct English
  // and the error "and I is" wants "are" — a fix the 'I am' entry cannot offer.
  // Holding fire beats offering the wrong correction.
  test('the I-agreement gate holds fire after a coordinating conjunction', () => {
    assert.deepEqual(fixes('My family and I are happy.'), []);
    assert.deepEqual(fixes('You and I are friends.'), []);
    assert.deepEqual(fixes('My family and I is happy.'), []);
  });

  test('the he/she/it agreement errors now come from the conjugator, aux-guarded', () => {
    assert.deepEqual(fixes('He have a car.'), ['have=>has']);
    assert.deepEqual(fixes('She have kids.'), ['have=>has']);
    assert.deepEqual(fixes('Does he have a car?'), []);
  });

  test('say/tell and explain fire where the complement forces the error reading', () => {
    for (const [text, want] of [
      ['He said me that he was tired.', 'said me=>told me'],
      ['She said them everything about the trip.', 'said them=>told them'],
      ['He said her that he was leaving.', 'said her=>told her'],
      ['He said him where to park.', 'said him=>told him'],
      ['Explain me the rules again.', 'Explain me=>Explain to me'],
    ] as const) {
      assert.deepEqual(fixes(text), [want], text);
    }
  });

  test('the block gates fire everywhere outside their idiom', () => {
    for (const [text, want] of [
      ['There is many reasons to stay.', 'There is many=>There are many'],
      ['There was many people at the party.', 'There was many=>There were many'],
      ['It depends of the weather.', 'depends of=>depends on'],
      ['These results depend of the context.', 'depend of=>depend on'],
    ] as const) {
      assert.deepEqual(fixes(text), [want], text);
    }
  });
});

describe('the deliberate misses', () => {
  // Dropped rather than gated: no one-word neighbour test separates these from valid
  // English, and a silent miss beats a confident wrong correction. The optional deep
  // grammar model is the layer for them.
  test('the dropped entries are gone from both tables', () => {
    for (const key of [
      'i were',
      'he were',
      'she were',
      'it were',
      'i has',
      'i does',
      'he have',
      'she have',
      'it have',
      'people is',
      'people was',
      'much people',
      'much things',
      'much times',
      'less people',
      'less things',
      'less books',
      'married with',
      'discuss about',
      'good in english',
    ]) {
      assert.ok(!(key in PHRASES), `${key} is rewritten on sight again`);
      assert.ok(!(key in CONTEXTUAL_PHRASES), `${key} was reviewed as ungateable — see #1051 before re-gating`);
    }
  });

  test('the ungateable errors now pass silently', () => {
    for (const text of ['He were late yesterday.', 'She is married with John.', 'We need to discuss about it.']) {
      assert.deepEqual(fixes(text), [], text);
    }
  });
});
