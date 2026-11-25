// What Enter does on a list item, asserted as a table.
//
// Each case writes the caret as `|` inside the source, so the expectation reads as the
// thing a user would describe — "press Enter here, get that" — rather than as a pair of
// offsets nobody can check by eye.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { continueList } from './listContinuation.js';

/** Apply `continueList` to a source written with `|` for the caret; returns the result
 *  with `|` back at the new caret, or null if Enter should behave natively. */
function press(marked: string): string | null {
  const caret = marked.indexOf('|');
  assert.notEqual(caret, -1, 'the case must place a caret with |');
  const value = marked.slice(0, caret) + marked.slice(caret + 1);
  const out = continueList(value, caret);
  if (!out) return null;
  const next = value.slice(0, out.start) + out.text + value.slice(out.end);
  const at = out.start + out.text.length;
  return next.slice(0, at) + '|' + next.slice(at);
}

describe('Notes: Enter continues a Markdown list', () => {
  const continues: [string, string, string][] = [
    ['an unchecked task', '- [ ] one|', '- [ ] one\n- [ ] |'],
    ['a checked task continues UNCHECKED', '- [x] one|', '- [x] one\n- [ ] |'],
    ['an uppercase [X] is still a task', '- [X] one|', '- [X] one\n- [ ] |'],
    ['a dash bullet', '- one|', '- one\n- |'],
    ['a star bullet keeps its marker', '* one|', '* one\n* |'],
    ['a plus bullet keeps its marker', '+ one|', '+ one\n+ |'],
    ['an ordered item increments', '1. one|', '1. one\n2. |'],
    ['an ordered item keeps its delimiter', '3) three|', '3) three\n4) |'],
    ['an ordered task item', '1. [ ] one|', '1. [ ] one\n2. [ ] |'],
    ['indentation is carried across', '  - [ ] one|', '  - [ ] one\n  - [ ] |'],
    ['tab indentation is carried across', '\t- one|', '\t- one\n\t- |'],
    ['wide spacing after the marker is kept', '-   one|', '-   one\n-   |'],
    ['a caret mid-item splits it', '- [ ] ab|cd', '- [ ] ab\n- [ ] |cd'],
    ['a list below other text', '# T\n\n- [ ] a|', '# T\n\n- [ ] a\n- [ ] |'],
    ['a line above other text', '- a|\nafter', '- a\n- |\nafter'],
  ];
  for (const [name, input, expected] of continues) {
    test(name, () => assert.equal(press(input), expected));
  }

  test('9-digit numbers still increment, longer ones are left alone', () => {
    assert.equal(press('999999998. a|'), '999999998. a\n999999999. |');
    assert.equal(press('1234567890. a|'), null);
  });
});

describe('Notes: Enter on an empty item ends the list', () => {
  const ends: [string, string, string][] = [
    ['an empty task item', '- [ ] a\n- [ ] |', '- [ ] a\n|'],
    ['an empty bullet', '- a\n- |', '- a\n|'],
    ['an empty ordered item', '1. a\n2. |', '1. a\n|'],
    ['an indented empty item loses its indent too', '- a\n  - |', '- a\n|'],
    ['an empty item above other text', '- [ ] |\nafter', '|\nafter'],
    ['whitespace-only content still counts as empty', '- [ ]   |', '|'],
  ];
  for (const [name, input, expected] of ends) {
    test(name, () => assert.equal(press(input), expected));
  }

  test('an empty item at the very end of the document ends the list too', () => {
    assert.equal(press('- |'), '|');
  });

  test('the caret must be PAST the marker, or Enter opens a line as usual', () => {
    // At the start of `- `, Enter means "open a line above me". Inserting a marker there
    // would be a surprise, and one the user cannot undo in a single step.
    assert.equal(press('|- '), null);
    assert.equal(press('|- [ ] a'), null);
    assert.equal(press('- [ |] a'), null); // inside the task box itself
  });
});

describe('Notes: Enter is untouched everywhere else', () => {
  const natives = [
    ['a plain paragraph', 'just text|'],
    ['an empty document', '|'],
    ['a heading', '### Linux Research|'],
    ['a thematic break is not a bullet', '---|'],
    ['a lone dash with no space is not an item', '-|'],
    ['a blockquote is out of scope', '> quoted|'],
    ['text that merely contains a dash', 'a - b|'],
    ['a number without a list delimiter', '1 one|'],
  ];
  for (const [name, input] of natives) {
    test(name, () => assert.equal(press(input), null));
  }
});

describe('Notes: CRLF line endings', () => {
  // A textarea normalises CRLF to LF, so the app never feeds this in — but the function is
  // exported and pure, and its contract carves out nothing. Before the fix it returned
  // null at EVERY caret in a CRLF document (`.` does not match `\r`, so no line matched),
  // i.e. the feature was silently off for anything pasted in with Windows endings.
  test('a CRLF item still continues', () => {
    const value = '- [ ] one\r\n';
    assert.equal(continueList(value, 9)?.text, '\n- [ ] ');
  });
  test('an empty CRLF item still ends the list, carriage return and all', () => {
    const value = '- a\r\n- \r\n';
    const out = continueList(value, 7);
    assert.ok(out);
    assert.equal(value.slice(0, out.start) + out.text + value.slice(out.end), '- a\r\n\n');
  });
});

describe('Notes: continueList is total', () => {
  test('a caret outside the string is clamped, never thrown', () => {
    assert.doesNotThrow(() => continueList('- a', -5));
    assert.doesNotThrow(() => continueList('- a', 999));
    // Clamped to 0, which is inside the marker, so Enter stays native.
    assert.equal(continueList('- a', -5), null);
    assert.equal(continueList('- a', 999)?.text, '\n- ');
  });
});
