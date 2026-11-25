// evaluateModelFit (#269) — the pure comparison behind the pre-download resource warning. The
// behaviours that matter: a device below a model's RAM floor is a hard WARN (gated behind an ack
// in the UI), a device between the floor and the recommendation is a soft CAUTION, a missing
// measurement never warns (we don't block on absence of data), and WARN outranks CAUTION.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateModelFit, describeDevice, type ModelReq, type DeviceResources } from './deviceResources.js';

const MODEL: ModelReq = {
  minRamGB: 6,
  recRamGB: 8,
  downloadMB: 1200,
  needsWebGPU: false,
  recWebGPU: true,
};

describe('evaluateModelFit (#269)', () => {
  test('a capable device is ok with no reasons', () => {
    const res: DeviceResources = { ramGB: 8, webgpu: true, storageFreeGB: 20, cores: 8 };
    const fit = evaluateModelFit(MODEL, res);
    assert.equal(fit.level, 'ok');
    assert.deepEqual(fit.reasons, []);
  });

  test('below the RAM floor is a hard warn', () => {
    const res: DeviceResources = { ramGB: 4, webgpu: true, storageFreeGB: 20 };
    const fit = evaluateModelFit(MODEL, res);
    assert.equal(fit.level, 'warn');
    assert.match(fit.reasons[0], /RAM/);
  });

  test('between floor and recommended RAM is a caution, not a block', () => {
    // 7 GB: clears the 6 GB floor, under the 8 GB recommendation. webgpu present so no GPU note.
    const res: DeviceResources = { ramGB: 7, webgpu: true, storageFreeGB: 20 };
    const fit = evaluateModelFit(MODEL, res);
    assert.equal(fit.level, 'caution');
    assert.match(fit.reasons[0], /runs best/);
  });

  test('a recommended-GPU model on a no-WebGPU device cautions', () => {
    const res: DeviceResources = { ramGB: 8, webgpu: false, storageFreeGB: 20 };
    const fit = evaluateModelFit(MODEL, res);
    assert.equal(fit.level, 'caution');
    assert.ok(fit.reasons.some((r) => /GPU/.test(r)));
  });

  test('a required-GPU model on a no-WebGPU device warns', () => {
    const res: DeviceResources = { ramGB: 8, webgpu: false, storageFreeGB: 20 };
    const fit = evaluateModelFit({ ...MODEL, needsWebGPU: true }, res);
    assert.equal(fit.level, 'warn');
  });

  test('not enough free storage is a warn', () => {
    const res: DeviceResources = { ramGB: 8, webgpu: true, storageFreeGB: 0.5 };
    const fit = evaluateModelFit(MODEL, res);
    assert.equal(fit.level, 'warn');
    assert.ok(fit.reasons.some((r) => /free space/.test(r)));
  });

  test('a missing RAM reading never warns on RAM (can’t tell, don’t block)', () => {
    const res: DeviceResources = { webgpu: true, storageFreeGB: 20 }; // ramGB undefined
    const fit = evaluateModelFit(MODEL, res);
    // Only the recommended-GPU caution could apply, and webgpu is present, so this is ok.
    assert.equal(fit.level, 'ok');
  });

  test('warn outranks caution when both apply', () => {
    // Under the floor (warn) AND no GPU on a rec-GPU model (caution) → overall warn, both listed.
    const res: DeviceResources = { ramGB: 4, webgpu: false, storageFreeGB: 20 };
    const fit = evaluateModelFit(MODEL, res);
    assert.equal(fit.level, 'warn');
    assert.ok(fit.reasons.length >= 2);
  });
});

describe('describeDevice', () => {
  test('summarizes what is known and flags 8 GB as a cap', () => {
    const s = describeDevice({ cores: 8, ramGB: 8, webgpu: true, storageFreeGB: 42 });
    assert.match(s, /8 CPU cores/);
    assert.match(s, /8 GB RAM\+/); // deviceMemory caps at 8, so "+" signals "or more"
    assert.match(s, /WebGPU/);
  });

  test('handles a browser that reports nothing but WebGPU', () => {
    const s = describeDevice({ webgpu: false });
    assert.match(s, /no WebGPU/);
  });
});
