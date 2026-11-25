// Shared worker-side plumbing for the Transformers.js engines (transcribe, grammar).
// Worker-safe by construction: no DOM, no window.
//
// The backend config and the per-file progress aggregation were copied line-for-line
// between the engines; this is the one copy. Kept deliberately small — each worker
// still owns its own protocol and its own pipeline task.

import { LogLevel } from '@huggingface/transformers';
import { type EngineProgress } from './types.js';

export interface Pipe {
  (input: never, opts?: Record<string, unknown>): Promise<unknown>;
  dispose?: () => void | Promise<void>;
}
export interface TransformersEnv {
  backends: { onnx: { wasm: { wasmPaths?: unknown; numThreads?: number } } };
  useWasmCache?: boolean;
  remoteHost?: string;
  logLevel?: number;
}
export interface TransformersProgress {
  file?: string;
  status?: string;
  loaded?: number;
  total?: number;
}

// Self-host the ONNX Runtime wasm in PROD: by default Transformers.js loads it from a
// CDN, which the MV3 CSP blocks. Single-threaded because extension pages are not
// cross-origin isolated, so SharedArrayBuffer (and thus ORT threads) is unavailable.
// Dev keeps the CDN default so the dev server needs no copy of the files.
//
// Models are NOT redirected: every model id is a Hugging Face repo and Transformers.js resolves
// it to `https://huggingface.co/<model>/resolve/main/<file>` by default (see lib/modelHosts.ts).
export function configureBackend(env: TransformersEnv): void {
  // Quiet Transformers.js's own library warnings (it defaults its logger to WARNING).
  // They are not our errors and not actionable by a user: Voice Studio (Kokoro) logs
  // "[resolve_model_type] ... 'style_text_to_speech_2' ... Falling back to EncoderOnly"
  // — its correct single-model.onnx path, and the one warning that ends with an invitation
  // to "report at github.com/huggingface/transformers.js", sending a maintainer to chase a
  // non-bug — and transcription (Whisper) logs "No language specified - defaulting to
  // English (en)" when a multilingual model runs without an explicit language, its safe
  // default. Our engine failures are exceptions, caught and surfaced by each engine's own
  // error path, so ERROR still shows what matters.
  //
  // TRADE-OFF: this also silences Transformers.js's own NON-throwing warnings, including
  // the host/network ones it swallows (e.g. "Unable to fetch file metadata" for a wrong
  // remoteHost — the #1096 class, which fails silently rather than throwing). Debugging a
  // model that loads from the wrong host, or shows no download total, means temporarily
  // lowering this to LogLevel.WARNING. Set before the dev early-return below so the console
  // is clean in every environment.
  env.logLevel = LogLevel.ERROR;
  if (!import.meta.env.PROD) return;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: '/ort/ort-wasm-simd-threaded.mjs',
    wasm: '/ort/ort-wasm-simd-threaded.wasm',
  };
  env.backends.onnx.wasm.numThreads = 1;
  env.useWasmCache = false; // our wasm is bundled; avoids a chrome-extension cache warning
}

// Sum per-file byte counts into the normalized progress shape the UI expects.
// Transformers.js fires one event per downloaded chunk, so this throttles to ~6/sec —
// posting every chunk would jank the page we are trying to keep smooth — but always
// sends a file's final 'done' so the bar still reaches 100%.
export function makeProgressCallback(report: (p: EngineProgress) => void): (p: TransformersProgress) => void {
  const files = new Map<string, { loaded: number; total: number }>();
  let lastPost = 0;
  const flush = (): void => {
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    report({ phase: 'download', label: 'Downloading model', loaded, total, ratio: total ? loaded / total : null });
  };
  return (p: TransformersProgress) => {
    if (!p?.file) return;
    let done = false;
    if (p.status === 'progress' || p.status === 'done') {
      const prev = files.get(p.file) || { loaded: 0, total: 0 };
      files.set(p.file, {
        loaded: p.status === 'done' ? p.total || prev.total : p.loaded || 0,
        total: p.total || prev.total,
      });
      done = p.status === 'done';
    } else if ((p.status === 'initiate' || p.status === 'download') && !files.has(p.file)) {
      files.set(p.file, { loaded: 0, total: p.total || 0 });
    } else {
      return;
    }
    const now = Date.now();
    if (!done && now - lastPost < 160) return;
    lastPost = now;
    flush();
  };
}

// Turn a raw error into something the user can act on.
export function friendly(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message || String(err) || 'Something went wrong.';
  if (/network ?error|failed to fetch|load failed/i.test(msg)) {
    return "Couldn't reach the model files (network error). If you're offline, reconnect — otherwise the model may need to be downloaded again.";
  }
  return msg;
}
