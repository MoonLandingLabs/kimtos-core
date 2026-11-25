import test from 'node:test';
import assert from 'node:assert/strict';
import { kindLabel, sortNodes, matches, searchTree, fmtWhen, type ListNode } from './listing.js';

const folder = (id: string, name: string, parentId = ''): ListNode => ({ id, name, parentId, type: 'folder' });
const file = (id: string, name: string, extra: Partial<ListNode> = {}): ListNode => ({
  id,
  name,
  parentId: '',
  type: 'file',
  kind: 'blob',
  ...extra,
});

test('kindLabel names a folder a folder', () => {
  assert.equal(kindLabel(folder('f', 'Docs')), 'Folder');
});

test('kindLabel names a file by what the viewer will do with it', () => {
  assert.equal(kindLabel(file('a', 'data.json')), 'JSON');
  assert.equal(kindLabel(file('b', 'report.pdf')), 'PDF document');
  assert.equal(kindLabel(file('c', 'cat.png')), 'Image');
  assert.equal(kindLabel(file('d', 'notes.md')), 'Markdown');
  assert.equal(kindLabel(file('e', 'blob.xyz')), 'Document');
});

test('folders sort before files — in BOTH directions', () => {
  const nodes = [file('a', 'apple.txt'), folder('z', 'Zebra'), file('b', 'banana.txt')];
  assert.deepEqual(
    sortNodes(nodes, 'name', 'asc').map((n) => n.name),
    ['Zebra', 'apple.txt', 'banana.txt'],
  );
  // Reversing the sort must NOT push the folder to the bottom — every file manager keeps
  // folders on top. This is the assertion the obvious one-liner comparator fails.
  assert.deepEqual(
    sortNodes(nodes, 'name', 'desc').map((n) => n.name),
    ['Zebra', 'banana.txt', 'apple.txt'],
  );
});

test('folders stay on top when sorting by size, too', () => {
  const nodes = [file('a', 'big.bin', { size: 900 }), folder('z', 'Docs'), file('b', 'small.bin', { size: 10 })];
  assert.deepEqual(
    sortNodes(nodes, 'size', 'desc').map((n) => n.name),
    ['Docs', 'big.bin', 'small.bin'],
  );
});

test('size sorts numerically, not as text', () => {
  const nodes = [file('a', 'a', { size: 9 }), file('b', 'b', { size: 100 })];
  assert.deepEqual(
    sortNodes(nodes, 'size', 'asc').map((n) => n.name),
    ['a', 'b'],
  );
});

test('an injected sizeOf sorts folders by their aggregate size (still grouped) (#645)', () => {
  // Two folders whose own `size` is 0; the injected sizeOf gives them their contents' total.
  const big = folder('big', 'Big'); // 5000 inside
  const small = folder('small', 'Small'); // 100 inside
  const nodes = [small, file('f', 'mid.bin', { size: 500 }), big];
  const sizeOf = (n: ListNode): number => (n.type === 'folder' ? { big: 5000, small: 100 }[n.id] || 0 : n.size || 0);
  // Descending: folders stay on top (grouped), ordered by aggregate size; the file last.
  assert.deepEqual(
    sortNodes(nodes, 'size', 'desc', sizeOf).map((n) => n.name),
    ['Big', 'Small', 'mid.bin'],
  );
  // Ascending: folders still on top, smaller aggregate first.
  assert.deepEqual(
    sortNodes(nodes, 'size', 'asc', sizeOf).map((n) => n.name),
    ['Small', 'Big', 'mid.bin'],
  );
  // Without sizeOf, folders fall back to name order (the old, unchanged default).
  assert.deepEqual(
    sortNodes(nodes, 'size', 'asc').map((n) => n.name),
    ['Big', 'Small', 'mid.bin'],
  );
});

test('name sorts naturally: file10 comes after file9', () => {
  const nodes = [file('a', 'file10.txt'), file('b', 'file9.txt')];
  assert.deepEqual(
    sortNodes(nodes, 'name', 'asc').map((n) => n.name),
    ['file9.txt', 'file10.txt'],
  );
});

test('modified sorts by time, newest first when descending', () => {
  const nodes = [file('a', 'old', { updatedAt: 1000 }), file('b', 'new', { updatedAt: 9000 })];
  assert.deepEqual(
    sortNodes(nodes, 'modified', 'desc').map((n) => n.name),
    ['new', 'old'],
  );
});

test('sortNodes does not mutate its input', () => {
  const nodes = [file('a', 'b.txt'), file('b', 'a.txt')];
  sortNodes(nodes, 'name', 'asc');
  assert.deepEqual(
    nodes.map((n) => n.name),
    ['b.txt', 'a.txt'],
  );
});

test('matches is case-insensitive and ignores surrounding space', () => {
  assert.equal(matches(file('a', 'Invoice.pdf'), '  invoice '), true);
  assert.equal(matches(file('a', 'Invoice.pdf'), 'voice'), true);
  assert.equal(matches(file('a', 'Invoice.pdf'), 'receipt'), false);
});

test('search recurses into subfolders — a filter of the visible rows would miss this', () => {
  const nodes: ListNode[] = [
    folder('d', 'Docs'),
    folder('d2', 'Deep', 'd'),
    file('x', 'buried.txt', { parentId: 'd2' }),
    file('y', 'top.txt'),
  ];
  assert.deepEqual(
    searchTree(nodes, '', 'buried').map((n) => n.id),
    ['x'],
  );
});

test('search is scoped to the folder you are in', () => {
  const nodes: ListNode[] = [
    folder('a', 'A'),
    folder('b', 'B'),
    file('x', 'report.txt', { parentId: 'a' }),
    file('y', 'report.txt', { parentId: 'b' }),
  ];
  assert.deepEqual(
    searchTree(nodes, 'b', 'report').map((n) => n.id),
    ['y'],
  );
});

test('an empty query finds nothing, rather than everything', () => {
  const nodes = [file('x', 'a.txt'), file('y', 'b.txt')];
  assert.deepEqual(searchTree(nodes, '', '   '), []);
});

test('fmtWhen shows a time today and a date otherwise', () => {
  const now = new Date();
  assert.match(fmtWhen(now.getTime()), /\d/);
  assert.match(fmtWhen(new Date(2020, 0, 15).getTime()), /2020/);
  assert.equal(fmtWhen(undefined), '—');
  assert.equal(fmtWhen(0), '—');
});
