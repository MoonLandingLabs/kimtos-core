# On-device models and where they load from

KimtOS runs every model in the browser. There is no KimtOS file server: each model file is
downloaded once from a public host that already serves it with CORS, then cached. This page lists
what loads from where, why, and what was evaluated and left alone. The host list itself is
`scripts/network-hosts.mjs`; the URL helpers are `extension/src/lib/modelHosts.ts`.

## Hosts

| Host                                           | Used for                         | Manifest grant                                   |
| ---------------------------------------------- | -------------------------------- | ------------------------------------------------ |
| `huggingface.co`                               | every model                      | `https://huggingface.co/*`                       |
| `*.cdn.hf.co` (for example `us.aws.cdn.hf.co`) | large files, reached by redirect | `https://*.hf.co/*`                              |
| `cdn.jsdelivr.net`                             | non-English OCR language packs   | none (it sends `access-control-allow-origin: *`) |

Hugging Face answers a large-file URL with a 302 to `us.aws.cdn.hf.co`, and its first response only
allows the `https://huggingface.co` origin, so the manifest must grant both hosts. This was checked
with `curl -I` on 2026-11-22. Transformers.js resolves a model id to
`https://huggingface.co/<id>/resolve/main/<file>` by default, so the engines no longer set
`env.remoteHost`.

## Models

| App                   | Model (Hugging Face repo)                                         | Files loaded                                            | Download                 | Licence           |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- | ------------------------ | ----------------- |
| Voice to Text         | `Xenova/whisper-tiny` (default), fp32                             | encoder 33 MB, merged decoder 119 MB                    | ~145 MB                  | Apache-2.0        |
| Voice to Text         | `Xenova/whisper-base`, fp32                                       | encoder 83 MB, merged decoder 209 MB                    | ~280 MB                  | Apache-2.0        |
| Voice to Text         | `Xenova/whisper-small`, q8 (new)                                  | `encoder_model_quantized` 92 MB, merged decoder 157 MB  | ~250 MB                  | Apache-2.0        |
| Voice Studio          | `onnx-community/Kokoro-82M-v1.0-ONNX`, q8, plus `voices/<id>.bin` | `onnx/model_quantized.onnx`, about 0.5 MB per voice     | ~90 MB                   | Apache-2.0        |
| KimtAI (default)      | `HuggingFaceTB/SmolLM2-360M-Instruct`, q4f16 (GPU) / q4 (CPU)     | one `onnx/model_*.onnx`                                 | ~300 MB                  | Apache-2.0        |
| KimtAI                | `onnx-community/Qwen3-0.6B-ONNX` (new, replaces TinyLlama)        | `onnx/model_q4f16.onnx` 570 MB / `model_q4.onnx` 919 MB | ~570 MB GPU, ~920 MB CPU | Apache-2.0        |
| KimtAI                | `HuggingFaceTB/SmolLM2-1.7B-Instruct`                             | one `onnx/model_*.onnx`                                 | ~1.4 GB                  | Apache-2.0        |
| Grammit (optional)    | `Xenova/flan-t5-base` (default) or `-small`, q8                   | quantized encoder and merged decoder                    | ~250 MB / ~80 MB         | Apache-2.0        |
| Thoth search          | `Xenova/all-MiniLM-L6-v2`, q8                                     | `onnx/model_quantized.onnx`                             | about 25 megabytes       | Apache-2.0        |
| Denoise               | `kimtos-labs/denoiser-dfn3` (DeepFilterNet3, torchDF export)      | `denoiser_model.onnx`, 16,104,687 bytes                 | ~16 MB                   | MIT or Apache-2.0 |
| Snaptext, non-English | `@tesseract.js-data/<lang>` 4.0.0_best_int on jsDelivr            | `<lang>.traineddata.gz`, 0.7 to 3 MB each               | 0.7 to 3 MB              | Apache-2.0        |

Sizes for Whisper, Qwen3 and the Tesseract packs are the byte sizes Hugging Face and jsDelivr report
for the exact files above (2026-11-22). The others are the figures already shown in the app.
Every repo was confirmed to exist, be ungated, and serve each listed file (HTTP 200 on
`/resolve/main/...`). English OCR data is bundled and loads nothing.

`kimtos-labs/denoiser-dfn3` is the one repo under the project's own Hugging Face org. It is the only
copy of the end-to-end DeepFilterNet3 graph the Denoise worker expects (PCM in, PCM out, a 45304-float
recurrent state). The other public DeepFilterNet ONNX repos found (`soniqo/DeepFilterNet3-ONNX`,
`tonythethompson/DeepFilterNet3-ONNX` and others) use different input and output contracts, so they
are not drop-in replacements.

Settings saved by earlier versions hold ids such as `kimtos-labs/whisper-base`.
`currentModelId()` in `modelHosts.ts` maps them to the repos above (the old TinyLlama pick becomes
Qwen3 0.6B). Because cached files are keyed by URL, everyone downloads their models once more.

## What changed and why

- Hosts. The CDN and the `kimtos-labs/*` mirror are gone from the code. Models load from the original
  Hugging Face repos, the OCR packs from the Tesseract.js default (jsDelivr). The manifest grants no KimtOS-operated host.
- Whisper Small added. Whisper Small reports clearly lower word error rates than Base in the
  [Whisper paper](https://arxiv.org/abs/2212.04356) (the model card lists the sizes: 39M, 74M, 244M
  parameters for tiny, base, small). Its fp32 export is about 1 GB, so it loads the int8 (`q8`) export,
  which is about 250 MB. Verified by transcribing the 11-second JFK sample with `Xenova/whisper-small`
  `q8` on CPU through the installed `@huggingface/transformers` 4.2.0 in Node: the text came out
  correct and complete. `Xenova/whisper-base` `q8` and `fp32` gave the same words. The existing note
  that quantized Whisper crashes concerns the q4 (`MatMulNBits`) exports, which are not used.
- Qwen3 0.6B replaces TinyLlama 1.1B. Qwen3-0.6B is Apache-2.0, lists 100+ languages (its
  [model card](https://huggingface.co/Qwen/Qwen3-0.6B)), and is a 2025 model against TinyLlama's 2023
  one. Loaded through the installed library on CPU at q4, it answered English prompts coherently and
  translated "Good morning, how are you?" into Arabic. By default it writes a long reasoning block
  first, so `kimtai.worker.ts` passes `enable_thinking: false` (through `tokenizer_encode_kwargs`, which
  the library forwards to `apply_chat_template`); with it off the replies were direct. Download cost is
  similar to the model it replaces (570 MB on GPU against 700 MB).
- Kokoro. `onnx-community/Kokoro-82M-v1.0-ONNX` is already the current v1.0 release. No change.

## Evaluated and not adopted

- Whisper large-v3-turbo (`onnx-community/whisper-large-v3-turbo`). Its smallest usable export
  (q4f16) is about 560 MB and needs a WebGPU path the transcription worker does not have; fp32 is
  about 3 GB. Too large for a default download and not exercised.
- Qwen3 1.7B and 4B. Qwen3-1.7B q4f16 is 1.4 GB (q4 for CPU is 2.1 GB), the same cost as SmolLM2 1.7B.
  Not added: there is no way to run them here on WebGPU, and the catalogue is deliberately short.
- Gemma 3 and Llama 3.2 ONNX. Both ship under custom licences with use restrictions. The project is
  MIT, so they are excluded (Gemma 3 was already dropped for this reason).
- SmolLM3-3B. Too large for an in-browser default.
- Grammar models trained for correction (`vennify/t5-base-grammar-correction` and its ONNX ports,
  `pszemraj/grammar-synthesis-small`). Their licences are CC-BY-NC-SA-4.0 (non-commercial), or dual
  with it. FLAN-T5 (Apache-2.0) stays.
- Other DeepFilterNet ONNX repos. See above: incompatible graph contracts.

## What was not verified

- No WebGPU or WASM-in-the-browser run happened. Whisper Small (q8) and Qwen3 0.6B (q4) were run on CPU
  in Node with `onnxruntime-node`, using the same library version and ONNX graphs, but not the browser
  runtime. The repo's own rule is that a chat model must be checked in a real browser, on both the
  WebGPU and WASM paths, before release (see `.claude/skills/on-device-models/SKILL.md`). Qwen2.5 passed
  CI and still produced garbage in the browser; Qwen3 0.6B has not been through that check.
- Kokoro, FLAN-T5, MiniLM and the SmolLM2 models were not run at all in this pass; only their
  Hugging Face file paths were checked.
- The Denoise graph, Tesseract language packs and the voice `.bin` files were checked for existence
  and size only.
