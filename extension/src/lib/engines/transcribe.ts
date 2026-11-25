// In-browser speech-to-text via Whisper (Transformers.js, ONNX/WASM). Runs
// entirely on-device — the audio never leaves the browser.
//
// The model runs in a Web Worker (transcribe.worker.js). It used to run on the main
// thread, where an awaited generation loop starved the event loop and froze the whole
// new tab for the length of the job — the defect measured on the sibling Denoise engine
// (93% of timer ticks lost, worst stall 814ms, a reload that could not even commit) and
// fixed the same way (#275, #315). Only the decode stays on this thread: it needs an
// AudioContext, which a worker does not have, and it is native and does not block.
//
// Notes:
//  - Tiny and Base use full-precision (fp32) weights. The q4 exports of these Whisper
//    models ship broken quantization scales, which crash onnxruntime ("Missing required
//    scale … MatMulNBits"). fp32 has no scales to be missing, so it's reliable everywhere.
//    Small is the exception (see transcribe.worker.ts): its fp32 export is ~1 GB, so it
//    loads the int8 (`q8`) export, which was checked to transcribe correctly.
//  - The model FILES are cached by Transformers.js (Cache Storage), so the
//    download happens only once. The in-memory session is the heavy part
//    (hundreds of MB), so we DISPOSE it after each transcription to free memory
//    when idle — and the worker is terminated with it.
//
// `onProgress` receives a normalized `{ phase, label, ratio, loaded, total }`.

import { type OnProgress, type EngineProgress } from './types.js';
import { levelOf, isSilent } from '../audioLevel.js';
import { speechSpans } from '../speechSpans.js';
import { CACHE_NAMES } from '@kimtos/config/ui';

const DEFAULT_MODEL = 'Xenova/whisper-tiny';
/** Whisper's input rate, and what `decodeToMono16k` resamples to. */
export const SAMPLE_RATE = 16000;

interface WorkerMsg {
  type: 'progress' | 'done' | 'ready' | 'error';
  progress?: EngineProgress;
  text?: string;
  message?: string;
}

const spawn = (): Worker => new Worker(new URL('./transcribe.worker.js', import.meta.url), { type: 'module' });

// Drive one worker job to completion, then terminate it. `resolveOn` names the reply
// that finishes the job.
function runJob<T>(
  msg: Record<string, unknown>,
  transfer: Transferable[],
  onProgress: OnProgress | undefined,
  resolveOn: (m: WorkerMsg) => T | undefined,
  signal?: AbortSignal,
): Promise<T> {
  const worker = spawn();
  return new Promise<T>((resolve, reject) => {
    // Stopping means terminating the worker, and that really stops it: the model download and
    // the inference both live inside it and die with it. A worker per job is what makes this
    // safe — nothing else is using this one. Without it the run was structurally unstoppable and
    // KimtManager's Stop deleted the row while the work carried on (#1304).
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    worker.onmessage = ({ data }: MessageEvent<WorkerMsg>) => {
      if (data.type === 'progress' && data.progress) {
        onProgress?.(data.progress);
        return;
      }
      if (data.type === 'error') {
        reject(new Error(data.message || 'Transcription failed'));
        return;
      }
      const value = resolveOn(data);
      if (value !== undefined) resolve(value);
    };
    // A worker that dies (out of memory, a blocked wasm load) must not leave the
    // caller hanging on a promise that can never settle.
    worker.onerror = (e) => reject(new Error(e.message || 'The transcriber stopped unexpectedly'));
    worker.postMessage(msg, transfer);
  }).finally(() => worker.terminate());
}

// Decode any browser-supported audio (webm/mp3/m4a/ogg/wav) to the mono 16 kHz
// Float32 samples Whisper expects.
async function decodeToMono16k(file: Blob): Promise<Float32Array> {
  const buffer = await file.arrayBuffer();
  const Ctx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await ctx.decodeAudioData(buffer);
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    const mono = new Float32Array(decoded.length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch += 1) {
      const channel = decoded.getChannelData(ch);
      for (let i = 0; i < mono.length; i += 1) mono[i] += channel[i] / decoded.numberOfChannels;
    }
    return mono;
  } finally {
    ctx.close();
  }
}

// Download + cache the model without transcribing (used by onboarding so the
// first real use is instant). Disposes the session right after.
export async function prefetchModel(
  model = DEFAULT_MODEL,
  onProgress?: OnProgress,
  signal?: AbortSignal,
): Promise<void> {
  await runJob<true>(
    { type: 'prefetch', model },
    [],
    onProgress,
    (m) => (m.type === 'ready' ? true : undefined),
    signal,
  );
}

/**
 * Whether THIS model's files are already on the device, so a run needs no download.
 *
 * Mirrors `isVoiceModelCached` — the same question, asked of the same Cache Storage — but keyed
 * on the model id rather than on "any whisper": Tiny being cached says nothing about Base, and
 * answering yes for it would skip the download job for the model actually about to be used.
 */
export async function isWhisperCached(model = DEFAULT_MODEL): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAMES.transformers);
    return (await cache.keys()).some((req) => req.url.includes(model));
  } catch {
    return false; // no Cache API (or it is blocked): assume a download is needed
  }
}

// Free the cached Whisper model files (uninstall). Transformers.js stores model
// weights in the 'transformers-cache' Cache Storage shared with other on-device
// models (e.g. Grammit's grammar model), so delete ONLY the Whisper entries.
export async function removeWhisperCache(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAMES.transformers);
    const keys = await cache.keys();
    await Promise.all(keys.filter((req) => /whisper/i.test(req.url)).map((req) => cache.delete(req)));
  } catch {
    /* ignore */
  }
}

export async function transcribeAudio(
  file: Blob,
  {
    model = DEFAULT_MODEL,
    language,
    onProgress,
    signal,
  }: { model?: string; language?: string; onProgress?: OnProgress; signal?: AbortSignal } = {},
): Promise<string> {
  onProgress?.({ phase: 'run', label: 'Decoding audio', ratio: null });
  const audio = await decodeToMono16k(file);
  // Nothing to transcribe: stop here rather than let the model make something up.
  // Whisper does not answer "no speech" for an empty clip — it emits a token,
  // reliably the word "you", and the user reads a confident transcript of a
  // recording that had no sound in it (#805). An empty string is what the caller
  // renders as "No speech detected", and we skip the model download too.
  if (isSilent(levelOf(audio))) return '';
  // Find the speech BEFORE the model runs, and hand it only those stretches. A
  // clip that has sound in it somewhere passes the whole-clip gate above wholesale,
  // silence and all — and Whisper invents a transcript for every quiet stretch it
  // is shown, looping one phrase for pages once it starts (#710). No spans means
  // the recording holds no speech at all, which is the honest answer.
  const spans = speechSpans(audio, SAMPLE_RATE);
  if (!spans.length) return '';
  // Transferred, not copied — an hour of 16 kHz audio is ~230 MB of Float32.
  return runJob<string>(
    { type: 'run', audio, model, language, spans },
    [audio.buffer],
    onProgress,
    (m) => (m.type === 'done' ? (m.text ?? '') : undefined),
    signal,
  );
}
