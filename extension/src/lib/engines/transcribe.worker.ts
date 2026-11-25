// Whisper transcription worker. Runs the model off the main thread.
//
// Generation is a loop of awaited inference calls, and `await` only yields a
// MICROtask — so on the main thread it starved the event loop for the whole job and
// froze the new tab (the same defect measured and fixed for Denoise in #275/#315).
//
// Protocol (main -> worker):
//   { type:'run', audio: Float32Array, model, language?, spans? }  // 16 kHz mono, transferred
//   { type:'prefetch', model }                                     // download + cache only
// Worker -> main:
//   { type:'progress', progress } | { type:'done', text } | { type:'ready' }
//   { type:'error', message }
//
// `spans` are the stretches of the recording that hold speech (seconds), found on
// the main thread by `speechSpans`. Each is transcribed on its own and the model
// never sees what lies between them — fed silence or room tone it does not report
// "nothing", it invents, and loops one phrase until it runs out of tokens (#710).

import { pipeline as _pipeline, env as _env } from '@huggingface/transformers';
import { type EngineProgress } from './types.js';
import { paragraphsFromChunks, plausibleTranscript, type TranscriptChunk } from './transcriptFormat.js';
import type { SpeechSpan } from '../speechSpans.js';
import {
  configureBackend,
  makeProgressCallback,
  friendly,
  type Pipe,
  type TransformersEnv,
} from './transformersWorker.js';

type PipelineFn = (task: string, model: string, opts: Record<string, unknown>) => Promise<Pipe>;
const pipeline = _pipeline as unknown as PipelineFn;
const env = _env as unknown as TransformersEnv;

// `self` is typed as Window under the DOM lib; the worker-only bits are cast.
const workerSelf = self as unknown as { postMessage: (m: unknown, transfer?: Transferable[]) => void };
const post = (msg: unknown): void => workerSelf.postMessage(msg);
const report = (progress: EngineProgress): void => post({ type: 'progress', progress });

async function load(model: string): Promise<Pipe> {
  configureBackend(env);
  return pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    // fp32 on purpose for Tiny and Base: the q4 Whisper exports ship broken quantization
    // scales and crash onnxruntime ("Missing required scale … MatMulNBits"). Small's fp32 is
    // ~1 GB, so it uses the int8 export (~250 MB), which transcribes correctly.
    dtype: /whisper-small/.test(model) ? 'q8' : 'fp32',
    progress_callback: makeProgressCallback(report),
  });
}

const SAMPLE_RATE = 16000;

self.onmessage = async ({
  data,
}: MessageEvent<{ type: string; audio?: Float32Array; model?: string; language?: string; spans?: SpeechSpan[] }>) => {
  const model = data?.model || 'Xenova/whisper-tiny';
  try {
    if (data?.type === 'prefetch') {
      const pipe = await load(model);
      await pipe.dispose?.();
      post({ type: 'ready' });
      return;
    }
    if (data?.type !== 'run' || !data.audio) return;
    const audio = data.audio;
    // No spans means the caller did not gate the audio (nothing does today, but the
    // protocol allows it) — transcribe the lot rather than silently return nothing.
    const spans: SpeechSpan[] = data.spans?.length ? data.spans : [{ start: 0, end: audio.length / SAMPLE_RATE }];

    const transcriber = await load(model);
    try {
      // `return_timestamps` is what makes the per-segment `chunks` come back — the only
      // place sentence boundaries exist. Without them the transcript is one endless
      // line, in the card and in the downloaded .txt alike (#957).
      const options: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
      if (data.language) {
        options.language = data.language;
        options.task = 'transcribe';
      }
      const run = transcriber as unknown as (a: Float32Array, o: Record<string, unknown>) => Promise<unknown>;

      // One span at a time. A span boundary is a pause long enough that we chose not
      // to merge across it, so it is a real paragraph break — more trustworthy than
      // the model's own timestamps, which routinely run past the audio they describe.
      const paragraphs: string[] = [];
      for (let i = 0; i < spans.length; i += 1) {
        report({
          phase: 'run',
          label: 'Transcribing',
          ratio: spans.length > 1 ? i / spans.length : null,
        });
        const from = Math.max(0, Math.floor(spans[i].start * SAMPLE_RATE));
        const to = Math.min(audio.length, Math.ceil(spans[i].end * SAMPLE_RATE));
        if (to <= from) continue;
        const output = (await run(audio.subarray(from, to), options)) as {
          text?: string;
          chunks?: TranscriptChunk[];
        };
        const text = paragraphsFromChunks(output.chunks, output.text || '');
        if (text && plausibleTranscript(text, (to - from) / SAMPLE_RATE)) paragraphs.push(text);
      }
      post({ type: 'done', text: paragraphs.join('\n\n') });
    } finally {
      // Free the model from memory; the cached files make the next run fast.
      await transcriber.dispose?.();
    }
  } catch (err) {
    post({ type: 'error', message: friendly(err) });
  }
};
