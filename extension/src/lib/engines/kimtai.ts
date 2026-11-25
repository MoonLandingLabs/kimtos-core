// On-device LLM chat engine for KimtAI. A small instruction-tuned model runs
// entirely in the browser via Transformers.js — the conversation never leaves the
// device. Generation happens in a Web Worker (kimtai.worker.js) so token-by-token
// streaming never blocks the growing message bubble.
//
// Unlike the other engines this is a *library*: several models can be downloaded
// independently and the user picks which one to chat with. Model FILES are cached
// by Transformers.js (Cache Storage, key `transformers-cache`), so a model is
// downloaded once. Which models the user has fetched is tracked in a small kv set.
//
// `onProgress` receives the normalized `{ phase, label, ratio, loaded, total }`.

import { dataStore } from '../dataStore.js';
import { CACHE_NAMES, STORAGE_KEYS } from '@kimtos/config/ui';

import { type EngineProgress, type OnProgress } from './types.js';
// The catalog is DATA, and it lives in a module the docs can also read — see kimtaiModels.ts.
import { MODELS, type Model } from './kimtaiModels.js';
export { MODELS, DEFAULT_MODEL, type Model } from './kimtaiModels.js';
interface Turn {
  role: string;
  content: string;
}
interface ToolSpec {
  name: string;
  description?: string;
  parameters?: unknown;
}
interface Callbacks {
  onToken?: (text: string, acc: string) => void;
  onDone?: (text: string, toolCalls: unknown) => void;
  onError?: (err: Error) => void;
}
interface WorkerMsg {
  type: string;
  data?: EngineProgress;
  status?: string;
  device?: string;
  text?: string;
  toolCalls?: unknown;
  fatal?: boolean;
  message?: string;
  run?: number; // which generation a token/done/error belongs to (#967)
}

// Look up a catalog entry by repo id.
export const byId = (id: string): Model | null => MODELS.find((m) => m.id === id) || null;

// WebGPU gives usable speed; without it we fall back to (much slower) WASM.
export const webgpuAvailable = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator;

// --- Which models the user has downloaded (kv set) -----------------------------
const DOWNLOADED_KEY = STORAGE_KEYS.kimtaiDownloaded;

async function downloadedSet(): Promise<Set<string>> {
  return new Set(((await dataStore.kv.get(DOWNLOADED_KEY)) as string[]) || []);
}
async function saveDownloaded(set: Set<string>): Promise<void> {
  await dataStore.kv.set(DOWNLOADED_KEY, [...set]);
}
export async function downloadedModels(): Promise<string[]> {
  return [...(await downloadedSet())];
}
export async function isDownloaded(id: string): Promise<boolean> {
  return (await downloadedSet()).has(id);
}

// --- Measured decode speed per model (tokens/sec on THIS device) --------------
const SPEED_KEY = STORAGE_KEYS.kimtaiSpeed;
export async function recordSpeed(id: string, tokPerSec: number): Promise<void> {
  if (!id || !tokPerSec || !Number.isFinite(tokPerSec)) return;
  const map = ((await dataStore.kv.get(SPEED_KEY)) as Record<string, number>) || {};
  // Exponential smoothing so one unusually slow/fast run doesn't dominate.
  map[id] = map[id] ? Math.round(map[id] * 0.6 + tokPerSec * 0.4) : Math.round(tokPerSec);
  await dataStore.kv.set(SPEED_KEY, map);
}
export async function modelSpeeds(): Promise<Record<string, number>> {
  return ((await dataStore.kv.get(SPEED_KEY)) as Record<string, number>) || {};
}

// The default we recommend and pre-select: the small, fast SmolLM2-360M, which runs even without
// a GPU. The library now offers larger models too (#269 — TinyLlama 1.1B, SmolLM2 1.7B), but this
// stays the safe starting point. History worth keeping: Qwen2.5 0.5B/1.5B ONNX degenerated into
// repeated/garbage tokens on this Transformers.js/WASM+WebGPU path — tried and pulled twice now,
// the second time verified in-browser (#546). Do not re-add them without a working ONNX build.
export function recommendedModelId(): string {
  return 'HuggingFaceTB/SmolLM2-360M-Instruct';
}

// Models whose chat template is *trained* for function-calling: we can pass `tools`
// into apply_chat_template and the model emits a proper <tool_call> block — far more
// reliable than our prompt-based fallback. Qwen (and Llama) ship such templates.
const NATIVE_TOOL_FAMILIES = new Set(['Qwen', 'Llama']);
export const supportsNativeTools = (id: string): boolean => NATIVE_TOOL_FAMILIES.has(byId(id)?.family ?? '');

// Convert our MCP-shaped tools to the OpenAI function specs apply_chat_template wants.
export function toFunctionSpecs(tools: ToolSpec[]) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'object', properties: {} },
    },
  }));
}

// --- Worker plumbing -----------------------------------------------------------
function spawnWorker(): Worker {
  return new Worker(new URL('./kimtai.worker.js', import.meta.url), { type: 'module' });
}

const loadOpts = (id: string) => {
  const m = byId(id);
  return { model: id, dtype: m?.dtype || 'q4f16', wasmDtype: m?.wasmDtype || 'q4' };
};

// Rejection reason when the caller aborts a download (#655). A distinct type, not a
// message the UI has to string-match: cancelling is a normal outcome, not a failure,
// and the difference decides whether the row shows an error or just goes back to
// "Download".
class DownloadCancelledError extends Error {
  constructor() {
    super('Download cancelled.');
    this.name = 'DownloadCancelledError';
  }
}
export const isDownloadCancelled = (err: unknown): boolean => err instanceof DownloadCancelledError;

// Download + cache a model's files without keeping it resident (install / library
// "Download"). Records the id in the downloaded set on success. Runs in a
// throwaway worker so the main thread stays responsive.
//
// Pass a `signal` to make it cancellable. Aborting terminates the worker, which
// aborts every fetch it owns — the transfer really stops, it is not just hidden.
// Nothing half-written is left behind either: Transformers.js reads a file's body
// to completion BEFORE it writes the Cache Storage entry (`storeCachedResource`),
// so a file interrupted in flight is never stored. Files that had already finished
// stay cached, so a later retry resumes from them instead of starting over.
//
// There is deliberately no pause/resume: the loader fetches whole files with no
// range/resume support, so a "pause" could only discard the file in flight — which
// is what cancel does. A button that claimed otherwise would be lying.
export function downloadModel(id: string, onProgress?: OnProgress, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DownloadCancelledError());
      return;
    }
    const worker = spawnWorker();
    // One settle only, and the flag flips SYNCHRONOUSLY: `ready` persists the id
    // asynchronously, and an abort landing inside that await must not reject a
    // promise that has already committed to resolving (nor vice versa).
    let settled = false;
    const settle = (fn: () => void | Promise<void>): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      // The `ready` callback is async (it persists the id). If that write fails — a full
      // disk, a broken IndexedDB — the promise must STILL settle, or the caller's progress
      // bar spins forever with no error and no way out.
      void Promise.resolve()
        .then(fn)
        .catch((err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
    };
    function onAbort(): void {
      settle(() => reject(new DownloadCancelledError()));
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = ({ data }: MessageEvent<WorkerMsg>) => {
      if (data.type === 'progress') {
        if (data.data) onProgress?.(data.data);
      } else if (data.type === 'ready') {
        settle(async () => {
          const set = await downloadedSet();
          set.add(id);
          await saveDownloaded(set);
          resolve();
        });
      } else if (data.type === 'error') {
        settle(() => reject(new Error(data.message || 'Failed to download the model.')));
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      settle(() => reject(new Error(e.message || 'The model worker failed to start.')));
    };
    worker.postMessage({ type: 'load', prefetch: true, ...loadOpts(id) });
  });
}

// Free one model's cached files. Matches only this repo id in the shared
// `transformers-cache`, so co-installed Transformers.js apps (Whisper, FLAN-T5)
// and the other KimtAI models are untouched.
export async function removeModel(id: string): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAMES.transformers);
    const keys = await cache.keys();
    const needle = id.toLowerCase();
    await Promise.all(keys.filter((req) => req.url.toLowerCase().includes(needle)).map((req) => cache.delete(req)));
  } catch {
    /* ignore */
  }
  const set = await downloadedSet();
  set.delete(id);
  await saveDownloaded(set);
}

// Free every KimtAI model (app uninstall).
export async function removeAllModels(): Promise<void> {
  for (const m of MODELS) await removeModel(m.id);
  await dataStore.kv.del(DOWNLOADED_KEY);
}

// One-time housekeeping: drop any cached model that's no longer in the catalog
// (e.g. after we trimmed the list to one model). Frees its cache files and prunes
// it from the downloaded set so the UI never lands the user on a model we dropped.
// Returns the number of models cleaned up.
export async function pruneRemovedModels(): Promise<number> {
  const known = new Set(MODELS.map((m) => m.id));
  const stale = (await downloadedModels()).filter((id) => !known.has(id));
  for (const id of stale) await removeModel(id);
  return stale.length;
}

// --- Chat session --------------------------------------------------------------
// Every model we ship accepts a real `system` role, so the system prompt is sent as
// one. (Some chat templates — Gemma's, notably — reject a system turn and need the
// prompt folded into the first user message instead. We carried that special case for
// Gemma; it went with the model. If a future model's template rejects `system`, that
// is the trick to reach for.)
export function buildMessages(turns: Turn[], systemPrompt: string, maxTurns = 24): Turn[] {
  const sys = (systemPrompt || '').trim();
  // Keep only the most recent turns so a long chat never overflows the model's
  // context window (the system prompt is always kept, below).
  const msgs = turns.slice(-maxTurns).map((t) => ({ role: t.role, content: t.content }));
  if (!sys) return msgs;
  return [{ role: 'system', content: sys }, ...msgs];
}

// A resident chat session backed by the worker. Load the model once, then
// stream replies. Call dispose() (e.g. on window close) to free it.
//   ready               -> Promise (resolves when the model is loaded)
//   send(messages, cbs) -> stream a reply (cbs: onToken, onDone, onError)
//   stop()              -> interrupt the current generation
//   dispose()           -> terminate the worker
//
// Every generation is a RUN with its own id and its own callbacks. The id is
// stamped on the `generate` request, the worker echoes it on every `token` /
// `done` / `error`, and anything not carrying the current run's id is dropped
// here — so a stopped or superseded run's late completion can never be
// delivered to the next run's callbacks (#967; the corruption that routing
// caused in the app is #951).
export function createChat({
  model,
  onProgress,
  onStatus,
}: { model?: string; onProgress?: OnProgress; onStatus?: (s: string) => void } = {}) {
  const worker = spawnWorker();
  let runSeq = 0;
  let run = 0; // the in-flight run's id; 0 = idle
  let cbs: Callbacks = {};
  let acc = '';
  let readyResolve: ((device: string) => void) | undefined;
  let readyReject: ((err: Error) => void) | undefined;
  const ready = new Promise<string>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  // End the current run and hand back its callbacks. Clearing the state BEFORE
  // the caller invokes a callback keeps re-entrancy safe: an onDone that calls
  // send() again must not be clobbered afterwards.
  const settleRun = (): Callbacks => {
    const settled = cbs;
    run = 0;
    cbs = {};
    return settled;
  };

  worker.onmessage = ({ data }: MessageEvent<WorkerMsg>) => {
    switch (data.type) {
      case 'progress':
        if (data.data) onProgress?.(data.data);
        break;
      case 'status':
        if (data.status) onStatus?.(data.status);
        break;
      case 'ready':
        readyResolve?.(data.device || 'wasm'); // resolves to 'webgpu' | 'wasm'
        break;
      case 'token':
        if (!run || data.run !== run) break; // a stopped/superseded run's straggler
        acc += data.text ?? '';
        cbs.onToken?.(data.text ?? '', acc);
        break;
      case 'done':
        if (!run || data.run !== run) break;
        settleRun().onDone?.(data.text ?? acc, data.toolCalls || null);
        break;
      case 'error': {
        const err = new Error(data.message || 'Generation failed.');
        if (data.fatal) readyReject?.(err);
        // A fatal (load) error fails whatever run is waiting on the model; a
        // generation error is addressed to its own run only.
        if (run && (data.fatal || data.run === run)) settleRun().onError?.(err);
        break;
      }
    }
  };
  worker.onerror = (e: ErrorEvent) => {
    const err = new Error(e.message || 'The model worker crashed.');
    readyReject?.(err);
    // A crashed worker can never post this run's `done` — settle the run here,
    // or its caller waits forever.
    if (run) settleRun().onError?.(err);
  };
  worker.postMessage({ type: 'load', ...loadOpts(model ?? '') });

  return {
    ready,
    // Start a new run. A run still in flight is superseded: the worker is told
    // to stop it and its callbacks are dropped, so nothing it still emits can
    // reach the callbacks registered here. Call stop() first if the partial
    // text matters.
    send(messages: Turn[], callbacks: Callbacks = {}, opts: Record<string, unknown> = {}) {
      if (run) {
        worker.postMessage({ type: 'stop', run });
        settleRun();
      }
      run = ++runSeq;
      cbs = callbacks;
      acc = '';
      worker.postMessage({ type: 'generate', run, messages, opts });
    },
    // Interrupt the current run and settle it NOW: its onDone fires with the
    // text streamed so far, and whatever the worker still posts for it is
    // dropped. A late `done` can therefore never surface in a later run.
    stop() {
      if (!run) return;
      worker.postMessage({ type: 'stop', run });
      const text = acc;
      settleRun().onDone?.(text, null);
    },
    dispose() {
      worker.terminate();
    },
  };
}
