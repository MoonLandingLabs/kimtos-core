// KimtAI generation worker. Loads an instruction-tuned LLM with Transformers.js
// and streams tokens back to the app. Runs off the main thread so the growing
// message bubble stays at 60fps. Prefers WebGPU; falls back to WASM.
//
// Protocol (main → worker):
//   { type:'load', model, dtype, wasmDtype, prefetch? }
//   { type:'generate', run, messages }   // messages: [{role,content}, …]
//   { type:'stop', run }                 // interrupt that run (running or still queued)
// Worker → main:
//   { type:'progress', data } | { type:'status', status } | { type:'ready' }
//   { type:'token', run, text } | { type:'done', run, text } | { type:'error', message, fatal?, run? }
//
// `run` identifies a generation: the main thread stamps it on `generate`, this
// worker echoes it on everything that generation emits, and the main thread drops
// messages whose run is no longer current — so a stopped run's late `done` can
// never be delivered to the next run's callbacks (#967).

import {
  pipeline as _pipeline,
  env as _env,
  TextStreamer as _TextStreamer,
  InterruptableStoppingCriteria as _InterruptableStoppingCriteria,
} from '@huggingface/transformers';

// The npm module is typed through minimal local interfaces cast at the import
// boundary — enough to type the call sites without the package's heavy surface.
interface Pipe {
  (input: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  tokenizer: unknown;
  dispose?: () => void | Promise<void>;
}
type PipelineFn = (task: string, model: string, opts: Record<string, unknown>) => Promise<Pipe>;
interface TransformersEnv {
  backends: {
    onnx: {
      wasm: { wasmPaths?: unknown; numThreads?: number };
      webgpu?: Record<string, unknown>;
    };
  };
  useWasmCache?: boolean;
  remoteHost?: string;
}
interface TransformersProgress {
  file?: string;
  status?: string;
  loaded?: number;
  total?: number;
}
interface Stopper {
  interrupt?: () => void;
}
const pipeline = _pipeline as unknown as PipelineFn;
const env = _env as unknown as TransformersEnv;
const TextStreamer = _TextStreamer as unknown as new (tokenizer: unknown, opts: Record<string, unknown>) => unknown;
const InterruptableStoppingCriteria = _InterruptableStoppingCriteria as unknown as new () => Stopper;

// `self` is typed as Window under the DOM lib; the worker-only bits are cast.
const workerSelf = self as unknown as { postMessage: (m: unknown) => void };
const post = (msg: unknown): void => workerSelf.postMessage(msg);

let pipe: Pipe | null = null;
// The repo id of the loaded model, for the few per-model generation settings.
let modelId = '';
let stopper: Stopper | null = null;
let loading = false; // true while a model is loading, so stray rejections surface as fatal

// Generations run strictly one after another. `self.onmessage` fires per message
// and used to start a `generate()` per `generate` message, so two overlapping
// generations shared the single module-level `stopper` — the second overwrote the
// first's, leaving the first uninterruptible (#967). The queue serializes them,
// and `activeRun` scopes a `stop` to the run it was aimed at.
let genQueue: Promise<void> = Promise.resolve();
let activeRun = 0; // the run generating right now; 0 = none
let finishedThrough = 0; // highest run id already settled (they arrive in order)
const stoppedEarly = new Set<number>(); // runs stopped while still queued

// Turn a raw error into something the user can act on.
function friendly(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message || String(err) || 'Something went wrong.';
  if (/network ?error|failed to fetch|load failed/i.test(msg)) {
    return "Couldn't reach the model files (network error). If you're offline, reconnect — otherwise the model may need to be downloaded again.";
  }
  return msg;
}

// Transformers.js/ORT can reject a background fetch (e.g. a model shard) OUTSIDE our
// awaited load path — this converts it into a proper fatal error while loading.
self.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  if (loading) post({ type: 'error', message: friendly(e.reason), fatal: true });
});

// Sum per-file byte counts into the normalized progress shape the UI expects.
// Transformers.js fires progress per downloaded chunk — for a ~1 GB model that's
// thousands of events, and posting each one floods the page's main thread (janks
// the tab). Throttle to ~6 updates/sec, but always send a file's final 'done' so
// the bar still reaches 100%.
function makeProgressCallback(): (p: TransformersProgress) => void {
  const files = new Map<string, { loaded: number; total: number }>();
  let lastPost = 0;
  const flush = (): void => {
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({
      type: 'progress',
      data: { phase: 'download', label: 'Downloading model', loaded, total, ratio: total ? loaded / total : null },
    });
  };
  return (p) => {
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
    const now = performance.now();
    if (done || now - lastPost >= 160) {
      lastPost = now;
      flush();
    }
  };
}

async function hasWebGPU(): Promise<boolean> {
  const nav = self.navigator as unknown as { gpu?: { requestAdapter: (o?: unknown) => Promise<unknown> } };
  if (!nav.gpu) return false;
  try {
    // Prefer the discrete/high-performance GPU on multi-GPU machines.
    return !!(await nav.gpu.requestAdapter({ powerPreference: 'high-performance' }));
  } catch {
    return false;
  }
}

async function load({
  model,
  dtype,
  wasmDtype,
}: {
  model: string;
  dtype: string;
  wasmDtype: string;
}): Promise<{ pipe: Pipe; device: string }> {
  // Self-host the ONNX Runtime wasm in PROD (the MV3 CSP blocks the CDN default),
  // single-threaded. We pin the ASYNCIFY build explicitly (it carries the WebGPU
  // kernels and also runs the CPU/WASM fallback). The model itself loads from Hugging Face,
  // Transformers.js's default host (see lib/modelHosts.ts).
  if (import.meta.env.PROD) {
    env.backends.onnx.wasm.wasmPaths = {
      mjs: '/ort/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: '/ort/ort-wasm-simd-threaded.asyncify.wasm',
    };
    env.backends.onnx.wasm.numThreads = 1;
    env.useWasmCache = false;
  }
  // Ask the WebGPU EP for the high-performance GPU too (best-effort).
  try {
    env.backends.onnx.webgpu = { ...(env.backends.onnx.webgpu || {}), powerPreference: 'high-performance' };
  } catch {
    /* ignore */
  }

  // Prefer WebGPU when a real adapter exists; otherwise run on WASM.
  if (await hasWebGPU()) {
    try {
      const gpuPipe = await pipeline('text-generation', model, {
        device: 'webgpu',
        dtype,
        progress_callback: makeProgressCallback(),
      });
      return { pipe: gpuPipe, device: 'webgpu' };
    } catch {
      post({ type: 'status', status: 'wasm-fallback' });
    }
  }
  const cpuPipe = await pipeline('text-generation', model, {
    device: 'wasm',
    dtype: wasmDtype,
    progress_callback: makeProgressCallback(),
  });
  return { pipe: cpuPipe, device: 'wasm' };
}

// Some chat templates leak control/placeholder tokens into the generated text — strip
// them. Deliberately generic (not tied to any one model): it costs nothing, and this is
// the sort of thing that only surfaces once a model is in front of a user.
const CONTROL_RE = /<\/?(?:unused\d+|start_of_turn|end_of_turn|eos|bos|pad|sep|cls|mask|s|unk)>/gi;
const clean = (t: unknown): string | undefined => (typeof t === 'string' ? t.replace(CONTROL_RE, '') : undefined);

async function generate(run: number, messages: unknown, opts: Record<string, unknown> = {}): Promise<void> {
  if (!pipe) {
    post({ type: 'error', run, message: 'Model not loaded yet.' });
    return;
  }
  stopper = InterruptableStoppingCriteria ? new InterruptableStoppingCriteria() : null;
  let sawText = false; // any real (non-control) token produced?
  // Qwen3 streams a <think>…</think> reasoning block before its answer. Hide it
  // from the UI (and it's stripped from the final text below) so chat stays clean
  // and tool-call parsing isn't confused. Harmless for models that never think.
  let thinkPhase: 'sniff' | 'in' | 'out' = 'sniff';
  let thinkBuf = '';
  const stripThinkStream = (chunk: string): string => {
    if (thinkPhase === 'out') return chunk;
    thinkBuf += chunk;
    if (thinkPhase === 'sniff') {
      const t = thinkBuf.replace(/^\s+/, '');
      if (t === '' || '<think>'.startsWith(t)) return ''; // still might become <think>
      if (t.startsWith('<think>')) thinkPhase = 'in';
      else {
        thinkPhase = 'out';
        const out = thinkBuf;
        thinkBuf = '';
        return out;
      }
    }
    const end = thinkBuf.indexOf('</think>');
    if (end === -1) return ''; // still inside the reasoning block
    thinkPhase = 'out';
    const rest = thinkBuf.slice(end + '</think>'.length).replace(/^\s+/, '');
    thinkBuf = '';
    return rest;
  };
  const streamer = new TextStreamer(pipe.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      const c = clean(text);
      if (!c) return;
      const emit = stripThinkStream(c);
      if (emit) {
        sawText = true;
        post({ type: 'token', run, text: emit });
      }
    },
  });
  try {
    // temperature 0 → deterministic (greedy); otherwise sample.
    const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.7;
    const maxTokens = typeof opts.maxTokens === 'number' ? opts.maxTokens : 1024;
    const tools = opts.tools;
    const output = await pipe(messages, {
      max_new_tokens: maxTokens || 1024,
      do_sample: temperature > 0,
      ...(temperature > 0 ? { temperature, top_p: 0.9 } : {}),
      repetition_penalty: 1.1,
      no_repeat_ngram_size: 3, // break degenerate loops
      // Qwen3 reasons at length before answering unless its template is told not to. Passed to
      // apply_chat_template via tokenizer_encode_kwargs; other templates ignore the variable.
      ...(/qwen3/i.test(modelId) ? { tokenizer_encode_kwargs: { enable_thinking: false } } : {}),
      // Native function-calling: forwarded into apply_chat_template (Qwen/Llama).
      ...(Array.isArray(tools) && tools.length ? { tools } : {}),
      streamer,
      ...(stopper ? { stopping_criteria: stopper } : {}),
    });
    // For chat input Transformers.js returns the full conversation; the last
    // message is the assistant reply. Fall back to the streamed text if absent.
    const out = output as Array<{ generated_text?: Array<{ content?: string; tool_calls?: unknown[] }> }> | undefined;
    const last = out?.[0]?.generated_text?.at?.(-1);
    const text = clean(last?.content)?.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
    // Native function-calling models put the call in `tool_calls`, NOT `content`.
    const tc = last?.tool_calls;
    const toolCalls = Array.isArray(tc) && tc.length ? tc : null;
    if (sawText || text?.trim() || toolCalls) {
      post({ type: 'done', run, text, toolCalls });
    } else {
      // Everything was control/placeholder tokens → the model degenerated.
      post({
        type: 'error',
        run,
        message:
          'The model returned no usable text — it likely degenerated on this device. Please try again, or reload the page.',
      });
    }
  } catch (err) {
    // Log the FULL error (with stack + transformers.js frames) to the worker
    // console so we can pinpoint library-internal throws (e.g. a chat-template
    // "reading 'filter'"); the posted message is just the short summary.
    console.error('[kimtai worker] generate failed:', err);
    post({ type: 'error', run, message: err instanceof Error ? err.stack || err.message : 'Generation failed.' });
  } finally {
    stopper = null;
  }
}

// One queued generation: skipped outright if its stop arrived before its turn,
// otherwise run with `activeRun` scoping any incoming `stop` to it. Never
// rejects — the queue must survive a failed generation.
async function runGenerate(run: number, messages: unknown, opts?: Record<string, unknown>): Promise<void> {
  if (stoppedEarly.delete(run)) {
    // Stopped while still queued. Settle it anyway so every `generate` gets
    // exactly one terminal message (the main thread has already dropped this
    // run's callbacks, so the empty `done` goes nowhere).
    post({ type: 'done', run, text: '' });
    return;
  }
  activeRun = run;
  try {
    await generate(run, messages, opts);
  } catch (err) {
    post({ type: 'error', run, message: friendly(err) });
  } finally {
    activeRun = 0;
    finishedThrough = Math.max(finishedThrough, run);
  }
}

self.onmessage = async ({ data }: MessageEvent) => {
  try {
    if (data.type === 'load') {
      loading = true;
      const { pipe: loaded, device } = await load(data);
      if (data.prefetch) {
        // Files are now cached; don't keep the model resident.
        await loaded.dispose?.();
        post({ type: 'ready' });
        return;
      }
      pipe = loaded;
      modelId = data.model;
      // Warm-up: a tiny generation compiles the WebGPU shaders/kernels now.
      post({ type: 'status', status: 'warming', device });
      try {
        // Warm-up must never block `ready` — interrupt it after a bounded wait.
        const warmStopper = InterruptableStoppingCriteria ? new InterruptableStoppingCriteria() : null;
        const warmTimer = setTimeout(() => warmStopper?.interrupt?.(), 20000);
        try {
          await pipe([{ role: 'user', content: 'Hi' }], {
            max_new_tokens: 2,
            ...(warmStopper ? { stopping_criteria: warmStopper } : {}),
          });
        } finally {
          clearTimeout(warmTimer);
        }
      } catch {
        /* best effort — a slow/failed warm-up must not block real use */
      }
      post({ type: 'ready', device });
    } else if (data.type === 'generate') {
      const run = typeof data.run === 'number' ? data.run : 0;
      const job = (): Promise<void> => runGenerate(run, data.messages, data.opts);
      genQueue = genQueue.then(job, job);
    } else if (data.type === 'stop') {
      // Scope the interrupt to the run it was aimed at: a stop for a run that
      // already finished must not cut short whatever is generating now. A stop
      // for a run still waiting in the queue is remembered so it never starts.
      if (typeof data.run !== 'number' || data.run === activeRun) stopper?.interrupt?.();
      else if (data.run > finishedThrough) stoppedEarly.add(data.run);
    }
  } catch (err) {
    post({ type: 'error', message: friendly(err), fatal: data.type === 'load' });
  } finally {
    if (data.type === 'load') loading = false;
  }
};
