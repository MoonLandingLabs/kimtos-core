// Denoise worker. Runs the DeepFilterNet3 ONNX graph frame-by-frame, off the main
// thread, and hands back the cleaned PCM.
//
// The frame loop is the whole reason this worker exists. It is ~2x realtime -- a
// ten-minute recording is four minutes of compute -- and `await session.run()` only
// yields a MICROtask, so on the main thread the loop starved the event loop for the
// entire run: the new tab froze, and a reload could not even commit (#275).
//
// Protocol (main -> worker):
//   { type:'run', pcm: Float32Array }     // decoded 48 kHz mono, transferred
// Worker -> main:
//   { type:'progress', progress: EngineProgress }
//   { type:'done', pcm: ArrayBuffer }     // cleaned samples, transferred back
//   { type:'error', message }

import { fetchModelFile } from '../modelFetch.js';
import { CACHE_NAMES } from '@kimtos/config/ui';
import { DENOISER_URL as MODEL_URL } from '../modelHosts.js';
import { type EngineProgress } from './types.js';

const MODEL_CACHE = CACHE_NAMES.models;

// Model I/O contract (verified against the export): 48 kHz mono, 10 ms hops.
const HOP = 480; // samples per frame
const STATE = 45304; // recurrent state vector carried frame-to-frame

interface OrtTensor {
  data: Float32Array | ArrayLike<number>;
}
interface OrtSession {
  run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, OrtTensor>>;
  release?: () => Promise<void>;
}
interface Ort {
  env: { wasm: { numThreads: number; wasmPaths?: unknown } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: { create: (bytes: Uint8Array, opts: Record<string, unknown>) => Promise<OrtSession> };
}

const post = (msg: Record<string, unknown>, transfer: Transferable[] = []): void => {
  (self as unknown as Worker).postMessage(msg, transfer);
};
const report = (progress: EngineProgress): void => post({ type: 'progress', progress });

async function loadSession(): Promise<{ ort: Ort; session: OrtSession }> {
  const ort = (await import('onnxruntime-web')) as unknown as Ort;
  // Single-threaded: extension pages have no SharedArrayBuffer anyway.
  ort.env.wasm.numThreads = 1;
  if (import.meta.env.PROD) {
    // Self-host the wasm (the MV3 CSP blocks CDNs).
    ort.env.wasm.wasmPaths = {
      mjs: '/ort/ort-wasm-simd-threaded.mjs',
      wasm: '/ort/ort-wasm-simd-threaded.wasm',
    };
  } else {
    // Dev: onnxruntime-web has no working default wasm path under Vite — the request
    // falls back to index.html ("expected magic word …"). Load it from a CDN, pinned
    // to the installed version.
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/';
  }
  const bytes = await fetchModelFile(MODEL_URL, MODEL_CACHE, report);
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return { ort, session };
}

async function run(pcm: Float32Array): Promise<Float32Array> {
  const { ort, session } = await loadSession();
  try {
    const n = pcm.length;
    const out = new Float32Array(n);
    let states: OrtTensor = new ort.Tensor('float32', new Float32Array(STATE), [STATE]);
    const atten = new ort.Tensor('float32', new Float32Array([0]), [1]); // 0 = no attenuation limit
    const frames = Math.floor(n / HOP);

    for (let f = 0; f < frames; f += 1) {
      const off = f * HOP;
      const result = await session.run({
        input_frame: new ort.Tensor('float32', pcm.subarray(off, off + HOP), [HOP]),
        states,
        atten_lim_db: atten,
      });
      out.set(result.enhanced_audio_frame.data as ArrayLike<number>, off);
      states = result.new_states;
      if (f % 32 === 0) report({ phase: 'run', label: 'Removing noise', ratio: f / frames });
    }
    // Copy any trailing partial frame through unchanged.
    if (frames * HOP < n) out.set(pcm.subarray(frames * HOP), frames * HOP);
    return out;
  } finally {
    // Free the session's memory; the cached model keeps the next run fast.
    await session.release?.();
  }
}

self.onmessage = async ({ data }: MessageEvent<{ type: string; pcm?: Float32Array }>) => {
  if (data?.type !== 'run' || !data.pcm) return;
  try {
    const out = await run(data.pcm);
    report({ phase: 'run', label: 'Finishing', ratio: 1 });
    post({ type: 'done', pcm: out.buffer }, [out.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
