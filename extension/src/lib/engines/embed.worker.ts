// Embedding worker (all-MiniLM-L6-v2). Runs the model off the main thread.
//
// The embedder is RESIDENT, like the grammar one: Thoth keeps it loaded to index a
// document at a time and then to embed each search query, so the worker stays alive
// until the app disposes it. Every call carries an id, so a reply is matched to its
// request when several are in flight (#278).
//
// Protocol (main -> worker):
//   { type:'load' }
//   { type:'embed', id, texts }   // one or many; always answered with one vector each
//   { type:'dispose' }
// Worker -> main:
//   { type:'ready' } | { type:'progress', progress }
//   { type:'embedded', id, vectors, dim } | { type:'error', id?, message }

import { pipeline as _pipeline, env as _env } from '@huggingface/transformers';
import { type EngineProgress } from './types.js';
import { configureBackend, makeProgressCallback, friendly, type TransformersEnv } from './transformersWorker.js';

interface Tensor {
  data: Float32Array | number[];
  dims?: number[];
}
interface Extractor {
  (input: string | string[], opts?: Record<string, unknown>): Promise<Tensor>;
  dispose?: () => void | Promise<void>;
}
type PipelineFn = (task: string, model: string, opts: Record<string, unknown>) => Promise<Extractor>;

const pipeline = _pipeline as unknown as PipelineFn;
const env = _env as unknown as TransformersEnv;

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

const workerSelf = self as unknown as { postMessage: (m: unknown, transfer?: Transferable[]) => void };
const post = (msg: unknown, transfer: Transferable[] = []): void => workerSelf.postMessage(msg, transfer);
const report = (progress: EngineProgress): void => post({ type: 'progress', progress });

let extractor: Extractor | null = null;

async function load(): Promise<Extractor> {
  configureBackend(env);
  return pipeline('feature-extraction', EMBED_MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: makeProgressCallback((p) => report({ ...p, label: 'Downloading search model' })),
  });
}

const toF32 = (d: Float32Array | number[]): Float32Array => (d instanceof Float32Array ? d : Float32Array.from(d));

self.onmessage = async ({ data }: MessageEvent<{ type: string; id?: number; texts?: string[] }>) => {
  try {
    if (data.type === 'load') {
      extractor ??= await load();
      post({ type: 'ready' });
      return;
    }
    if (data.type === 'dispose') {
      await extractor?.dispose?.();
      extractor = null;
      return;
    }
    if (data.type === 'embed') {
      extractor ??= await load();
      const texts = data.texts?.length ? data.texts : [' '];
      const out = await extractor(texts, { pooling: 'mean', normalize: true });
      const flat = toF32(out.data);
      // One flat buffer for every vector, transferred once rather than copied per text.
      post({ type: 'embedded', id: data.id, vectors: flat.buffer, dim: out.dims?.[out.dims.length - 1] ?? 384 }, [
        flat.buffer,
      ]);
    }
  } catch (err) {
    post({ type: 'error', id: data.id, message: friendly(err) });
  }
};
