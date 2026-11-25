// Thoth — vector search. Brute-force cosine similarity over stored chunk vectors.
// For a personal knowledge base (thousands, not millions, of chunks) a linear
// scan over Float32Arrays is plenty fast and needs no index structure. Pure.

export function cosine(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export interface Scored<T> {
  item: T;
  score: number;
}

// Top-k most similar items to `query`. Returns them sorted best-first, optionally
// filtered to a minimum similarity so unrelated chunks don't pad the context.
export function topK<T extends { vector: Float32Array }>(
  query: Float32Array,
  items: readonly T[],
  k: number,
  minScore = 0,
): Scored<T>[] {
  const scored: Scored<T>[] = [];
  for (const item of items) {
    const score = cosine(query, item.vector);
    if (score >= minScore) scored.push({ item, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, Math.max(0, k));
}
