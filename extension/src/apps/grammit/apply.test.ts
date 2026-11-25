// Grammit's per-suggestion Apply did nothing (#255) — the app's primary interaction, dead.
//
// Not because of execCommand or focus (the issue's guess, and the suggestion buttons above use
// the same path and work). Because the Apply button belongs to the CUSTOM CORRECTION box, that
// box was pre-filled with the user's own misspelled word, and the handler treated "the value
// equals the original" as "no change" and closed. Clicking Apply submitted `sentance` and got
// silence.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyDecision, initialCustomValue, isRemoval } from './apply.js';

const SPELLING = { original: 'sentance', suggestion: 'sentence' };
const REMOVAL = { original: 'to', suggestion: '' }; // rules.ts:234 — "Remove 'to'"

describe('the custom box starts with the SUGGESTION, so Apply applies (#255)', () => {
  test('the box is pre-filled with the correction, not the mistake', () => {
    // The whole bug in one assertion: it used to be `iss.original`, so the user pressed Apply on
    // their own typo and the handler called that "nothing to change".
    assert.equal(initialCustomValue(SPELLING), 'sentence');
  });

  test('THE BUG: Apply on the untouched box now applies the suggestion', () => {
    const decision = applyDecision(initialCustomValue(SPELLING), SPELLING);
    assert.deepEqual(decision, { action: 'apply', text: 'sentence' });
  });

  test('a removal starts empty and Apply deletes', () => {
    // A repeated word / stray "to" suggests deletion. The old guard's `value !== ''` made that
    // unexpressible: an empty replacement was read as "no value" instead of "delete this".
    assert.equal(initialCustomValue(REMOVAL), '');
    assert.deepEqual(applyDecision('', REMOVAL), { action: 'apply', text: '' });
    assert.equal(isRemoval(REMOVAL), true);
    assert.equal(isRemoval(SPELLING), false);
  });
});

describe('applyDecision — apply unless there is genuinely nothing to change', () => {
  test('the user typing their own wording applies it', () => {
    assert.deepEqual(applyDecision('phrase', SPELLING), { action: 'apply', text: 'phrase' });
  });

  test('CLEARING the box deletes the word — that is an edit, not an absence of one', () => {
    assert.deepEqual(applyDecision('', SPELLING), { action: 'apply', text: '' });
  });

  test('a value identical to the original closes — nothing would change', () => {
    // The one honest no-op: the user reverted the box to what is already in the document.
    assert.deepEqual(applyDecision('sentance', SPELLING), { action: 'close' });
  });

  test('whitespace is NOT trimmed away — a space can be the whole point', () => {
    // "runon" -> "run on" is a real correction, and so is a trailing space the user typed
    // deliberately. We compare the value; we never rewrite it.
    assert.deepEqual(applyDecision('run on', { original: 'runon', suggestion: 'run on' }), {
      action: 'apply',
      text: 'run on',
    });
    assert.deepEqual(applyDecision(' sentence ', SPELLING), { action: 'apply', text: ' sentence ' });
    assert.deepEqual(applyDecision(' ', REMOVAL), { action: 'apply', text: ' ' }, 'a lone space is a value');
  });

  test('an issue whose suggestion equals the original still closes on an untouched box', () => {
    // Defensive: a rule that proposes the text it already found would otherwise apply a no-op
    // edit, blowing away the undo stack and re-running the checker for nothing.
    const noop = { original: 'x', suggestion: 'x' };
    assert.deepEqual(applyDecision(initialCustomValue(noop), noop), { action: 'close' });
  });
});
