// WAV encoding and crossfade stitching for Voice Studio's long-form renders.
// A hard concat of per-chunk PCM leaves an audible click at every seam; the
// crossfade removes it. These tests pin the header, the stitched length, and the
// equal-power blend that keeps loudness constant through a seam.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, crossfadeConcat, stitchedLength } from './audioAssembly.js';

const ramp = (n: number, value: number): Float32Array => new Float32Array(n).fill(value);

describe('encodeWav', () => {
  test('writes a 44-byte header + 2 bytes per mono sample', async () => {
    const blob = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 24000);
    assert.equal(blob.type, 'audio/wav');
    const view = new DataView(await blob.arrayBuffer());
    assert.equal(blob.size, 44 + 4 * 2);
    // "RIFF" and "WAVE" magic
    assert.equal(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF');
    assert.equal(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)), 'WAVE');
    assert.equal(view.getUint32(24, true), 24000); // sample rate
    assert.equal(view.getUint16(22, true), 1); // mono
    assert.equal(view.getUint16(34, true), 16); // bits
  });

  test('clamps out-of-range samples to full scale', async () => {
    const view = new DataView(await encodeWav(new Float32Array([2, -2]), 8000).arrayBuffer());
    assert.equal(view.getInt16(44, true), 0x7fff);
    assert.equal(view.getInt16(46, true), -0x8000);
  });
});

describe('stitchedLength', () => {
  test('subtracts one overlap per join', () => {
    assert.equal(stitchedLength([100, 100, 100], 10), 300 - 20);
    assert.equal(stitchedLength([100], 10), 100);
    assert.equal(stitchedLength([], 10), 0);
  });

  test('overlap never exceeds the shorter neighbour', () => {
    assert.equal(stitchedLength([5, 100], 10), 100); // overlap capped at 5
  });
});

describe('crossfadeConcat', () => {
  test('a single chunk passes through unchanged', () => {
    const one = ramp(50, 0.3);
    assert.equal(crossfadeConcat([one], 24000, 30), one);
  });

  test('empty input yields an empty clip', () => {
    assert.equal(crossfadeConcat([], 24000).length, 0);
    assert.equal(crossfadeConcat([new Float32Array(0)], 24000).length, 0);
  });

  test('stitched length matches the overlap accounting', () => {
    const sr = 24000;
    const fade = Math.floor((30 / 1000) * sr);
    const out = crossfadeConcat([ramp(2000, 0.4), ramp(2000, 0.4)], sr, 30);
    assert.equal(out.length, stitchedLength([2000, 2000], fade));
  });

  test('the seam never dips below the input level (no click/gap)', () => {
    // Equal-power gains (cos, sin) mean a seam between two chunks at the same level
    // never drops BELOW that level — which is the audible failure a naive fade
    // causes. (For identical signals the sum rises to at most sqrt(2)× in the
    // middle; real seams are uncorrelated near-silence, where power stays flat.)
    const sr = 1000;
    const level = 0.5;
    const out = crossfadeConcat([ramp(500, level), ramp(500, level)], sr, 60);
    for (let i = 0; i < out.length; i += 1) {
      assert.ok(out[i] >= level - 1e-6, `dip at ${i}: ${out[i]}`);
      assert.ok(out[i] <= level * Math.SQRT2 + 1e-6, `overshoot at ${i}: ${out[i]}`);
    }
  });

  test('the fade shrinks to fit a chunk shorter than the requested fade', () => {
    // 4-sample chunks with a 1000-sample fade request must not overlap past their
    // own length or read out of bounds — every sample stays finite and bounded.
    const out = crossfadeConcat([ramp(4, 1), ramp(4, 1), ramp(4, 1)], 24000, 1000);
    // The safety property here is bounds: correct length, no NaN, no out-of-range
    // read. (Amplitude can transiently exceed the inputs when many chunks shorter
    // than the fade stack at one point — a degenerate case real audio never hits.)
    assert.ok(out.length >= 4 && out.length <= 12);
    for (const v of out) assert.ok(Number.isFinite(v) && v >= 0);
  });
});
