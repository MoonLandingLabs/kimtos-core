// Thoth — text chunking. Splits a document into overlapping word-windows small
// enough to embed well but large enough to carry context. Pure and deterministic
// so it's straightforward to unit-test. Overlap keeps a sentence that straddles a
// boundary retrievable from either chunk.

export interface ChunkOptions {
  /** Target chunk length in words. */
  size?: number;
  /** Words shared between consecutive chunks. */
  overlap?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = Math.max(20, opts.size ?? 180);
  const overlap = Math.min(size - 1, Math.max(0, opts.overlap ?? 30));
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  if (words.length <= size) return [words.join(' ')];

  const step = size - overlap;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    chunks.push(words.slice(i, i + size).join(' '));
    if (i + size >= words.length) break;
  }
  return chunks;
}
