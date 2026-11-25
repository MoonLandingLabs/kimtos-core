// Where the extension downloads its on-device AI models and data files from.
//
// Everything comes from Hugging Face, a public, no-auth host that already serves it with CORS, so
// Kimtos runs no file server of its own. Nothing else is contacted:
//
//   - Hugging Face (`huggingface.co`) for every model: Whisper, Kokoro, the chat models, the
//     grammar model, MiniLM and the denoiser. Transformers.js already resolves
//     `<model id>` to `https://huggingface.co/<id>/resolve/main/<file>`, so the engines only
//     name the repo and leave `env.remoteHost` at its default. Large files redirect to
//     `*.cdn.hf.co`, which the manifest grants alongside the main host.
//
// The full list of hosts, and why each is there, lives in scripts/network-hosts.mjs; the model
// choices and their sources are in docs/extension/models.md.

/** The Hugging Face origin, with no trailing slash. */
const HF_URL = 'https://huggingface.co';

/** The direct download URL of one file in a Hugging Face model repo (default branch). */
export const hfFileUrl = (repo: string, file: string): string => `${HF_URL}/${repo}/resolve/main/${file}`;

/** DeepFilterNet3 end-to-end ONNX graph (torchDF export), the Denoise model. */
export const DENOISER_URL = hfFileUrl('kimtos-labs/denoiser-dfn3', 'denoiser_model.onnx');

// Model ids that earlier versions saved in settings, when the models were mirrored into a
// `kimtos-labs/<name>` Hugging Face org behind a CDN. The mirror is gone; the same files are the
// upstream repos below. Keyed by the bare name so this file names no repo that is not loaded.
const LEGACY_ORG = 'kimtos-labs/';
const LEGACY_MODEL_IDS: Record<string, string> = {
  'whisper-tiny': 'Xenova/whisper-tiny',
  'whisper-base': 'Xenova/whisper-base',
  'flan-t5-base': 'Xenova/flan-t5-base',
  'flan-t5-small': 'Xenova/flan-t5-small',
  'all-MiniLM-L6-v2': 'Xenova/all-MiniLM-L6-v2',
  'SmolLM2-360M-Instruct': 'HuggingFaceTB/SmolLM2-360M-Instruct',
  'SmolLM2-1.7B-Instruct': 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
  'TinyLlama-1.1B-Chat-v1.0': 'onnx-community/Qwen3-0.6B-ONNX',
  'Kokoro-82M-v1.0-ONNX': 'onnx-community/Kokoro-82M-v1.0-ONNX',
};

/** Map a model id saved by an earlier version to its current Hugging Face repo. Any other id is
 *  returned unchanged. (The old TinyLlama pick becomes Qwen3 0.6B, which replaced it.) */
export const currentModelId = (id: string): string =>
  id.startsWith(LEGACY_ORG) ? (LEGACY_MODEL_IDS[id.slice(LEGACY_ORG.length)] ?? id) : id;
