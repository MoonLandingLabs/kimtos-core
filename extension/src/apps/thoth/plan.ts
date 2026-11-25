// Thoth — pure indexing decisions, kept free of any IndexedDB/model imports so
// they're trivially unit-testable and reusable.

// Stable content hash (FNV-1a, 32-bit) — lets us skip unchanged documents.
export function hashString(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export const docKeyOf = (d: { app: string; docId: string }): string => `${d.app}:${d.docId}`;

export interface ReindexPlan {
  toIndex: string[];
  toRemove: string[];
}

// Compare current documents (key + content hash) against the hashes stored last
// time to decide what to (re)index and what to drop.
export function planReindex(current: { key: string; hash: string }[], stored: Record<string, string>): ReindexPlan {
  const currentKeys = new Set(current.map((d) => d.key));
  const toIndex = current.filter((d) => stored[d.key] !== d.hash).map((d) => d.key);
  const toRemove = Object.keys(stored).filter((k) => !currentKeys.has(k));
  return { toIndex, toRemove };
}
