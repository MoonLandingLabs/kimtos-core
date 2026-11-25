// The models KimtAI ships — DATA ONLY, and the single source of truth for them.
//
// It lives apart from kimtai.ts (which imports Transformers.js and cannot be loaded outside a
// browser) so that the DOCS can read it. The public booklet used to describe a "Model Library"
// you could pick from, while exactly one model shipped — the models were removed deliberately
// (Gemma for its licence, Qwen for a suspected output problem) and the docs were simply never
// told (#245). A hand-written copy of a fact is a fact waiting to drift, so the docs now generate
// their model list from this array. Add a model here and the docs say so, with no docs edit.

// --- Model catalog -------------------------------------------------------------
// Every id is a Hugging Face repo holding an ONNX export Transformers.js can load, fetched from
// huggingface.co (lib/modelHosts.ts). `dtype` is used on WebGPU; `wasmDtype` (falls back to
// 'q4') on the slower WASM path. To add a model: check that both onnx files exist in the repo
// (`onnx/model_<dtype>.onnx`) and add its attribution (scripts/model-notices.mjs).
//
// v1 scope: ONE small, fast CHAT model. On-device tool-calling needs a bigger model
// to be reliable, which is too slow in-browser on modest hardware — so agent tools
// are OFF for now (see AGENT_TOOLS_ENABLED in apps/kimtai/index.js) and we ship the
// lightest model that gives usable chat. More models / tools come in a later pass.
// EVERY model here must be PERMISSIVELY licensed. KimtOS is MIT-licensed and
// hands these weights to end users, so a model whose licence restricts how they
// may use it — or obliges us to pass terms on to them — does not belong in this list.
// Gemma 3 was dropped for exactly that: Google's Gemma Terms are a custom licence,
// not OSS, with use restrictions we would have had to bind users to. Attribution for
// what we do ship is in THIRD-PARTY-NOTICES.md; add a model there when you add it here.
export interface Model {
  id: string;
  label: string;
  family: string;
  params: string;
  size: string;
  dtype: string;
  wasmDtype: string;
  tier: string;
  needsWebGPU: boolean;
  note: string;
  // Resource guidance, used to warn before a download that this device may struggle (#269).
  // `downloadMB` is the on-disk footprint (for the storage check); `minRamGB` is the floor
  // below which the model is likely to fail to load / crash the tab; `recRamGB` is the RAM it
  // wants for comfortable use; `recWebGPU` flags a model that is usable on CPU/WASM but really
  // wants a GPU to be fast. These are advisory — the user can always download anyway.
  downloadMB: number;
  minRamGB: number;
  recRamGB: number;
  recWebGPU: boolean;
}

// EVERY entry is Apache-2.0 (verified) so we can ship it in an MIT-licensed
// project without binding users to a restrictive licence. That rules out Gemma (custom Google
// terms) and the Llama-licensed models — do not add them here. Sizes/RAM are the q4-quantised
// in-browser footprint, rounded; the numbers drive the pre-download resource warning.
//
// Qwen3-0.6B is a different model from Qwen2.5 (below). It was loaded through the installed
// Transformers.js on CPU and answered coherently in English and Arabic, but it has NOT been run
// on WebGPU or in a browser. It defaults to a long "thinking" preamble, so kimtai.worker.ts turns
// that off for the Qwen family.
//
// DO NOT re-add Qwen2.5 (0.5B or 1.5B) ONNX here. They were tried twice — most recently under
// #269 — and BOTH times degenerated into repeated/garbage tokens on the Transformers.js
// WASM/WebGPU path (verified in-browser: coherent on a one-word reply, then a wall of garbage on
// any real generation), and were pulled (#546). Re-adding needs a genuinely working ONNX build +
// generation config proven in a real browser first, not just another catalog entry.
export const MODELS: Model[] = [
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    label: 'SmolLM2 360M',
    family: 'SmolLM2',
    params: '0.36B',
    size: '~300 MB',
    dtype: 'q4f16',
    wasmDtype: 'q4',
    tier: 'Tiny',
    needsWebGPU: false,
    note: 'Small, fast chat model — runs even without a GPU. Great for quick questions and drafting.',
    downloadMB: 300,
    minRamGB: 2,
    recRamGB: 4,
    recWebGPU: false,
  },
  {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    label: 'Qwen3 0.6B',
    family: 'Qwen',
    params: '0.6B',
    size: '~570 MB (GPU) / ~920 MB',
    dtype: 'q4f16',
    wasmDtype: 'q4',
    tier: 'Small',
    needsWebGPU: false,
    note: 'Newer and stronger than the tiny models, and it speaks 100+ languages including Arabic. A bit heavier.',
    downloadMB: 920,
    minRamGB: 4,
    recRamGB: 6,
    recWebGPU: true,
  },
  {
    id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    label: 'SmolLM2 1.7B',
    family: 'SmolLM2',
    params: '1.7B',
    size: '~1.4 GB',
    dtype: 'q4f16',
    wasmDtype: 'q4',
    tier: 'Small',
    needsWebGPU: false,
    note: 'The largest model here — the best quality, but it wants a strong machine and ideally a GPU.',
    downloadMB: 1400,
    minRamGB: 6,
    recRamGB: 8,
    recWebGPU: true,
  },
];

export const DEFAULT_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';
