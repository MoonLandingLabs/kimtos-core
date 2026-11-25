// The rules behind the column list: what a file is called, how the columns sort, and what a
// search matches. Kept out of index.ts and free of the DOM so they can be tested — the sort
// comparator in particular is the kind of code that looks right and is quietly wrong.

import { detectKind, type ViewKind } from './viewer.js';

export interface ListNode {
  id: string;
  parentId: string;
  type: 'folder' | 'file';
  name: string;
  kind?: 'text' | 'blob';
  size?: number;
  mime?: string;
  updatedAt?: number;
  createdAt?: number;
}

export type SortKey = 'name' | 'size' | 'kind' | 'modified';
export type SortDir = 'asc' | 'desc';

const KIND_LABELS: Record<ViewKind, string> = {
  image: 'Image',
  pdf: 'PDF document',
  audio: 'Audio',
  video: 'Video',
  json: 'JSON',
  markdown: 'Markdown',
  code: 'Code',
  text: 'Plain text',
  archive: 'Archive',
  binary: 'Document',
};

// The Kind column. A folder is a folder; everything else is named by what the viewer will
// actually DO with it, so the column never promises a preview the app cannot give.
export function kindLabel(node: ListNode): string {
  if (node.type === 'folder') return 'Folder';
  return KIND_LABELS[detectKind(node.name, node.mime || '')];
}

// The effective size of a node for the Size column. A file carries its own `size`; a
// folder has none of its own, so its size is the sum of what it contains — which the
// caller computes (it needs the whole tree) and injects. The default keeps a folder at
// 0, so a caller that does not supply one sees the old behaviour.
export type SizeOf = (node: ListNode) => number;
const ownSize: SizeOf = (n) => n.size || 0;

// Folders before files — always, in every column and both directions. That is what every file
// manager does: reversing the Size column should not scatter the folders through the files.
function compare(a: ListNode, b: ListNode, key: SortKey, sizeOf: SizeOf): number {
  switch (key) {
    case 'size':
      // Files by their own size, folders by their aggregate (contents) size — the same
      // number the Size column shows. Ties fall back to the name and stay stable.
      return sizeOf(a) - sizeOf(b) || a.name.localeCompare(b.name);
    case 'kind':
      return kindLabel(a).localeCompare(kindLabel(b)) || a.name.localeCompare(b.name);
    case 'modified':
      return (a.updatedAt || 0) - (b.updatedAt || 0) || a.name.localeCompare(b.name);
    default:
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }
}

export function sortNodes<T extends ListNode>(nodes: T[], key: SortKey, dir: SortDir, sizeOf: SizeOf = ownSize): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  return [...nodes].sort((a, b) => {
    const folders = Number(b.type === 'folder') - Number(a.type === 'folder');
    if (folders) return folders; // NOT multiplied by sign — see above
    return compare(a, b, key, sizeOf) * sign;
  });
}

// Case-insensitive substring. Deliberately not a fuzzy match: in a file manager you usually
// know the name, and a fuzzy match on a short query returns the whole disk.
export const matches = (node: ListNode, query: string): boolean =>
  node.name.toLowerCase().includes(query.trim().toLowerCase());

// Search is RECURSIVE from the folder you are in — a search that only looked at the folder
// already on screen would be a filter, not a search.
export function searchTree<T extends ListNode>(nodes: T[], rootId: string, query: string): T[] {
  const q = query.trim();
  if (!q) return [];
  const out: T[] = [];
  const walk = (parentId: string): void => {
    for (const n of nodes.filter((x) => x.parentId === parentId)) {
      if (matches(n, q)) out.push(n);
      if (n.type === 'folder') walk(n.id);
    }
  };
  walk(rootId);
  return out;
}

// The Modified column. Today's files show a time, everything else a date — the shape every
// file manager uses, because the year on a file you touched an hour ago is noise.
export function fmtWhen(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
