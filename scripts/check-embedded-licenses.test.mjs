// The guard that stops a permissive wrapper hiding a copyleft engine (#1092).
//
// The fixtures below are shaped on the real case: `phonemizer@1.2.1` declares
// `"license": "Apache-2.0"` and ships `dist/phonemizer.js`, a 1.3 MB Emscripten build of
// GPL-3.0 eSpeak-NG with its `espeak-ng-data` filesystem packaged inside. A guard that
// would not have caught that is theatre, so the first test IS that case.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { binaryEvidence, driftErrors, shippedPackages } from './check-embedded-licenses.mjs';

const file = (path, size, text = '') => [path, size, () => text];

// The Emscripten symbols really present in phonemizer's bundle. Note what is NOT here:
// any licence text. The GPL header does not survive the compile, which is why this guard
// looks for the artifact and not for words.
const EMSCRIPTEN = 'var A=void 0;A.expectedDataFileDownloads++;A.FS_createPath("/","usr");_emscripten_memcpy_big';

describe('binaryEvidence', () => {
  test('catches an engine compiled into JavaScript — the phonemizer case', () => {
    const reasons = binaryEvidence([
      file('package.json', 1200, '{"license":"Apache-2.0"}'),
      file('LICENSE', 11000, 'Apache License Version 2.0'),
      file('dist/phonemizer.js', 1_322_380, EMSCRIPTEN),
    ]);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /dist\/phonemizer\.js/);
  });

  test('catches a wasm blob and an Emscripten packaged filesystem', () => {
    assert.equal(binaryEvidence([file('dist/ort.wasm', 9_000_000)]).length, 1);
    assert.equal(binaryEvidence([file('data/espeak-ng-data.data', 5_000_000)]).length, 1);
    assert.equal(binaryEvidence([file('build/Release/addon.node', 400_000)]).length, 1);
  });

  test('leaves ordinary JavaScript alone', () => {
    const reasons = binaryEvidence([
      file('index.js', 40_000, 'export const marked = () => {};'),
      file('README.md', 9000, 'HEAPU8 is mentioned in this prose'),
      // Large, but nothing compiled in it.
      file('dist/bundle.js', 800_000, 'a'.repeat(100)),
    ]);
    assert.deepEqual(reasons, []);
  });

  test('does not read small files at all, so prose in them cannot trip it', () => {
    assert.deepEqual(binaryEvidence([file('tiny.js', 100, EMSCRIPTEN)]), []);
  });
});

describe('driftErrors', () => {
  const shipped = [{ name: 'phonemizer', version: '1.2.1', license: 'Apache-2.0' }];
  const evidence = new Map([['phonemizer', ['dist/phonemizer.js is JavaScript with a compiled engine inside it']]]);

  test('an unrecorded embedded artifact fails, and says what to do', () => {
    const errors = driftErrors({ shipped, evidence, ledger: [] });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /nobody has recorded the licence of/);
    assert.match(errors[0], /embedded-binaries\.mjs/);
  });

  test('a recorded permissive artifact passes', () => {
    const ledger = [{ package: 'phonemizer', embeds: 'something MIT', license: 'MIT', copyleft: false }];
    assert.deepEqual(driftErrors({ shipped, evidence, ledger }), []);
  });

  // Recording it is not the same as allowing it. This is the outcome #1092 needed.
  test('a recorded COPYLEFT artifact fails permanently', () => {
    const ledger = [{ package: 'phonemizer', embeds: 'eSpeak-NG', license: 'GPL-3.0-or-later', copyleft: true }];
    const errors = driftErrors({ shipped, evidence, ledger });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /eSpeak-NG/);
    assert.match(errors[0], /cannot ship/);
  });

  test('a package with no embedded artifact needs no entry', () => {
    assert.deepEqual(
      driftErrors({
        shipped: [{ name: 'marked', version: '18.0.7', license: 'MIT' }],
        evidence: new Map(),
        ledger: [],
      }),
      [],
    );
  });

  test('a ledger entry for a package we no longer ship is stale and fails', () => {
    const errors = driftErrors({
      shipped: [],
      evidence: new Map(),
      ledger: [{ package: 'phonemizer', embeds: 'eSpeak-NG', license: 'GPL-3.0-or-later', copyleft: false }],
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /stale entry/);
  });
});

describe('shippedPackages', () => {
  test('reads the generated component list, and stops before the model section', () => {
    const notices = [
      '# Third-party notices',
      '',
      '3 components:',
      '',
      '- marked 18.0.7 — MIT',
      '- @huggingface/transformers 4.2.0 — Apache-2.0',
      '- onnxruntime-web 1.27.0 — MIT',
      '',
      '# On-device models',
      '',
      '- **Kokoro-82M v1.0 (ONNX)** — Apache-2.0 — used by Voice Studio',
    ].join('\n');
    const shipped = shippedPackages(notices);
    assert.deepEqual(
      shipped.map((p) => p.name),
      ['marked', '@huggingface/transformers', 'onnxruntime-web'],
    );
    assert.equal(shipped[1].license, 'Apache-2.0');
  });
});
