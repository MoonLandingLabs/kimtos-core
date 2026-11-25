// In-browser grammar & spelling correction via a FLAN-T5 sequence-to-sequence
// model (Transformers.js, ONNX/WASM). Runs entirely on-device — the text never
// leaves the browser. The model FILES are cached by Transformers.js (Cache
// Storage) so the download happens only once. `createCorrector` keeps the session
// resident for fast live re-checks; the caller disposes it when the app closes.
//
// The model runs in a Web Worker (grammar.worker.js). It used to run on the main
// thread, where an awaited generation loop starved the event loop — and this is the
// engine where that hurt most, because Grammit re-checks WHILE THE USER TYPES: every
// keystroke competed with the model for the same thread (#315). The worker is resident
// too, so the session is loaded once and torn down on dispose().
//
// FLAN-T5 is Apache-2.0 (Google). The id is the Transformers.js ONNX export on Hugging Face,
// `Xenova/flan-t5-base`, loaded from huggingface.co (see lib/modelHosts.ts).
//
// `onProgress` receives the normalized `{ phase, label, ratio, loaded, total }`.

import { type OnProgress, type EngineProgress } from './types.js';
import { CACHE_NAMES } from '@kimtos/config/ui';

export const DEFAULT_MODEL = 'Xenova/flan-t5-base';

// Keep each pass well under the model's ~512-token context window.
const MAX_WORDS_PER_PASS = 180;

interface WorkerMsg {
  type: 'progress' | 'ready' | 'corrected' | 'error';
  progress?: EngineProgress;
  id?: number;
  text?: string;
  message?: string;
}

const spawn = (): Worker => new Worker(new URL('./grammar.worker.js', import.meta.url), { type: 'module' });

// A loaded corrector kept in memory so live, per-sentence re-checks are fast.
// Call dispose() when done (e.g. the app window closes) to free the model.
export async function createCorrector({
  model = DEFAULT_MODEL,
  onProgress,
}: { model?: string; onProgress?: OnProgress } = {}) {
  const worker = spawn();
  // Several corrections can be in flight while the user types, so each carries an id
  // and its reply is routed back to the right caller.
  const pending = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>();
  let ready: { resolve: () => void; reject: (err: Error) => void } | null = null;
  let nextId = 1;

  worker.onmessage = ({ data }: MessageEvent<WorkerMsg>) => {
    if (data.type === 'progress' && data.progress) onProgress?.(data.progress);
    else if (data.type === 'ready') ready?.resolve();
    else if (data.type === 'corrected' && data.id != null) pending.get(data.id)?.resolve(data.text ?? '');
    else if (data.type === 'error') {
      const err = new Error(data.message || 'The grammar model failed');
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
  // A worker that dies must not leave the caller waiting on a promise that can never settle.
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The grammar model stopped unexpectedly');
    ready?.reject(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  await new Promise<void>((resolve, reject) => {
    ready = { resolve, reject };
    worker.postMessage({ type: 'load', model });
  });

  return {
    async correct(text: string): Promise<string> {
      const t = (text || '').trim();
      if (!t) return '';
      const words = t.split(/\s+/).length;
      if (words > MAX_WORDS_PER_PASS) return t; // too long for one pass — leave as-is
      const id = nextId++;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({
          type: 'correct',
          id,
          text: t,
          maxNewTokens: Math.min(512, Math.round(words * 1.6) + 16),
        });
      });
    },
    dispose: () => {
      worker.postMessage({ type: 'dispose' });
      worker.terminate();
    },
  };
}

// Download + cache the model without running it (onboarding / App Store install).
export async function prefetchGrammarModel(model = DEFAULT_MODEL, onProgress?: OnProgress): Promise<void> {
  const worker = spawn();
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<WorkerMsg>) => {
        if (data.type === 'progress' && data.progress) onProgress?.(data.progress);
        else if (data.type === 'ready') resolve();
        else if (data.type === 'error') reject(new Error(data.message || 'Downloading the grammar model failed'));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The grammar model stopped unexpectedly'));
      worker.postMessage({ type: 'prefetch', model });
    });
  } finally {
    worker.terminate();
  }
}

// Free this app's cached model files (uninstall). Only deletes the FLAN-T5
// entries so a co-installed Transformers.js app (e.g. Voice to Text) is untouched.
export async function removeGrammarModel(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAMES.transformers);
    const keys = await cache.keys();
    await Promise.all(keys.filter((req) => /flan-t5/i.test(req.url)).map((req) => cache.delete(req)));
  } catch {
    /* ignore */
  }
}
