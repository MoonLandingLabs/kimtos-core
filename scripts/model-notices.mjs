// The on-device model WEIGHTS and data files we SHIP or DOWNLOAD to users — the single
// source of truth for their attribution. Imported by BOTH
// scripts/gen-third-party-notices.mjs (which renders them into THIRD-PARTY-NOTICES.md) and
// scripts/check-model-notices.mjs (which fails CI when this list and what we actually ship
// disagree).
//
// These are NOT npm packages, so the bundler scan in gen-third-party-notices.mjs cannot see
// them — they have to be listed by hand, because a licence is a claim about the world, not a
// fact in a lockfile. Every entry here was checked against the model's own card, not assumed.
//
// WHY A DEDICATED CHECK. This list used to live inline in the generator with nothing asserting
// it stayed complete, and it drifted exactly as such lists do: it shipped omitting whisper-base,
// flan-t5-small, TinyLlama, SmolLM2-1.7B and the Tesseract OCR trained data, and fell out of sync
// with the committed notices file itself (#669). The `assets` field below is what closes that:
// it names the model repo id(s) each entry attributes, so check-model-notices.mjs can prove
// every `<org>/<repo>` id the extension source loads (and the Tesseract language packs) is covered
// — and refuses to go green when a new model is added without an attribution here.
//
// `assets` keys, matched against the model ids in extension/src:
//   - a Hugging Face '<org>/<repo>' id                   → a model the extension loads from there
//   - the literal 'tesseract-langs'                      → every Tesseract language pack
//   - an empty array                                     → a data file BUNDLED in the extension
//                                                          (Grammit's word list). The notice is
//                                                          still owed: we distribute the bytes.
//
// Adding a model to extension/src/lib/engines/ means adding it here. EVERY model we ship must be PERMISSIVELY licensed — Gemma 3 was removed because
// Google's Gemma Terms are a custom licence with use restrictions we cannot bind users to.
export const MODELS = [
  {
    name: 'DeepFilterNet3 (denoiser_model.onnx)',
    license: 'MIT / Apache-2.0 (dual)',
    source: 'https://github.com/Rikorose/DeepFilterNet — ONNX export via https://github.com/grazder/DeepFilterNet',
    usedBy: 'Denoise',
    assets: ['kimtos-labs/denoiser-dfn3'],
    note:
      'Upstream dual-licenses all of DeepFilterNet under MIT or Apache-2.0, at your option, ' +
      'which permits commercial redistribution with the notice preserved. Corroborated by the ' +
      'other redistributions of these weights (Intel/deepfilternet-openvino and ' +
      'mlx-community/DeepFilterNet-mlx both publish them as MIT).\n\n' +
      'We load this file from the Hugging Face repo we control ' +
      '(huggingface.co/kimtos-labs/denoiser-dfn3), which carries this notice too.',
  },
  {
    name: 'SmolLM2-360M-Instruct',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct',
    usedBy: 'KimtAI (the default chat model)',
    assets: ['HuggingFaceTB/SmolLM2-360M-Instruct'],
    note: 'Apache-2.0 permits commercial use and redistribution with the notice preserved.',
  },
  {
    name: 'SmolLM2-1.7B-Instruct',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct',
    usedBy: 'KimtAI (optional larger chat model)',
    assets: ['HuggingFaceTB/SmolLM2-1.7B-Instruct'],
    note: 'Apache-2.0 permits commercial use and redistribution with the notice preserved.',
  },
  {
    name: 'Qwen3-0.6B',
    license: 'Apache-2.0',
    source:
      'https://huggingface.co/Qwen/Qwen3-0.6B — ONNX build: https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX',
    usedBy: 'KimtAI (optional chat model)',
    assets: ['onnx-community/Qwen3-0.6B-ONNX'],
    note: 'Apache-2.0 permits commercial use and redistribution with the notice preserved.',
  },
  {
    name: 'Whisper (tiny)',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Xenova/whisper-tiny — upstream https://huggingface.co/openai/whisper-tiny',
    usedBy: 'Voice to Text',
    assets: ['Xenova/whisper-tiny'],
    note: 'Apache-2.0 permits commercial use and redistribution with the notice preserved.',
  },
  {
    name: 'Whisper (base)',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Xenova/whisper-base — upstream https://huggingface.co/openai/whisper-base',
    usedBy: 'Voice to Text (optional higher-accuracy model)',
    assets: ['Xenova/whisper-base'],
    note: 'Apache-2.0 permits commercial use and redistribution with the notice preserved.',
  },
  {
    name: 'Whisper (small)',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Xenova/whisper-small — upstream https://huggingface.co/openai/whisper-small',
    usedBy: 'Voice to Text (optional higher-accuracy model)',
    assets: ['Xenova/whisper-small'],
    note: 'Apache-2.0 permits commercial use and redistribution with the notice preserved.',
  },
  {
    name: 'all-MiniLM-L6-v2',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
    usedBy: 'Thoth (embeddings)',
    assets: ['Xenova/all-MiniLM-L6-v2'],
    note: 'Apache-2.0 permits commercial use and redistribution with the notice preserved.',
  },
  {
    name: 'FLAN-T5 (base)',
    license: 'Apache-2.0 (upstream); the ONNX conversion declares none',
    source: 'https://huggingface.co/Xenova/flan-t5-base — upstream https://huggingface.co/google/flan-t5-base',
    usedBy: 'Grammit (optional "deep grammar", off by default)',
    assets: ['Xenova/flan-t5-base'],
    note:
      'Google publishes FLAN-T5 under Apache-2.0. The Xenova ONNX conversion we load declares ' +
      'NO licence of its own, so we rely on the upstream terms. Worth pinning down before this ' +
      'model is ever made a default rather than an opt-in extra.',
  },
  {
    name: 'FLAN-T5 (small)',
    license: 'Apache-2.0 (upstream); the ONNX conversion declares none',
    source: 'https://huggingface.co/Xenova/flan-t5-small — upstream https://huggingface.co/google/flan-t5-small',
    usedBy: 'Grammit (optional "deep grammar" — the lighter model, off by default)',
    assets: ['Xenova/flan-t5-small'],
    note:
      'Google publishes FLAN-T5 under Apache-2.0. The Xenova ONNX conversion we load declares ' +
      'NO licence of its own, so we rely on the upstream terms. Worth pinning down before this ' +
      'model is ever made a default rather than an opt-in extra.',
  },
  {
    name: 'Kokoro-82M (v1.0 ONNX)',
    license: 'Apache-2.0',
    source:
      'https://huggingface.co/hexgrad/Kokoro-82M — ONNX build: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',
    usedBy: 'Voice Studio (text to speech)',
    assets: ['onnx-community/Kokoro-82M-v1.0-ONNX'],
    note:
      'Apache-2.0 permits commercial use and redistribution with the notice preserved. The ' +
      'extension downloads the weights, and the per-speaker `voices/*.bin` style vectors that go ' +
      'with them, from Hugging Face (huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX).\n\n' +
      "Voice Studio's voice catalog (extension/src/lib/engines/voiceCatalog.ts) and its " +
      'grapheme-to-phoneme frontend (extension/src/lib/engines/voicePhonemize.ts) are derived ' +
      'from the Apache-2.0 kokoro-js project (https://github.com/hexgrad/kokoro), which carries ' +
      'the same terms; that notice is owed here too because we distribute that code in the ' +
      'extension.',
  },
  {
    name: 'Tesseract OCR trained data',
    license: 'Apache-2.0',
    source: 'https://github.com/tesseract-ocr/tessdata_best — packaged as @tesseract.js-data/<lang>',
    usedBy: 'Snaptext (Image to Text)',
    assets: ['tesseract-langs'],
    note:
      'Google publishes the Tesseract `tessdata_best` trained-data files under Apache-2.0, which ' +
      'permits commercial redistribution with the notice preserved. English is bundled in the ' +
      'extension (extension/public/ocr) and works offline; the other language packs are fetched ' +
      'from jsDelivr, from the official @tesseract.js-data npm packages (Tesseract.js default). ' +
      'The tesseract.js engine itself is an npm dependency and is attributed above with the other ' +
      'shipped packages.',
  },
  {
    name: 'SCOWL English word list (words.txt)',
    license: 'Permissive (Copyright 2000-2016 Kevin Atkinson)',
    source: 'http://wordlist.aspell.net/ — frequency order from https://norvig.com/ngrams/count_1w.txt',
    usedBy: 'Grammit (the on-device spell checker)',
    // Bundled in the extension, not a CDN asset, so there is no manifest row to point at.
    assets: [],
    note:
      "Grammit's 60,000-word dictionary (extension/public/words.txt) is derived from SCOWL — the " +
      "curated word lists behind hunspell's en_US and Aspell — ordered by Norvig's frequency " +
      'counts (scripts/gen-words.mjs, #961). SCOWL grants permission to "use, copy, modify, ' +
      'distribute and sell these word lists, the associated scripts, the output created from the ' +
      'scripts, and its documentation for any purpose", provided the copyright notice appears in ' +
      'supporting documentation — which is what this entry is, and it must travel with any ' +
      "regenerated list. Norvig's list is freely published and supplies only the ordering, not " +
      'which words are in the file.',
  },
  {
    name: 'Kokoro-82M v1.0 (ONNX)',
    license: 'Apache-2.0',
    source:
      'https://huggingface.co/hexgrad/Kokoro-82M — ONNX export via https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',
    usedBy: 'Voice Studio (text to speech, all voices)',
    assets: ['onnx-community/Kokoro-82M-v1.0-ONNX'],
    note:
      'Apache-2.0 permits commercial use and redistribution with the notice preserved. This ' +
      'covers the weights AND the ~50 speaker style vectors (voices/*.bin) the app downloads, ' +
      'which are published in the same repo under the same licence.\n\n' +
      'The model is trained on eSpeak-NG IPA, but eSpeak-NG itself is GPL-3.0 and is NOT part ' +
      'of Kimtos: the phonemes come from the CMU Pronouncing Dictionary instead (below, and ' +
      '#1092). Kokoro consumes IPA; nothing about its licence obliges us to use a copyleft ' +
      'frontend to produce it.',
  },
  {
    name: 'CMU Pronouncing Dictionary (voice/lexicon.txt.gz)',
    license: 'BSD-2-Clause (Copyright (C) 1993-2015 Carnegie Mellon University)',
    source: 'https://github.com/cmusphinx/cmudict',
    usedBy: 'Voice Studio (the grapheme-to-phoneme frontend)',
    // Bundled in the extension, not a CDN asset, so there is no manifest row to point at.
    assets: [],
    note:
      "Voice Studio's pronunciation dictionary (extension/public/voice/lexicon.txt.gz, 126,037 " +
      'words) is generated from cmudict by scripts/gen-voice-lexicon.mjs, from a digest-pinned ' +
      'commit. cmudict is BSD-2-Clause: redistribution in binary form is permitted provided the ' +
      'copyright notice, the list of conditions and the disclaimer are reproduced "in the ' +
      'documentation and/or other materials provided with the distribution" — this file is that ' +
      'material, and it must travel with any regenerated dictionary.\n\n' +
      'It exists because the obvious frontend does not qualify. The `phonemizer` npm package ' +
      'declares itself Apache-2.0, but that covers only its JS wrapper: what it bundles is an ' +
      'Emscripten build of eSpeak-NG and its espeak-ng-data, which are GPL-3.0-or-later. ' +
      'Conveying that inside an MIT-licensed extension is a copyleft conflict, so it was ' +
      'removed and replaced with this dictionary plus letter-to-sound rules we wrote (#1092). ' +
      'No eSpeak-NG code or data ships in Kimtos.\n\n' +
      'The BSD-2-Clause notice, reproduced as that licence requires:\n\n' +
      'Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.\n\n' +
      'Redistribution and use in source and binary forms, with or without modification, are ' +
      'permitted provided that the following conditions are met:\n\n' +
      '1. Redistributions of source code must retain the above copyright notice, this list of ' +
      'conditions and the following disclaimer. The contents of this file are deemed to be ' +
      'source code.\n\n' +
      '2. Redistributions in binary form must reproduce the above copyright notice, this list ' +
      'of conditions and the following disclaimer in the documentation and/or other materials ' +
      'provided with the distribution.\n\n' +
      'This work was supported in part by funding from the Defense Advanced Research Projects ' +
      'Agency, the Office of Naval Research and the National Science Foundation of the United ' +
      'States of America, and by member companies of the Carnegie Mellon Sphinx Speech ' +
      'Consortium. We acknowledge the contributions of many volunteers to the expansion and ' +
      'improvement of this dictionary.\n\n' +
      "THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND ANY EXPRESSED " +
      'OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF ' +
      'MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL ' +
      'CARNEGIE MELLON UNIVERSITY NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, ' +
      'INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, ' +
      'PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS ' +
      'INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT ' +
      'LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE ' +
      'OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
  },
];

// NOTE: Gemma 3 was REMOVED from the product, and so from this list. Google's Gemma Terms are a
// custom licence, not OSS: they carry use restrictions that we would have had to bind every user
// to, in a product we distribute. Every model above is permissively licensed. Keep it that way.
