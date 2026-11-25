// The shared word tokenizer and the underline offsets that ride on it (#642).
//
// The regression this locks down: an ASCII-only tokenizer does not SKIP a word it cannot
// judge, it SPLITS it. "coöperation" became "co" + "peration", so the speller underlined
// "peration" at offset 7 — an underline in the middle of a word — and offered "operation",
// which corrupts the word on accept. Same cut made the capitalization rule underline "cr"
// in "crème". Every assertion below re-slices the ORIGINAL text with the issue's offsets,
// so a wrong span fails even when the suggestion happens to look right.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { words, wordAt, isLatinWord, protectedSpans, overlapsSpan } from './words.js';
import { ruleIssues } from './grammarRules/index.js';
import { cpuMs } from '../test/cpuTime.js';

const tokens = (t: string) => [...words(t)];

describe('word tokenizer', () => {
  test('keeps a word with a non-ASCII letter whole', () => {
    assert.deepEqual(
      tokens('The coöperation was teh best').map((w) => w.word),
      ['The', 'coöperation', 'was', 'teh', 'best'],
    );
    assert.deepEqual(
      tokens('crème brûlée').map((w) => w.word),
      ['crème', 'brûlée'],
    );
  });

  test('tokenizes a non-Latin script as whole words', () => {
    assert.deepEqual(
      tokens('Hello يوسف world').map((w) => w.word),
      ['Hello', 'يوسف', 'world'],
    );
  });

  // The emoji is written as an escape, never as a literal glyph: this repo bans
  // colour emoji in source and CI enforces it (scripts/check-emoji.mjs). The escape
  // is the same code point, so the test still exercises a surrogate pair — which is
  // the whole point of it. Do not paste the glyph back in.
  test('offsets are UTF-16 indices into the original text', () => {
    for (const text of ['The coöperation was teh best', 'Hello \u{1F600} teh world', 'مرحبا teh world adress']) {
      for (const { word, start } of tokens(text)) assert.equal(text.slice(start, start + word.length), word);
    }
  });

  test('keeps one internal apostrophe, so "i\'m" stays a single token', () => {
    assert.deepEqual(
      tokens("i'm here").map((w) => w.word),
      ["i'm", 'here'],
    );
  });

  test('isLatinWord accepts only what our English data covers', () => {
    for (const ok of ['cat', 'Cat', 'CAT', "i'm"]) assert.equal(isLatinWord(ok), true, ok);
    for (const no of ['crème', 'coöperation', 'يوسف', 'Fußball']) assert.equal(isLatinWord(no), false, no);
  });

  test('wordAt returns the whole word starting at an index, in any script', () => {
    assert.equal(wordAt('crème brûlée', 0), 'crème');
    assert.equal(wordAt('crème brûlée', 6), 'brûlée');
    assert.equal(wordAt('crème brûlée', 5), null); // the space
  });
});

describe('grammar rules on non-ASCII text', () => {
  test('never flags a fragment of an accented word', () => {
    const text = 'The coöperation was teh best';
    for (const iss of ruleIssues(text)) {
      assert.equal(text.slice(iss.start, iss.end), iss.original);
      assert.equal(iss.original, 'teh'); // the ASCII typo, and nothing else
    }
  });

  test('capitalizes the WHOLE first word, accents included', () => {
    for (const [text, original, suggestion] of [
      ['crème brûlée is nice.', 'crème', 'Crème'],
      ['résumé attached.', 'résumé', 'Résumé'],
    ] as const) {
      const caps = ruleIssues(text).filter((i) => i.label === 'Capitalize');
      assert.equal(caps.length, 1, text);
      assert.equal(caps[0].original, original);
      assert.equal(caps[0].suggestion, suggestion);
      assert.equal(text.slice(caps[0].start, caps[0].end), original);
    }
  });

  test('mixed-script and emoji text keeps every offset aligned', () => {
    for (const [text, original] of [
      ['مرحبا teh world', 'teh'],
      ['Hello \u{1F600} teh world', 'teh'],
      ['Björk sang teh song', 'teh'],
      ['Der Fußball ist teh best', 'teh'],
    ] as const) {
      const found = ruleIssues(text);
      assert.equal(found.length, 1, text);
      assert.equal(found[0].original, original);
      assert.equal(text.slice(found[0].start, found[0].end), original);
    }
  });

  test('plain ASCII behaviour is unchanged', () => {
    const found = ruleIssues("i'm teh best");
    assert.deepEqual(
      found.map((i) => [i.original, i.suggestion]),
      [
        ["i'm", "I'm"],
        ['teh', 'the'],
      ],
    );
  });
});

// Spans that are identifiers rather than prose (#941). Grammit offered to turn a
// domain into a different one, and Fix all applied it without asking. The damage
// is silent: the text still looks like an address afterwards, it just no longer resolves.
describe('protected spans', () => {
  const covers = (text: string, part: string): boolean => {
    const at = text.indexOf(part);
    assert.notEqual(at, -1, `fixture does not contain ${part}`);
    return overlapsSpan(protectedSpans(text), at, at + part.length);
  };

  test('an address, a link, a code span, a path and a handle are left alone', () => {
    for (const [text, part] of [
      ['Write to sara.mahmoud@exampl.com today', 'exampl'],
      ['See https://acmecorp.test/downlod/page now', 'acmecorp'],
      ['See https://acmecorp.test/downlod/page now', 'downlod'],
      ['Visit acmecorp.test for the details', 'acmecorp.test'],
      ['Mail mailto:sara@exampl.com now', 'exampl'],
      ['Run `npm run buld` first', 'buld'],
      ['Open ./src/indx.ts and fix it', 'indx'],
      ['Ping @mahmoudemadd about it', 'mahmoudemadd'],
      ['Open C:\\Users\\sara\\notes.txt now', 'notes'],
    ] as const) {
      assert.equal(covers(text, part), true, `${part} in ${text}`);
    }
  });

  test('ordinary prose is never protected', () => {
    for (const [text, part] of [
      ['This is delicous and here', 'delicous'],
      ['e.g. this is an exampl', 'exampl'], // an abbreviation is not a host
      ['The value is 3.14 aproximately', 'aproximately'], // nor is a decimal
      ['Use and/or as neccessary', 'neccessary'], // nor is a slash between two words
      ['He said hello.World today', 'hello.World'], // a missing space must stay flaggable
      ['Visit acmecorp.test for the downlod', 'downlod'], // only the host itself is opaque
    ] as const) {
      assert.equal(covers(text, part), false, `${part} in ${text}`);
    }
  });

  test('neither checker corrects inside one', () => {
    for (const text of [
      'See https://acmecorp.test/downlod/page now',
      'Write to sara.mahmoud@exampl.com today',
      'Run `npm run buld` first',
    ]) {
      assert.deepEqual(ruleIssues(text), [], text);
    }
  });

  // Every greedy alternative is pinned to a token start. Unpinned, the address pattern
  // restarts at every index of a long unbroken token and scans to its end each time —
  // quadratic, and 5000 characters without a space measured 137 ms for this one regex.
  // Pasted base64 and minified JS are exactly that shape, so the bound is load-bearing.
  //
  // Measured in CPU time, not elapsed time (#1075). This block costs ~2 ms either way,
  // but a 2 ms region is easily descheduled: on a loaded machine its ELAPSED time broke
  // the 100 ms ceiling on ~5% of runs and peaked near 400 ms, with the CPU cost never
  // moving. See test/cpuTime.ts.
  test('a long unbroken token does not cost quadratic time', () => {
    const cost = cpuMs(() => {
      protectedSpans('a'.repeat(5000));
      protectedSpans('a.'.repeat(2000));
      protectedSpans(`sara${'.x'.repeat(2000)}@`);
    });
    assert.ok(cost < 100, `three 4-5k pathological tokens took ${Math.round(cost)} ms of CPU (ceiling 100 ms)`);
  });

  test('overlapsSpan is exact at the edges', () => {
    const spans = [
      { start: 4, end: 10 },
      { start: 20, end: 25 },
    ];
    assert.equal(overlapsSpan(spans, 0, 4), false); // ends where the span begins
    assert.equal(overlapsSpan(spans, 10, 20), false); // between two spans
    assert.equal(overlapsSpan(spans, 3, 5), true);
    assert.equal(overlapsSpan(spans, 9, 12), true);
    assert.equal(overlapsSpan(spans, 24, 30), true);
    assert.equal(overlapsSpan(spans, 25, 30), false);
    assert.equal(overlapsSpan([], 0, 5), false);
  });
});
