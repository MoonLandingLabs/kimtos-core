import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentModelId, hfFileUrl, DENOISER_URL } from './modelHosts.js';

test('hfFileUrl builds a Hugging Face resolve URL', () => {
  assert.equal(
    hfFileUrl('onnx-community/Kokoro-82M-v1.0-ONNX', 'voices/af_heart.bin'),
    'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin',
  );
  assert.equal(DENOISER_URL, 'https://huggingface.co/kimtos-labs/denoiser-dfn3/resolve/main/denoiser_model.onnx');
});

test('currentModelId maps ids saved by earlier versions and leaves others alone', () => {
  assert.equal(currentModelId('kimtos-labs/whisper-base'), 'Xenova/whisper-base');
  assert.equal(currentModelId('kimtos-labs/TinyLlama-1.1B-Chat-v1.0'), 'onnx-community/Qwen3-0.6B-ONNX');
  assert.equal(currentModelId('Xenova/whisper-small'), 'Xenova/whisper-small');
  assert.equal(currentModelId('kimtos-labs/unknown'), 'kimtos-labs/unknown');
});
