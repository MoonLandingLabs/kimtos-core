// Deep-grammar worker (FLAN-T5, seq2seq). Runs the model off the main thread.
//
// Unlike transcribe, the corrector is RESIDENT: Grammit keeps it loaded and re-checks
// as the user types, so the worker stays alive across many `correct` calls and is only
// torn down when the app disposes it. Each call carries an id, so a reply is matched to
// its request even when several are in flight.
//
// Protocol (main -> worker):
//   { type:'load', model }                 // resolve once the model is resident
//   { type:'correct', id, text, maxNewTokens }
//   { type:'prefetch', model }             // download + cache only, then dispose
// Worker -> main:
//   { type:'ready' } | { type:'progress', progress }
//   { type:'corrected', id, text } | { type:'error', id?, message }

import { pipeline as _pipeline, env as _env } from '@huggingface/transformers';
import { type EngineProgress } from './types.js';
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

const workerSelf = self as unknown as { postMessage: (m: unknown) => void };
const post = (msg: unknown): void => workerSelf.postMessage(msg);
const report = (progress: EngineProgress): void => post({ type: 'progress', progress });

let pipe: Pipe | null = null;

async function load(model: string): Promise<Pipe> {
  configureBackend(env);
  return pipeline('text2text-generation', model, {
    device: 'wasm',
    dtype: 'q8', // int8 weights keep the download small (FLAN-T5 quantizes cleanly)
    progress_callback: makeProgressCallback(report),
  });
}

interface Msg {
  type: string;
  id?: number;
  text?: string;
  model?: string;
  maxNewTokens?: number;
}

self.onmessage = async ({ data }: MessageEvent<Msg>) => {
  try {
    if (data.type === 'prefetch') {
      const p = await load(data.model || '');
      await p.dispose?.();
      post({ type: 'ready' });
      return;
    }
    if (data.type === 'load') {
      pipe ??= await load(data.model || '');
      post({ type: 'ready' });
      return;
    }
    if (data.type === 'dispose') {
      await pipe?.dispose?.();
      pipe = null;
      return;
    }
    if (data.type === 'correct') {
      if (!pipe) throw new Error('The grammar model is not loaded.');
      const text = data.text || '';
      const result = await (pipe as unknown as (i: string, o: Record<string, unknown>) => Promise<unknown>)(
        `Correct the grammar and spelling of this text, keeping the meaning: ${text}`,
        {
          max_new_tokens: data.maxNewTokens ?? 512,
          num_beams: 1, // greedy keeps live checking responsive
          repetition_penalty: 1.2,
        },
      );
      const out = result as { generated_text?: string } | { generated_text?: string }[];
      const fixed = (Array.isArray(out) ? out[0]?.generated_text : out?.generated_text) || text;
      post({ type: 'corrected', id: data.id, text: fixed.trim() });
    }
  } catch (err) {
    post({ type: 'error', id: data.id, message: friendly(err) });
  }
};
