// The model-attribution drift guard, checked against what it must catch and what it must pass.
//
// The bug it exists for (#669): the hand-maintained model list (scripts/model-notices.mjs) shipped
// omitting whisper-base, flan-t5-small, TinyLlama, SmolLM2-1.7B and the Tesseract trained data, and
// drifted from the committed notices. So the sheep (a complete, in-sync list) must pass and the
// wolves (a shipped model with no attribution, a stale attribution, an un-regenerated notices file)
// must fail — and the real shipped tree must be green today.
//
// And the bug the guard itself had (#1096): it reconciled the CDN manifests against the notices, so
// a model referenced only by a hardcoded id in extension source — never mirrored, never in a
// manifest — was invisible to it, and skipping the manifest skipped the licence check too. The
// source scan is the other end of that chain, so it gets its own wolves here.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shippedAssetKeys,
  noticeModelNames,
  driftErrors,
  sourceModelIds,
  extensionSourceTexts,
} from './check-model-notices.mjs';
import { MODELS } from './model-notices.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('shippedAssetKeys is the source model ids plus the collapsed language set', () => {
  const keys = shippedAssetKeys({ sourceIds: new Set(['Xenova/whisper-tiny', 'Xenova/flan-t5-small']) });
  assert.deepEqual([...keys].sort(), ['Xenova/flan-t5-small', 'Xenova/whisper-tiny', 'tesseract-langs']);
});

test('noticeModelNames reads the bold bullets under the on-device heading, not the npm list', () => {
  const notices =
    '# Third-party notices\n\n2 components:\n\n- some-pkg 1.0.0 — MIT\n\n---\n\n' +
    '# On-device models\n\n- **Whisper (base)** — Apache-2.0 — used by Voice to Text\n' +
    '- **Tesseract OCR trained data** — Apache-2.0 — used by Snaptext\n';
  assert.deepEqual([...noticeModelNames(notices)].sort(), ['Tesseract OCR trained data', 'Whisper (base)']);
});

test('noticeModelNames stops at the first `## ` detail heading — a bullet in later license text is ignored', () => {
  const notices =
    '# On-device models\n\n- **Widget** — Apache-2.0 — used by X\n\n' +
    '## Widget\n\nLicense: **Apache-2.0**\n\n' +
    '---\n\n## some-pkg 1.0.0\n\n```\n- **Not A Model** — a line inside a license file\n```\n';
  assert.deepEqual([...noticeModelNames(notices)], ['Widget']);
});

// A minimal in-sync world: one model, attributed, present in the notices.
const oneModel = [{ name: 'Widget', assets: ['Xenova/widget'] }];
const oneShipped = new Set(['Xenova/widget']);
const oneNotice = '# On-device models\n\n- **Widget** — Apache-2.0 — used by X\n';

test('a complete, in-sync list produces no errors', () => {
  assert.deepEqual(driftErrors({ shipped: oneShipped, models: oneModel, noticesText: oneNotice }), []);
});

test('a shipped asset with no attribution fails', () => {
  const shipped = new Set(['Xenova/widget', 'Xenova/unlisted']);
  const errors = driftErrors({ shipped, models: oneModel, noticesText: oneNotice });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Xenova\/unlisted[\s\S]*no entry/);
});

test('an attribution for something we no longer ship fails', () => {
  const models = [{ name: 'Widget', assets: ['Xenova/widget', 'Xenova/gone'] }];
  const notices = oneNotice; // 'Widget' is present, so only the stale-asset error should fire
  const errors = driftErrors({ shipped: oneShipped, models, noticesText: notices });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Xenova\/gone[\s\S]*stale attribution/);
});

test('a list entry missing from the notices fails (edited but never regenerated)', () => {
  const errors = driftErrors({ shipped: oneShipped, models: oneModel, noticesText: '# On-device models\n\n' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"Widget"[\s\S]*regenerate/);
});

test('a notice entry missing from the list fails (the notices were hand-edited)', () => {
  const notices = oneNotice + '- **Ghost** — Apache-2.0 — used by nothing\n';
  const errors = driftErrors({ shipped: oneShipped, models: oneModel, noticesText: notices });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"Ghost"[\s\S]*hand-edited/);
});

// --- The source scan: a model id shipped in code is a model we distribute ----------------------

test('sourceModelIds finds quoted Hugging Face ids and ignores comments', () => {
  const ids = sourceModelIds([
    "export const DEFAULT_MODEL = 'Xenova/whisper-tiny';\n",
    '// every id is a repo — see Xenova/not-a-real-model\n' +
      'const MODELS = ["Xenova/flan-t5-base", `Xenova/flan-t5-small`];\n',
    '/* onnx-community/also-a-comment */\nconst id = `onnx-community/Kokoro-82M-v1.0-ONNX`;\n',
  ]);
  assert.deepEqual(
    [...ids].sort(),
    [
      'Xenova/flan-t5-base',
      'Xenova/flan-t5-small',
      'Xenova/whisper-tiny',
      'onnx-community/Kokoro-82M-v1.0-ONNX',
    ].sort(),
  );
});

test('sourceModelIds does not match an id built into a longer string', () => {
  // A URL is not a model id — the id is the whole quoted literal, nothing more.
  const ids = sourceModelIds(["const u = 'https://huggingface.co/Xenova/whisper-tiny/resolve/main/x';\n"]);
  assert.deepEqual([...ids], []);
});

test('the real shipped tree is green today', () => {
  const sourceIds = sourceModelIds(extensionSourceTexts());
  // Sanity: the scan really did read the source tree (an empty scan would pass vacuously).
  assert.ok(sourceIds.size >= 5, `expected the extension's model ids, found ${sourceIds.size}`);
  const shipped = shippedAssetKeys({ sourceIds });
  const errors = driftErrors({ shipped, models: MODELS, noticesText: read('THIRD-PARTY-NOTICES.md') });
  assert.deepEqual(errors, [], errors.join('\n'));
});
