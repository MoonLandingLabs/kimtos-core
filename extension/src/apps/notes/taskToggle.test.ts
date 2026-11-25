// Clicking the Nth checkbox must flip the Nth `[ ]` the RENDERER produced.
//
// The load-bearing test is `agrees with what marked actually renders`: it counts the
// boxes this module finds and the `<input>`s `marked` emits for the same document, and
// fails if they disagree. An off-by-one here does not look like a bug, it looks like the
// user's note quietly changing a different line, so the count is asserted against the
// renderer rather than against my reading of the spec.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toggleTaskAt } from './taskToggle.js';
import { marked } from '../../lib/markdown.js';

/** How many boxes this module can resolve, by walking indices until one does not. */
function found(src: string): number {
  let n = 0;
  while (toggleTaskAt(src, n)) n += 1;
  return n;
}
/** How many TASK boxes marked actually renders.
 *
 *  Anchored to the `<li>` marked puts a task item's input in (with an optional `<p>`, which
 *  a loose list adds), rather than counting every `<input` in the output. A note can also
 *  contain hand-written HTML with an input in it, which the renderer passes through
 *  verbatim; that is the user's own markup, has no `[ ]` behind it, and is not enhanced
 *  into a control — so it is not a box, and counting it here would assert the wrong thing.
 *  `previewTasks.dom.test.ts` checks the same boundary from the DOM side. */
function rendered(src: string): number {
  return ((marked.parse(src) as string).match(/<li>\s*(?:<p>)?\s*<input/g) || []).length;
}
/** Apply the toggle at `index` and return the new source. */
function click(src: string, index: number): string {
  const edit = toggleTaskAt(src, index);
  assert.ok(edit, `expected a box at index ${index}`);
  return src.slice(0, edit.start) + edit.text + src.slice(edit.end);
}

const DOCS: [string, string][] = [
  ['a flat list', '- [ ] one\n- [x] two\n'],
  // Every one of these was found by an adversarial pass over the first version, which
  // counted markers the renderer never turns into a box. Each phantom shifted the index of
  // every real box after it, so a click rewrote a different line of the note.
  ['a raw html block around a marker', '- [ ] before\n<div>\n- [ ] hidden\n</div>\n\n- [ ] after\n'],
  ['a script block', '- [ ] a\n<script>\n- [ ] nope\n</script>\n\n- [x] b\n'],
  ['a raw table block', '<table>\n<tr><td>- [ ] cell</td></tr>\n</table>\n\n- [ ] real\n'],
  ['a marker with no content is not a box', '- [ ]\n- [ ] real\n'],
  ['a marker with only spaces after it is not a box', '- [ ]   \n- [ ] real\n'],
  ['a tilde fence', '- [ ] a\n\n~~~\n- [ ] fenced\n~~~\n\n- [x] b\n'],
  ['a table cell containing a marker', '| a | b |\n| - | - |\n| - [ ] c | d |\n\n- [ ] real\n'],
  // A quoted code sample is the one that mattered most: the refusal used to be
  // document-wide, so one of these switched off every checkbox in the note.
  ['a fenced sample inside a blockquote', '- [ ] real\n\n> example:\n>\n> ```\n> - [ ] sample\n> ```\n'],
  ['an indented sample inside a blockquote', '- [ ] real\n\n>     - [ ] sample\n'],
  ['a quoted list and a real list together', '> - [ ] quoted\n\n- [ ] real\n'],
  ['a loose list', '- [ ] one\n\n- [x] two\n'],
  ['a loose list before a tight one', '- [ ] loose\n\n- [ ] loose two\n\ntext\n\n- [ ] tight\n'],
  ['a pasted input tag between real boxes', '- [ ] one\n\n<input type="checkbox">\n\n- [ ] two\n'],
  ['an input tag written inline in a paragraph', 'See <input type="checkbox"> here\n\n- [ ] real\n'],
  ['a pasted form snippet', '- [ ] one\n\n<form><input name="q"><button>Go</button></form>\n\n- [x] two\n'],
  ['a nested list', '- [x] two\n  - [ ] nested\n  - [x] deep\n'],
  ['an ordered task list', '1. [ ] one\n2. [x] two\n'],
  ['a quoted list', '> - [ ] quoted\n'],
  ['a fence inside a list', '- [ ] a\n\n  ```\n  - [ ] fenced\n  ```\n\n- [ ] b\n'],
  ['a top-level fence', '- [ ] a\n\n```\n- [ ] fenced\n- [x] also fenced\n```\n\n- [x] b\n'],
  ['indented code', 'text\n\n    - [ ] indented\n'],
  ['prose that merely contains brackets', 'an array is [ ] in some languages\n'],
  ['no lists at all', '# Heading\n\nJust prose.\n'],
  ['the issue s own note', '### Linux Research\n\nSome text\n\n- [ ] Btrfs file system\n- [ ] loop devices\n'],
];

describe('Notes: the boxes found agree with what marked actually renders', () => {
  for (const [name, src] of DOCS) {
    test(name, () => assert.equal(found(src), rendered(src), `box count for: ${name}`));
  }
});

describe('Notes: ticking a box edits the right marker', () => {
  test('an unchecked box becomes checked, and back', () => {
    const src = '- [ ] one\n- [x] two\n';
    assert.equal(click(src, 0), '- [x] one\n- [x] two\n');
    assert.equal(click(src, 1), '- [ ] one\n- [ ] two\n');
  });

  test('nothing but the three marker characters changes', () => {
    const src = '- [ ] one\n- [x] two\n';
    const edit = toggleTaskAt(src, 1);
    assert.ok(edit);
    assert.equal(src.slice(edit.start, edit.end), '[x]');
    assert.equal(edit.text.length, 3);
  });

  test('a nested box is reached, and its parent is untouched', () => {
    const src = '- [x] two\n  - [ ] nested\n';
    assert.equal(click(src, 1), '- [x] two\n  - [x] nested\n');
  });

  test('an uppercase [X] is treated as checked and clears', () => {
    assert.equal(click('- [X] one\n', 0), '- [ ] one\n');
  });

  test('a box after a fenced block is not off by the fenced ones', () => {
    const src = '- [ ] a\n\n```\n- [ ] fenced\n- [x] also fenced\n```\n\n- [x] b\n';
    // Index 1 is `b`, NOT either line inside the fence.
    assert.equal(click(src, 1), '- [ ] a\n\n```\n- [ ] fenced\n- [x] also fenced\n```\n\n- [ ] b\n');
  });

  test('a quoted box toggles in place', () => {
    assert.equal(click('> - [ ] quoted\n', 0), '> - [x] quoted\n');
  });

  test('an ordered task item toggles', () => {
    assert.equal(click('1. [ ] one\n', 0), '1. [x] one\n');
  });
});

describe('Notes: a marker the renderer hid never shifts a real box', () => {
  test('clicking the box after a raw html block toggles THAT box', () => {
    const src = '- [ ] before\n<div>\n- [ ] hidden\n</div>\n\n- [ ] after\n';
    // Two boxes render: `before` (0) and `after` (1). The marker inside the <div> is
    // literal text and must not be reachable at all.
    assert.equal(click(src, 1), '- [ ] before\n<div>\n- [ ] hidden\n</div>\n\n- [x] after\n');
    assert.equal(toggleTaskAt(src, 2), null);
  });

  test('an empty marker does not shift the real one after it', () => {
    assert.equal(click('- [ ]\n- [ ] real\n', 0), '- [ ]\n- [x] real\n');
  });
});

describe('Notes: an unrelated block never switches the feature off', () => {
  // The refusal has to be scoped. A quoted code sample containing what looks like a task
  // line renders no box at all, so it must simply contribute nothing — not take the rest
  // of the note's checkboxes down with it.
  test('a quoted code sample leaves the real box working', () => {
    const src = '- [ ] real\n\n> example:\n>\n> ```\n> - [ ] sample\n> ```\n';
    assert.equal(click(src, 0), '- [x] real\n\n> example:\n>\n> ```\n> - [ ] sample\n> ```\n');
    assert.equal(toggleTaskAt(src, 1), null, 'the sample is not a box');
  });

  test('a raw html block leaves the real boxes working', () => {
    const src = '<div>\n- [ ] hidden\n</div>\n\n- [ ] a\n- [ ] b\n';
    assert.equal(click(src, 1), '<div>\n- [ ] hidden\n</div>\n\n- [ ] a\n- [x] b\n');
  });

  test('a loose list before a tight one does not shift the tight one', () => {
    // The clickable set and the marker set must agree, or clicking the tight box writes to
    // a loose one. Index 2 IS the tight item.
    const src = '- [ ] loose\n\n- [ ] loose two\n\ntext\n\n- [ ] tight\n';
    assert.equal(click(src, 2), '- [ ] loose\n\n- [ ] loose two\n\ntext\n\n- [x] tight\n');
  });

  test('an input tag written inline in a paragraph is not a box', () => {
    // Inline raw HTML lexes as a `paragraph`, not an `html` block, so exempting by token
    // type missed it and the whole note refused.
    const src = 'See <input type="checkbox"> here\n\n- [ ] real\n';
    assert.equal(click(src, 0), 'See <input type="checkbox"> here\n\n- [x] real\n');
  });

  test('a pasted input tag is not counted as a box', () => {
    // The renderer passes raw HTML through verbatim, so counting `<input` in it reported a
    // box no `[ ]` could account for — and the disagreement took the whole note down.
    const src = '- [ ] one\n\n<input type="checkbox">\n\n- [ ] two\n';
    assert.equal(click(src, 1), '- [ ] one\n\n<input type="checkbox">\n\n- [x] two\n');
    assert.equal(toggleTaskAt(src, 2), null);
  });
});

describe('Notes: a forged checkbox costs its own block and nothing else', () => {
  // `<li>` is a tag anyone can paste, so raw HTML CAN open a list item and forge the shape
  // both halves of the mapping key on. That used to take the whole note down: the fake had
  // no marker behind it, the counts disagreed, and every real checkbox in the note went
  // dead while the fake was enhanced into something that looked like a live control
  // (#1294). The forged block now simply takes no part — no offsets here, and no enhanced
  // boxes in the app, which is what makes skipping it safe.
  test('a pasted list-item checkbox leaves the real boxes working', () => {
    const src = '<li><p><input type="checkbox" disabled> pasted</p></li>\n\n- [ ] real\n- [x] real two\n';
    assert.equal(
      click(src, 0),
      '<li><p><input type="checkbox" disabled> pasted</p></li>\n\n- [x] real\n- [x] real two\n',
    );
    assert.equal(
      click(src, 1),
      '<li><p><input type="checkbox" disabled> pasted</p></li>\n\n- [ ] real\n- [ ] real two\n',
    );
    assert.equal(toggleTaskAt(src, 2), null, 'the fake is not one of them');
  });

  test('the same paste AFTER the real boxes does not shift them either', () => {
    const src = '- [ ] real one\n- [ ] real two\n\n<li><input type="checkbox" disabled> fake</li>\n';
    assert.equal(click(src, 1), '- [ ] real one\n- [x] real two\n\n<li><input type="checkbox" disabled> fake</li>\n');
    assert.equal(toggleTaskAt(src, 2), null);
  });

  // Not a literal `<li>` anywhere: a list item whose content STARTS with inline raw HTML
  // renders as `<li><input …>` too, and lexes as a `list`, not as `html`. Exempting raw
  // HTML by token type would leave both of these exactly as they were.
  test('an item that merely starts with inline HTML forges the same shape', () => {
    const src = '- <input type="checkbox" disabled> fake\n\n- [ ] real\n';
    // One loose list, so the forgery costs the real box in it too — contained, and it reads
    // as inert rather than posing as a control.
    assert.equal(toggleTaskAt(src, 0), null);
    assert.equal(toggleTaskAt(src, 1), null);
  });

  test('a forged item does not take a SEPARATE list down with it', () => {
    const src = '- <input type="checkbox" disabled> fake\n\ntext\n\n- [ ] real\n';
    assert.equal(click(src, 0), '- <input type="checkbox" disabled> fake\n\ntext\n\n- [x] real\n');
  });
});

describe('Notes: a forgery that balances the count is still refused', () => {
  // Equal counts are NOT proof of correspondence, and this is how that bites. With no blank
  // line between them, the pasted `<li>` and the task line below it are ONE raw-HTML block:
  // the paste renders a box with no marker, and `- [x] done` is literal text inside the
  // block, a marker with no box. They cancel — one box, one marker — so a count test passes
  // and the fake gets mapped onto `done`. Clicking the fake then rewrote a line the user
  // never clicked, which is the exact failure this whole module exists to prevent.
  //
  // Comparing tick states instead would not save it either: the second case below is the
  // same document with the states already agreeing.
  for (const [name, src] of [
    ['when the states differ', '<li><input type="checkbox" disabled> forged</li>\n- [x] done\n'],
    ['when the states agree', '<li><input type="checkbox" disabled> forged</li>\n- [ ] done\n'],
    [
      'in a loose list, with a setext heading hiding the other marker',
      '- <input type="checkbox" disabled> forged\n\n- [x] done\n\n- [ ] a\n===\n',
    ],
  ] as const) {
    test(name, () => {
      assert.equal(toggleTaskAt(src, 0), null, 'nothing may resolve, or the fake writes a real line');
      assert.equal(toggleTaskAt(src, 1), null);
    });
  }
});

describe('Notes: a block that is not where its raw says it is cannot be mapped', () => {
  // Everything here scans `token.raw` for markers and adds the block's offset, which is only
  // legitimate while `raw` IS the source text of the block. `marked` does not always give it
  // back verbatim: a blockquote followed by a lazily-continued raw HTML line comes back with
  // a newline inserted, and the second document below comes back reflowed. Offsets computed
  // from those are a character or more out, so the click does not refuse — it rewrites the
  // middle of a marker. Found by widening the preview fuzz to join fragments with no blank
  // line; it predates the #1294 work.
  for (const [name, src] of [
    ['a newline marked inserted', '> - [ ] quoted\n<input type="checkbox" disabled> loose input\n> - [ ] quoted\n'],
    ['a block marked reflowed', '> - [ ] quoted\n> - [ ] quoted\n<input type="checkbox" disabled> loose input\n'],
  ] as const) {
    test(name, () => {
      // marked < 18 rewrote the raw of these blocks (a newline inserted, a reflow); 18 returns
      // it verbatim, so the offsets are right and the boxes map. The guard in
      // `blockTaskOffsets` stays for any future regression, and this invariant is what it protects.
      // Every index refuses. What must never happen is the old behaviour: resolving to an
      // offset that is not a marker at all.
      for (let i = 0; i < 4; i += 1) {
        const edit = toggleTaskAt(src, i);
        if (edit) assert.match(src.slice(edit.start, edit.end), /^\[[ xX]\]$/, `index ${i} resolved to a non-marker`);
      }
      // Both documents hold two real boxes (the loose <input> is not a task box).
      assert.ok(toggleTaskAt(src, 0));
      assert.ok(toggleTaskAt(src, 1));
      assert.equal(toggleTaskAt(src, 2), null);
    });
  }
});

describe('Notes: proving the correspondence does not cost the honest documents', () => {
  // The proof re-renders the block with every marker flipped, so a box that is really ours
  // moves with it. Only blocks that could contain raw HTML pay for it — but those include
  // ordinary notes ABOUT html, which must go on working.
  for (const [src, want] of [
    ['- [ ] document the `<input>` element\n', 1],
    ['- [ ] fix the <div> bug\n- [x] and the <span> one\n', 2],
    ['- [ ] <b>bold</b> task\n', 1],
    ['- [ ] a <!-- comment --> task\n', 1],
    ['- [ ] 5 < 6 is true\n', 1],
    ['- [ ] parent <em>x</em>\n  - [x] nested <i>y</i>\n', 2],
    ['> - [ ] quoted <b>x</b>\n', 1],
    // A raw input that does NOT open the item is not in the clickable set, so the item's
    // own box is still perfectly mappable.
    ['- [ ] real <input type="checkbox" disabled>\n', 1],
    // Astral characters: the flip indexes by code unit, like every offset in this module.
    ['- [ ] emoji \u{1F600} and <b>tag</b>\n- [x] second \u{1F600}\n', 2],
  ] as const) {
    test(JSON.stringify(src), () => {
      assert.equal(found(src), want);
      // and the offsets really are markers
      for (let i = 0; i < want; i += 1) {
        const edit = toggleTaskAt(src, i);
        assert.ok(edit);
        assert.match(src.slice(edit.start, edit.end), /^\[[ xX]\]$/);
      }
    });
  }
});

describe('Notes: an ambiguous document refuses rather than guessing', () => {
  // marked < 18 turned a setext underline into a heading, so `- [ ] a` rendered no box and
  // the scan disagreed with the renderer (refused, every index null). marked 18 treats `===`
  // as a continuation of the item's paragraph, so both boxes render and the scan agrees:
  // both map to real markers. The count check in `blockTaskOffsets` still covers any
  // construct where the two disagree.
  const setext = '- [ ] a\n===\n\n- [ ] b\n';
  test('marked and the scan agree here', () => {
    assert.equal((marked.parse(setext) as string).match(/<input/g)?.length ?? 0, 2);
  });
  test('so both indices resolve to real markers', () => {
    for (const i of [0, 1]) {
      const edit = toggleTaskAt(setext, i);
      assert.ok(edit);
      assert.match(setext.slice(edit.start, edit.end), /^\[[ xX]\]$/);
    }
    assert.equal(toggleTaskAt(setext, 2), null);
  });
});

describe('Notes: an index that does not resolve does nothing', () => {
  const src = '- [ ] one\n';
  for (const [name, index] of [
    ['past the end', 1],
    ['far past the end', 99],
    ['negative', -1],
    ['not an integer', 0.5],
    ['NaN', Number.NaN],
  ] as [string, number][]) {
    test(name, () => assert.equal(toggleTaskAt(src, index), null));
  }

  test('an empty document resolves nothing', () => {
    assert.equal(toggleTaskAt('', 0), null);
  });
});
