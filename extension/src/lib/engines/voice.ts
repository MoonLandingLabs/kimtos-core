// Voice Studio engine (main-thread side) — turns text into speech with Kokoro-82M,
// entirely on-device. The heavy synthesis runs in voice.worker.js; this module owns
// one long-lived worker (so previews and re-renders don't reload the ~90 MB model),
// correlates its messages by job id, and stitches the per-chunk PCM into one clip
// with a short crossfade at every seam (see lib/audioAssembly).
//
// Nothing leaves the browser: the model + voice files are fetched from our CDN and
// cached; the audio is generated locally.
//
// `onProgress` receives the normalized `{ phase, label, ratio, loaded, total }`.

import { type OnProgress, type EngineProgress } from './types.js';
import { crossfadeConcat, encodeWav } from '../audioAssembly.js';
import { CACHE_NAMES } from '@kimtos/config/ui';

// Kokoro-82M v1.0 as exported to ONNX for Transformers.js, loaded from Hugging Face.
// Single definition — the worker defaults to the same id.
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// q8 (`model_quantized.onnx`, ~90 MB) is the size/quality sweet spot for the WASM
// CPU path the extension runs on (it is not cross-origin isolated, so ORT is
// single-threaded). Verified to produce clean, intelligible speech.
const DTYPE = 'q8';
export const KOKORO_SAMPLE_RATE = 24000;

export interface SynthResult {
  pcm: Float32Array;
  sampleRate: number;
}

interface WorkerReply {
  type: 'progress' | 'chunk' | 'done' | 'ready' | 'error';
  id: string;
  progress?: EngineProgress;
  index?: number;
  total?: number;
  pcm?: ArrayBuffer | Float32Array;
  sampleRate?: number;
  message?: string;
}

type Job = {
  onProgress?: OnProgress;
  chunks: Float32Array[];
  sampleRate: number;
  resolve: (r: SynthResult) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null = null;
const jobs = new Map<string, Job>();
let seq = 0;

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./voice.worker.js', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }: MessageEvent<WorkerReply>): void => {
    const job = jobs.get(data.id);
    if (!job) return;
    switch (data.type) {
      case 'progress':
        if (data.progress) job.onProgress?.(data.progress);
        break;
      case 'chunk': {
        if (data.pcm) job.chunks[data.index ?? job.chunks.length] = new Float32Array(data.pcm as ArrayBuffer);
        if (data.sampleRate) job.sampleRate = data.sampleRate;
        break;
      }
      case 'ready':
        jobs.delete(data.id);
        job.resolve({ pcm: new Float32Array(0), sampleRate: job.sampleRate });
        break;
      case 'done': {
        jobs.delete(data.id);
        const pcm = crossfadeConcat(job.chunks, job.sampleRate);
        job.resolve({ pcm, sampleRate: job.sampleRate });
        break;
      }
      case 'error':
        jobs.delete(data.id);
        job.reject(new Error(data.message || 'Synthesis failed'));
        break;
    }
  };
  // A worker that dies (out of memory, a blocked wasm load) must not leave callers
  // hanging on promises that can never settle.
  w.onerror = (e): void => {
    const err = new Error(e.message || 'The voice engine stopped unexpectedly');
    for (const job of jobs.values()) job.reject(err);
    jobs.clear();
    worker = null;
  };
  worker = w;
  return w;
}

/**
 * Synthesise speech from text. Splits long input at sentence boundaries, renders
 * each chunk in the worker, and returns one continuous crossfaded clip.
 */
export function synthesizeSpeech(
  text: string,
  {
    voice,
    speed = 1,
    onProgress,
    signal,
  }: { voice: string; speed?: number; onProgress?: OnProgress; signal?: AbortSignal } = { voice: '' },
): Promise<SynthResult> {
  const w = ensureWorker();
  const id = `s${(seq += 1)}`;
  return new Promise<SynthResult>((resolve, reject) => {
    jobs.set(id, { onProgress, chunks: [], sampleRate: KOKORO_SAMPLE_RATE, resolve, reject });
    if (signal) {
      if (signal.aborted) {
        jobs.delete(id);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          if (!jobs.has(id)) return;
          jobs.delete(id);
          w.postMessage({ type: 'cancel', id });
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }
    w.postMessage({ type: 'run', id, text, voice, speed, model: MODEL_ID, dtype: DTYPE });
  });
}

/** Synthesise and encode straight to a WAV blob (export path). */
export async function synthesizeToWav(
  text: string,
  opts: { voice: string; speed?: number; onProgress?: OnProgress; signal?: AbortSignal },
): Promise<Blob> {
  const { pcm, sampleRate } = await synthesizeSpeech(text, opts);
  return encodeWav(pcm, sampleRate);
}

/** Download + warm the model without synthesising (install / onboarding). */
export function prefetchVoiceModel(onProgress?: OnProgress): Promise<void> {
  const w = ensureWorker();
  const id = `p${(seq += 1)}`;
  return new Promise<void>((resolve, reject) => {
    jobs.set(id, {
      onProgress,
      chunks: [],
      sampleRate: KOKORO_SAMPLE_RATE,
      resolve: () => resolve(),
      reject,
    });
    w.postMessage({ type: 'prefetch', id, model: MODEL_ID, dtype: DTYPE });
  });
}

/** Where Voice Studio caches the samples it renders for the voice picker (a blob-key
 *  prefix, app-id-prefixed per storage convention 6). Declared here, next to the code
 *  that frees it, so the uninstall path does not have to import the app. */
export const PREVIEW_BLOB_PREFIX = 'voicestudio:preview/';

/** Is the speech model already on this device? The UI asks so it can say "this needs a
 *  ~90 MB download" BEFORE the user presses something and waits at a blank screen —
 *  the model is fetched lazily on first use, and silence is not an answer (#1152). */
export async function isVoiceModelCached(): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAMES.transformers);
    return (await cache.keys()).some((req) => /kokoro/i.test(req.url));
  } catch {
    return false; // no Cache API (or it is blocked): assume a download is needed
  }
}

/** Free everything the voice feature cached (uninstall): the Kokoro weights + voice
 *  files, and the rendered voice samples.
 *
 *  The weights share the transformers cache with other on-device models, so delete ONLY
 *  the Kokoro entries (model files and `voices/*.bin` both carry "Kokoro" in the URL).
 *  The samples are a CACHE, not the user's data — they are re-renderable from the model —
 *  so they go here rather than in the app's `clearData`, which only runs when the user
 *  asks to erase their clips as well. */
export async function removeVoiceModel(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAMES.transformers);
    const keys = await cache.keys();
    await Promise.all(keys.filter((req) => /kokoro/i.test(req.url)).map((req) => cache.delete(req)));
  } catch {
    /* ignore */
  }
  try {
    const { dataStore } = await import('../dataStore.js');
    await dataStore.clearBlobsByPrefix(PREVIEW_BLOB_PREFIX);
  } catch {
    /* ignore */
  }
}

/** Terminate the worker and drop the loaded model (app teardown). */
export function disposeVoiceEngine(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  jobs.clear();
}
