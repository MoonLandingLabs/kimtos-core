// On-device text embeddings via Transformers.js (all-MiniLM-L6-v2, ONNX/WASM).
// Runs entirely in the browser — text never leaves the device. Model files are
// cached by Transformers.js (Cache Storage) so the ~23 MB download happens once.
// Produces 384-dim, L2-normalized vectors (so cosine == dot product). Powers Thoth's
// knowledge base.
//
// The model runs in a Web Worker (embed.worker.js), like the other engines: indexing
// embeds a document at a time in a loop, and on the main thread that competed with the
// UI of the very app showing its progress (#278 — the same class as #275/#315). The
// worker is resident, because the embedder is: Thoth holds it across a whole index
// build and then uses it for every search query, and disposes it when the app closes.

import { type OnProgress, type EngineProgress } from './types.js';
import { CACHE_NAMES } from '@kimtos/config/ui';

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
const EMBED_DIM = 384;

interface WorkerMsg {
  type: 'progress' | 'ready' | 'embedded' | 'error';
  progress?: EngineProgress;
  id?: number;
  vectors?: ArrayBuffer;
  dim?: number;
  message?: string;
}
interface Waiter {
  resolve: (v: { vectors: ArrayBuffer; dim: number }) => void;
  reject: (e: Error) => void;
}

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  dispose(): void;
}

export async function createEmbedder({ onProgress }: { onProgress?: OnProgress } = {}): Promise<Embedder> {
  const worker = new Worker(new URL('./embed.worker.js', import.meta.url), { type: 'module' });
  // An index build embeds one document at a time, and a search can fire while it runs,
  // so a reply is routed back to its own caller by id.
  const pending = new Map<number, Waiter>();
  let ready: { resolve: () => void; reject: (e: Error) => void } | null = null;
  let nextId = 1;

  worker.onmessage = ({ data }: MessageEvent<WorkerMsg>) => {
    if (data.type === 'progress' && data.progress) onProgress?.(data.progress);
    else if (data.type === 'ready') ready?.resolve();
    else if (data.type === 'embedded' && data.id != null && data.vectors)
      pending.get(data.id)?.resolve({ vectors: data.vectors, dim: data.dim ?? EMBED_DIM });
    else if (data.type === 'error') {
      const err = new Error(data.message || 'The search model failed');
      if (data.id != null) pending.get(data.id)?.reject(err);
      else {
        ready?.reject(err);
        // A failure with no id belongs to no single call — fail everything waiting.
        for (const p of pending.values()) p.reject(err);
        pending.clear();
      }
    }
    if (data.id != null) pending.delete(data.id);
  };
  // A worker that dies must not leave an indexing loop waiting on a promise that can
  // never settle.
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The search model stopped unexpectedly');
    ready?.reject(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  await new Promise<void>((resolve, reject) => {
    ready = { resolve, reject };
    worker.postMessage({ type: 'load' });
  });

  const embedTexts = (texts: string[]): Promise<{ vectors: ArrayBuffer; dim: number }> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'embed', id, texts });
    });
  };

  return {
    async embed(text) {
      const { vectors, dim } = await embedTexts([text || ' ']);
      return new Float32Array(vectors).slice(0, dim);
    },
    async embedBatch(texts) {
      if (!texts.length) return [];
      const { vectors, dim } = await embedTexts(texts);
      const data = new Float32Array(vectors);
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i++) out.push(data.slice(i * dim, (i + 1) * dim));
      return out;
    },
    dispose() {
      worker.postMessage({ type: 'dispose' });
      worker.terminate();
    },
  };
}

// Prefetch the model at install, so the first index/search never triggers a download. Loading
// the worker pipeline caches the ~23 MB via Transformers.js; then tear the worker back down.
export async function prefetchEmbedModel(onProgress?: OnProgress): Promise<void> {
  const embedder = await createEmbedder({ onProgress });
  embedder.dispose();
}

// Free this app's cached model files (uninstall). Only deletes the all-MiniLM entries, so a
// co-installed Transformers.js app is untouched — exactly as removeGrammarModel scopes to FLAN-T5.
export async function removeEmbedModel(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAMES.transformers);
    const keys = await cache.keys();
    await Promise.all(keys.filter((req) => /all-minilm/i.test(req.url)).map((req) => cache.delete(req)));
  } catch {
    /* ignore */
  }
}
