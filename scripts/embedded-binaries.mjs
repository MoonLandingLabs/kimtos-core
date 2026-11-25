// The npm packages we SHIP that carry a compiled third-party artifact inside them, and
// what that artifact actually is. Imported by scripts/check-embedded-licenses.mjs, which
// fails the build when a shipped package carries one that is NOT recorded here.
//
// WHY THIS LIST EXISTS. `scripts/gen-third-party-notices.mjs` reads each package's own
// `license` field. That field describes what the package's AUTHOR wrote — it says nothing
// about what the package BUNDLES, and the two can have different licences. We shipped
// exactly that: the `phonemizer` package declares `"license": "Apache-2.0"`, and the
// Apache text in its LICENSE file is real and correct for its 200 lines of JavaScript —
// but `dist/phonemizer.js` is a 1.3 MB Emscripten build of eSpeak-NG and its
// `espeak-ng-data` dictionaries, which are GPL-3.0-or-later (#1092). Our generated
// notices would have said "phonemizer 1.2.1 — Apache-2.0" and never mentioned eSpeak-NG
// at all: a FALSE notice, in an MIT-licensed project, for a copyleft component we were
// conveying to every user.
//
// No text scan can catch that reliably. The GPL licence text is not in the compiled
// bundle — Emscripten does not carry it through, and the only literal "GPL" strings in
// the file are accidents of base64. What IS reliably detectable is the artifact itself: a
// wasm blob, an Emscripten packaged filesystem, a `.node` binary. So the guard does not
// try to identify licences by reading them. It finds every shipped package that contains
// a compiled artifact and requires a HUMAN to have written down what is inside it here.
//
// That is the point: this file is a record that someone looked. Adding a dependency that
// bundles a binary is a red build until its entry exists, and an entry that says
// `copyleft: true` is a red build permanently — which is what a GPL engine in a
// MIT-licensed extension should be.
//
// Every entry must name the embedded component specifically enough to be checkable, cite
// where its licence was read, and be reflected in THIRD-PARTY-NOTICES.md.

export const EMBEDDED = [
  {
    package: 'onnxruntime-web',
    embeds: 'ONNX Runtime, compiled to WebAssembly (dist/ort-*.wasm and its Emscripten glue)',
    license: 'MIT',
    copyleft: false,
    source: 'https://github.com/microsoft/onnxruntime — LICENSE is MIT, and the wasm builds are that same source',
    note:
      'The wasm is the engine every on-device model runs on. MIT is permissive and requires only ' +
      'the notice, which travels in THIRD-PARTY-NOTICES.md with the package itself.',
  },
  {
    package: '@huggingface/transformers',
    embeds: "onnxruntime-web's Emscripten runtime, re-bundled into dist/transformers*.js",
    license: 'MIT (the embedded runtime); Apache-2.0 (Transformers.js itself)',
    copyleft: false,
    source: 'https://github.com/huggingface/transformers.js — bundles onnxruntime-web, above',
    note:
      'The same MIT ONNX Runtime as the entry above, inlined by the Transformers.js build. Both ' +
      'licences are already reproduced in THIRD-PARTY-NOTICES.md.',
  },
  {
    package: 'pdfjs-dist',
    embeds: 'its own compiled worker and image decoders (build/pdf.worker.min.mjs, image_decoders)',
    license: 'Apache-2.0',
    copyleft: false,
    source: 'https://github.com/mozilla/pdf.js — one project, one licence; the build output is not third-party',
    note:
      'Listed for completeness rather than risk: the compiled artifacts are pdf.js compiling ITSELF, ' +
      'so the declared Apache-2.0 does cover them. The check cannot tell that apart from a bundled ' +
      'foreign engine, and a human confirming which it is once is the whole point.',
  },
];

// NOTE: `phonemizer` was REMOVED from the product, and so from this list. It is the reason
// the list exists — see the header, and #1092. Do not re-add it, or anything else that
// bundles a GPL/LGPL/AGPL engine, however permissive the wrapper's own licence field says
// the package is.
