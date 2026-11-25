// The on-device speller's offsets (#642).
//
// The dictionary is English-only, so a word carrying any non-ASCII letter cannot be
// judged — and must therefore be skipped WHOLE. Tokenizing on [A-Za-z] instead cut
// "coöperation" into "co" + "peration", and the speller confidently underlined
// "peration" at offset 7 with the suggestion "operation": an underline in the middle
// of a word that corrupts it on accept.
//
// The word list is a runtime asset, so the fetch is stubbed with a tiny list before
// the module is imported (`loadSpeller` memoizes its one fetch).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { SpellIssue } from './spellcheck.js';

// Frequency-ordered, exactly like public/words.txt — most common first.
const WORDS = ['the', 'is', 'was', 'here', 'best', 'hello', 'world', 'address', 'operation', 'delicious'].join('\n');

let spell: (text: string) => SpellIssue[];
const realFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = (async () => new Response(WORDS)) as typeof fetch;
  const { loadSpeller } = await import('./spellcheck.js');
  spell = await loadSpeller();
});
after(() => {
  globalThis.fetch = realFetch; // never leave a global stubbed behind
});

describe('spellIssues offsets', () => {
  test('never flags a fragment of an accented word', () => {
    const text = 'The coöperation was the best';
    assert.deepEqual(spell(text), []);
  });

  // The emoji is written as an escape, never as a literal glyph: this repo bans
  // colour emoji in source and CI enforces it (scripts/check-emoji.mjs). The escape
  // is the same code point, so the test still exercises a surrogate pair — which is
  // the whole point of it. Do not paste the glyph back in.
  test('still flags the plain misspellings around non-ASCII words', () => {
    for (const [text, original] of [
      ['crème brûlée is delicous', 'delicous'],
      ['Hello \u{1F600} adress here', 'adress'],
      ['مرحبا adress here', 'adress'],
    ] as const) {
      const found = spell(text);
      assert.equal(found.length, 1, text);
      assert.equal(found[0].original, original);
      // The span must re-slice to the same word, or the underline is misplaced.
      assert.equal(text.slice(found[0].start, found[0].end), original);
    }
  });

  test('suggests the near dictionary word', () => {
    assert.equal(spell('This is delicous').at(0)?.suggestion, 'delicious');
    assert.equal(spell('The adress is here').at(0)?.suggestion, 'address');
  });

  // #941: the speller must not "correct" inside an identifier. Accepting one of these
  // leaves text that still looks like an address but no longer resolves.
  test('never corrects inside an address, a link or a code span', () => {
    for (const text of ['Write to sara@adress.com here', 'See https://adress.com/best here', 'Run `the adress` here']) {
      assert.deepEqual(spell(text), [], text);
    }
    // ...while the same word in prose is still flagged.
    assert.equal(spell('The adress is here').at(0)?.original, 'adress');
  });

  test('leaves a wholly non-Latin word alone', () => {
    assert.deepEqual(spell('يوسف مرحبا'), []);
  });
});
