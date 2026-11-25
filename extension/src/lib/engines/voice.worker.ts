// Voice Studio synthesis worker — runs Kokoro-82M (Transformers.js, ONNX/WASM)
// entirely on-device, off the main thread.
//
// Synthesis is a loop of awaited model calls, one per text chunk; on the main
// thread that would starve the event loop and freeze the whole new tab (the defect
// measured and fixed for Denoise/Whisper in #275/#315). So it lives here, and the
// main thread only stitches the returned PCM.
//
// The model + tokenizer are loaded once and kept for the worker's lifetime (the app
// keeps one worker alive), so previews and re-renders don't reload the weights.
// Voice style vectors (`voices/<id>.bin`) are fetched from OUR CDN on demand and
// validated + cached like every other model asset.
//
// Protocol (main -> worker):
//   { type:'prefetch', id, model, dtype }              // download + warm the model
//   { type:'run', id, text, voice, speed, model, dtype } // synthesise, chunk by chunk
//   { type:'cancel', id }                              // stop a run between chunks
// Worker -> main:
//   { type:'progress', id, progress }
//   { type:'chunk', id, index, total, pcm, sampleRate } // one synthesised chunk (transferred)
//   { type:'done', id, sampleRate } | { type:'ready', id }
//   { type:'error', id, message }

import { StyleTextToSpeech2Model, AutoTokenizer, Tensor, env as _env } from '@huggingface/transformers';
import { type EngineProgress } from './types.js';
import { configureBackend, makeProgressCallback, friendly, type TransformersEnv } from './transformersWorker.js';
import { phonemize } from './voicePhonemize.js';
import { langOf, isKnownVoice, DEFAULT_VOICE } from './voiceCatalog.js';
import { chunkText } from '../voiceChunk.js';
import { fetchModelFile } from '../modelFetch.js';
import { sharedByKey, createSerialQueue } from '../asyncOnce.js';
import { hfFileUrl } from '../modelHosts.js';
import { CACHE_NAMES } from '@kimtos/config/ui';

const env = _env as unknown as TransformersEnv;

const STYLE_DIM = 256;
export const KOKORO_SAMPLE_RATE = 24000;
// A voice .bin is 510 style vectors × 256 floats ≈ 510 KB — below fetchModelFile's
// default 1 MB floor, so we lower the validity threshold for it (still large enough
// to reject an HTML error body).
const VOICE_MIN_BYTES = 200_000;

const workerSelf = self as unknown as { postMessage: (m: unknown, transfer?: Transferable[]) => void };
const post = (msg: unknown, transfer?: Transferable[]): void => workerSelf.postMessage(msg, transfer);

interface Tts {
  model: (inputs: Record<string, unknown>) => Promise<{ waveform: { data: Float32Array } }>;
  tokenizer: (text: string, opts: Record<string, unknown>) => { input_ids: { dims: number[] } };
}

/** Jobs the main thread has asked to stop, cleared as each one is honoured. */
const cancelled = new Set<string>();

/** Has this job been cancelled? Reports it once and clears the flag, so the three checkpoints
 *  below cannot each announce the same cancellation. */
function stopped(id: string): boolean {
  if (!cancelled.has(id)) return false;
  cancelled.delete(id);
  post({ type: 'error', id, message: 'Cancelled' });
  return true;
}

// Progress from the SHARED load goes to every job waiting on it, so several cards
// watching one download all see it move.
const loadWatchers = new Set<string>();

function report(id: string, progress: EngineProgress): void {
  post({ type: 'progress', id, progress });
}

// The model+tokenizer load, keyed so a dtype change reloads.
//
// One load per `model|dtype`, however many jobs ask at once — the IN-FLIGHT promise is cached,
// not just the settled result. `onmessage` is async, so two requests that overlap both reach here
// before either finishes; caching only the settled value meant both missed and both ran
// `from_pretrained` — two ~90 MB model instantiations racing each other, one of them leaked
// (#1163). That is reachable without any concurrency feature, because cancelling a job does not
// stop a load already under way.
const loadShared = sharedByKey<Tts>(async (key) => {
  const [model, dtype] = key.split('|');
  configureBackend(env);
  const progress_callback = makeProgressCallback((p) => {
    for (const watcher of loadWatchers) report(watcher, p);
  });
  const [m, tok] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(model, {
      dtype: dtype as never,
      device: 'wasm',
      progress_callback,
    }),
    AutoTokenizer.from_pretrained(model, { progress_callback }),
  ]);
  return { model: m, tokenizer: tok } as unknown as Tts;
});

function loadTts(id: string, model: string, dtype: string): Promise<Tts> {
  // Each job removes ITSELF when it stops waiting. Clearing the whole set when the load
  // settles instead would leave every later job's id in it for ever, since a job that
  // arrives after the load has finished never triggers another settle.
  loadWatchers.add(id);
  return loadShared(`${model}|${dtype}`).finally(() => loadWatchers.delete(id));
}

// Inference runs one at a time. Several voices can be FETCHED at once — that is network —
// but the model is a single-threaded WASM session, so overlapping `tts.model()` calls buy
// nothing and are not something to bet on. Jobs queue here instead.
const serialise = createSerialQueue();

// Fetch a voice's style vectors from Hugging Face (validated + cached), as a Float32Array.
//
// The URL comes from `hfFileUrl` in lib/modelHosts.ts, the one place that names the host,
// rather than from `env.remoteHost`: a voice file is a model asset, and building the URL here
// keeps it on the same host as the model whatever the library's own default is.
const voiceCache = new Map<string, Float32Array>();
async function voiceData(model: string, voice: string): Promise<Float32Array> {
  const cached = voiceCache.get(voice);
  if (cached) return cached;
  const url = hfFileUrl(model, `voices/${voice}.bin`);
  const bytes = await fetchModelFile(url, CACHE_NAMES.transformers, undefined, { minBytes: VOICE_MIN_BYTES });
  // A copy whose byteOffset is 0 so the Float32 view is aligned and independent of
  // the fetch buffer.
  const buf = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  voiceCache.set(voice, buf);
  return buf;
}

// Synthesise one chunk of text into mono 24 kHz PCM.
async function synthChunk(
  tts: Tts,
  style: Float32Array,
  text: string,
  voice: string,
  speed: number,
): Promise<Float32Array> {
  const phonemes = await phonemize(text, langOf(voice) === 'en-gb' ? 'b' : 'a');
  const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
  const numTokens = Math.min(Math.max(input_ids.dims.at(-1)! - 2, 0), 509);
  const offset = numTokens * STYLE_DIM;
  const styleVec = style.slice(offset, offset + STYLE_DIM);
  const { waveform } = await tts.model({
    input_ids,
    style: new Tensor('float32', styleVec, [1, STYLE_DIM]),
    speed: new Tensor('float32', [speed], [1]),
  });
  return waveform.data as Float32Array;
}

interface RunMsg {
  type: string;
  id: string;
  text?: string;
  voice?: string;
  speed?: number;
  model?: string;
  dtype?: string;
}

self.onmessage = async ({ data }: MessageEvent<RunMsg>): Promise<void> => {
  const id = data?.id;
  const model = data?.model || 'onnx-community/Kokoro-82M-v1.0-ONNX';
  const dtype = data?.dtype || 'q8';
  try {
    if (data?.type === 'cancel') {
      cancelled.add(id);
      return;
    }
    if (data?.type === 'prefetch') {
      await loadTts(id, model, dtype);
      post({ type: 'ready', id });
      return;
    }
    if (data?.type !== 'run') return;

    const voice = data.voice && isKnownVoice(data.voice) ? data.voice : DEFAULT_VOICE;
    const speed = typeof data.speed === 'number' && data.speed > 0 ? data.speed : 1;
    const text = (data.text || '').trim();
    if (!text) {
      post({ type: 'error', id, message: 'There is no text to speak.' });
      return;
    }

    // A cancel that arrived while this job waited its turn must stop it BEFORE the load, not
    // after. `onmessage` is async and a `cancel` lands as its own message, so by the time a
    // queued job reaches here the flag may already be set — and the check used to sit below the
    // load, which meant the job reported "Cancelled" only once the ~90 MB it could no longer
    // use had finished arriving (#1304). Cancelling cannot abort a transfer already under way —
    // transformers.js owns that fetch, and the worker is shared with every other voice — which
    // is why a cold job declares no Stop at all rather than one that lies.
    if (stopped(id)) return;

    // The two fetches run concurrently with any other job's fetches — that is what makes
    // "download several voices at once" real. Only the inference below is serialised.
    const [tts, style] = await Promise.all([loadTts(id, model, dtype), voiceData(model, voice)]);
    const chunks = chunkText(text);
    const total = chunks.length;
    if (stopped(id)) return;
    // Waiting for the engine is a state of its own: with several voices requested, a job
    // can be fetched and ready long before its turn, and a card that says nothing while it
    // waits looks stalled.
    report(id, { phase: 'run', label: 'Queued', ratio: null });

    const done = await serialise(async () => {
      for (let i = 0; i < total; i += 1) {
        if (stopped(id)) return false;
        report(id, { phase: 'run', label: total > 1 ? 'Narrating' : 'Speaking', ratio: total > 1 ? i / total : null });
        const pcm = await synthChunk(tts, style, chunks[i], voice, speed);
        // Transfer the PCM so a long render doesn't copy every chunk across the boundary.
        post({ type: 'chunk', id, index: i, total, pcm, sampleRate: KOKORO_SAMPLE_RATE }, [pcm.buffer]);
      }
      return true;
    });
    if (!done) return;
    cancelled.delete(id);
    post({ type: 'done', id, sampleRate: KOKORO_SAMPLE_RATE });
  } catch (err) {
    post({ type: 'error', id, message: friendly(err) });
  }
};
