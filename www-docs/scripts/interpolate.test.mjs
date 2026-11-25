// Proves the authored-page token pass fills a known token, refuses an unknown one, and leaves
// Vue's own `{{ expr }}` interpolation alone -- so it cannot rot into a pass-through that
// publishes a literal `{{chromeWebStoreUrl}}` to readers (#1009).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, proseList, tokensIn } from './interpolate.mjs';

test('interpolate fills a known token, everywhere it appears', () => {
  const md = 'Open the [listing]({{url}}) — or copy {{url}} by hand.';
  assert.equal(
    interpolate(md, { url: 'https://example.test/x' }),
    'Open the [listing](https://example.test/x) — or copy https://example.test/x by hand.',
  );
});

test('interpolate stringifies a non-string value', () => {
  assert.equal(interpolate('a {{days}}-day window', { days: 3 }), 'a 3-day window');
});

test('interpolate leaves text with no tokens untouched', () => {
  const md = '# Install\n\nNothing to substitute here.\n';
  assert.equal(interpolate(md, { url: 'https://example.test' }), md);
});

test('interpolate throws on an unknown token, naming it and the file', () => {
  assert.throws(
    () => interpolate('see {{typoed}}', { url: 'u' }, 'guides/install.md'),
    (err) => {
      assert.match(err.message, /\{\{typoed\}\}/);
      assert.match(err.message, /guides\/install\.md/);
      return true;
    },
  );
});

test('interpolate reports every unknown token at once', () => {
  assert.throws(() => interpolate('{{one}} and {{two}}', {}), /\{\{one\}\}, \{\{two\}\}/);
});

test("interpolate ignores Vue's spaced {{ expr }} interpolation", () => {
  // VitePress renders Markdown through Vue, so `{{ 1 + 1 }}` is the page's own expression.
  // The token syntax is deliberately space-free so the two can never collide.
  const md = 'Vue: {{ 1 + 1 }} — ours: {{url}}';
  assert.equal(interpolate(md, { url: 'U' }), 'Vue: {{ 1 + 1 }} — ours: U');
});

test('tokensIn reports each token once, and none for a page that uses none', () => {
  assert.deepEqual(tokensIn('{{a}} then {{b}} then {{a}} again'), new Set(['a', 'b']));
  assert.equal(tokensIn('nothing to see').size, 0);
});

test("tokensIn ignores Vue's spaced {{ expr }} interpolation too", () => {
  // It feeds the "declared but unused" check, so a false positive here would report a live
  // token as dead — the two readers of the syntax must agree exactly.
  assert.deepEqual(tokensIn('{{ 1 + 1 }} and {{url}}'), new Set(['url']));
});

test('proseList reads as a sentence, not as generated output', () => {
  // The app-name tokens sit mid-sentence in the authored guides, so the join has to be
  // the one a person would write.
  assert.equal(proseList([]), '');
  assert.equal(proseList(['Notes']), 'Notes');
  assert.equal(proseList(['Notes', 'Tasks']), 'Notes and Tasks');
  assert.equal(proseList(['Notes', 'Tasks', 'Tabs']), 'Notes, Tasks and Tabs');
});

test('proseList substitutes into a sentence unchanged', () => {
  assert.equal(
    interpolate('The default apps — {{defaultAppNames}} — install themselves.', {
      defaultAppNames: proseList(['Notes', 'Tasks', 'Tabs']),
    }),
    'The default apps — Notes, Tasks and Tabs — install themselves.',
  );
});

test('tokensIn and interpolate agree after one another (no shared regex state)', () => {
  const md = '{{a}} {{b}} {{a}}';
  assert.deepEqual(tokensIn(md), new Set(['a', 'b']));
  assert.equal(interpolate(md, { a: '1', b: '2' }), '1 2 1');
  assert.deepEqual(tokensIn(md), new Set(['a', 'b']));
});
