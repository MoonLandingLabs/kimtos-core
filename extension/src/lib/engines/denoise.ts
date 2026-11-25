// In-browser speech denoising via DeepFilterNet3 — exported by torchDF to a single
// end-to-end ONNX graph (PCM in → clean PCM out, all the STFT/ERB/deep-filter DSP
// baked in) and run on onnxruntime-web. Audio is decoded, processed frame-by-frame
// on-device, and re-encoded to WAV — nothing leaves the browser. The model
// downloads once (~16 MB) and is cached (Cache Storage) for offline use.
//
// The frame loop runs in a Web Worker (denoise.worker.js). It used to run right here
// on the main thread, where it froze the whole new tab for the length of the job —
// measured at ~2x realtime, so a ten-minute recording froze the UI for over four
// minutes, and even a page reload could not commit (#275). Only the decode (which
// needs an AudioContext, unavailable in a worker) stays on this thread; it is native
// and does not block.
//
// Credits (both permissive): DeepFilterNet — https://github.com/Rikorose/DeepFilterNet
// (MIT/Apache-2.0); torchDF export — https://github.com/grazder/DeepFilterNet.
//
// `onProgress` receives the normalized `{ phase, label, ratio, loaded, total }`.

// Served from Hugging Face (kimtos-labs/denoiser-dfn3, a repo the project owns), which sends
// CORS headers and is granted in the manifest, so the fetch works in the packed extension.
// See lib/modelHosts.ts.
import { type OnProgress, type EngineProgress } from './types.js';
import { fetchModelFile } from '../modelFetch.js';
import { CACHE_NAMES } from '@kimtos/config/ui';
import { DENOISER_URL as MODEL_URL } from '../modelHosts.js';
const MODEL_CACHE = CACHE_NAMES.models;

// The model's sample rate. Its frame contract (hop, state size) lives in the worker,
// which is the only place that feeds the graph.
const SR = 48000;

// Fetch the model bytes, from Cache Storage if present, else download (with byte
// progress) and cache. Goes through `fetchModelFile`, which validates the body on
// both the download and the cached-read path — so a host serving an HTML fallback
// with HTTP 200 fails with a clear reason instead of a cryptic ONNX parse error,
// and never poisons the cache.
async function fetchModelBytes(onProgress?: OnProgress, signal?: AbortSignal): Promise<Uint8Array> {
  return fetchModelFile(MODEL_URL, MODEL_CACHE, onProgress, { signal });
}

// Decode any browser-supported audio to mono 48 kHz Float32 (the rate Whisper's
// cousin DeepFilterNet expects). The AudioContext resamples for us.
async function decodeMono48k(file: Blob): Promise<Float32Array> {
  const buffer = await file.arrayBuffer();
  const Ctx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: SR });
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

// Minimal 16-bit PCM WAV encoder (mono).
function encodeWav(samples: Float32Array, sampleRate = SR): Blob {
  const n = samples.length;
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  str(36, 'data');
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

// Download + cache the model without processing (for an optional warm-up).
export async function prefetchDenoiseModel(onProgress?: OnProgress, signal?: AbortSignal): Promise<void> {
  await fetchModelBytes(onProgress, signal);
}

// Free the cached model (uninstall).
export async function removeDenoiseModel(): Promise<void> {
  try {
    await (await caches.open(MODEL_CACHE)).delete(MODEL_URL);
  } catch {
    /* ignore */
  }
}

interface WorkerMsg {
  type: 'progress' | 'done' | 'error';
  progress?: EngineProgress;
  pcm?: ArrayBuffer;
  message?: string;
}

// Denoise an audio file; resolves to a WAV Blob of the cleaned audio.
//
// Decode here (an AudioContext is a window API), then hand the samples to the worker
// and let it do the frame loop. The PCM is TRANSFERRED both ways, so a ten-minute clip
// does not cost a 28 MB copy in each direction.
export async function denoiseAudio(file: Blob, { onProgress }: { onProgress?: OnProgress } = {}): Promise<Blob> {
  onProgress?.({ phase: 'run', label: 'Decoding audio', ratio: null });
  const pcm = await decodeMono48k(file);

  const worker = new Worker(new URL('./denoise.worker.js', import.meta.url), { type: 'module' });
  try {
    const cleaned = await new Promise<Float32Array>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<WorkerMsg>) => {
        if (data.type === 'progress' && data.progress) onProgress?.(data.progress);
        else if (data.type === 'done' && data.pcm) resolve(new Float32Array(data.pcm));
        else if (data.type === 'error') reject(new Error(data.message || 'Denoising failed'));
      };
      // A worker that dies (out of memory, a bad wasm load) must not leave the caller
      // hanging on a promise that can never settle.
      worker.onerror = (e) => reject(new Error(e.message || 'The denoiser stopped unexpectedly'));
      worker.postMessage({ type: 'run', pcm }, [pcm.buffer]);
    });
    return encodeWav(cleaned);
  } finally {
    worker.terminate();
  }
}
