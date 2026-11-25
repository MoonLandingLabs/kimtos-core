// Notes' preview renders incrementally (#838): the page is lexed into top-level
// blocks, and only the run of blocks that changed is re-rendered and spliced into
// the DOM. Two things keep that honest, and both are tested here:
//
//  1. diffBlocks must bound the changed run exactly — replace too little and the
//     preview shows stale content, replace too much and a keystroke rebuilds the
//     whole page again (the very lag the change removes).
//  2. Rendering block-by-block through marked's lexer + parser must produce the
//     SAME HTML as parsing the whole document at once — otherwise the fast path
//     silently drifts from the correct one on the next marked upgrade.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Marked, type Token } from 'marked';
import { diffBlocks, linksKey } from './previewDiff.js';

describe('diffBlocks — smallest replaced run', () => {
  test('identical lists are a no-op', () => {
    const d = diffBlocks(['a', 'b', 'c'], ['a', 'b', 'c']);
    assert.equal(d.same, true);
  });

  test('a one-block edit touches exactly that block', () => {
    const d = diffBlocks(['a', 'b', 'c'], ['a', 'B', 'c']);
    assert.deepEqual(d, { lo: 1, prevEnd: 2, nextEnd: 2, same: false });
  });

  test('an insertion removes nothing', () => {
    const d = diffBlocks(['a', 'c'], ['a', 'b', 'c']);
    assert.deepEqual(d, { lo: 1, prevEnd: 1, nextEnd: 2, same: false });
  });

  test('a deletion inserts nothing', () => {
    const d = diffBlocks(['a', 'b', 'c'], ['a', 'c']);
    assert.deepEqual(d, { lo: 1, prevEnd: 2, nextEnd: 1, same: false });
  });

  test('edits at the very start and very end', () => {
    assert.deepEqual(diffBlocks(['a', 'b'], ['A', 'b']), { lo: 0, prevEnd: 1, nextEnd: 1, same: false });
    assert.deepEqual(diffBlocks(['a', 'b'], ['a', 'B']), { lo: 1, prevEnd: 2, nextEnd: 2, same: false });
  });

  test('empty to something and back', () => {
    assert.deepEqual(diffBlocks([], ['a']), { lo: 0, prevEnd: 0, nextEnd: 1, same: false });
    assert.deepEqual(diffBlocks(['a'], []), { lo: 0, prevEnd: 1, nextEnd: 0, same: false });
  });

  test('a repeated block cannot fool the bounds', () => {
    // prefix/suffix scans must not overlap: with prev=[x,x] and next=[x], a naive
    // suffix scan would step past the prefix and produce a negative-length run.
    const d = diffBlocks(['x', 'x'], ['x']);
    assert.equal(d.lo <= d.prevEnd && d.lo <= d.nextEnd, true);
    // Applying the diff must reproduce `next`.
    const prev = ['x', 'x'];
    const applied = [...prev.slice(0, d.lo), ...['x'].slice(d.lo, d.nextEnd), ...prev.slice(d.prevEnd)];
    assert.deepEqual(applied, ['x']);
  });
});

describe('per-block rendering matches whole-document rendering', () => {
  // The app's real instance adds a highlight extension, but the invariant under
  // test — parser([token]) with the links table equals parse(doc) — is a property
  // of marked's lexer/parser contract itself, so a plain instance proves it.
  const md = new Marked();

  const renderByBlocks = (doc: string): string => {
    const tokens = md.lexer(doc);
    let html = '';
    for (const token of tokens) {
      const one = [token] as Token[] & { links?: unknown };
      one.links = tokens.links;
      html += md.parser(one);
    }
    return html;
  };

  const CASES: Record<string, string> = {
    'headings, emphasis, lists': '# Title\n\nSome **bold** and *italic*.\n\n- one\n- two\n\n1. first\n2. second\n',
    'fenced code with blank lines inside': 'Before\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter\n',
    'loose list (blank line between items)': '- one\n\n- two\n\n- three\n',
    'reference links defined at the bottom':
      'See [the docs][d] and [home].\n\n[d]: https://docs.example.com "Docs"\n[home]: https://example.com\n',
    'blockquote and table': '> quoted\n> lines\n\n| a | b |\n| - | - |\n| 1 | 2 |\n',
    'setext heading': 'Title\n=====\n\nBody text.\n',
  };

  for (const [name, doc] of Object.entries(CASES)) {
    test(name, () => {
      assert.equal(renderByBlocks(doc), md.parse(doc));
    });
  }
});

describe('linksKey — cache fingerprint of the reference-link table', () => {
  test('stable across definition order', () => {
    const a = { x: { href: 'https://a', title: null }, y: { href: 'https://b', title: 't' } };
    const b = { y: { href: 'https://b', title: 't' }, x: { href: 'https://a', title: null } };
    assert.equal(linksKey(a), linksKey(b));
  });

  test('changes when a definition changes, and distinguishes id from href', () => {
    const a = { x: { href: 'https://a', title: null } };
    assert.notEqual(linksKey(a), linksKey({ x: { href: 'https://b', title: null } }));
    assert.notEqual(linksKey({ 'a b': { href: 'c', title: null } }), linksKey({ a: { href: 'b c', title: null } }));
  });

  test('empty and missing tables agree', () => {
    assert.equal(linksKey(undefined), linksKey({}));
  });
});
