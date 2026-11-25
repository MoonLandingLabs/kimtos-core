// A deletion is not an insert of nothing.
//
// `execCommand('insertText', false, '')` does not remove a selection — it reports success and
// leaves the text alone. Every suggestion whose replacement is empty ("Remove" — a repeated
// word, a stray "to") therefore did nothing, in BOTH surfaces that apply edits this way: the
// Grammit app's popover (#255) and Grammit Anywhere in the page (#295).
//
// The command CHOICE is what was wrong, so that is what is tested here. It is one rule now,
// shared by both, rather than two copies that were each wrong in the same way.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { editCommandFor, execEdit, applyToRange } from './editCommand.js';

describe('editCommandFor — an empty replacement is a DELETION (#255, #295)', () => {
  test('empty text deletes', () => {
    assert.equal(editCommandFor(''), 'delete');
  });

  test('any other text inserts', () => {
    assert.equal(editCommandFor('sentence'), 'insertText');
    assert.equal(editCommandFor(' '), 'insertText', 'a lone space is text the user asked for');
    assert.equal(editCommandFor('0'), 'insertText', 'falsy-looking but real');
  });
});

describe('execEdit — issues the right command, and never lies about the result', () => {
  /** A document that records what it was asked to do. */
  const fakeDoc = (honoured: boolean) => {
    const calls: { cmd: string; value?: string }[] = [];
    return {
      calls,
      doc: {
        execCommand: (cmd: string, _ui?: boolean, value?: string) => {
          calls.push({ cmd, value });
          return honoured;
        },
      } as unknown as Document,
    };
  };

  test('an empty replacement issues `delete`, NOT an empty insertText', () => {
    // The whole bug in one assertion. It used to call insertText with '', which does nothing.
    const { calls, doc } = fakeDoc(true);
    assert.equal(execEdit('', doc), true);
    assert.deepEqual(calls, [{ cmd: 'delete', value: undefined }]);
  });

  test('a real replacement issues insertText with the text', () => {
    const { calls, doc } = fakeDoc(true);
    assert.equal(execEdit('sentence', doc), true);
    assert.deepEqual(calls, [{ cmd: 'insertText', value: 'sentence' }]);
  });

  test('a refusal is REPORTED, so the caller can fall back', () => {
    // A caller that ignores this silently does nothing — which is the failure this module is
    // named after. Both call sites fall back on `false`.
    const { doc } = fakeDoc(false);
    assert.equal(execEdit('', doc), false);
    assert.equal(execEdit('x', doc), false);
  });

  test('a document with no execCommand at all returns false rather than throwing', () => {
    // A hardened page, or a test DOM. It must degrade to "not honoured", not take the page down.
    assert.equal(execEdit('x', {} as unknown as Document), false);
  });
});

// The fallback, against a REAL contentEditable. happy-dom has no execCommand, which is exactly
// the case this path exists for — and it is what a hardened page looks like too.
describe('applyToRange — the fallback really edits, and tells the page it did (#295)', () => {
  let win: Window;
  let doc: Document;
  let field: HTMLElement;

  const rangeOver = (start: number, end: number): Range => {
    const node = field.firstChild!;
    const r = doc.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    return r;
  };

  beforeEach(() => {
    win = new Window();
    doc = win.document as unknown as Document;
    field = doc.createElement('div');
    field.setAttribute('contenteditable', 'true');
    doc.body.append(field);
  });

  test('a REMOVAL actually removes the text', () => {
    // "I saw the the cat" — the repeated-word rule spans the whitespace + the duplicate (" the"),
    // so deleting exactly that range leaves correct spacing and no double space.
    field.textContent = 'I saw the the cat';
    applyToRange(rangeOver(9, 13), '', field); // " the"
    assert.equal(field.textContent, 'I saw the cat');
  });

  test('a replacement replaces', () => {
    field.textContent = 'a sentance here';
    applyToRange(rangeOver(2, 10), 'sentence', field);
    assert.equal(field.textContent, 'a sentence here');
  });

  test('it fires an input event, so React/ProseMirror learn the DOM changed', () => {
    // Without this the editor's own model would resurrect the old text on the next keystroke —
    // the edit would appear to work and then undo itself.
    field.textContent = 'the the cat';
    const seen: { type: string; bubbles: boolean }[] = [];
    field.addEventListener('input', (e) => {
      seen.push({ type: e.type, bubbles: e.bubbles });
    });
    applyToRange(rangeOver(3, 7), '', field);
    assert.equal(seen.length, 1, 'an input event must fire');
    assert.equal(seen[0]!.type, 'input');
    assert.equal(seen[0]!.bubbles, true, 'it must bubble — the editor listens above the field');
  });

  test('execEdit reports false on a DOM with no execCommand, so the fallback runs', () => {
    // This is the wiring that matters: writer.ts calls the fallback only when execEdit says the
    // browser refused. If execEdit ever swallowed that, the fallback would never run.
    assert.equal(execEdit('', doc), false);
  });
});
