// The speller against the REAL 60k dictionary (#939).
//
// A pasted document full of names, jargon and typos misses the suggestion cache on
// nearly every word, and every miss used to run an edit-distance-2 sweep built by
// generating `edits1()` of every string in `edits1(word)` — roughly (54 x len)^2
// candidate strings for ONE word. Measured on this dictionary: 200 unknown 8-10
// character words took 77 s, and 1000 took 158 s, all of it synchronous. In the app
// window that is a frozen dialog; in the in-page checker that call runs in the service
// worker, which is killed long before it returns, so the check never comes back.
//
// The ceiling below is deliberately generous — a slow CI runner must not make it flake —
// but it is two orders of magnitude under the numbers above, so any return to generating
// candidates instead of looking them up fails here rather than in a user's tab.
//
// It is a ceiling on CPU time, not on elapsed time, and that is load-bearing: this used
// to assert `performance.now()` and went red on a busy machine that had not changed a
// line of the speller (#1075). The pass costs ~310 ms of CPU whether the machine is idle
// or buried; its ELAPSED time went past 6000 ms under load. See test/cpuTime.ts.
//
// This lives in its own file because `loadSpeller` memoizes one dictionary per module
// instance, and spellcheck.test.ts loads a ten-word stub. The runner gives each test
// file its own process, so both dictionaries can coexist.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SpellIssue } from './spellcheck.js';
import { cpuMs } from '../test/cpuTime.js';

const DICTIONARY = readFileSync(new URL('../../public/words.txt', import.meta.url), 'utf8');

/** A whole pass over `count` unknown words must stay under this many milliseconds of CPU. */
const CEILING_MS = 5000;

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

/** `count` distinct 8-10 character nonsense words — the worst case, because none of them
 *  has a near dictionary word to cut the search short. Seeded, so the run is repeatable. */
function unknownWords(count: number): string {
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  let seed = 12345;
  const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out: string[] = [];
  while (out.length < count) {
    const len = 8 + Math.floor(next() * 3);
    let word = '';
    for (let i = 0; i < len; i += 1) word += alpha[Math.floor(next() * 26)];
    out.push(word);
  }
  return out.join(' ');
}

describe('spellIssues on a large paste', () => {
  test('a document of unknown words is checked in bounded time', () => {
    const text = unknownWords(1000);
    const cost = cpuMs(() => spell(text));
    assert.ok(cost < CEILING_MS, `1000 unknown words took ${Math.round(cost)} ms of CPU (ceiling ${CEILING_MS} ms)`);
  });

  test('still suggests the right word for a two-edit typo', () => {
    // Both of these are two edits from their correction and have no dictionary word one
    // edit away, so they can only be found by the distance-2 path — they are what proves
    // the scan replaced the sweep rather than dropping it.
    assert.equal(spell('See you tommorow here').at(0)?.suggestion, 'tomorrow');
    assert.equal(spell('It was sucessfull here').at(0)?.suggestion, 'successful');
    // And the ordinary one-edit path still ranks by frequency.
    assert.equal(spell('A neccessary step').at(0)?.suggestion, 'necessary');
  });

  test('offers nothing for a word with no near dictionary word', () => {
    assert.deepEqual(spell('the zqxvbnmkrp here'), []);
  });
});
