// The shipped dictionary itself (#961) — not the speller's logic, the DATA it trusts.
//
// `spellIssues` treats public/words.txt as the definition of a real word: an entry in it
// is never underlined, and IS offered as a correction for a near miss. The list used to be
// derived by intersecting a web-crawl frequency list with another web-scraped word list,
// so a misspelling frequent enough to appear in both shipped as a dictionary word. Twenty-
// nine of the classic English misspellings did — `langauge`, `accomodate`, `enviroment`,
// `untill`, `wich` among them. A user who typed `langauge` got no underline at all, and
// `langauges` was "corrected" to `langauge`: one misspelling replaced by another.
//
// The list is now derived from SCOWL, a curated dictionary (scripts/gen-words.mjs). This
// file is the assert that keeps it that way. The generator runs once in a blue moon and
// needs the network; these tests run on every PR and need neither, so THIS is the guard —
// a regenerated list that reintroduces a misspelling, or that buys its cleanliness by
// dropping ordinary words, fails here.
//
// It lives in its own file because `loadSpeller` memoizes one dictionary per module
// instance and spellcheck.test.ts loads a ten-word stub; the runner gives each test file
// its own process, so both can coexist (the perf test does the same).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MISSPELLINGS, CONTEXTUAL_MISSPELLINGS } from './grammarRules/dictionaries.js';
import { ruleIssues } from './grammarRules/index.js';
import type { SpellIssue } from './spellcheck.js';

const DICTIONARY = readFileSync(new URL('../../public/words.txt', import.meta.url), 'utf8');
const WORDS = DICTIONARY.split('\n').filter(Boolean);
const KNOWN = new Set(WORDS);

/** The fixture of words that are only ever a misspelling — the same file gen-words.mjs
 *  refuses to write a list containing, so there is one list, not two. */
const FIXTURE = readFileSync(new URL('./data/known-misspellings.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

let spell: (text: string) => SpellIssue[];
const realFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = (async () => new Response(DICTIONARY)) as typeof fetch;
  const { loadSpeller } = await import('./spellcheck.js');
  spell = await loadSpeller();
});
after(() => {
  globalThis.fetch = realFetch; // never leave a global stubbed behind
});

describe('the shipped dictionary', () => {
  test('is 60,000 unique lowercase words, most frequent first', () => {
    assert.equal(WORDS.length, 60000);
    assert.equal(KNOWN.size, WORDS.length, 'the list contains a duplicate');
    const odd = WORDS.filter((w) => !/^[a-z]+$/.test(w));
    assert.deepEqual(odd, [], 'the speller only ever looks up [a-z]+');
    // Line order IS the frequency rank — `suggest` sorts candidates by it. An alphabetical
    // or otherwise re-sorted list would still pass every other test here and quietly rank
    // every suggestion wrong, so assert the order, not just the contents.
    assert.equal(WORDS[0], 'the');
    const common = WORDS.indexOf('house');
    const rare = WORDS.indexOf('houseboat');
    assert.ok(common !== -1 && rare !== -1, 'the ordering probe words are no longer in the list');
    assert.ok(common < rare, `house ranks ${common}, houseboat ${rare} — the list is not frequency-ordered`);
    assert.ok(DICTIONARY.endsWith('\n'));
  });

  test('contains no known misspelling', () => {
    const leaked = FIXTURE.filter((word) => KNOWN.has(word));
    assert.deepEqual(leaked, [], 'these are misspellings the speller would never flag, and would suggest');
  });

  // The fixture is worth nothing if it is empty or drifts to a handful of entries.
  test('the fixture covers the misspellings this bug was filed for', () => {
    assert.ok(FIXTURE.length >= 150, `fixture has only ${FIXTURE.length} entries`);
    for (const word of ['langauge', 'accomodate', 'enviroment', 'untill', 'wich']) {
      assert.ok(FIXTURE.includes(word), `${word} is missing from the fixture`);
    }
  });

  // A dictionary can be made misspelling-free by simply being tiny, which trades a silent
  // miss for a loud false positive. These must stay known: everyday English, British
  // spellings, proper nouns (checked lowercased at a sentence start), and the loanwords
  // SCOWL only spells with their accents.
  test('still knows ordinary English', () => {
    const required = [
      'because',
      'people',
      'through',
      'thought',
      'business',
      'government',
      'necessary',
      'separate',
      'receive',
      'environment',
      'language',
      'accommodate',
      'until',
      'which',
      'colour',
      'favourite',
      'organisation',
      'theatre',
      'defence',
      'centre',
      'programme',
      'january',
      'february',
      'wednesday',
      'america',
      'london',
      'canada',
      'europe',
      'cafe',
      'resume',
      'naive',
      'fiance',
      'cliche',
      'facade',
      'debut',
      'website',
      'email',
      'password',
      'download',
      'browser',
      'toolbar',
      'checkbox',
    ];
    const missing = required.filter((word) => !KNOWN.has(word));
    assert.deepEqual(missing, [], 'dropping real words trades a silent miss for a false positive');
  });

  test('flags nothing in ordinary prose', () => {
    const prose = [
      'The committee accommodated their separate requests until the environment improved.',
      'Colour, favourite, organisation, theatre and defence are British spellings.',
      'January in America is cold, and Wednesday is the busiest day of the week.',
      'She wrote a receipt, received the parcel, and definitely remembered the address.',
    ];
    for (const line of prose) assert.deepEqual(spell(line), [], line);
  });
});

describe('the misspellings the old list hid (#961)', () => {
  // Each of these was IN the shipped dictionary, so it was never underlined.
  test('are flagged, with the correct spelling suggested first', () => {
    for (const [text, original, want] of [
      ['I speak your langauge', 'langauge', 'language'],
      ['many langauges here', 'langauges', 'languages'],
      ['we must accomodate them', 'accomodate', 'accommodate'],
      ['a clean enviroment', 'enviroment', 'environment'],
      ['wait untill later', 'untill', 'until'],
    ] as const) {
      const found = spell(text);
      assert.equal(found.length, 1, text);
      assert.equal(found[0].original, original);
      assert.equal(found[0].suggestion, want, text);
    }
  });

  // `wich` is the one the rule engine also owns. Grammit merges the two layers with rules
  // winning on overlap, so the speller only has to stop calling it a word and offer the
  // right correction somewhere in its list; the precise fix comes from the rule table.
  test('wich is flagged by the speller and corrected by the rule engine', () => {
    const found = spell('The book wich you read');
    assert.equal(found.length, 1);
    assert.equal(found[0].original, 'wich');
    assert.ok(found[0].suggestions.includes('which'), found[0].suggestions.join('/'));
    assert.equal(ruleIssues('The book wich you read').find((i) => i.original === 'wich')?.suggestion, 'which');
  });

  // The second half of the bug: a misspelling in the dictionary is a CANDIDATE, so the
  // speller offered it as a fix for a near miss. Nothing it suggests may be a misspelling.
  test('are never offered as a suggestion', () => {
    const banned = new Set(FIXTURE);
    for (const text of ['langauges', 'enviroments', 'accomodates', 'untille', 'wiche', 'recieves', 'seperatly']) {
      for (const suggestion of spell(`I saw ${text} here`).at(0)?.suggestions ?? []) {
        assert.ok(!banned.has(suggestion), `${text} was corrected to the misspelling ${suggestion}`);
      }
    }
  });
});

// The two layers disagreed about whether the same string was a word: the rule engine's
// curated typo table called `wich`, `untill` and `enviroment` misspellings while the
// dictionary called them words, and only one of them can be right. Whatever the rule engine
// rewrites unconditionally must not be a dictionary word.
//
// Eleven keys used to need an exception here, because they were words in one layer and
// typos in the other — `to wolf down`, `to leaf through`, a cloth `calender`, a castrated
// `wether`. #1031 removed the exception rather than the entries: the ones with a cheap
// context test moved to CONTEXTUAL_MISSPELLINGS, the rest were dropped. So the invariant
// is now absolute, and it runs BOTH ways — a real word cannot be added to the
// unconditional table, and a non-word cannot hide in the gated one where the gate would
// stop it being flagged at all.
describe('the rule engine and the dictionary agree', () => {
  test('no unconditional typo in the rule table is also a dictionary word', () => {
    // A correction containing an apostrophe is the contraction layer's, not the speller's
    // — `cant`, `wont`, `lets` and `ill` are ordinary words too, but the fix is punctuation.
    const conflicts = Object.keys(MISSPELLINGS).filter((typo) => KNOWN.has(typo) && !MISSPELLINGS[typo].includes("'"));
    assert.deepEqual(conflicts, []);
  });

  test('every gated typo really is a dictionary word — that is the only reason to gate it', () => {
    const ungated = Object.keys(CONTEXTUAL_MISSPELLINGS).filter((typo) => !KNOWN.has(typo));
    assert.deepEqual(ungated, [], 'these have no legitimate reading, so they belong in the flat table');
  });

  test('the two tables are disjoint', () => {
    const both = Object.keys(CONTEXTUAL_MISSPELLINGS).filter((typo) => typo in MISSPELLINGS);
    assert.deepEqual(both, [], 'the unconditional entry would win and the gate would never run');
  });
});
