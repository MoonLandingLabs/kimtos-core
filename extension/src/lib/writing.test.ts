// mergeIssues is the ONLY thing the Grammit app window and the in-page checker share.
// They cannot share a code path — a content script is one IIFE and inlining the 60k-word
// speller took writer.js from 24 kB to 543 kB (#42), which is why checkWriting() was
// deleted (#75) — so each composes its own layers, and this is the one rule that keeps the
// two consistent.
//
// The rule: RULES BEAT SPELLING on an overlapping span. Break it and the user gets two
// underlines fighting over one word, and the "fix" button applies the wrong one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIssues, type WritingIssue } from './writing.js';

const issue = (start: number, end: number, label: string): WritingIssue => ({
  start,
  end,
  original: label,
  suggestion: `${label}!`,
  label,
});

describe('mergeIssues — rules beat spelling on an overlap', () => {
  test('an overlapping spelling issue is DROPPED; the rule survives', () => {
    const rules = [issue(0, 5, 'rule')];
    const spelling = [issue(3, 8, 'spell')]; // overlaps 3..5
    assert.deepEqual(
      mergeIssues(rules, spelling).map((i) => i.label),
      ['rule'],
    );
  });

  test('an identical span is dropped too (the same word flagged twice)', () => {
    const merged = mergeIssues([issue(0, 4, 'rule')], [issue(0, 4, 'spell')]);
    assert.deepEqual(
      merged.map((i) => i.label),
      ['rule'],
    );
  });

  test('a spelling issue INSIDE a rule span is dropped', () => {
    const merged = mergeIssues([issue(0, 10, 'rule')], [issue(4, 6, 'spell')]);
    assert.deepEqual(
      merged.map((i) => i.label),
      ['rule'],
    );
  });

  test('a rule issue inside a spelling span still wins (primary is authoritative either way)', () => {
    const merged = mergeIssues([issue(4, 6, 'rule')], [issue(0, 10, 'spell')]);
    assert.deepEqual(
      merged.map((i) => i.label),
      ['rule'],
    );
  });
});

describe('mergeIssues — everything that does NOT overlap is kept', () => {
  test('two disjoint issues both survive', () => {
    const merged = mergeIssues([issue(0, 4, 'rule')], [issue(10, 14, 'spell')]);
    assert.equal(merged.length, 2);
  });

  test('ADJACENT spans do not overlap — a span ends where the next begins', () => {
    // [0,5) and [5,9) touch but share no character. Both must be kept: dropping one here
    // would silently swallow a real misspelling in the word right after a rule fix.
    const merged = mergeIssues([issue(0, 5, 'rule')], [issue(5, 9, 'spell')]);
    assert.deepEqual(
      merged.map((i) => i.label),
      ['rule', 'spell'],
    );
  });
});

describe('mergeIssues — shape of the result', () => {
  test('the output is sorted by position, whatever order it came in', () => {
    const merged = mergeIssues([issue(20, 24, 'a'), issue(0, 4, 'b')], [issue(10, 14, 'c')]);
    assert.deepEqual(
      merged.map((i) => i.start),
      [0, 10, 20],
    );
  });

  test('an empty extra list is a no-op (but still sorted)', () => {
    const merged = mergeIssues([issue(9, 10, 'b'), issue(1, 2, 'a')], []);
    assert.deepEqual(
      merged.map((i) => i.label),
      ['a', 'b'],
    );
  });

  test('an empty primary keeps every spelling issue', () => {
    const merged = mergeIssues([], [issue(0, 3, 'x'), issue(5, 8, 'y')]);
    assert.equal(merged.length, 2);
  });

  test('does not mutate its inputs', () => {
    const rules = [issue(0, 4, 'rule')];
    const spelling = [issue(10, 14, 'spell')];
    mergeIssues(rules, spelling);
    assert.equal(rules.length, 1);
    assert.equal(spelling.length, 1);
  });
});
