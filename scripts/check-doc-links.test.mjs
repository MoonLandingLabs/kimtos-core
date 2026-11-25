// Tests for check-doc-links: the link parser is exercised against the false positives that would
// otherwise make it delete honest links -- code fences, link titles, anchors, reference defs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokenLinks } from './check-doc-links.mjs';

// An `exists` stub: only these absolute-ish paths resolve. brokenLinks resolves targets against
// fromDir, so we assert on the resolved tail via endsWith in a small closure.
const existsFor = (present) => (abs) => present.some((p) => abs.endsWith(p));

test('flags a relative link whose target is missing', () => {
  const bad = brokenLinks('See [the guide](docs/gone.md).', '/repo', existsFor([]));
  assert.equal(bad.length, 1);
  assert.equal(bad[0].target, 'docs/gone.md');
  assert.equal(bad[0].line, 1);
});

test('passes a relative link whose target exists', () => {
  const ok = brokenLinks('See [the guide](docs/here.md).', '/repo', existsFor(['/repo/docs/here.md']));
  assert.deepEqual(ok, []);
});

test('ignores external links and mailto/tel', () => {
  const text = '[site](https://example.test) [mail](mailto:a@b.com) [t](tel:+1) [proto](//cdn.x/y)';
  assert.deepEqual(brokenLinks(text, '/repo', existsFor([])), []);
});

test('ignores pure in-page anchors', () => {
  assert.deepEqual(brokenLinks('[jump](#verification)', '/repo', existsFor([])), []);
});

test('trims a #fragment and checks only the file part', () => {
  const ok = brokenLinks('[x](CLAUDE.md#git)', '/repo', existsFor(['/repo/CLAUDE.md']));
  assert.deepEqual(ok, []);
  const bad = brokenLinks('[x](nope.md#git)', '/repo', existsFor([]));
  assert.equal(bad.length, 1);
});

test('does not read links inside fenced code blocks', () => {
  const text = ['```ts', 'const a = [x](totally-fake.md);', '```', '[real](real.md)'].join('\n');
  const bad = brokenLinks(text, '/repo', existsFor(['/repo/real.md']));
  assert.deepEqual(bad, []);
});

test('does not read links inside inline code', () => {
  assert.deepEqual(brokenLinks('use `[x](fake.md)` literally', '/repo', existsFor([])), []);
});

test('handles a link destination with a title', () => {
  const ok = brokenLinks('[x](doc.md "the title")', '/repo', existsFor(['/repo/doc.md']));
  assert.deepEqual(ok, []);
});

test('handles a <bracketed> destination', () => {
  const ok = brokenLinks('[x](<a b.md>)', '/repo', existsFor(['/repo/a b.md']));
  assert.deepEqual(ok, []);
});

test('checks reference-style link definitions', () => {
  const bad = brokenLinks('[label]: docs/missing.md', '/repo', existsFor([]));
  assert.equal(bad.length, 1);
  assert.equal(bad[0].target, 'docs/missing.md');
});

test('resolves parent-relative links from the file dir', () => {
  const ok = brokenLinks('[up](../../CLAUDE.md)', '/repo/docs/extension', existsFor(['/repo/CLAUDE.md']));
  assert.deepEqual(ok, []);
});

test('resolves a directory target (trailing slash)', () => {
  const ok = brokenLinks(
    '[skill](../../.claude/skills/new-app/)',
    '/repo/docs/x',
    existsFor(['/repo/.claude/skills/new-app']),
  );
  assert.deepEqual(ok, []);
});
