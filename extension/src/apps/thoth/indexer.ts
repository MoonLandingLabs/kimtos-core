// Thoth — indexer. Gathers the user's own text from every source, chunks and
// embeds anything new or changed, and drops anything deleted — all on-device. The
// decision of *what* to (re)index is pulled out into pure, testable helpers
// (hashString, planReindex); the rest is the IndexedDB + embedder plumbing.

import { dataStore } from '../../lib/dataStore.js';
import { SOURCES, documentsFrom, type KbDoc } from './sources.js';
import { chunkText } from './chunk.js';
import { topK } from './search.js';
import { hashString, docKeyOf, planReindex } from './plan.js';
import type { Embedder } from '../../lib/engines/embed.js';
import * as store from './store.js';

export interface IndexStatus {
  chunks: number;
  docs: number;
}
export async function indexStatus(): Promise<IndexStatus> {
  const chunks = await store.loadChunks();
  return { chunks: chunks.length, docs: new Set(chunks.map((c) => c.docKey)).size };
}

async function gatherDocs(): Promise<KbDoc[]> {
  const docs: KbDoc[] = [];
  for (const src of SOURCES) {
    const records = await dataStore.list(src.collection);
    docs.push(...documentsFrom(src, records));
  }
  return docs;
}

export type ReindexProgress = (done: number, total: number, label: string) => void;

/** How far the index is behind the content: documents to (re)embed, and stale ones to drop. */
export interface IndexGap {
  toIndex: number;
  toRemove: number;
}

// What a rebuild WOULD do, without doing it — so the app can say "12 documents are not
// indexed yet" instead of leaving the user to guess (#356).
//
// It runs the same planReindex() the build runs, over the same hashes, so the number it
// reports and the work a rebuild performs cannot drift apart. An interrupted build lands
// here naturally: it keeps the documents it finished (chunks are saved per document) and
// writes the hash map only at the end, so whatever it did not reach is exactly what this
// counts.
export async function indexGap(): Promise<IndexGap> {
  const docs = await gatherDocs();
  const current = docs.map((d) => ({ key: docKeyOf(d), hash: hashString(d.text) }));
  const plan = planReindex(current, await store.getHashes());
  return { toIndex: plan.toIndex.length, toRemove: plan.toRemove.length };
}

/**
 * Bring the index up to date with the current on-device content.
 *
 * `signal` stops it BETWEEN documents, which is the only place a stop can land honestly: a single
 * document's embedding is one call into the worker with no interruption point inside it, and
 * pretending otherwise would leave a half-written document in the index. Chunks are saved per
 * document, so whatever it finished is kept; the hash map is written for exactly that set, so a
 * later rebuild picks up where this one stopped instead of starting the whole corpus again.
 */
export async function reindex(
  embedder: Embedder,
  onProgress?: ReindexProgress,
  signal?: AbortSignal,
): Promise<IndexStatus> {
  const docs = await gatherDocs();
  const byKey = new Map(docs.map((d) => [docKeyOf(d), d]));
  const current = docs.map((d) => ({ key: docKeyOf(d), hash: hashString(d.text) }));
  const stored = await store.getHashes();
  const plan = planReindex(current, stored);

  // Removed and changed docs both lose their existing chunks (changed ones are
  // re-added below).
  const all = await store.loadChunks();
  await store.removeDocKeys(all, new Set([...plan.toRemove, ...plan.toIndex]));

  let done = 0;
  const indexed = new Set<string>();
  for (const key of plan.toIndex) {
    if (signal?.aborted) break;
    const d = byKey.get(key);
    if (!d) continue;
    const pieces = chunkText(d.text);
    const vectors = await embedder.embedBatch(pieces);
    await store.saveChunks(
      pieces.map((text, i) => ({
        docKey: key,
        app: d.app,
        docId: d.docId,
        title: d.title,
        text,
        vector: vectors[i] ?? new Float32Array(),
      })),
    );
    indexed.add(key);
    done += 1;
    onProgress?.(done, plan.toIndex.length, d.title);
  }

  // Record the hash of every document the index now actually holds — the ones just embedded, plus
  // the ones the plan left alone because they had not changed. A document this run did not reach is
  // simply absent, so the next rebuild plans it again and nothing is embedded twice.
  //
  // Writing `current` wholesale was right only while the loop could not end early: it claimed every
  // document was indexed, so a stopped run left the index permanently missing whatever it had not
  // reached — and `indexGap` would have reported nothing to do.
  const planned = new Set(plan.toIndex);
  const nextHashes: Record<string, string> = {};
  for (const d of current) if (indexed.has(d.key) || !planned.has(d.key)) nextHashes[d.key] = d.hash;
  await store.setHashes(nextHashes);
  return indexStatus();
}

export interface Hit {
  chunk: store.StoredChunk;
  score: number;
}
// Embed the query and return the most similar chunks (the RAG retrieval step).
export async function search(embedder: Embedder, query: string, k = 6, minScore = 0.2): Promise<Hit[]> {
  const qv = await embedder.embed(query);
  const chunks = await store.loadChunks();
  return topK(qv, chunks, k, minScore).map((s) => ({ chunk: s.item, score: s.score }));
}
