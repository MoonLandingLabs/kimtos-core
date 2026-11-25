// The contract between what `marked` renders and what the Notes preview enhances.
//
// The preview turns its task boxes into real controls by finding them with
// `input[type="checkbox"][disabled]` and clearing `disabled` (`enhanceTaskBoxes`, in
// taskToggle.ts). That selector is a guess about somebody else's output: if `marked` ever
// emits the box differently — no `disabled`, a wrapping span, a class instead of an
// attribute — the enhancer matches nothing, every box silently stays inert, and the
// feature is gone with no test failing and no error in the console.
//
// So the shape is pinned here, against the real renderer, and the count is cross-checked
// against `toggleTaskAt` so the DOM the user clicks and the source offsets that get
// written can never disagree about how many boxes there are.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Token } from 'marked';
import { installDom, type DomEnv } from '../../test/domEnv.js';
import { marked } from '../../lib/markdown.js';
import { enhanceTaskBoxes, TASK_BOX_SELECTOR as DISABLED_BOXES, toggleTaskAt } from './taskToggle.js';

const DOCS: [string, string, number][] = [
  ['a flat list', '- [ ] one\n- [x] two\n', 2],
  // A LOOSE list (one blank line anywhere in it) wraps every item's content in a <p>, so
  // the box is `li > p > input`. A selector that only knew the tight shape silently
  // dropped these from the clickable set while the source side still counted them — and
  // every later box was then one out, so a click wrote to the wrong line.
  ['a loose list', '- [ ] one\n\n- [x] two\n', 2],
  ['a loose ordered list', '1. [ ] one\n\n2. [ ] two\n', 2],
  ['a loose list before a tight one', '- [ ] loose\n\n- [ ] loose two\n\ntext\n\n- [ ] tight\n', 3],
  ['a nested list', '- [x] two\n  - [ ] nested\n', 2],
  ['an ordered task list', '1. [ ] one\n2. [x] two\n', 2],
  ['a quoted list', '> - [ ] quoted\n', 1],
  ['a fenced block is not a box', '- [ ] a\n\n```\n- [ ] fenced\n```\n\n- [x] b\n', 2],
  ['no tasks at all', '# Heading\n\nprose\n', 0],
];

describe('notes preview task boxes', () => {
  let env: DomEnv;
  before(() => {
    env = installDom();
  });
  after(() => env.cleanup());

  for (const [name, src, expected] of DOCS) {
    test(`${name}: marked emits a disabled box the enhancer can find`, () => {
      const host = env.document.createElement('div');
      host.innerHTML = marked.parse(src) as string;

      const all = host.querySelectorAll('input[type="checkbox"]');
      assert.equal(all.length, expected, 'the renderer emits one input per task item');

      // Every box marked renders must be one the enhancer's selector reaches, or the
      // ones it misses stay dead while the rest work.
      const disabled = host.querySelectorAll(DISABLED_BOXES);
      assert.equal(disabled.length, expected, 'every rendered box is disabled, and matches the enhancer selector');
    });

    test(`${name}: the DOM and the source agree on how many boxes there are`, () => {
      const host = env.document.createElement('div');
      host.innerHTML = marked.parse(src) as string;
      let fromSource = 0;
      while (toggleTaskAt(src, fromSource)) fromSource += 1;
      assert.equal(
        fromSource,
        host.querySelectorAll('input[type="checkbox"]').length,
        'an index into the DOM must be an index into the source markers',
      );
    });
  }

  test('clearing disabled is all it takes to make the box clickable', () => {
    const host = env.document.createElement('div');
    host.innerHTML = marked.parse('- [ ] one\n') as string;
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    assert.equal(box.disabled, true, 'marked ships it disabled');
    box.disabled = false;
    box.classList.add('doc-task');
    assert.equal(box.disabled, false);
    // The delegated listener matches on this class, so it has to survive on the element.
    assert.ok(box.closest('input.doc-task'), 'the delegated click selector reaches the box');
  });

  test('a hand-written checkbox in raw HTML is NOT enhanced', () => {
    // It has no `[ ]` behind it, so enabling it would add a clickable box the source
    // cannot account for — and every box after it would then be one out.
    const host = env.document.createElement('div');
    host.innerHTML = marked.parse('- [ ] real\n\n<div><input type="checkbox" disabled></div>\n') as string;
    assert.equal(host.querySelectorAll('input[type="checkbox"]').length, 2, 'both are in the DOM');
    assert.equal(host.querySelectorAll(DISABLED_BOXES).length, 1, 'only the Markdown one is enhanced');
  });

  test('a checked box renders checked, so the tick reflects the source', () => {
    const host = env.document.createElement('div');
    host.innerHTML = marked.parse('- [ ] one\n- [x] two\n') as string;
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    assert.equal(boxes[0].checked, false);
    assert.equal(boxes[1].checked, true);
  });
});

// ── the clickable set, built the way the app builds it ────────────────────────────────────
//
// Everything above renders a whole document at once. The app does not: `renderPreview`
// renders one top-level token at a time and enhances that block's boxes through
// `enhanceTaskBoxes`, which decides for itself whether the block can be mapped. The
// difference is the entire fix for #1294, so it has to be what is tested — a whole-document
// render would report the old behaviour passing.

/** The app's render loop, reduced to the two lines these assertions are about. The enhancer
 *  is the shipped one, not a copy: a copy would keep passing while the app broke. */
function renderPreview(doc: Document, src: string): HTMLElement {
  const preview = doc.createElement('div');
  let at = 0;
  for (const token of marked.lexer(src) as Token[]) {
    const block = doc.createElement('div');
    block.innerHTML = marked.parser([token]) as string;
    enhanceTaskBoxes([...block.childNodes], token, src, at);
    at += token.raw.length;
    preview.append(...[...block.childNodes]);
  }
  return preview;
}

/**
 * The one invariant the whole feature rests on: every box the user can click resolves to a
 * real marker, and to the marker at its own index. If it ever fails, a click writes to a
 * line the user did not click on.
 */
function assertClickableSetIsSound(doc: Document, src: string): number {
  const preview = renderPreview(doc, src);
  const clickable = preview.querySelectorAll<HTMLInputElement>('input.doc-task');
  for (const [i, box] of [...clickable].entries()) {
    const edit = toggleTaskAt(src, i);
    assert.ok(edit, `clickable box ${i} resolves to no marker in:\n${src}`);
    assert.match(src.slice(edit.start, edit.end), /^\[[ xX]\]$/, `box ${i} resolved to a non-marker in:\n${src}`);
    // The box shows the state of the marker it resolved to. `edit.text` is what that marker
    // BECOMES, so an un-clicked box must be the opposite of it — which is the app's own
    // consistency check at click time, where the box has already flipped and the two agree.
    assert.equal(box.checked, edit.text === '[ ]', `box ${i} disagrees with its marker in:\n${src}`);
  }
  assert.equal(toggleTaskAt(src, clickable.length), null, `there is a marker with no box in:\n${src}`);
  return clickable.length;
}

describe('notes preview: a forged checkbox cannot reach the clickable set', () => {
  let env: DomEnv;
  before(() => {
    env = installDom();
  });
  after(() => env.cleanup());

  // Each forgery, and how many REAL boxes must survive it. `<li>` is a tag anyone can paste
  // and nothing sanitises the editor, so all three of these render `<li><input …>` — the
  // signature both halves of the mapping key on. Note the last two lex as a `list`, not as
  // `html`: exempting raw HTML by token type would leave them exactly as they were.
  const FORGERIES: [string, string, number][] = [
    [
      'a pasted list-item checkbox before the real ones',
      '<li><p><input type="checkbox" disabled> pasted</p></li>\n\n- [ ] real\n- [x] real two\n',
      2,
    ],
    [
      'a pasted list-item checkbox after the real ones',
      '- [ ] real one\n- [ ] real two\n\n<li><input type="checkbox" disabled> fake</li>\n',
      2,
    ],
    [
      'an item starting with inline HTML, in its own list',
      '- <input type="checkbox" disabled> fake\n\ntext\n\n- [ ] real\n',
      1,
    ],
    // Same block as the real box, so the real one goes with it. Contained, and it now reads
    // as inert instead of posing as a live control.
    ['an item starting with inline HTML, in the SAME list', '- [ ] real\n- <input type="checkbox" disabled> fake\n', 0],
  ];

  for (const [name, src, survivors] of FORGERIES) {
    test(`${name}: the fake is never clickable`, () => {
      const preview = renderPreview(env.document, src);
      assert.ok(
        preview.querySelectorAll('input[type="checkbox"]').length > survivors,
        'the fake is in the DOM, so the test is testing something',
      );
      assert.equal(preview.querySelectorAll('input.doc-task').length, survivors);
      // It keeps the attributes that say it is not a control, rather than being dressed up
      // as one that silently does nothing.
      const fake = [...preview.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
        (b) => !b.classList.contains('doc-task'),
      )!;
      assert.equal(fake.disabled, true);
      assert.equal(fake.getAttribute('aria-label'), null);
    });

    test(`${name}: every surviving box still maps to its own marker`, () => {
      assert.equal(assertClickableSetIsSound(env.document, src), survivors);
    });
  }
});

describe('notes preview: the clickable set survives arbitrary documents', () => {
  let env: DomEnv;
  before(() => {
    env = installDom();
  });
  after(() => env.cleanup());

  // The fix trades "refuse the whole document" for "skip the block", and skipping is only
  // safe while the renderer skips the same block. Nothing about that is obvious by reading,
  // so it is fuzzed: every combination of these fragments, in every order, asserting the
  // no-wrong-write invariant on each.
  const FRAGMENTS = [
    '- [ ] real\n',
    '- [x] done\n',
    '- [ ] parent\n  - [ ] nested\n',
    '1. [ ] ordered\n',
    '> - [ ] quoted\n',
    '```\n- [ ] fenced\n```\n',
    '<li><input type="checkbox" disabled> forged</li>\n',
    '<li><p><input type="checkbox" disabled> forged loose</p></li>\n',
    '- <input type="checkbox" disabled> forged inline\n',
    '- [ ] real <input type="checkbox" disabled>\n',
    '<input type="checkbox" disabled> loose input\n',
    '<div>\n- [ ] hidden\n</div>\n',
    '- [ ]\n',
    '- [ ] a\n===\n',
    '| a |\n| - |\n| - [ ] c |\n',
    'plain text\n',
    '# heading\n',
  ];

  // Joined BOTH ways on purpose. A blank line makes two blocks; without one, a raw-HTML
  // fragment swallows the line below it into the SAME block — which is how a forged box and
  // a marker that renders no box come to cancel each other out. Only the second joiner
  // reaches that, and it was the case the first version of this fuzz missed.
  const JOINERS = ['\n', ''];

  test(`every ordered pair and triple of ${FRAGMENTS.length} fragments keeps the mapping sound`, () => {
    let documents = 0;
    for (const a of FRAGMENTS)
      for (const b of FRAGMENTS)
        for (const j of JOINERS) {
          assertClickableSetIsSound(env.document, a + j + b);
          documents += 1;
          for (const c of FRAGMENTS) {
            assertClickableSetIsSound(env.document, a + j + b + j + c);
            documents += 1;
          }
        }
    assert.ok(documents > 5000, `expected a real sweep, ran ${documents}`);
  });
});
